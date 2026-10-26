package io.muse.remote.core

import kotlin.test.Test
import kotlin.test.assertEquals

class ActivityAlertTrackerTest {
    @Test fun noAlertsOnBootstrapOrOldApprovals() {
        val t = ActivityAlertTracker()
        assertEquals(emptyList(), t.observe("s1", true, setOf("old"), true, false))
        assertEquals(emptyList(), t.observe("s1", true, setOf("old"), true, false))
        assertEquals(listOf(LocalActivityEvent.APPROVAL_REQUIRED),
            t.observe("s1", true, setOf("old","new"), true, false))
        assertEquals(emptyList(), t.observe("s1", true, setOf("old","new"), true, false))
    }

    @Test fun completionAlertsOnlyOnceWhileAppHidden() {
        val t = ActivityAlertTracker()
        t.observe("s1", true, emptySet(), true, true)
        assertEquals(listOf(LocalActivityEvent.TURN_COMPLETED),
            t.observe("s1", true, emptySet(), false, false))
        assertEquals(emptyList(), t.observe("s1", true, emptySet(), false, false))
        t.observe("s1", true, emptySet(), true, true)
        assertEquals(emptyList(), t.observe("s1", true, emptySet(), false, true))
    }

    @Test fun sessionSwitchAndDisconnectNeverAlert() {
        val t = ActivityAlertTracker()
        t.observe("s1", true, emptySet(), true, true)
        assertEquals(emptyList(), t.observe("s2", true, setOf("approval"), false, false))
        assertEquals(emptyList(), t.observe(null, false, emptySet(), false, false))
        assertEquals(emptyList(), t.observe("s2", true, setOf("approval"), false, false))
    }

    @Test fun awaitingApprovalDoesNotGenerateCompletionDoubleAlert() {
        val t = ActivityAlertTracker()
        t.observe("s1", true, emptySet(), true, true)
        assertEquals(listOf(LocalActivityEvent.APPROVAL_REQUIRED),
            t.observe("s1", true, setOf("p1"), false, false))
    }
}
