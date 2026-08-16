package tel.quark.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Injects a push payload from `adb`, so the whole wake path can be exercised
 * without a distributor, a gateway or a homeserver.
 *
 * This is the harness for the riskiest part of push: nothing else in this app
 * calls Rust without a `TauriActivity`, so "does the library load, does the JNI
 * symbol resolve, can a Tauri-less process build a Matrix client and sync"
 * needs an answer before any of the UnifiedPush machinery is worth writing.
 *
 * Debug builds only — see src/debug/AndroidManifest.xml for why.
 *
 *     adb shell am broadcast -n tel.quark.app/.PushDebugReceiver \
 *       --es payload '{"notification":{"room_id":"!ROOM:server","event_id":"$EVENT","counts":{"unread":1}}}'
 *
 * Then watch it work (or not):
 *
 *     adb logcat -s quark
 *
 * Force-stop the app first (`adb shell am force-stop tel.quark.app`) — with the
 * app running, the wake correctly declines to open a second sync and you will
 * have proved nothing.
 */
class PushDebugReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val payload = intent.getStringExtra("payload")
    if (payload.isNullOrEmpty()) {
      Log.w("quark", "PushDebugReceiver: pass a payload with --es payload '<json>'")
      return
    }
    Log.i("quark", "PushDebugReceiver: injecting a push payload")
    if (!PushSyncService.start(context, payload)) {
      // Same fallback the real receiver uses: if Android refuses the service,
      // handle it inline rather than dropping the push.
      val pending = goAsync()
      Thread {
        try {
          PushNotifier.post(context.applicationContext, PushNative.handle(context.applicationContext, payload))
        } catch (e: Throwable) {
          Log.e("quark", "Inline push handling failed", e)
        } finally {
          pending.finish()
        }
      }.start()
    }
  }
}
