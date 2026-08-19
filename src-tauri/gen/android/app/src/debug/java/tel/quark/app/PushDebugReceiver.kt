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
 * Two modes, because they prove different halves and need different setups.
 *
 * **selftest** needs no account at all. It renders a synthetic notification
 * through the real `notify::evaluate` and posts it, which covers the JNI
 * boundary, the spec's trip back through JSON, the channels and the tap intent:
 *
 *     adb shell am broadcast -n tel.quark.app/.PushDebugReceiver --es mode selftest
 *
 * **push** (the default) is the real thing, and needs a signed-in device with
 * push enabled — a wake declines before touching the network otherwise.
 *
 * Note the doubled quoting. `adb shell` hands the command to a shell *on the
 * device*, which strips one layer, so JSON quoted only for your own shell
 * arrives with its double quotes gone and fails to parse ("key must be a
 * string at line 1 column 2"). Wrapping it in single quotes as well is what
 * survives the second shell:
 *
 *     JSON='{"notification":{"room_id":"!ROOM:server","event_id":"$EVENT","counts":{"unread":1}}}'
 *     adb shell am broadcast -n tel.quark.app/.PushDebugReceiver --es payload "'$JSON'"
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
    if (intent.getStringExtra("mode") == "selftest") {
      runSelfTest(context)
      return
    }
    val payload = intent.getStringExtra("payload")
    if (payload.isNullOrEmpty()) {
      Log.w(
        "quark",
        "PushDebugReceiver: pass --es payload '<json>', or --es mode selftest",
      )
      return
    }
    Log.i("quark", "PushDebugReceiver: injecting a push payload")
    if (!PushSyncService.start(context, payload)) {
      // Same fallback the real receiver uses: if Android refuses the service,
      // handle it inline rather than dropping the push.
      val pending = goAsync()
      Thread {
        try {
          val app = context.applicationContext
          val result = PushNative.handle(app, payload)
          PushNotifier.post(app, result.specs)
          result.dismiss.forEach { PushNotifier.cancelRoom(app, it) }
        } catch (e: Throwable) {
          Log.e("quark", "Inline push handling failed", e)
        } finally {
          pending.finish()
        }
      }.start()
    }
  }

  /**
   * Render and post a synthetic notification. No service: there is no sync to
   * outlive a receiver's ten seconds, only a config read and a `notify` call.
   */
  private fun runSelfTest(context: Context) {
    Log.i("quark", "PushDebugReceiver: running the push self-test")
    val pending = goAsync()
    Thread {
      try {
        val app = context.applicationContext
        val result = PushNative.selfTest(app)
        if (result.specs.isEmpty()) {
          Log.w("quark", "Self-test produced no notification — see the reason logged above")
        } else {
          PushNotifier.post(app, result.specs)
          Log.i("quark", "Self-test posted ${result.specs.size} notification(s)")
        }
        // The synthetic event never asks for a dismissal, but honour one if it
        // ever does: half a contract exercised is a harness that lies.
        result.dismiss.forEach { PushNotifier.cancelRoom(app, it) }
      } catch (e: Throwable) {
        Log.e("quark", "Self-test failed", e)
      } finally {
        pending.finish()
      }
    }.start()
  }
}
