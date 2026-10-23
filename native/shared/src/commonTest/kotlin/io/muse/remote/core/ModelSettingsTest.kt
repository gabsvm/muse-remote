package io.muse.remote.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.*
import io.ktor.http.content.TextContent
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import kotlin.test.*

/** No Muse CLI, real subscriptions or personal sessions are contacted by these tests. */
class ModelSettingsTest {
    private val mime = headersOf(HttpHeaders.ContentType, "application/json")
    private fun parseRequest(payload: String): JsonObject =
        Json.parseToJsonElement(payload).jsonObject

    @Test fun catalogUsesMspLabelsAndScopedActiveModel() = runBlocking {
        val requests = mutableListOf<JsonObject>()
        val engine = MockEngine { request ->
            val rpc = parseRequest((request.body as TextContent).text)
            requests += rpc
            respond("""{"ok":true,"result":{"models":[
                {"modelId":"muse-spark-1.3","displayLabel":"Spark 1.3","isActive":true},
                {"modelId":"muse-spark-1.2","displayLabel":"Spark 1.2","isActive":false}
            ]}}""", headers = mime)
        }
        val gateway = MuseGateway(HttpClient(engine))
        try {
            gateway.authorize(ServerCredentials("https://example.com", "0123456789abcdef"))
            val models = gateway.listModels("session-A")
            assertEquals(2, models.size)
            assertEquals("Spark 1.3", models[0].label)
            assertEquals("muse-spark-1.3", models[0].id)
            assertTrue(models[0].isActive)
            assertFalse(models[1].isActive)
            assertEquals("model/list", requests.single().getValue("method").jsonPrimitive.content)
            assertEquals("session-A", requests.single().getValue("params").jsonObject.getValue("sessionId").jsonPrimitive.content)
        } finally { gateway.close() }
    }

    @Test fun catalogFallsBackToUnscopedQueryWhenOlderHostRejectsSession() = runBlocking {
        val calls = mutableListOf<JsonObject>()
        val engine = MockEngine { request ->
            val req = parseRequest((request.body as TextContent).text)
            calls += req
            if (req.getValue("params").jsonObject.containsKey("sessionId"))
                respond("""{"ok":false,"error":"sessionNotLoaded"}""", HttpStatusCode.BadGateway, mime)
            else respond("""{"ok":true,"result":{"models":[{"modelId":"spark","isActive":true}]}}""",
                headers = mime)
        }
        val gateway = MuseGateway(HttpClient(engine))
        try {
            gateway.authorize(ServerCredentials("https://example.com", "0123456789abcdef"))
            assertEquals("spark", gateway.listModels("old-session").single().id)
            assertEquals(2, calls.size)
            assertFalse(calls.last().getValue("params").jsonObject.containsKey("sessionId"))
        } finally { gateway.close() }
    }

    @Test fun settingsUseExactMspContractAndCommandIds() = runBlocking {
        val calls = mutableListOf<JsonObject>()
        val engine = MockEngine { request ->
            if (request.url.encodedPath == "/api/command-id") {
                respond("""{"ok":true,"commandId":"00000000-0000-7000-8000-000000000001"}""", headers=mime)
            } else {
                calls += parseRequest((request.body as TextContent).text)
                respond("""{"ok":true,"result":{}}""", headers=mime)
            }
        }
        val gateway = MuseGateway(HttpClient(engine))
        try {
            gateway.authorize(ServerCredentials("https://example.com", "0123456789abcdef"))
            gateway.setModel("session-A", "muse-spark-1.3")
            gateway.setReasoningEffort("session-A", "high")
            assertEquals("session/setModel", calls[0].getValue("method").jsonPrimitive.content)
            val setModel = calls[0].getValue("params").jsonObject
            assertEquals("session-A", setModel.getValue("sessionId").jsonPrimitive.content)
            assertEquals("muse-spark-1.3", setModel.getValue("model").jsonObject.getValue("modelId").jsonPrimitive.content)
            assertEquals("00000000-0000-7000-8000-000000000001", setModel.getValue("commandId").jsonPrimitive.content)
            assertEquals("session/setReasoningEffort", calls[1].getValue("method").jsonPrimitive.content)
            assertEquals("high", calls[1].getValue("params").jsonObject.getValue("reasoningEffort").jsonPrimitive.content)
            assertEquals("session-A", calls[1].getValue("params").jsonObject.getValue("sessionId").jsonPrimitive.content)
            assertFailsWith<IllegalArgumentException> { gateway.setReasoningEffort("session-A", "unsupported") }
            assertEquals(2, calls.size)
        } finally { gateway.close() }
    }

    @Test fun controllerOnlyConfirmsChangesAfterSuccessAndRetainsValuesOnFailure() = runBlocking {
        var rejectEffort = false
        val engine = MockEngine { request ->
            val body = (request.body as? TextContent)?.text
            val req = body?.let(::parseRequest)
            val method = req?.get("method")?.jsonPrimitive?.content
            val params = req?.get("params")?.jsonObject
            val response = when {
                request.url.encodedPath == "/api/health" -> """{"ok":true,"mspReady":true}"""
                request.url.encodedPath == "/api/command-id" ->
                    """{"ok":true,"commandId":"00000000-0000-7000-8000-000000000001"}"""
                method == "model/list" -> """{"ok":true,"result":{"models":[
                    {"modelId":"spark-a","displayLabel":"Spark A","isActive":true},
                    {"modelId":"spark-b","displayLabel":"Spark B","isActive":false}]}}"""
                method == "session/list" -> """{"ok":true,"result":{"sessions":[
                    {"sessionId":"s1","name":"Sample","modelId":"spark-a"}]}}"""
                method == "session/resume" -> """{"ok":true,"result":{"session":{
                    "sessionId":"s1","modelId":"spark-a","reasoningEffort":"medium","status":"idle"
                    },"history":{"items":[]}}}"""
                method == "session/read" -> """{"ok":true,"result":{"session":{"status":"idle"},"history":{"items":[]}}}"""
                method == "approval/listPending" -> """{"ok":true,"result":{"approvals":[]}}"""
                method == "session/setReasoningEffort" && rejectEffort -> """{"ok":false,"error":"effortUnsupported"}"""
                else -> """{"ok":true,"result":{}}"""
            }
            respond(response,
                status = if (method == "session/setReasoningEffort" && rejectEffort)
                    HttpStatusCode.BadGateway else HttpStatusCode.OK,
                headers = mime)
        }
        val controller = MuseController(MuseGateway(HttpClient(engine)), MemoryCredentialsStore())
        suspend fun await(predicate: () -> Boolean) {
            withTimeout(10000) { while (!predicate()) delay(20) }
        }
        try {
            controller.connect("https://example.com", "0123456789abcdef")
            await { controller.state.value.authenticated }
            controller.openSession("s1")
            await { controller.state.value.sessionReady && controller.state.value.models.size == 2 }
            assertEquals("spark-a", controller.state.value.activeModelId)
            assertEquals("medium", controller.state.value.reasoningEffort)
            controller.changeModel("spark-b")
            await { controller.state.value.activeModelId == "spark-b" }
            assertNull(controller.state.value.reasoningEffort)
            controller.changeReasoningEffort("high")
            await { controller.state.value.reasoningEffort == "high" }
            rejectEffort = true
            controller.changeReasoningEffort("ultra")
            await { controller.state.value.modelSettingsError != null }
            assertEquals("high", controller.state.value.reasoningEffort,
                "Failed change must never be presented as active")
            assertTrue(controller.state.value.modelSettingsError!!.contains("effortUnsupported"))
        } finally { controller.close() }
    }
}
