package io.muse.remote.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import kotlinx.coroutines.runBlocking
import kotlin.test.*

class ProjectOrganizerTest {
    private fun controller(store: MemoryCredentialsStore): MuseController =
        MuseController(MuseGateway(HttpClient(MockEngine {
            respond("""{"ok":true,"result":{}}""")
        })), store)

    @Test fun projectsPersistAcrossControllersAndNeverDeleteMspSessions() {
        val store = MemoryCredentialsStore()
        val first = controller(store)
        try {
            first.createProject(" HorrorPlay ", "C:\\Dev\\horrorplay")
            val project = first.state.value.projects.single()
            assertEquals("HorrorPlay", project.name)
            first.assignSession("chat-001", project.id)
            first.assignSession("chat-002", project.id)
            first.togglePinned("chat-002")
            first.togglePinned("chat-001")
            first.togglePinned("chat-001")
            assertEquals(setOf("chat-002"), first.state.value.pinnedSessionIds)
            assertEquals(project.id, first.state.value.projectAssignments["chat-002"])
            val second = controller(store)
            try {
                assertEquals("HorrorPlay", second.state.value.projects.single().name)
                assertEquals(project.id, second.state.value.projectAssignments["chat-001"])
                assertTrue("chat-002" in second.state.value.pinnedSessionIds)
                second.updateProject(project.id, "El Huésped", "C:\\Dev\\huesped")
                assertEquals("El Huésped", second.state.value.projects.single().name)
                second.assignSession("chat-001", null)
                assertFalse(second.state.value.projectAssignments.containsKey("chat-001"))
                second.deleteProject(project.id)
                assertTrue(second.state.value.projectAssignments.isEmpty())
                assertTrue(second.state.value.projects.isEmpty())
                assertTrue("chat-002" in second.state.value.pinnedSessionIds,
                    "Project removal must not unpin or delete chats")
            } finally { second.close() }
        } finally { first.close() }
    }

    @Test fun invalidProjectAssignmentDoesNotOverwriteExistingGrouping() {
        val store = MemoryCredentialsStore()
        val c = controller(store)
        try {
            c.createProject("A")
            val id = c.state.value.projects.single().id
            c.assignSession("s1", id)
            c.assignSession("s1", "not-a-project")
            assertEquals(id, c.state.value.projectAssignments["s1"])
            c.createProject("")
            assertEquals(1, c.state.value.projects.size)
        } finally { c.close() }
    }
}
