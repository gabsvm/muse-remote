package io.muse.remote.core

import kotlinx.serialization.json.JsonObject

/** Ephemeral read-only match. Only a 220-character preview is retained. */
data class GlobalSearchHit(
    val sessionId: String,
    val sessionTitle: String,
    val itemId: String,
    val isUser: Boolean,
    val preview: String,
)

/** Return at most five excerpts per session. Do not include reasoning, tool output or attachments. */
fun globalSearchHits(
    session: SessionSummary,
    history: JsonObject?,
    query: String,
): List<GlobalSearchHit> {
    val needle = query.trim().take(90)
    if (needle.length < 3) return emptyList()
    val hits = mutableListOf<GlobalSearchHit>()
    for (raw in historyItemObjects(history)) {
        if (hits.size >= 5) break
        val kind = raw.string("kind")
        if (kind != "userMessage" && kind != "agentMessage") continue
        val content = raw.string("text") ?: continue
        if (content.length > 250_000) continue
        val offset = content.indexOf(needle, ignoreCase = true)
        if (offset < 0) continue
        val from = (offset - 65).coerceAtLeast(0)
        val to = (from + 220).coerceAtMost(content.length)
        val preview = (if (from > 0) "…" else "") +
            content.substring(from, to).replace(Regex("\\s+"), " ").trim() +
            (if (to < content.length) "…" else "")
        hits.add(GlobalSearchHit(
            sessionId = session.id,
            sessionTitle = session.title.take(100),
            itemId = raw.string("itemId").orEmpty().take(100),
            isUser = kind == "userMessage",
            preview = preview,
        ))
    }
    return hits
}
