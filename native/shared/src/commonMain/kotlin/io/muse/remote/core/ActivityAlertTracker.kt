package io.muse.remote.core

enum class LocalActivityEvent { APPROVAL_REQUIRED, TURN_COMPLETED }

/** Pure, deterministic foreground-process notification policy.
 * Snapshot bootstrap, chat switching and historical pending approvals never alert.
 */
class ActivityAlertTracker {
    private var sessionId: String? = null
    private var approvals: Set<String> = emptySet()
    private var working: Boolean = false

    fun observe(
        activeSessionId: String?,
        ready: Boolean,
        pendingApprovals: Set<String>,
        turnWorking: Boolean,
        applicationVisible: Boolean,
    ): List<LocalActivityEvent> {
        if (!ready || activeSessionId.isNullOrBlank()) {
            sessionId = null
            approvals = emptySet()
            working = false
            return emptyList()
        }
        if (activeSessionId != sessionId) {
            sessionId = activeSessionId
            approvals = pendingApprovals
            working = turnWorking
            return emptyList()
        }
        val events = buildList {
            if (!applicationVisible) {
                if ((pendingApprovals - approvals).isNotEmpty())
                    add(LocalActivityEvent.APPROVAL_REQUIRED)
                if (working && !turnWorking && pendingApprovals.isEmpty())
                    add(LocalActivityEvent.TURN_COMPLETED)
            }
        }
        approvals = pendingApprovals
        working = turnWorking
        return events
    }
}
