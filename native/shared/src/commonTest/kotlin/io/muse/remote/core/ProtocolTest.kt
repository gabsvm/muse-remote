package io.muse.remote.core

import kotlin.test.*
import kotlinx.serialization.json.*

class ProtocolTest {
    @Test fun sessionParsingUsesFirstPromptAndWorkspace() {
        val obj = buildJsonObject {
            put("sessionId", "abc-123")
            put("firstUserPrompt", "Arreglar streaming")
            put("workspaceRoot", "C:\\Dev\\muse-remote")
            put("status", "running")
        }
        val parsed = SessionSummary.from(obj)!!
        assertEquals("Arreglar streaming", parsed.title)
        assertEquals("running", parsed.status)
        assertEquals("C:\\Dev\\muse-remote", parsed.workspace)
    }

    @Test fun credentialsRejectNonTlsRemoteHosts() {
        assertFailsWith<IllegalArgumentException> {
            ServerCredentials("http://example.com", "1234567890abcdef").validate()
        }
        ServerCredentials("https://muse.example.com/", "1234567890abcdef").validate()
    }

    @Test fun approvalChoicesUseServerIds() {
        val obj = buildJsonObject {
            put("approvalId", "approval-1")
            put("sessionId", "s1")
            put("currentRequirementId", "req-1")
            putJsonArray("availableChoices") {
                add(buildJsonObject { put("choiceId", "allowOnce"); put("label", "Una vez") })
            }
        }
        assertEquals("allowOnce", PendingApproval.from(obj)!!.choices.single().id)
    }
}
