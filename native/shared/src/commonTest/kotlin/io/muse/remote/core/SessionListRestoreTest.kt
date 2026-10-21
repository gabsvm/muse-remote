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

class SessionListRestoreTest {
    private suspend fun awaitValue(predicate: () -> Boolean) {
        withTimeout(10_000L) {
            while (!predicate()) delay(20)
        }
    }

    @Test fun delayedSessionsDoNotAppearAsEmptyAndSavedLoginRestores() = runBlocking {
        val memory = MemoryCredentialsStore()
        memory.save(ServerCredentials("https://example.com", "0123456789abcdef"))
        val engine = MockEngine { request ->
            val method = (request.body as? TextContent)?.text?.let {
                runCatching { Json.parseToJsonElement(it).jsonObject["method"]?.jsonPrimitive?.content }.getOrNull()
            }
            val answer = when {
                request.url.encodedPath == "/api/health" ->
                    """{"ok":true,"mspReady":true}"""
                method == "session/list" -> {
                    delay(650)
                    """{"ok":true,"result":{"sessions":[{"sessionId":"s1","name":"Sesión recuperada"}]}}"""
                }
                else -> """{"ok":true,"result":{}}"""
            }
            respond(answer, headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val controller = MuseController(MuseGateway(HttpClient(engine)), memory)
        try {
            assertTrue(controller.state.value.restoringConnection,
                "Saved login must display restoring screen before bootstrap")
            controller.bootstrap()
            awaitValue { controller.state.value.authenticated }
            awaitValue { controller.state.value.sessionsLoading }
            assertFalse(controller.state.value.sessionsLoaded,
                "Unfinished list must not look like a confirmed empty result")
            assertTrue(controller.state.value.sessions.isEmpty())
            awaitValue { controller.state.value.sessionsLoaded }
            assertFalse(controller.state.value.sessionsLoading)
            assertEquals("s1", controller.state.value.sessions.single().id)
            assertFalse(controller.state.value.restoringConnection)
        } finally { controller.close() }
    }

    @Test fun listErrorsStayVisibleAndDoNotErasePreviouslyLoadedSessions() = runBlocking {
        var failList = false
        val engine = MockEngine { request ->
            val method = (request.body as? TextContent)?.text?.let {
                runCatching { Json.parseToJsonElement(it).jsonObject["method"]?.jsonPrimitive?.content }.getOrNull()
            }
            val reply = when {
                request.url.encodedPath == "/api/health" ->
                    """{"ok":true,"mspReady":true}"""
                method == "session/list" && failList ->
                    """{"ok":false,"error":"test listing unavailable"}"""
                method == "session/list" ->
                    """{"ok":true,"result":{"sessions":[{"sessionId":"s1","name":"Conservada"}]}}"""
                else -> """{"ok":true,"result":{}}"""
            }
            respond(reply, headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val controller = MuseController(MuseGateway(HttpClient(engine)), MemoryCredentialsStore())
        try {
            controller.connect("https://example.com", "0123456789abcdef")
            awaitValue { controller.state.value.sessionsLoaded }
            assertEquals(1, controller.state.value.sessions.size)
            failList = true
            controller.refreshSessions()
            awaitValue { !controller.state.value.sessionsLoading }
            assertNotNull(controller.state.value.sessionsError)
            assertEquals(1, controller.state.value.sessions.size)
        } finally { controller.close() }
    }

    @Test fun transientFailureCanRetryWithSavedCredentialsWithoutEnteringToken() = runBlocking {
        var online = false
        val memory = MemoryCredentialsStore().apply {
            save(ServerCredentials("https://example.com", "0123456789abcdef"))
        }
        val engine = MockEngine { request ->
            val answer = if (!online) """{"ok":false,"error":"offline"}"""
                else if (request.url.encodedPath == "/api/health")
                    """{"ok":true,"mspReady":true}"""
                else """{"ok":true,"result":{"sessions":[]}}"""
            respond(answer, status = if (online) HttpStatusCode.OK else HttpStatusCode.ServiceUnavailable,
                headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val controller = MuseController(MuseGateway(HttpClient(engine)), memory)
        try {
            controller.bootstrap()
            awaitValue { !controller.state.value.restoringConnection }
            assertFalse(controller.state.value.authenticated)
            assertTrue(controller.state.value.savedConnectionAvailable)
            assertNotNull(memory.read())
            online = true
            controller.retrySavedConnection()
            awaitValue { controller.state.value.authenticated }
            assertTrue(controller.state.value.savedConnectionAvailable)
            assertTrue(controller.state.value.sessionsLoading || controller.state.value.sessionsLoaded)
        } finally { controller.close() }
    }
}
