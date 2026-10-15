package io.muse.remote.core

import kotlin.test.*

class ConversationPresentationTest {
    private fun item(id: String, kind: String, text: String = "",
                     status: String = "", tool: String = "") =
        ChatItem(id, kind, text, status, tool, "")

    @Test fun fiftyToolCallsBecomeOneCompactActivityBlock() {
        val original = listOf(item("user", "userMessage", "Arregla el proyecto")) +
            (1..50).map { item("tool-$it", "toolCall", status = "completed", tool = "shell") } +
            listOf(item("answer", "agentMessage", "El proyecto está listo."))
        val entries = conversationEntries(original)
        assertEquals(3, entries.size)
        assertEquals("user", (entries[0] as ConversationEntry.Message).item.id)
        val activity = entries[1] as ConversationEntry.Activity
        assertEquals(50, activity.steps.size)
        assertEquals(50, activity.toolCount)
        assertEquals("activity:tool-1", activity.key)
        assertEquals("El proyecto está listo.",
            (entries[2] as ConversationEntry.Message).item.text)
        assertEquals(original.size, 52, "MSP history must remain untouched")
    }

    @Test fun narrationBetweenToolsDoesNotSpawnMoreActivityCards() {
        val entries = conversationEntries(listOf(
            item("u1", "userMessage", "Haz pruebas"),
            item("t1", "toolCall", status = "completed"),
            item("a1", "agentMessage", "Verificando archivos"),
            item("t2", "toolCall", status = "failed"),
            item("r1", "reasoning", status = "completed"),
            item("a2", "agentMessage", "Corregí el error"),
            item("t3", "toolCall", status = "completed"),
            item("u2", "userMessage", "Gracias"),
            item("t4", "toolCall", status = "completed"),
            item("a3", "agentMessage", "Listo."),
        ))
        assertEquals(7, entries.size)
        val activities = entries.filterIsInstance<ConversationEntry.Activity>()
        assertEquals(2, activities.size)
        assertEquals(listOf("t1","t2","r1","t3"), activities[0].steps.map { it.id })
        assertEquals(1, activities[0].failedCount)
        assertEquals(listOf("t4"), activities[1].steps.map { it.id })
        assertEquals("activity:t1", activities[0].key)
    }

    @Test fun emptyMuseMessagesAndEllipsesAreNotRendered() {
        val entries = conversationEntries(listOf(
            item("u", "userMessage", "Hola"),
            item("a0", "agentMessage", ""),
            item("a1", "agentMessage", "..."),
            item("a2", "agentMessage", "…"),
            item("a3", "agentMessage", "Respuesta real"),
            item("t", "toolCall", status = "completed"),
        ))
        assertEquals(3, entries.size)
        assertEquals("Respuesta real", (entries[1] as ConversationEntry.Message).item.text)
    }

    @Test fun activityKeysAndOrderRemainStableWhenStepsStreamIn() {
        val initial = listOf(
            item("u", "userMessage", "Tarea"),
            item("t1", "toolCall", status = "running"),
        )
        val first = conversationEntries(initial).filterIsInstance<ConversationEntry.Activity>().single()
        val next = conversationEntries(initial + listOf(item("t2", "toolCall", status = "completed")))
            .filterIsInstance<ConversationEntry.Activity>().single()
        assertEquals(first.key, next.key)
        assertEquals(1, first.steps.size)
        assertEquals(2, next.steps.size)
    }

    @Test fun unknownKindsAreActivityNotFalseAssistantMessages() {
        val entries = conversationEntries(listOf(
            item("x", "arbitrarySystemArtifact", "internal event"),
            item("r", "reasoning", text = "Internal data"),
            item("a", "agentMessage", "Respuesta"),
        ))
        val activity = entries.first() as ConversationEntry.Activity
        assertEquals(2, activity.steps.size)
        assertEquals("Respuesta", (entries.last() as ConversationEntry.Message).item.text)
    }
}
