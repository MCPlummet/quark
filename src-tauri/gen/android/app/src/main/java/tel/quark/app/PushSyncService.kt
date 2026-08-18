package tel.quark.app

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

    /** Start the service for a push payload; false if Android refuses. */
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
    var foreground = false
    try {
      SyncForegroundService.ensureChannel(this)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(
          NOTIFICATION_ID,
          buildPlaceholder(),
          ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE
        )
      } else {
        startForeground(NOTIFICATION_ID, buildPlaceholder())
      }
      foreground = true
    } catch (e: Throwable) {
      // ForegroundServiceStartNotAllowedException (12+), a refused SHORT_SERVICE
      // or InvalidForegroundServiceTypeException (14+).
      Log.w(TAG, "Could not enter the foreground; demoting to a background service", e)
    }

    // Any of those is survivable on its own and fatal if we press on regardless.
    // start() used startForegroundService, so Android is now counting: a service
    // begun that way and not in the foreground within ~10s takes the whole
    // process down with ForegroundServiceDidNotStartInTimeException, mid-sync.
    // Nor can the caller's inline fallback rescue us — start() already returned
    // true, so nobody is going to try again.
    //
    // So stop now, before the slow work, leaving the timer nothing to fire on,
    // and run the push anyway as a plain background service. A cached process
    // *may* be reclaimed before the sync finishes; the alternative is certain
    // to be killed. A maybe beats a certainty.
    if (!foreground) {
      stopSelf(startId)
    }

    val payload = intent?.getStringExtra(EXTRA_PAYLOAD)
    if (payload == null) {
      stopSelf(startId)
      return START_NOT_STICKY
    }

    // Off the main thread: this blocks on a network sync. The finally still
    // stops us on the demoted path — a second stopSelf for a startId already
    // stopped is a no-op, and on the normal path it is the only thing that
    // releases the service.
    thread(name = "quark-push") {
      try {
        val result = PushNative.handle(applicationContext, payload)
        PushNotifier.post(applicationContext, result.specs)
        result.dismiss.forEach { PushNotifier.cancelRoom(applicationContext, it) }
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
