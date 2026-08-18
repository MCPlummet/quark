package tel.quark.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps the process — and with it the Rust tokio
 * runtime running the Matrix sync loop — alive while the app is backgrounded
 * or its task is swiped away. It does no work itself: the sync loop and
 * notification emission live entirely on the Rust side; this service only
 * raises the process to foreground importance so Android doesn't kill it.
 *
 * Service type is `specialUse`: `dataSync` gained a ~6 h/day runtime cap on
 * Android 15 (fatal for a persistent sync connection), and no other typed
 * bucket fits a chat client with no push server. Quark is distributed outside
 * Google Play, so Play's special-use review declaration does not apply; the
 * manifest documents the subtype regardless.
 */
class SyncForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "background_sync" // must match notify.rs CHANNEL_BACKGROUND
    const val NOTIFICATION_ID = 0x51_4B_53 // "QKS"

    @Volatile
    var isRunning: Boolean = false
      private set

    /**
     * The channel is normally created by the Rust side via the notification
     * plugin (init_notification_channels), but a foreground service must be
     * able to post its required notification even when it starts first — which
     * a push wake does routinely, in a process the webview has never run in.
     * Idempotent, so calling it after Rust already did costs nothing.
     *
     * On the companion rather than in each service because [PushSyncService]
     * posts its placeholder on this very channel. Two copies of the definition
     * would sooner or later disagree about the name or the importance the user
     * sees, and only one of them would win — whichever service started first.
     */
    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return // channels exist since API 26
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Background sync", NotificationManager.IMPORTANCE_MIN)
            .apply { description = "Keeps the connection to your homeserver alive" }
        )
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel(this)
    isRunning = true
  }

  override fun onDestroy() {
    isRunning = false
    super.onDestroy()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // Restart with a null intent if the system ever reclaims the process.
    return START_STICKY
  }

  // Keep running when the user swipes the task away — that's the entire point.
  override fun onTaskRemoved(rootIntent: Intent?) {}

  private fun buildNotification(): android.app.Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("Connected to Matrix")
      .setContentText("Listening for new messages")
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setOngoing(true)
      .setShowWhen(false)
      .setContentIntent(contentIntent)
      .build()
  }
}
