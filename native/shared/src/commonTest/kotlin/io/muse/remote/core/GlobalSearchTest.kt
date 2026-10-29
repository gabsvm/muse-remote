package io.muse.remote.core

import kotlinx.serialization.json.*
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GlobalSearchTest {
    private val session = SessionSummary(
        id = "s1", title = "Proyecto Muse", workspace = "repo", status = "idle",
        model = "", updatedAt = "2026-10-27", turnCount = 3,
    )
    @Test fun onlyHumanAndAgentMessagesMatch() {
        val history = buildJsonObject {
            putJsonArray("items") {
                add(buildJsonObject {
                    put("kind", "toolCall"); put("itemId", "tool")
                    put("text", "secreto scroll")
                })
                add(buildJsonObject {
                    put("kind", "reasoning"); put("itemId", "thought")
                    put("text", "scroll razonamiento")
                })
                add(buildJsonObject {
                    put("kind", "userMessage"); put("itemId", "user")
                    put("text", "Necesito corregir el scroll")
                })
                add(buildJsonObject {
                    put("kind", "agentMessage"); put("itemId", "agent")
                    put("text", "Scroll corregido")
                })
            }
        }
        val hits = globalSearchHits(session, history, "scroll")
        assertEquals(listOf("user","agent"), hits.map { it.itemId })
        assertTrue(hits.none { it.preview.contains("secreto") })
    }
    @Test fun compactedSnapshotsAreIndexedToo() {
        val history = buildJsonObject {
            put("snapshot", buildJsonObject {
                put("state", buildJsonObject {
                    putJsonArray("items") {
                        add(buildJsonObject {
                            put("kind","agentMessage"); put("itemId","m1")
                            put("text","Búsqueda completada")
                        })
                    }
                })
            })
        }
        assertEquals("m1", globalSearchHits(session,history,"búsqueda").single().itemId)
    }
    @Test fun excerptsAndResultCountAreBounded() {
        val history = buildJsonObject {
            putJsonArray("items") {
                repeat(100) {
                    add(buildJsonObject {
                        put("kind","userMessage")
                        put("itemId","id"+it)
                        put("text","resultado " + "x".repeat(1000))
                    })
                }
            }
        }
        val hits = globalSearchHits(session,history,"resultado")
        assertEquals(5, hits.size)
        assertTrue(hits.all { it.preview.length <= 222 })
        assertTrue(globalSearchHits(session,history,"aa").isEmpty())
    }
}
