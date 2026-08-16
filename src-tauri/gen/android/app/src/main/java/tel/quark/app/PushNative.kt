package tel.quark.app

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Kotlin half of the push JNI boundary (see push_jni.rs).
 *
 * Its own class rather than a method on [PushSyncService] because Android can
 * refuse to start a foreground service from the background — when it does,
 * [PushReceiver] has to make this same call itself. Both callers need the
 * binding, so it belongs to neither.
 *
 * A Kotlin `object`'s members are instance methods on the singleton, which
 * keeps the JNI symbol at the plain `Java_tel_quark_app_PushNative_…` name. A
 * companion object would mangle it and fail at call time instead of build time.
 */
object PushNative {
  private const val TAG = "quark"

  /**
   * `TauriActivity` loads the library on the warm path, but a push can wake a
   * process where that never ran. Idempotent within a ClassLoader, so calling
   * it again when Tauri already did is free.
   */
  private val libraryLoaded: Boolean by lazy {
    try {
      System.loadLibrary("quark_lib")
      true
    } catch (e: UnsatisfiedLinkError) {
      Log.e(TAG, "Could not load quark_lib for push", e)
      false
    }
  }

  /**
   * Run the push through Rust and return the notifications it decided to show.
   *
   * Blocking, and can take seconds — it may build a Matrix client and sync.
   * Never call it on the main thread.
   */
  fun handle(context: Context, payload: String): List<PushSpec> {
    if (!libraryLoaded) return emptyList()

    // Rust resolves the store, the session and notifications.toml under this
    // one path: Tauri's app_data_dir() and app_config_dir() both resolve to
    // Context.dataDir on Android.
    val json = try {
      nativeHandlePush(payload, context.dataDir.absolutePath)
    } catch (e: Throwable) {
      Log.e(TAG, "Push handler failed", e)
      null
    } ?: return emptyList()

    return try {
      val result = JSONObject(json)
      result.optString("error").takeIf { it.isNotEmpty() }?.let {
        Log.w(TAG, "Push handler reported: $it")
      }
      parseSpecs(result.optJSONArray("specs"))
    } catch (e: Throwable) {
      Log.e(TAG, "Unreadable push result", e)
      emptyList()
    }
  }

  private fun parseSpecs(array: JSONArray?): List<PushSpec> {
    if (array == null) return emptyList()
    val specs = ArrayList<PushSpec>(array.length())
    for (i in 0 until array.length()) {
      val o = array.optJSONObject(i) ?: continue
      specs.add(
        PushSpec(
          id = o.getInt("id"),
          summaryId = o.getInt("summaryId"),
          title = o.getString("title"),
          body = o.getString("body"),
          channel = o.getString("channel"),
          group = o.getString("group"),
          roomId = o.getString("roomId"),
          eventId = o.getString("eventId"),
          roomName = o.getString("roomName"),
          highlight = o.optBoolean("highlight", false),
        )
      )
    }
    return specs
  }

  /**
   * Render a notification from a synthetic event — no session, no network.
   *
   * Present only in debug builds (the Rust symbol is gated on
   * `debug_assertions`), so this reports the failure rather than assuming it
   * will resolve. Used by PushDebugReceiver to exercise the render-and-post
   * half of the cold path on a device that has never logged in.
   */
  fun selfTest(context: Context): List<PushSpec> {
    if (!libraryLoaded) return emptyList()
    val json = try {
      nativeSelfTest(context.dataDir.absolutePath)
    } catch (e: UnsatisfiedLinkError) {
      Log.e(TAG, "nativeSelfTest is missing — this is not a debug build", e)
      return emptyList()
    } catch (e: Throwable) {
      Log.e(TAG, "Push self-test failed", e)
      return emptyList()
    } ?: return emptyList()

    return try {
      val result = JSONObject(json)
      result.optString("error").takeIf { it.isNotEmpty() }?.let { Log.w(TAG, "Self-test: $it") }
      parseSpecs(result.optJSONArray("specs"))
    } catch (e: Throwable) {
      Log.e(TAG, "Unreadable self-test result", e)
      emptyList()
    }
  }

  /** Record a distributor endpoint and register it with the homeserver. */
  fun onNewEndpoint(context: Context, endpoint: String) {
    if (!libraryLoaded) return
    logError("endpoint", runCatching { nativeOnNewEndpoint(endpoint, context.dataDir.absolutePath) })
  }

  /** Drop the endpoint and the pusher that pointed at it. */
  fun onUnregistered(context: Context) {
    if (!libraryLoaded) return
    logError("unregister", runCatching { nativeOnUnregistered(context.dataDir.absolutePath) })
  }

  /** The endpoint callbacks return only an error, if anything went wrong. */
  private fun logError(what: String, result: Result<String?>) {
    val json = result.getOrElse {
      Log.e(TAG, "Push $what callback failed", it)
      return
    } ?: return
    runCatching { JSONObject(json).optString("error") }
      .getOrNull()
      ?.takeIf { it.isNotEmpty() }
      ?.let { Log.w(TAG, "Push $what: $it") }
  }

  private external fun nativeHandlePush(payload: String, dataDir: String): String?

  private external fun nativeOnNewEndpoint(endpoint: String, dataDir: String): String?

  private external fun nativeOnUnregistered(dataDir: String): String?

  /** Debug builds only — absent from release, hence the UnsatisfiedLinkError catch. */
  private external fun nativeSelfTest(dataDir: String): String?
}

/**
 * A rendered notification, decided entirely on the Rust side by the same
 * `notify::evaluate` the warm path uses. Field names mirror NotificationSpec's
 * serde output — they are matched by name, so a rename there fails silently
 * here (notify.rs has a test pinning them).
 */
data class PushSpec(
  val id: Int,
  val summaryId: Int,
  val title: String,
  val body: String,
  val channel: String,
  val group: String,
  val roomId: String,
  val eventId: String,
  val roomName: String,
  val highlight: Boolean,
)
