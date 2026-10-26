package io.muse.remote.android

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import io.muse.remote.core.MuseState
import io.muse.remote.core.ActivityAlertTracker
import io.muse.remote.core.LocalActivityEvent

/**
 * Explicit opt-in, local notifications while this Android process remains alive.
 * This is NOT an always-on remote daemon nor FCM delivery: no background worker,
 * no persistent socket and no promise to work after Android kills the process.
 */
internal class MuseLocalNotifier(private val context: Context) {
    private val prefs = context.getSharedPreferences("muse_local_alerts_v1", Context.MODE_PRIVATE)
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val tracker = ActivityAlertTracker()

    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false) && permissionGranted()
        set(value) {
            prefs.edit().putBoolean("enabled", value && permissionGranted()).apply()
        }

    fun permissionGranted(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    fun observe(state: MuseState, appVisible: Boolean) {
        val events = tracker.observe(
            activeSessionId = if (state.authenticated) state.sessionId else null,
            ready = state.sessionReady,
            pendingApprovals = state.approvals.map { it.id }.toSet(),
            turnWorking = state.working,
            applicationVisible = appVisible,
        )
        if (!enabled) return
        val sid = state.sessionId ?: return
        for (event in events) {
            when (event) {
                LocalActivityEvent.APPROVAL_REQUIRED ->
                    notifyOnce("approval:$sid", "Muse requiere una aprobación",
                        "Abrí Muse Remote para revisar la solicitud.", 4101)
                LocalActivityEvent.TURN_COMPLETED ->
                    notifyOnce("done:$sid", "Turno de Muse finalizado",
                        "Revisá la respuesta en Muse Remote.", 4102)
            }
        }
    }

    private fun notifyOnce(tag: String, title: String, body: String, id: Int) {
        if (!permissionGranted()) return
        val channelId = "muse_remote_activity"
        if (manager.getNotificationChannel(channelId) == null) {
            manager.createNotificationChannel(
                NotificationChannel(channelId, "Actividad de Muse", NotificationManager.IMPORTANCE_DEFAULT)
                    .apply { description = "Aprobaciones y finalización de turnos (proceso abierto)" }
            )
        }
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_STATUS)
            .build()
        manager.notify(tag, id, notification)
    }
}
