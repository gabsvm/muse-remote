package io.muse.remote.core

import kotlinx.serialization.json.*

internal val wireJson = Json { ignoreUnknownKeys = true; isLenient = true }

fun JsonObject.string(key: String): String? =
    (get(key) as? JsonPrimitive)?.contentOrNull

fun JsonObject.obj(key: String): JsonObject? = get(key) as? JsonObject
fun JsonObject.array(key: String): JsonArray? = get(key) as? JsonArray

data class ServerCredentials(
    val url: String,
    val token: String,
    val pin: String? = null,
    val fallbackUrl: String? = null,
) {
    val base: String get() = url.trim().trimEnd('/')
    fun validate() {
        val normalized = base
        require(normalized.startsWith("https://") ||
            normalized.startsWith("http://127.0.0.1:") ||
            normalized.startsWith("http://localhost:")) {
            "Usa una dirección HTTPS (Tailscale Serve o un túnel protegido)."
        }
        if (pin != null) {
            require(normalized.startsWith("https://")) { "La conexión LAN debe usar HTTPS." }
            require(pin.matches(Regex("[0-9a-fA-F]{64}"))) { "Huella TLS SHA-256 inválida." }
        }
        if (!fallbackUrl.isNullOrBlank()) {
            require(fallbackUrl.startsWith("https://") && !fallbackUrl.contains('@') &&
                !fallbackUrl.contains('#')) { "URL de respaldo Tailscale inválida." }
        }
        require(token.trim().length >= 16) { "El token debe tener al menos 16 caracteres." }
        require(!normalized.contains('@') && !normalized.contains('#')) { "Dirección de servidor inválida." }
    }
}

interface CredentialsStore {
    fun read(): ServerCredentials?
    fun save(value: ServerCredentials)
    fun clear()
    fun recentSession(): String?
    fun saveRecentSession(id: String?)
    // A reversible local filter; MSP has no session/delete operation.
    fun hiddenSessionIds(): Set<String> = emptySet()
    fun hideSession(id: String) {}
    fun restoreSession(id: String) {}
}

class MemoryCredentialsStore : CredentialsStore {
    private var credentials: ServerCredentials? = null
    private var session: String? = null
    private val hidden = mutableSetOf<String>()
    override fun read() = credentials
    override fun save(value: ServerCredentials) { credentials = value }
    override fun clear() { credentials = null; session = null }
    override fun recentSession() = session
    override fun saveRecentSession(id: String?) { session = id }
    override fun hiddenSessionIds(): Set<String> = hidden.toSet()
    override fun hideSession(id: String) { hidden.add(id) }
    override fun restoreSession(id: String) { hidden.remove(id) }
}

data class SessionSummary(
    val id: String,
    val title: String,
    val workspace: String,
    val status: String,
    val model: String,
    val updatedAt: String,
    val turnCount: Int,
) {
    companion object {
        fun from(raw: JsonObject): SessionSummary? {
            val id = raw.string("sessionId") ?: return null
            val name = raw.string("name").orEmpty().ifBlank {
                raw.string("firstUserPrompt").orEmpty().replace(Regex("\\[Image #\\d+]"), "").trim()
            }
            return SessionSummary(
                id = id,
                title = name.ifBlank { "Sesión ${id.take(8)}" }.take(100),
                workspace = raw.string("workspaceRoot").orEmpty(),
                status = raw.string("status") ?: "idle",
                model = raw.string("modelId").orEmpty(),
                updatedAt = raw.string("updatedAt") ?: raw.string("createdAt").orEmpty(),
                turnCount = raw.string("turnCount")?.toIntOrNull() ?: 0,
            )
        }
    }
}

data class ChatItem(
    val id: String,
    val kind: String,
    val text: String,
    val status: String,
    val toolName: String,
    val detail: String,
    val hasImage: Boolean = false,
) {
    companion object {
        fun from(raw: JsonObject): ChatItem? {
            val id = raw.string("itemId") ?: return null
            val summary = raw.array("summary")?.joinToString("\n") {
                (it as? JsonPrimitive)?.contentOrNull.orEmpty()
            }.orEmpty()
            val args = raw.obj("args")
            val argsString = raw.string("args")
            val hasImage = listOf("images", "attachments", "content", "input", "parts").any {
                field -> raw.array(field)?.any { element ->
                    val part = element as? JsonObject
                    part?.string("type") == "image" ||
                        part?.string("mediaType")?.startsWith("image/") == true
                } == true
            }
            return ChatItem(
                id = id,
                kind = raw.string("kind") ?: "message",
                text = raw.string("text") ?: summary
                    .ifBlank { raw.string("output") ?: raw.string("displayText").orEmpty() },
                status = raw.string("status").orEmpty(),
                toolName = raw.string("toolName").orEmpty(),
                detail = (args?.toString() ?: argsString).orEmpty().take(2000),
                hasImage = hasImage,
            )
        }
    }
}

data class ApprovalChoice(val id: String, val label: String)

data class PendingApproval(
    val id: String,
    val sessionId: String,
    val requirementId: String?,
    val title: String,
    val detail: String,
    val choices: List<ApprovalChoice>,
) {
    companion object {
        fun from(raw: JsonObject): PendingApproval? {
            val id = raw.string("approvalId") ?: return null
            val subject = raw.obj("subject")
            return PendingApproval(
                id = id,
                sessionId = raw.string("sessionId").orEmpty(),
                requirementId = raw.string("currentRequirementId"),
                title = raw.string("toolName") ?: subject?.string("kind") ?: "Permiso requerido",
                detail = subject?.string("command") ?: subject?.string("path")
                    ?: raw.string("rawArgs").orEmpty(),
                choices = raw.array("availableChoices")?.mapNotNull {
                    (it as? JsonObject)?.let { o ->
                        o.string("choiceId")?.let { key ->
                            ApprovalChoice(key, o.string("label") ?: key)
                        }
                    }
                }.orEmpty(),
            )
        }
    }
}

data class PromptQuestion(
    val id: String,
    val sessionId: String,
    val title: String,
    val questionId: String,
    val options: List<String>,
) {
    companion object {
        fun from(raw: JsonObject): PromptQuestion? {
            val id = raw.string("userInputId") ?: return null
            val q = raw.array("questions")?.firstOrNull() as? JsonObject ?: return null
            return PromptQuestion(
                id = id,
                sessionId = raw.string("sessionId").orEmpty(),
                title = q.string("question") ?: q.string("header") ?: "Muse necesita una respuesta",
                questionId = q.string("id") ?: return null,
                options = q.array("options")?.mapNotNull {
                    (it as? JsonObject)?.string("label")
                }.orEmpty(),
            )
        }
    }
}

enum class Screen { Login, Sessions, Conversation }

data class MuseState(
    val screen: Screen = Screen.Login,
    val endpoint: String = "",
    val authenticated: Boolean = false,
    val hiddenSessionIds: Set<String> = emptySet(),
    val sessionReady: Boolean = false,
    val loading: Boolean = false,
    val sending: Boolean = false,
    val sessions: List<SessionSummary> = emptyList(),
    val sessionId: String? = null,
    val sessionTitle: String = "",
    val workspace: String = "",
    val items: List<ChatItem> = emptyList(),
    val approvals: List<PendingApproval> = emptyList(),
    val questions: List<PromptQuestion> = emptyList(),
    val working: Boolean = false,
    val turnId: String? = null,
    val stream: String = "Sin conexión",
    val viewCursor: String? = null,
    val error: String? = null,
)
