package io.muse.remote.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.*
import io.ktor.http.content.TextContent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import kotlin.test.*

class AttachmentGatewayTest {
    @Test fun imageIsAnActualMspImagePartAndSupportsImageOnlyPrompt() = runBlocking {
        var sent: JsonObject? = null
        val engine = MockEngine { request ->
            if (request.url.encodedPath == "/api/rpc") {
                sent = Json.parseToJsonElement((request.body as TextContent).text).jsonObject
            }
            respond("""{"ok":true,"result":{}}""",
                headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val gateway = MuseGateway(HttpClient(engine))
        try {
            gateway.authorize(ServerCredentials("https://example.com", "0123456789abcdef"))
            gateway.send("s1", "", "cmd-1",
                ComposerAttachment.Photo("imagen.jpg", "AQIDBA==", 32, 16))
            val input = sent!!.getValue("params").jsonObject.getValue("input").jsonArray
            assertEquals(1, input.size)
            val photo = input.single().jsonObject
            assertEquals("image", photo.getValue("type").jsonPrimitive.content)
            assertEquals("AQIDBA==", photo.getValue("base64Data").jsonPrimitive.content)
            assertEquals("image/jpeg", photo.getValue("mediaType").jsonPrimitive.content)
        } finally { gateway.close() }
    }

    @Test fun uploadUsesAuthenticatedBinaryEndpointAndMspTextPath() = runBlocking {
        var uploaded = false
        var sent: JsonObject? = null
        val engine = MockEngine { request ->
            when (request.url.encodedPath) {
                "/api/upload" -> {
                    assertEquals("Bearer 0123456789abcdef",
                        request.headers[HttpHeaders.Authorization])
                    uploaded = true
                    respond("""{"ok":true,"file":{"name":"notas.md","path":"C:\\\\muse-uploads\\\\notas.md","size":4}}""",
                        headers = headersOf(HttpHeaders.ContentType, "application/json"))
                }
                else -> {
                    sent = Json.parseToJsonElement((request.body as TextContent).text).jsonObject
                    respond("""{"ok":true,"result":{}}""",
                        headers = headersOf(HttpHeaders.ContentType, "application/json"))
                }
            }
        }
        val gateway = MuseGateway(HttpClient(engine))
        try {
            gateway.authorize(ServerCredentials("https://example.com", "0123456789abcdef"))
            val uploadedDoc = gateway.upload(
                ComposerAttachment.Document("notas.md", "text/markdown", byteArrayOf(1, 2, 3, 4)))
            gateway.send("s1", "Lee esto", "cmd-2", document = uploadedDoc)
            assertTrue(uploaded)
            val parts = sent!!.getValue("params").jsonObject.getValue("input").jsonArray
            assertEquals(1, parts.size)
            val message = parts[0].jsonObject.getValue("text").jsonPrimitive.content
            assertTrue(message.contains("notas.md"))
            assertTrue(message.contains("Ruta local del archivo"))
            assertTrue(message.contains("Lee esto"))
        } finally { gateway.close() }
    }

    @Test fun filesLargerThanTenMibFailBeforeNetwork() = runBlocking {
        val gateway = MuseGateway(HttpClient(MockEngine {
            fail("No network call expected")
        }))
        try {
            gateway.authorize(ServerCredentials("https://example.com", "0123456789abcdef"))
            assertFailsWith<IllegalArgumentException> {
                gateway.upload(ComposerAttachment.Document("huge.zip",
                    "application/zip", ByteArray(10 * 1024 * 1024 + 1)))
            }
        } finally { gateway.close() }
        Unit // JUnit4 requires Unit/void, not the captured exception.
    }
}
