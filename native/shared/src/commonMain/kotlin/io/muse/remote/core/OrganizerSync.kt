package io.muse.remote.core

import kotlinx.serialization.json.*

/**
 * E2EE organizer metadata v1, NEVER the MSP token, drafts, messages or credentials.
 * Client-controlled secret. The backend stores only encrypted envelope bytes.
 */
data class OrganizerBackup(
    val projects: List<RemoteProject>,
    val assignments: Map<String, String>,
    val aliases: Map<String, String>,
    val pinned: Set<String>,
) {
    fun toJson(): JsonObject = buildJsonObject {
        put("v", 1)
        putJsonArray("projects") {
            projects.forEach { p ->
                add(buildJsonObject {
                    put("id", p.id); put("name", p.name); put("workspace", p.workspace)
                })
            }
        }
        put("assignments", buildJsonObject { assignments.forEach { (id, project) -> put(id, project) } })
        put("aliases", buildJsonObject { aliases.forEach { (id, name) -> put(id, name) } })
        putJsonArray("pinned") { pinned.forEach { add(it) } }
    }
    fun mergedWith(remote: OrganizerBackup, remoteWins: Boolean): OrganizerBackup {
        val projectsById = projects.associateBy { it.id }.toMutableMap()
        remote.projects.forEach { p ->
            if (remoteWins || !projectsById.containsKey(p.id)) projectsById[p.id] = p
        }
        val assigns = if (remoteWins) assignments + remote.assignments else remote.assignments + assignments
        val names = if (remoteWins) aliases + remote.aliases else remote.aliases + aliases
        return OrganizerBackup(projectsById.values.take(100), assigns, names,
            (pinned + remote.pinned).take(10000).toSet()).validated()
    }
    fun validated(): OrganizerBackup {
        require(projects.size <= 100 && assignments.size <= 10000 &&
            aliases.size <= 10000 && pinned.size <= 10000) { "Organización demasiado grande." }
        projects.forEach {
            require(it.id.isNotBlank() && it.id.length <= 160 &&
                it.name.isNotBlank() && it.name.length <= 64 && it.workspace.length <= 512)
        }
        fun key(s: String) = s.isNotBlank() && s.length <= 160
        require(assignments.all { key(it.key) && key(it.value) } &&
            aliases.all { key(it.key) && it.value.isNotBlank() &&
                it.value.length <= 80 && it.value.none { c -> c.code < 32 || c.code == 127 } } &&
            pinned.all(::key)) { "Metadatos inválidos." }
        return this
    }
    companion object {
        fun from(raw: JsonObject): OrganizerBackup {
            require((raw["v"] as? JsonPrimitive)?.intOrNull == 1) { "Versión incompatible." }
            val projects = raw.array("projects")?.mapNotNull { entry ->
                val p = entry as? JsonObject ?: return@mapNotNull null
                val id = p.string("id") ?: return@mapNotNull null
                RemoteProject(id, p.string("name").orEmpty(), p.string("workspace").orEmpty())
            }.orEmpty()
            fun strings(key: String): Map<String, String> =
                (raw[key] as? JsonObject)?.entries?.associate { (id, value) ->
                    id to ((value as? JsonPrimitive)?.contentOrNull ?: "")
                }.orEmpty()
            val pinned = raw.array("pinned")?.mapNotNull {
                (it as? JsonPrimitive)?.contentOrNull
            }?.toSet().orEmpty()
            return OrganizerBackup(projects, strings("assignments"), strings("aliases"), pinned).validated()
        }
        fun fromStore(store: CredentialsStore): OrganizerBackup =
            OrganizerBackup(store.projects(), store.projectAssignments(), store.sessionAliases(),
                store.pinnedSessionIds()).validated()
    }
}

/** Implementations must use PBKDF2-HMAC-SHA256 310k, AES-256-GCM and the exact AAD. */
interface OrganizerSyncCipher {
    fun encrypt(data: OrganizerBackup, passphrase: String): JsonObject
    fun decrypt(envelope: JsonObject, passphrase: String): OrganizerBackup
}
