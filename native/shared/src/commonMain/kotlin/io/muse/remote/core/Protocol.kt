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

data class RemoteProject(
    val id: String,
    val name: String,
    val workspace: String = "",
)

interface CredentialsStore {
    fun read(): ServerCredentials?
    fun save(value: ServerCredentials)
    fun clear()
    fun recentSession(): String?
    fun saveRecentSession(id: String?)
    // A reversible local filter; MSP has no session/delete operation.
    /** Local organizer metadata; never deletes or mutates an upstream MSP session. */
    fun projects(): List<RemoteProject> = emptyList()
    fun saveProjects(value: List<RemoteProject>) {}
    fun projectAssignments(): Map<String, String> = emptyMap()
    fun saveProjectAssignments(value: Map<String, String>) {}
    /** Android-local session aliases until session/rename is supported by Muse on Windows. */
    fun drafts(): Map<String, String> = emptyMap()
    fun saveDraft(sessionId: String, content: String) {}
    fun sessionAliases(): Map<String, String> = emptyMap()
    fun saveSessionAliases(value: Map<String, String>) {}
    fun pinnedSessionIds(): Set<String> = emptySet()
    fun savePinnedSessionIds(value: Set<String>) {}
    fun hiddenSessionIds(): Set<String> = emptySet()
    fun hideSession(id: String) {}
    fun restoreSession(id: String) {}
}

class MemoryCredentialsStore : CredentialsStore {
    private var credentials: ServerCredentials? = null
    private var session: String? = null
    private val projectList = mutableListOf<RemoteProject>()
    private val assignments = mutableMapOf<String, String>()
    private val draftMap = mutableMapOf<String, String>()
    private val aliases = mutableMapOf<String, String>()
    private val pinned = mutableSetOf<String>()
    private val hidden = mutableSetOf<String>()
    override fun read() = credentials
    override fun save(value: ServerCredentials) { credentials = value }
    override fun clear() { credentials = null; session = null }
    override fun recentSession() = session
    override fun saveRecentSession(id: String?) { session = id }
    override fun projects(): List<RemoteProject> = projectList.toList()
    override fun saveProjects(value: List<RemoteProject>) { projectList.clear(); projectList.addAll(value) }
    override fun projectAssignments(): Map<String, String> = assignments.toMap()
    override fun saveProjectAssignments(value: Map<String, String>) { assignments.clear(); assignments.putAll(value) }
    override fun drafts(): Map<String, String> = draftMap.toMap()
    override fun saveDraft(sessionId: String, content: String) {
        if (content.isBlank()) draftMap.remove(sessionId)
        else draftMap[sessionId] = content
    }
    override fun sessionAliases(): Map<String, String> = aliases.toMap()
    override fun saveSessionAliases(value: Map<String, String>) { aliases.clear(); aliases.putAll(value) }
    override fun pinnedSessionIds(): Set<String> = pinned.toSet()
    override fun savePinnedSessionIds(value: Set<String>) { pinned.clear(); pinned.addAll(value) }
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

/** Attachment draft transmitted only on explicit user send. */
sealed interface ComposerAttachment {
    val name: String

    data class Photo(
        override val name: String,
        val base64Data: String,
        val width: Int,
        val height: Int,
    ) : ComposerAttachment

