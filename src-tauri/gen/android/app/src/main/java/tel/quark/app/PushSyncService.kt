package tel.quark.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlin.concurrent.thread

/**
 * Runs one push to completion.
 *
 * A broadcast receiver gets roughly ten seconds before Android considers it
 * hung, and a cold push has to build a Matrix client, open an encrypted SQLite
 * store and sync — comfortably more than that on a sleeping phone. A
 * `shortService` foreground service buys the time without claiming the
 * long-running exemption [SyncForegroundService] needs.
 *
 * It holds no state and does no work of its own: [PushNative] does the sync and
 * decides what to show, [PushNotifier] shows it, and then this stops itself.
 */
class PushSyncService : Service() {
  companion object {
    const val EXTRA_PAYLOAD = "payload"
    private const val TAG = "quark"
    private const val CHANNEL_ID = SyncForegroundService.CHANNEL_ID
    private const val NOTIFICATION_ID = 0x51_4B_50 // "QKP"

    /** Start the service for a push payload, or null if Android refuses. */
    fun start(context: Context, payload: String): Boolean {
      val intent = Intent(context, PushSyncService::class.java)
        .putExtra(EXTRA_PAYLOAD, payload)
      return try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      } catch (e: Throwable) {
        // Android 12+ refuses background foreground-service starts outside a
        // handful of exemptions. Receiving a push is normally one of them, but
        // "normally" is not a guarantee across OEMs — the caller falls back to
        // handling the push inline rather than dropping it.
        Log.w(TAG, "Could not start the push service", e)
        false
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForeground has to happen within seconds of the start request,
    // before any of the slow work.
    try {
      ensureChannel()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(
          NOTIFICATION_ID,
          buildPlaceholder(),
          ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE
        )
      } else {
        startForeground(NOTIFICATION_ID, buildPlaceholder())
      }
    } catch (e: Throwable) {
      Log.w(TAG, "Could not enter the foreground; handling the push anyway", e)
    }

    val payload = intent?.getStringExtra(EXTRA_PAYLOAD)
    if (payload == null) {
      stopSelf(startId)
      return START_NOT_STICKY
    }

    // Off the main thread: this blocks on a network sync.
    thread(name = "quark-push") {
      try {
        PushNotifier.post(applicationContext, PushNative.handle(applicationContext, payload))
      } catch (e: Throwable) {
        Log.e(TAG, "Push handling failed", e)
      } finally {
        stopSelf(startId)
      }
    }

    // Never restart a push we've lost the payload for — the homeserver will
    // resend, and a re-run with a null intent would sync for nothing.
    return START_NOT_STICKY
  }

  /**
   * Android 14+ calls this when a shortService has used up its time. The
   * process is killed shortly after, so all that is left is to stop cleanly —
   * an unstopped shortService is an ANR.
   */
  override fun onTimeout(startId: Int) {
    Log.w(TAG, "Push service timed out before the sync finished")
    stopSelf(startId)
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Background sync", NotificationManager.IMPORTANCE_MIN)
          .apply { description = "Keeps the connection to your homeserver alive" }
      )
    }
  }

  /**
   * The notification Android requires a foreground service to show. On the
   * lowest-importance channel and short-lived, so in practice it appears
   * briefly in the shade and disappears with the service.
   */
  private fun buildPlaceholder(): android.app.Notification =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("Checking for new messages")
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setShowWhen(false)
      .build()
}
