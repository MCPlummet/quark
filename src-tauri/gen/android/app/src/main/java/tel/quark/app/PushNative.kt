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
 * [PushEventService] falls back to making this same call itself. Both callers
 * need the binding, so it belongs to neither.
 *
 * A Kotlin `object`'s members are instance methods on the singleton, which
 * keeps the JNI symbol at the plain `Java_tel_quark_app_PushNative_…` name. A
 * companion object would mangle it and fail at call time instead of build time.
 */
object PushNative {
  private const val TAG = "quark"

  /**
   * Nothing to show, nothing to take away — the answer to every early return.
   *
   * Shared rather than rebuilt at each `return`, so the "we could not even ask
   * Rust" paths cannot drift apart from one another.
   */
  private val NOTHING = PushResult(emptyList(), emptyList())

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
   * Run the push through Rust and return what it decided the push means.
   *
   * Blocking, and can take seconds — it may build a Matrix client and sync.
   * Never call it on the main thread.
   */
  fun handle(context: Context, payload: String): PushResult {
    if (!libraryLoaded) return NOTHING

    // Rust resolves the store, the session and notifications.toml under this
    // one path: Tauri's app_data_dir() and app_config_dir() both resolve to
    // Context.dataDir on Android.
    val json = try {
      nativeHandlePush(payload, context.dataDir.absolutePath)
    } catch (e: Throwable) {
      Log.e(TAG, "Push handler failed", e)
      null
    } ?: return NOTHING

    return try {
      val result = JSONObject(json)
      result.optString("error").takeIf { it.isNotEmpty() }?.let {
        Log.w(TAG, "Push handler reported: $it")
      }
      PushResult(
        specs = parseSpecs(result.optJSONArray("specs")),
        dismiss = parseDismiss(result.optJSONArray("dismiss")),
      )
    } catch (e: Throwable) {
      Log.e(TAG, "Unreadable push result", e)
      NOTHING
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
   * Room ids the push says are already read elsewhere.
   *
   * Rust omits the key entirely when it has nothing to dismiss, which is the
   * common case, so an absent array has to mean "none" rather than "malformed".
   * Blank entries are skipped for the same reason: a room id that cannot
   * identify a room would match every notification with no group set.
   */
  private fun parseDismiss(array: JSONArray?): List<String> {
    if (array == null) return emptyList()
    val rooms = ArrayList<String>(array.length())
    for (i in 0 until array.length()) {
      val room = array.optString(i)
      if (room.isNullOrBlank()) continue
      rooms.add(room)
    }
    return rooms
  }

  /**
   * Render a notification from a synthetic event — no session, no network.
   *
   * Present only in debug builds (the Rust symbol is gated on
   * `debug_assertions`), so this reports the failure rather than assuming it
   * will resolve. Used by PushDebugReceiver to exercise the render-and-post
   * half of the cold path on a device that has never logged in.
   */
  fun selfTest(context: Context): PushResult {
    if (!libraryLoaded) return NOTHING
    val json = try {
      nativeSelfTest(context.dataDir.absolutePath)
    } catch (e: UnsatisfiedLinkError) {
      Log.e(TAG, "nativeSelfTest is missing — this is not a debug build", e)
      return NOTHING
    } catch (e: Throwable) {
      Log.e(TAG, "Push self-test failed", e)
      return NOTHING
    } ?: return NOTHING

    return try {
      val result = JSONObject(json)
      result.optString("error").takeIf { it.isNotEmpty() }?.let { Log.w(TAG, "Self-test: $it") }
      PushResult(
        specs = parseSpecs(result.optJSONArray("specs")),
        dismiss = parseDismiss(result.optJSONArray("dismiss")),
      )
    } catch (e: Throwable) {
      Log.e(TAG, "Unreadable self-test result", e)
      NOTHING
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
 * Both halves of what one push can mean.
 *
 * A push is not always something to add. A counts-only payload naming a room is
 * the homeserver saying the user read that room on another device, and Rust
 * answers it with a dismissal instead of a sync — so a single call has to be
 * able to return notifications, dismissals, or neither. `dismiss` is absent
 * from the wire whenever it is empty, which is nearly always.
 */
data class PushResult(val specs: List<PushSpec>, val dismiss: List<String>)

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
