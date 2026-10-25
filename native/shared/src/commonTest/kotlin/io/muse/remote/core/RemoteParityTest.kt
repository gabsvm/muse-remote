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

class RemoteParityTest {
    private val h = headersOf(HttpHeaders.ContentType, "application/json")
    private val token = ServerCredentials("https://example.com", "0123456789abcdef")

    @Test fun steeringRequiresExactActiveTurnAndUsesContentParts() = runBlocking {
        val calls = mutableListOf<JsonObject>()
        val engine = MockEngine { req ->
            if (req.url.encodedPath == "/api/command-id")
                respond("""{"ok":true,"commandId":"0199d4dd-0000-7000-8000-000000000001"}""", headers = h)
            else {
                calls.add(Json.parseToJsonElement((req.body as TextContent).text).jsonObject)
                respond("""{"ok":true,"result":{}}""", headers = h)
            }
        }
        val g = MuseGateway(HttpClient(engine))
        try {
            g.authorize(token)
            g.steer("session-1", "turn-1", "Use smaller changes")
            val rpc = calls.single()
            assertEquals("turn/steer", rpc.getValue("method").jsonPrimitive.content)
            val p = rpc.getValue("params").jsonObject
            assertEquals("turn-1", p.getValue("expectedTurnId").jsonPrimitive.content)
            assertEquals("session-1", p.getValue("sessionId").jsonPrimitive.content)
            val text = p.getValue("input").jsonArray.single().jsonObject
            assertEquals("text", text.getValue("type").jsonPrimitive.content)
            assertEquals("Use smaller changes", text.getValue("text").jsonPrimitive.content)
            assertFailsWith<IllegalArgumentException> { g.steer("session-1", "", "message") }
            assertEquals(1, calls.size)
        } finally { g.close() }
    }

    @Test fun sessionForkCompactAndApprovalModeHaveClosedParameterContracts() = runBlocking {
        val calls = mutableListOf<JsonObject>()
        val engine = MockEngine { req ->
            if (req.url.encodedPath == "/api/command-id")
                respond("""{"ok":true,"commandId":"0199d4dd-0000-7000-8000-000000000001"}""", headers = h)
            else {
                val rpc = Json.parseToJsonElement((req.body as TextContent).text).jsonObject
                calls += rpc
                val method = rpc.getValue("method").jsonPrimitive.content
                respond(if (method == "session/fork")
                    """{"ok":true,"result":{"session":{"sessionId":"new-session"}}}"""
                    else """{"ok":true,"result":{}}""", headers = h)
            }
        }
        val g = MuseGateway(HttpClient(engine))
        try {
            g.authorize(token)
            assertEquals("new-session", g.forkSession("s1"))
            g.compactSession("s1")
            g.setApprovalMode("s1", "denyUnmatched")
            assertEquals(listOf("session/fork", "session/compact", "session/setApprovalMode"),
                calls.map { it.getValue("method").jsonPrimitive.content })
            val a = calls.last().getValue("params").jsonObject
            assertEquals("denyUnmatched", a.getValue("mode").jsonPrimitive.content)
            assertEquals("s1", a.getValue("sessionId").jsonPrimitive.content)
            assertFailsWith<IllegalArgumentException> { g.setApprovalMode("s1", "unsafeNonexistent") }
            assertEquals(3, calls.size)
        } finally { g.close() }
    }

    @Test fun usageNeverInventedAndSkillCatalogTyped() = runBlocking {
        val calls = mutableListOf<JsonObject>()
        val engine = MockEngine { req ->
            val rpc = Json.parseToJsonElement((req.body as TextContent).text).jsonObject
            calls += rpc
            val method = rpc.getValue("method").jsonPrimitive.content
            val content = when(method) {
                "usage/read" -> """{"ok":true,"result":{"usage":{
                  "tier":"contributor","observedAtMs":1792914000000,
                  "window":{"usedPercent":23,"resetsAtMs":1792914100000,"windowDurationMins":300},
                  "weekly":{"usedPercent":12,"resetsAtMs":1793000000000}}}}"""
                "skill/list" -> """{"ok":true,"result":{"skills":[
                  {"selector":"review","displayName":"Review","description":"Review source"},
                  {"selector":"fix","displayName":"Fix","description":"Fix bug"}]}}"""
                else -> """{"ok":true,"result":{}}"""
            }
            respond(content, headers = h)
        }
        val g = MuseGateway(HttpClient(engine))
        try {
            g.authorize(token)
            val usage = g.usageSnapshot()
            assertNotNull(usage)
            assertEquals(23, usage.windowUsedPercent)
            assertEquals(12, usage.weeklyUsedPercent)
            assertEquals("contributor", usage.tier)
            assertEquals(listOf("review", "fix"), g.listSkills("session-1").map { it.selector })
            assertEquals("session-1",
                calls.last().getValue("params").jsonObject.getValue("sessionId").jsonPrimitive.content)
        } finally { g.close() }
        assertNull(SubscriptionSnapshot.from(buildJsonObject {}))
    }
}
