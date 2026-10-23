package io.muse.remote.core

import io.ktor.client.HttpClient
import io.ktor.client.request.*
import io.ktor.client.plugins.sse.sse
import io.ktor.http.*
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.json.*

class MuseGateway(
    private val defaultClient: HttpClient,
    private val pinnedClientFactory: ((String) -> HttpClient)? = null,
) {
    private var client: HttpClient = defaultClient
    private var credentials: ServerCredentials? = null

    fun authorize(value: ServerCredentials) {
        value.validate()
        val next = if (value.pin != null) {
            (pinnedClientFactory ?: error("Este cliente no permite certificados LAN autofirmados."))
                .invoke(value.pin.lowercase())
        } else defaultClient
        if (client !== defaultClient && client !== next) client.close()
        client = next
        credentials = value.copy(url = value.base, token = value.token.trim())
    }

    fun signOut() {
        credentials = null
        if (client !== defaultClient) client.close()
        client = defaultClient
    }

    fun close() {
        if (client !== defaultClient) client.close()
        defaultClient.close()
    }

    private fun auth(): ServerCredentials =
        credentials ?: error("No se ha conectado el dispositivo.")

    suspend fun checkConnection() {
        val cred = auth()
        val health = client.get(cred.base + "/api/health")
        if (!health.status.isSuccess()) error("No se puede acceder al servidor (HTTP ${health.status.value}).")
        val healthJson = parse(health.bodyAsText())
        if (healthJson["mspReady"] != JsonPrimitive(true)) error("El servidor responde, pero Muse aún no está listo.")
        rpc("model/list")
    }

    suspend fun commandId(): String {
        val c = auth()
        val response = client.get(c.base + "/api/command-id") {
            header(HttpHeaders.Authorization, "Bearer ${c.token}")
        }
        val body = requireSuccess(response.status.value, response.bodyAsText())
        return body.string("commandId") ?: error("Falta commandId en la respuesta.")
    }

    suspend fun rpc(method: String, params: JsonObject = buildJsonObject {}): JsonObject {
        val c = auth()
        val response = client.post(c.base + "/api/rpc") {
            header(HttpHeaders.Authorization, "Bearer ${c.token}")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("method", method)
                put("params", params)
            }.toString())
        }
        val body = requireSuccess(response.status.value, response.bodyAsText())
        return body.obj("result") ?: buildJsonObject {}
    }

    /** Metadata query: does not invoke a coding model. Fallback mirrors PWA. */
    suspend fun listModels(sessionId: String? = null): List<MuseModel> {
        val scoped = sessionId?.let { id ->
            runCatching { rpc("model/list", buildJsonObject { put("sessionId", id) }) }.getOrNull()
        }
        val cat = if (scoped?.array("models").isNullOrEmpty()) rpc("model/list") else scoped!!
        return cat.array("models").orEmpty().mapNotNull {
            (it as? JsonObject)?.let(MuseModel::from)
        }.distinctBy { it.id }
    }

    suspend fun setModel(sessionId: String, modelId: String) {
        require(modelId.isNotBlank()) { "Modelo inválido." }
        rpc("session/setModel", buildJsonObject {
            put("commandId", commandId())
            put("sessionId", sessionId)
            putJsonObject("model") { put("modelId", modelId) }
        })
    }

    suspend fun setReasoningEffort(sessionId: String, effort: String) {
        require(effort in reasoningEffortLevels) { "Nivel de razonamiento no reconocido." }
        rpc("session/setReasoningEffort", buildJsonObject {
            put("commandId", commandId())
            put("sessionId", sessionId)
            put("reasoningEffort", effort)
        })
    }

    suspend fun listAllSessions(
        maxPages: Int = 40,
        onPage: (pageNumber: Int, sessions: List<SessionSummary>) -> Unit = { _, _ -> },
    ): List<SessionSummary> {
        val results = linkedMapOf<String, SessionSummary>()
        val visited = mutableSetOf<String>()
        var cursor: String? = null
        repeat(maxPages) {
            val response = rpc("session/list", buildJsonObject {
                put("limit", 50)
                cursor?.let { put("cursor", it) }
            })
            val page = response.array("sessions")
                ?: error("Muse devolvió session/list sin la lista de sesiones.")
            page.forEach { element ->
                val s = (element as? JsonObject)?.let(SessionSummary::from)
                if (s != null) results[s.id] = s
            }
            onPage(it + 1, results.values.sortedByDescending { item -> item.updatedAt })
            val next = response.string("nextCursor")
            if (next.isNullOrEmpty() || !visited.add(next)) return results.values.sortedByDescending { item -> item.updatedAt }
            cursor = next
        }
        return results.values.sortedByDescending { it.updatedAt }
    }

    suspend fun resume(sessionId: String, onPhase: (String) -> Unit = {}): JsonObject {
        onPhase("Solicitando identificador de comando…")
        val id = commandId()
        onPhase("Muse está procesando session/resume…")
        return rpc("session/resume", buildJsonObject {
            put("commandId", id)
            put("sessionId", sessionId)
        })
    }

    suspend fun read(sessionId: String): JsonObject =
        rpc("session/read", buildJsonObject { put("sessionId", sessionId) })

    suspend fun pending(sessionId: String): JsonObject =
        rpc("approval/listPending", buildJsonObject { put("sessionId", sessionId) })

    suspend fun startSession(workspace: String): String {
        val r = rpc("session/start", buildJsonObject {
            put("commandId", commandId())
            if (workspace.isNotBlank()) put("workspaceRoot", workspace.trim())
        })
        return r.obj("session")?.string("sessionId") ?: r.string("sessionId")
            ?: error("Muse no devolvió la nueva sesión.")
    }

    data class UploadedDocument(val name: String, val path: String, val size: Int)

    suspend fun upload(attachment: ComposerAttachment.Document): UploadedDocument {
        require(attachment.content.isNotEmpty() && attachment.content.size <= 10 * 1024 * 1024) {
            "El archivo debe tener entre 1 byte y 10 MiB."
        }
        val c = auth()
        val response = client.post(c.base + "/api/upload") {
            header(HttpHeaders.Authorization, "Bearer ${c.token}")
            header("X-Muse-Filename", attachment.name.encodeURLParameter())
            header("X-Muse-Mime", attachment.mimeType)
            contentType(ContentType.Application.OctetStream)
            setBody(attachment.content)
        }
        val body = requireSuccess(response.status.value, response.bodyAsText())
        val file = body.obj("file") ?: error("El servidor no confirmó el adjunto.")
        return UploadedDocument(
            name = file.string("name") ?: attachment.name,
            path = file.string("path") ?: error("El servidor no devolvió la ruta del archivo."),
            size = file.string("size")?.toIntOrNull() ?: attachment.content.size,
        )
    }

    suspend fun send(
        sessionId: String,
        message: String,
        commandId: String,
        photo: ComposerAttachment.Photo? = null,
        document: UploadedDocument? = null,
    ) {
        require(photo == null || (photo.base64Data.length <= 4 * 1024 * 1024 &&
            photo.width in 1..1568 && photo.height in 1..1568)) {
            "Imagen demasiado grande."
        }
        val text = if (document == null) message else buildString {
            append(message)
            if (isNotBlank()) append("\n\n")
            append("Archivo adjunto desde Muse Remote, almacenado en esta PC: ")
            append(document.name)
            append("\nRuta local del archivo: ")
            append(document.path)
            append("\nUsa esta ruta si necesitas leer el archivo.")
        }
        rpc("turn/start", buildJsonObject {
            put("commandId", commandId)
            put("sessionId", sessionId)
            put("ifBusy", "queue")
            putJsonArray("input") {
                if (text.isNotBlank()) add(buildJsonObject {
                    put("type", "text")
                    put("text", text)
                })
                if (photo != null) add(buildJsonObject {
                    put("type", "image")
                    put("base64Data", photo.base64Data)
                    put("mediaType", "image/jpeg")
                    put("width", photo.width)
                    put("height", photo.height)
                })
            }
        })
    }

    suspend fun interrupt(sessionId: String, turnId: String?) {
        rpc("turn/interrupt", buildJsonObject {
            put("commandId", commandId())
            put("sessionId", sessionId)
            turnId?.let { put("turnId", it) }
        })
    }

    suspend fun decide(approval: PendingApproval, choiceId: String) {
        rpc("approval/decide", buildJsonObject {
            put("commandId", commandId())
            put("sessionId", approval.sessionId)
            put("approvalId", approval.id)
            approval.requirementId?.let { put("requirementId", it) }
            put("choiceId", choiceId)
        })
    }

    suspend fun answer(question: PromptQuestion, selected: String) {
        rpc("userInput/answer", buildJsonObject {
            put("commandId", commandId())
            put("sessionId", question.sessionId)
            put("userInputId", question.id)
            putJsonArray("answers") {
                add(buildJsonObject {
                    put("questionId", question.questionId)
                    if (question.options.contains(selected)) put("selectedLabel", selected)
                    else put("freeText", selected)
                })
            }
        })
    }

    suspend fun events(sessionId: String, cursor: String?, onEvent: suspend (String, JsonObject) -> Unit) {
        val c = auth()
        val url = c.base + "/api/events?sessionId=" + sessionId.encodeURLParameter() +
            (cursor?.let { "&after=" + it.encodeURLParameter() } ?: "")
        client.sse(urlString = url, request = {
            header(HttpHeaders.Authorization, "Bearer ${c.token}")
        }) {
            incoming.collect { event ->
                val name = event.event ?: return@collect
                val payload = event.data?.let {
                    runCatching { parse(it) }.getOrNull()
                } ?: buildJsonObject {}
                onEvent(name, payload)
            }
        }
    }

    private fun parse(s: String): JsonObject =
        (wireJson.parseToJsonElement(s) as? JsonObject) ?: error("Respuesta JSON inválida.")

    private fun requireSuccess(status: Int, response: String): JsonObject {
        val parsed = runCatching { parse(response) }.getOrNull()
        if (status !in 200..299 || parsed?.get("ok") != JsonPrimitive(true)) {
            val reason = parsed?.string("error") ?: when (status) {
                401 -> "Token incorrecto."
                403 -> "Acceso denegado."
                502, 503, 504, 530 -> "PC desconectada o túnel no disponible."
                in 300..399 -> "La sesión del túnel expiró; abre el servidor en el navegador."
                else -> "HTTP $status: respuesta inesperada del servidor."
            }
            error(reason)
        }
        return parsed
    }
}
