package io.muse.remote.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import io.ktor.http.content.TextContent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import kotlin.test.*

class DiffReviewTest {
    @Test fun unifiedDiffGroupsFilesAndClassifiesLines() {
        val raw = """
            diff --git a/src/a.kt b/src/a.kt
            --- a/src/a.kt
            +++ b/src/a.kt
            @@ -1,2 +1,2 @@
            -val old = 1
            +val new = 2
             unchanged()
            diff --git a/src/b.kt b/src/b.kt
            @@ -4 +4 @@
            -println(1)
            +println(2)
        """.trimIndent()
        val result = parseDiffReview(raw)
        assertEquals(2, result.files.size)
        assertEquals("src/a.kt", result.files[0].path)
        assertEquals(1, result.files[0].additions)
        assertEquals(1, result.files[0].removals)
        assertEquals("added", result.files[0].lines.first { it.value.startsWith("+val") }.type)
        assertEquals("src/b.kt", result.files[1].path)
    }

    @Test fun jsonPatchSupportsLineObjectsAndLiteralStrings() {
        val raw = """{"files":[{"path":"src/App.kt","hunks":[{"header":"@@ -1 +1 @@",
          "lines":[{"kind":"remove","text":"before"},{"kind":"add","text":"after"}]}]},
          {"newPath":"readme.md","lines":["-old","+new"]}]}"""
        val result = parseDiffReview(raw)
        assertEquals(2, result.files.size)
        assertEquals("src/App.kt", result.files[0].path)
        assertEquals(1, result.files[0].additions)
        assertEquals(1, result.files[0].removals)
        assertEquals("readme.md", result.files[1].path)
        assertEquals("removed", result.files[1].lines[0].type)
    }

    @Test fun unknownOrInvalidSchemaNeverProducesFabricatedPatch() {
        val raw = """{"weird":{"credentials":"not a diff"}}"""
        val result = parseDiffReview(raw)
        assertFalse(result.recognized)
        assertEquals(raw, result.fallback)
        assertFalse(parseDiffReview("{broken").recognized)
        assertFalse(parseDiffReview("no patch").recognized)
    }

    @Test fun patchInputIsBounded() {
        val doc = parseDiffReview("x".repeat(120000))
        assertEquals(50000, doc.fallback.length)
    }

    @Test fun snapshotAndInlineHistoriesExposeSameTypedItems() {
        val item = buildJsonObject {
            put("kind", "subagent")
            put("itemId", "item1")
            put("subagentId", "child1")
            put("status", "completed")
        }
        val inline = buildJsonObject {
            put("mode", "inline")
            putJsonArray("items") { add(item) }
        }
        val compacted = buildJsonObject {
            put("mode", "snapshot")
            put("items", JsonNull)
            put("snapshot", buildJsonObject {
                put("schemaVersion",1)
                put("state", buildJsonObject {
                    putJsonArray("items") { add(item) }
                })
            })
        }
        assertEquals(historyItemObjects(inline), historyItemObjects(compacted))
        assertEquals("child1", SubagentRow.from(historyItemObjects(compacted).single())?.subagentId)
        assertEquals(emptyList(), historyItemObjects(null))
        assertEquals(emptyList(), historyItemObjects(buildJsonObject {}))
    }

    @Test fun subagentItemParserRequiresOpaqueDurableId() {
        val item = buildJsonObject {
            put("itemId","item-1")
            put("subagentId","opaque-child-1")
            put("kind","subagent")
            put("status","inProgress")
            put("controlStatus","running")
            put("agentPath","roles/code-review.md")
            put("result", buildJsonObject {
                put("summary","Found two concerns")
                putJsonArray("artifactRefs") { add("artifact1") }
            })
        }
        val row = SubagentRow.from(item)
        assertNotNull(row)
        assertEquals("code-review.md", row.name)
        assertTrue(row.running)
        assertEquals(1,row.artifactCount)
        assertEquals("Found two concerns",row.summary)
        assertNull(SubagentRow.from(buildJsonObject { put("kind","subagent") }))
        assertNull(SubagentRow.from(buildJsonObject {
            put("kind","toolCall"); put("itemId","1"); put("subagentId","2")
        }))
    }

    @Test fun targetedSubagentControlsUseTypedWireParams() = runBlocking {
        val calls = mutableListOf<JsonObject>()
        val headers = headersOf(HttpHeaders.ContentType, "application/json")
        val mock = MockEngine { req ->
            if (req.url.encodedPath == "/api/command-id")
                respond("""{"ok":true,"commandId":"0199d4dd-0000-7000-8000-000000000001"}""",
                    headers=headers)
            else {
                calls += Json.parseToJsonElement((req.body as TextContent).text).jsonObject
                respond("""{"ok":true,"result":{"status":"accepted"}}""",headers=headers)
            }
        }
        val g = MuseGateway(HttpClient(mock))
        try {
            g.authorize(ServerCredentials("https://example.com","0123456789abcdef"))
            g.subagentAction("s1","c1","subagent/sendMessage","  Check tests  ")
            g.subagentAction("s1","c1","subagent/followupTask","Follow up")
            g.subagentAction("s1","c1","subagent/stop")
            assertEquals(listOf("subagent/sendMessage","subagent/followupTask","subagent/stop"),
                calls.map { it["method"]!!.jsonPrimitive.content })
            val p = calls.first()["params"]!!.jsonObject
            assertEquals("c1",p["subagentId"]!!.jsonPrimitive.content)
            assertEquals("Check tests",p["body"]!!.jsonPrimitive.content)
            assertFalse(calls.last()["params"]!!.jsonObject.containsKey("body"))
            assertFailsWith<IllegalArgumentException> {
                g.subagentAction("s1","c1","subagent/resume")
            }
            assertFailsWith<IllegalArgumentException> {
                g.subagentAction("s1","c1","subagent/sendMessage"," ")
            }
            assertEquals(3,calls.size)
        } finally {g.close()}
    }
}
