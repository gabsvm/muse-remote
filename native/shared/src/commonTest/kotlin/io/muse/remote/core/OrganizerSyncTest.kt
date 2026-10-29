package io.muse.remote.core

import kotlinx.serialization.json.*
import kotlin.test.*

class OrganizerSyncTest {
    @Test fun mergeLocalWinsByDefaultAndNeverDeletesUniqueItems() {
        val local = OrganizerBackup(
            projects=listOf(RemoteProject("p1","Local"), RemoteProject("p2","Unico")),
            assignments=mapOf("s1" to "p1"),
            aliases=mapOf("s1" to "Alias local"),
            pinned=setOf("s1"),
        )
        val remote = OrganizerBackup(
            projects=listOf(RemoteProject("p1","Remoto"),RemoteProject("p3","Nuevo")),
            assignments=mapOf("s1" to "p3","s2" to "p3"),
            aliases=mapOf("s1" to "Alias remoto", "s2" to "Alias nuevo"),
            pinned=setOf("s2"),
        )
        val safe = local.mergedWith(remote,false)
        assertEquals("Local",safe.projects.first { it.id=="p1" }.name)
        assertEquals("Unico",safe.projects.first { it.id=="p2" }.name)
        assertEquals("Nuevo",safe.projects.first { it.id=="p3" }.name)
        assertEquals("Alias local",safe.aliases["s1"])
        assertEquals("Alias nuevo",safe.aliases["s2"])
        assertEquals(setOf("s1","s2"),safe.pinned)
        val remotePreferred = local.mergedWith(remote,true)
        assertEquals("Remoto",remotePreferred.projects.first { it.id=="p1" }.name)
        assertEquals("Alias remoto",remotePreferred.aliases["s1"])
        assertEquals("p3",remotePreferred.assignments["s1"])
    }
    @Test fun serializationExcludesSecretsAndRoundTrips() {
        val data = OrganizerBackup(listOf(RemoteProject("p1","Muse Remote","C:/Dev")),
            mapOf("session" to "p1"),mapOf("session" to "Organizado"),setOf("session"))
        val encoded = data.toJson()
        assertFalse(encoded.containsKey("token"))
        assertFalse(encoded.containsKey("drafts"))
        assertFalse(encoded.containsKey("messages"))
        assertEquals(data,OrganizerBackup.from(encoded))
    }
    @Test fun invalidNamesAndOverflowAreRejected() {
        assertFailsWith<IllegalArgumentException> {
            OrganizerBackup(emptyList(),emptyMap(),mapOf("s1" to "\u0001bad"),emptySet())
                .validated()
        }
        assertFailsWith<IllegalArgumentException> {
            OrganizerBackup(listOf(RemoteProject("id","x".repeat(65))),
                emptyMap(),emptyMap(),emptySet()).validated()
        }
        assertFailsWith<IllegalArgumentException> {
            OrganizerBackup.from(buildJsonObject { put("v",2) })
        }
    }
    @Test fun storeCanApplyMergedOrganization() {
        val store = MemoryCredentialsStore()
        val imported = OrganizerBackup(listOf(RemoteProject("p9","Importado")),
            mapOf("s9" to "p9"),mapOf("s9" to "Mi chat"),setOf("s9"))
        store.saveOrganizerBackup(imported)
        assertEquals(imported,OrganizerBackup.fromStore(store))
    }
}
