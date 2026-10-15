package io.muse.remote.core

/**
 * Conversation presentation model independent of Compose and the MSP transport.
 *
 * A turn is delimited by a user message. Technical events may be interleaved
 * with Muse's narrative messages but are rendered as ONE collapsible activity
 * group per turn. Nothing is discarded from the underlying MSP state.
 */
sealed interface ConversationEntry {
    val key: String

    data class Message(val item: ChatItem) : ConversationEntry {
        override val key: String = "message:" + item.id
    }

    data class Activity(
        override val key: String,
        val steps: List<ChatItem>,
    ) : ConversationEntry {
        val failedCount: Int get() = steps.count { it.status.lowercase() in setOf("failed", "error", "rejected") }
        val toolCount: Int get() = steps.count {
            it.kind in setOf("toolCall", "userShell", "subagent", "workflow")
        }
        val reasoningCount: Int get() = steps.count { it.kind == "reasoning" }
    }
}

/** Treat placeholder/empty assistant output as no message, not a 'Muse …' bubble. */
private fun meaningfulText(text: String): Boolean {
    val value = text.trim()
    return value.isNotEmpty() && value != "…" && value != "..."
}

private sealed interface DraftEntry {
    data class Message(val item: ChatItem) : DraftEntry
    class Activity(val key: String) : DraftEntry {
        val steps: MutableList<ChatItem> = mutableListOf()
    }
}

fun conversationEntries(items: List<ChatItem>): List<ConversationEntry> {
    val draft = mutableListOf<DraftEntry>()
    var current: DraftEntry.Activity? = null

    for (item in items) {
        when (item.kind) {
            "userMessage" -> {
                current = null
                if (item.text.isNotBlank()) draft.add(DraftEntry.Message(item))
            }
            "agentMessage", "assistantMessage", "message" -> {
                if (meaningfulText(item.text)) draft.add(DraftEntry.Message(item))
            }
            else -> {
                // Keep unfamiliar MSP kinds in inspectable activity rather
                // than presenting raw internal events as assistant prose.
                if (item.kind == "reasoning" && item.text.isBlank() &&
                    item.detail.isBlank() && item.status.isBlank()) continue
                val group = current ?: DraftEntry.Activity("activity:" + item.id).also {
                    current = it
                    draft.add(it)
                }
                group.steps.add(item)
            }
        }
    }
    return draft.map { entry ->
        when (entry) {
            is DraftEntry.Message -> ConversationEntry.Message(entry.item)
            is DraftEntry.Activity -> ConversationEntry.Activity(
                entry.key, entry.steps.toList(),
            )
        }
    }
}
