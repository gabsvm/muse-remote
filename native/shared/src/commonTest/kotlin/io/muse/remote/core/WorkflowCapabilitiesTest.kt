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

class WorkflowCapabilitiesTest {
    private val headers = headersOf(HttpHeaders.ContentType, "application/json")
    private val account = ServerCredentials("https://example.com", "0123456789abcdef")

    @Test fun preciseUnqueueCannotCancelAnotherTurn() = runBlocking {
        val calls = mutableListOf<JsonObject>()
        val mock = MockEngine { req ->
            if (req.url.encodedPath == "/api/command-id")
                respond("""{"ok":true,"commandId":"0199d4dd-0000-7000-8000-000000000001"}""", headers = headers)
            else {
                calls += Json.parseToJsonElement((req.body as TextContent).text).jsonObject
                respond("""{"ok":true,"result":{"commandId":"cmd1","turnId":"turn-42","status":"accepted"}}""",
                    headers = headers)
            }
        }
        val g = MuseGateway(HttpClient(mock))
        try {
            g.authorize(account)
            g.unqueue("session-a", "turn-42")
            assertEquals("turn/unqueue", calls.single()["method"]?.jsonPrimitive?.content)
            val args = calls.single()["params"]!!.jsonObject
            assertEquals("turn-42", args["turnId"]!!.jsonPrimitive.content)
            assertEquals("session-a", args["sessionId"]!!.jsonPrimitive.content)
            assertFailsWith<IllegalArgumentException> { g.unqueue("session-a", "") }
            assertEquals(1, calls.size)
        } finally { g.close() }
    }

    @Test fun taskInventoryAndTargetedStopAreDistinctContracts() = runBlocking {
        val calls = mutableListOf<JsonObject>()
        val mock = MockEngine { req ->
            if (req.url.encodedPath == "/api/command-id")
                respond("""{"ok":true,"commandId":"0199d4dd-0000-7000-8000-000000000001"}""", headers = headers)
            else {
                val cmd = Json.parseToJsonElement((req.body as TextContent).text).jsonObject
                calls += cmd
                respond(if(cmd["method"]?.jsonPrimitive?.content == "task/list")
                    """{"ok":true,"result":{"tasks":[{"taskId":"task-1","tool":"exec","executionMode":"background","status":"inProgress"}]}}"""
                    else """{"ok":true,"result":{"status":"accepted"}}""", headers = headers)
            }
        }
        val g = MuseGateway(HttpClient(mock))
        try {
            g.authorize(account)
            assertEquals("task-1", g.listTasks("session-a").single().taskId)
            g.stopTask("session-a", "task-1")
            assertEquals(listOf("task/list","task/stop"),
                calls.map { it["method"]!!.jsonPrimitive.content })
            assertEquals("task-1",
                calls.last()["params"]!!.jsonObject["taskId"]!!.jsonPrimitive.content)
        } finally { g.close() }
    }

    @Test fun invocationIsTypedAndConstrainedToHostCatalog() = runBlocking {
        val calls = mutableListOf<JsonObject>()
        val mock = MockEngine { req ->
            if (req.url.encodedPath == "/api/command-id")
                respond("""{"ok":true,"commandId":"0199d4dd-0000-7000-8000-000000000001"}""", headers = headers)
            else {
                val cmd = Json.parseToJsonElement((req.body as TextContent).text).jsonObject
                calls += cmd
                respond(if(cmd["method"]?.jsonPrimitive?.content == "skill/list")
                    """{"ok":true,"result":{"skills":[{"selector":"review","displayName":"Review","description":"","source":"builtin"}]}}"""
                    else """{"ok":true,"result":{"status":"accepted","turnId":"turn1","disposition":"queued"}}""",
                    headers = headers)
            }
        }
        val g = MuseGateway(HttpClient(mock))
        try {
            g.authorize(account)
            g.invokeSkill("s1", "review", "Only tests")
            val turn = calls.last()["params"]!!.jsonObject
            val part = turn["input"]!!.jsonArray.single().jsonObject
            assertEquals("skill", part["type"]!!.jsonPrimitive.content)
            assertEquals("review", part["selector"]!!.jsonPrimitive.content)
            assertEquals("Only tests", part["arguments"]!!.jsonPrimitive.content)
            assertFailsWith<IllegalArgumentException> { g.invokeSkill("s1","not-in-catalog","") }
            assertEquals(2, calls.count { it["method"]!!.jsonPrimitive.content == "skill/list" })
            assertEquals(1, calls.count { it["method"]!!.jsonPrimitive.content == "turn/start" })
        } finally { g.close() }
    }

    @Test fun storedPatchAndWorktreeReadHaveExactReadOnlyContracts() = runBlocking {
        val calls = mutableListOf<JsonObject>()
        val mock = MockEngine { req ->
            val rpc = Json.parseToJsonElement((req.body as TextContent).text).jsonObject
            calls += rpc
            val method = rpc.getValue("method").jsonPrimitive.content
            respond(when(method) {
                "worktree/list" -> """{"ok":true,"result":{"worktrees":[
                    {"path":"C:\\\\Dev\\\\repo","branch":"main","isMain":true,"sessionIds":["s1"]}]}}"""
                "item/readOutput" -> """{"ok":true,"result":{"encoding":"utf8","content":"diff --git a/a b/a",
                    "eof":true,"byteLen":18,"offsetBytes":0,"mediaType":"application/json"}}"""
                else -> """{"ok":true,"result":{}}"""
            }, headers = headers)
        }
        val g = MuseGateway(HttpClient(mock))
        try {
            g.authorize(account)
            assertEquals("main", g.listWorktrees("C:/Dev/repo").single().branch)
            assertEquals("diff --git a/a b/a", g.patchText("s1", "item-2", "ref-3"))
            assertEquals(listOf("worktree/list","item/readOutput"),
                calls.map { it.getValue("method").jsonPrimitive.content })
            assertEquals("ref-3", calls.last()["params"]!!.jsonObject["outputRef"]!!.jsonPrimitive.content)
            assertFailsWith<IllegalArgumentException> { g.listWorktrees("") }
            assertEquals(2,calls.size)
        } finally { g.close() }
    }

    @Test fun draftPersistsLocallyWithoutModelInvocation() {
        val store = MemoryCredentialsStore()
        store.saveDraft("session-a", "Revision pendiente")
        assertEquals("Revision pendiente", store.drafts()["session-a"])
        store.saveDraft("session-a", "")
        assertFalse(store.drafts().containsKey("session-a"))
        val queued = QueuedEntry.from(buildJsonObject {
            put("sequence", 10L); put("text", "Second prompt")
        })
        assertEquals(10L, queued?.sequence)
        assertNull(QueuedEntry.from(buildJsonObject { put("text","unknown") }))
    }
}
