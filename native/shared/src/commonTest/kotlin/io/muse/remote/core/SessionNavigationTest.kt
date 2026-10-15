package io.muse.remote.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.*
import io.ktor.http.content.TextContent
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import kotlin.test.*

/** Regression: a slow MSP resume must not freeze the sessions screen. */
class SessionNavigationTest {

    private fun respondFor(request: HttpRequestData, resumeFails: Boolean): Pair<Int, String> {
        val method = (request.body as? TextContent)?.text?.let {
            runCatching {
                (Json.parseToJsonElement(it) as? JsonObject)?.get("method")?.jsonPrimitive?.content
            }.getOrNull()
        }
        return when {
            request.url.encodedPath == "/api/health" -> 200 to
                """{"ok":true,"mspReady":true}"""
            method == "session/list" -> 200 to
                """{"ok":true,"result":{"sessions":[{"sessionId":"s1","name":"Sesión original"}]}}"""
            method == "session/resume" && resumeFails -> 502 to
                """{"ok":false,"error":"No se pudo reanudar"}"""
            method == "session/resume" -> 200 to
                """{"ok":true,"result":{"session":{"sessionId":"s1","name":"Sesión original","status":"idle"},"history":{"items":[{"itemId":"i1","kind":"userMessage","text":"Hola"}]}}}"""
            method == "session/read" -> 200 to
                """{"ok":true,"result":{"session":{"sessionId":"s1","name":"Sesión original"},"history":{"items":[{"itemId":"i1","kind":"userMessage","text":"Hola"}]}}}"""
            method == "approval/listPending" -> 200 to
                """{"ok":true,"result":{"approvals":[]}}"""
            else -> 200 to """{"ok":true,"result":{}}"""
        }
    }

    private suspend fun awaitCondition(predicate: () -> Boolean) {
        withTimeout(8_000) {
            while (!predicate()) delay(15)
        }
    }

    @Test fun slowResumeNavigatesOnTapAndCompletes() = runBlocking {
        val engine = MockEngine { req ->
            val (code, result) = respondFor(req, resumeFails = false)
            if ((req.body as? TextContent)?.text?.contains("session/resume") == true)
                delay(350)
            respond(result, status = HttpStatusCode.fromValue(code),
                headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val controller = MuseController(
            MuseGateway(HttpClient(engine)), MemoryCredentialsStore())
        try {
            controller.connect("https://example.com", "0123456789abcdef")
            awaitCondition { controller.state.value.authenticated }
            controller.openSession("s1")
            assertEquals(Screen.Conversation, controller.state.value.screen)
            assertTrue(controller.state.value.loading)
            assertFalse(controller.state.value.sessionReady)
            awaitCondition { controller.state.value.sessionReady }
            assertFalse(controller.state.value.loading)
            assertEquals("Hola", controller.state.value.items.first().text)
        } finally {
            controller.close()
        }
    }

    @Test fun rejectedResumeShowsReadableHistoryWithoutEnablingSend() = runBlocking {
        val engine = MockEngine { req ->
            val (code, result) = respondFor(req, resumeFails = true)
            respond(result, status = HttpStatusCode.fromValue(code),
                headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val controller = MuseController(
            MuseGateway(HttpClient(engine)), MemoryCredentialsStore())
        try {
            controller.connect("https://example.com", "0123456789abcdef")
            awaitCondition { controller.state.value.authenticated }
            controller.openSession("s1")
            assertEquals(Screen.Conversation, controller.state.value.screen)
            awaitCondition { controller.state.value.stream == "Solo lectura" }
            assertFalse(controller.state.value.sessionReady)
            assertEquals("Hola", controller.state.value.items.single().text)
            assertTrue(controller.state.value.error.orEmpty().contains("No se pudo reanudar"))
        } finally {
            controller.close()
        }
    }
}
