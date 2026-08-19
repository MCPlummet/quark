package tel.quark.app

import android.util.Log
import kotlin.concurrent.thread
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/**
 * Everything the distributor tells us.
 *
 * Extends the connector's [PushService] rather than the older
 * `MessagingReceiver`, which 3.x deprecates: the service form gets a real
 * service lifetime instead of a broadcast receiver's ten seconds, and the
 * library handles acknowledging messages back to the distributor.
 *
 * It still hands the actual work to [PushSyncService], because [PushService] is
 * not a *foreground* service — a background service can be killed mid-sync, and
 * a sync that dies partway through has already spent the battery without
 * showing the notification it was woken for.
 */
class PushEventService : PushService() {
  private companion object {
    const val TAG = "quark"
  }

  override fun onMessage(message: PushMessage, instance: String) {
    // `decrypted` is false on the Matrix gateway path and that is expected, not
    // a problem: the gateway is a plaintext protocol translator, so there is no
    // Web Push encryption on this leg. What protects the content is that there
    // is no content — event_id_only means the gateway sees only ids.
    if (!message.decrypted) {
      Log.d(TAG, "Push arrived unencrypted (expected via the Matrix gateway)")
    }
    val payload = String(message.content, Charsets.UTF_8)
    if (!PushSyncService.start(this, payload)) {
      handleInline(payload)
    }
  }

  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    // `temporary` marks a stand-in endpoint from a fallback distributor. It is
    // still a working address, and treating it as one keeps push alive while
    // the primary is down — the real one arrives as another onNewEndpoint.
    Log.i(TAG, "Distributor endpoint received (temporary=${endpoint.temporary})")
    val url = endpoint.url
    thread(name = "quark-push-endpoint") {
      try {
        PushNative.onNewEndpoint(applicationContext, url)
      } catch (e: Throwable) {
        Log.e(TAG, "Failed to record the push endpoint", e)
      }
    }
  }

  override fun onUnregistered(instance: String) {
    Log.i(TAG, "Distributor revoked our registration")
    thread(name = "quark-push-unregister") {
      try {
        PushNative.onUnregistered(applicationContext)
      } catch (e: Throwable) {
        Log.e(TAG, "Failed to clean up after unregistration", e)
      }
    }
  }

  override fun onRegistrationFailed(reason: FailedReason, instance: String) {
    // Nothing to retry here. NETWORK and INTERNAL_ERROR resolve on the next
    // registration attempt at app start; ACTION_REQUIRED needs the user to fix
    // their distributor, which Settings tells them about by reporting that no
    // endpoint has arrived. Retrying in a loop would only drain the battery.
    Log.w(TAG, "Push registration failed: $reason")
  }

  override fun onTempUnavailable(instance: String) {
    // The distributor's backend is briefly down. It will re-announce when it
    // recovers; the existing endpoint stays registered meanwhile.
    Log.i(TAG, "Distributor temporarily unavailable")
  }

  /**
   * Fallback for when Android refuses to start a foreground service from the
   * background. This service is still alive at this point, so the work has more
   * headroom than a broadcast receiver would give it — less than the foreground
   * path, but far better than dropping the push.
   */
  private fun handleInline(payload: String) {
    thread(name = "quark-push-inline") {
      try {
        val result = PushNative.handle(applicationContext, payload)
        PushNotifier.post(applicationContext, result.specs)
        result.dismiss.forEach { PushNotifier.cancelRoom(applicationContext, it) }
      } catch (e: Throwable) {
        Log.e(TAG, "Inline push handling failed", e)
      }
    }
  }
}