    data class Document(
        override val name: String,
        val mimeType: String,
        val content: ByteArray,
    ) : ComposerAttachment
}

/** Model catalog from connected Muse CLI, never a hardcoded subscription list. */
data class MuseModel(val id: String, val label: String, val isActive: Boolean) {
    companion object {
        fun from(raw: JsonObject): MuseModel? {
            val id = raw.string("modelId")?.takeIf(String::isNotBlank) ?: return null
            return MuseModel(id, raw.string("displayLabel")?.takeIf(String::isNotBlank) ?: id,
                (raw["isActive"] as? JsonPrimitive)?.booleanOrNull == true)
        }
    }
}
val reasoningEffortLevels = listOf("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")
data class ContributorStatus(
    val available: Boolean = false,
    val value: Boolean? = null,
    val needsRestart: Boolean = false,
    val reason: String? = null,
)

data class SubscriptionSnapshot(
    val tier: String,
    val windowUsedPercent: Int,
    val weeklyUsedPercent: Int,
    val observedAtMs: Long,
) {
    companion object {
        fun from(r: JsonObject): SubscriptionSnapshot? {
            val u = r.obj("usage") ?: return null
            val window = u.obj("window") ?: return null
            val weekly = u.obj("weekly") ?: return null
            return SubscriptionSnapshot(
                u.string("tier").orEmpty(),
                window["usedPercent"]?.jsonPrimitive?.intOrNull ?: return null,
                weekly["usedPercent"]?.jsonPrimitive?.intOrNull ?: return null,
                u["observedAtMs"]?.jsonPrimitive?.longOrNull ?: return null,
            )
        }
    }
}
data class QueuedEntry(val sequence: Long, val text: String) {
    companion object {
        fun from(x: JsonObject): QueuedEntry? {
            val sequence = (x["sequence"] as? JsonPrimitive)?.longOrNull ?: return null
            return QueuedEntry(sequence, x.string("text").orEmpty())
        }
    }
}
data class PendingSubmit(val turnId: String, val text: String)
data class RemoteTask(val taskId: String, val title: String, val mode: String) {
    companion object {
        fun from(x: JsonObject): RemoteTask? {
            val id = x.string("taskId")?.takeIf(String::isNotBlank) ?: return null
            return RemoteTask(id, (x.string("tool") ?: x.string("kind") ?: "Tarea").take(100),
                x.string("executionMode") ?: "background")
        }
    }
}
data class WorktreeRow(val path: String, val branch: String,
    val main: Boolean, val activeSessions: Int) {
    companion object {
        fun from(x: JsonObject): WorktreeRow? {
            val path = x.string("path")?.takeIf(String::isNotBlank) ?: return null
            return WorktreeRow(path, x.string("branch").orEmpty(),
                (x["isMain"] as? JsonPrimitive)?.booleanOrNull ?: false,
                x.array("sessionIds").orEmpty().size)
        }
    }
}
data class PatchItem(val itemId: String, val refId: String, val files: Int,
    val added: Int, val removed: Int) {
    companion object {
        fun from(x: JsonObject): PatchItem? {
            val ref = x.obj("patchRef")?.string("id") ?: return null
            val id = x.string("itemId") ?: return null
            val summary = x.obj("patchSummary")
            return PatchItem(id, ref,
                (summary?.get("files") as? JsonPrimitive)?.intOrNull ?: 0,
                (summary?.get("added") as? JsonPrimitive)?.intOrNull ?: 0,
                (summary?.get("removed") as? JsonPrimitive)?.intOrNull ?: 0)
        }
    }
}
data class MuseSkill(val selector: String, val title: String, val description: String) {
    companion object {
        fun from(raw: JsonObject): MuseSkill? {
            val selector = raw.string("selector") ?: return null
            if (selector.isBlank()) return null
            return MuseSkill(selector, raw.string("displayName") ?: selector,
                raw.string("description").orEmpty())
        }
    }
}
val approvalModes = listOf("onRequest", "promptUnmatched", "denyUnmatched", "allowAll")
enum class Screen { Login, Sessions, Conversation }

data class MuseState(
    val screen: Screen = Screen.Login,
    val endpoint: String = "",
    val authenticated: Boolean = false,
    val restoringConnection: Boolean = false,
    val savedConnectionAvailable: Boolean = false,
    val sessionsLoading: Boolean = false,
    val sessionsLoaded: Boolean = false,
    val sessionsPageCount: Int = 0,
    val sessionsError: String? = null,
    val projects: List<RemoteProject> = emptyList(),
    val projectAssignments: Map<String, String> = emptyMap(),
    val pinnedSessionIds: Set<String> = emptySet(),
    val sessionAliases: Map<String, String> = emptyMap(),
    val contributor: ContributorStatus = ContributorStatus(),
    val contributorLoading: Boolean = false,
    val contributorSaving: Boolean = false,

    val hiddenSessionIds: Set<String> = emptySet(),
    val sessionReady: Boolean = false,
    val sessionBusyElsewhere: Boolean = false,
    val loading: Boolean = false,
    val sending: Boolean = false,
    val sessions: List<SessionSummary> = emptyList(),
    val sessionId: String? = null,
    val sessionTitle: String = "",
    val models: List<MuseModel> = emptyList(),
    val activeModelId: String? = null,
    val reasoningEffort: String? = null,
    val modelSettingsLoading: Boolean = false,
    val modelSettingsSaving: Boolean = false,
    val modelSettingsError: String? = null,
    val approvalMode: String? = null,
    val toolsLoading: Boolean = false,
    val toolsSaving: Boolean = false,
    val toolsError: String? = null,
    val usage: SubscriptionSnapshot? = null,
    val usageDiagnosis: String? = null,
    val usageChecking: Boolean = false,

    val queuedInputs: List<QueuedEntry> = emptyList(),
    val queuedSubmitted: List<PendingSubmit> = emptyList(),
    val queueBusy: Boolean = false,
    val worktrees: List<WorktreeRow> = emptyList(),
    val worktreeLoading: Boolean = false,
    val worktreeError: String? = null,
    val tasks: List<RemoteTask> = emptyList(),
    val tasksLoading: Boolean = false,
    val tasksError: String? = null,
    val patches: List<PatchItem> = emptyList(),
    val patchPreview: String? = null,
    val patchBusy: Boolean = false,
    val patchError: String? = null,
    val skills: List<MuseSkill> = emptyList(),

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
