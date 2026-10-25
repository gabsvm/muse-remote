package io.muse.remote.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import kotlin.test.*

/** No actual Muse CLI or subscriptions used; tests local Android organizer behavior. */
class SessionAliasTest {
    private fun controller(store: MemoryCredentialsStore): MuseController =
        MuseController(MuseGateway(HttpClient(MockEngine {
            respond("""{"ok":true,"result":{}}""")
        })), store)

    @Test fun aliasSurvivesRestartAndDoesNotChangeOtherOrganizerData() {
        val store = MemoryCredentialsStore()
        val a = controller(store)
        try {
            a.createProject("Project One")
            val project = a.state.value.projects.single()
            a.assignSession("s1", project.id)
            a.togglePinned("s1")
            a.renameSessionLocally("s1", "  Código del terror  ")
            assertEquals("Código del terror", a.state.value.sessionAliases["s1"])
            val b = controller(store)
            try {
                assertEquals("Código del terror", b.state.value.sessionAliases["s1"])
                assertTrue("s1" in b.state.value.pinnedSessionIds)
                assertEquals(project.id, b.state.value.projectAssignments["s1"])
                b.restoreSessionName("s1")
                assertFalse(b.state.value.sessionAliases.containsKey("s1"))
                assertTrue("s1" in b.state.value.pinnedSessionIds)
            } finally { b.close() }
        } finally { a.close() }
    }

    @Test fun invalidNameNeverOverwritesSavedAlias() {
        val store = MemoryCredentialsStore()
        val c = controller(store)
        try {
            c.renameSessionLocally("s1", "Original")
            c.renameSessionLocally("s1", "  ")
            c.renameSessionLocally("s1", "x".repeat(81))
            c.renameSessionLocally("s1", "Bad\nName")
            c.renameSessionLocally("", "Other")
            assertEquals(mapOf("s1" to "Original"), c.state.value.sessionAliases)
        } finally { c.close() }
    }

    @Test fun changingLocalChatAliasDoesNotCallBackend() {
        var calls = 0
        val store = MemoryCredentialsStore()
        val c = MuseController(MuseGateway(HttpClient(MockEngine {
            calls++
            respond("""{"ok":true,"result":{}}""")
        })), store)
        try {
            c.renameSessionLocally("s1", "Local name")
            c.restoreSessionName("s1")
            assertEquals(0, calls)
        } finally { c.close() }
    }
}
