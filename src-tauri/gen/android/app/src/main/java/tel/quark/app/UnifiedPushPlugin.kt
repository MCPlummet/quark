package tel.quark.app

import android.app.Activity
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.unifiedpush.android.connector.UnifiedPush

/**
 * App-local Tauri plugin for the parts of UnifiedPush that need an Activity:
 * listing the installed distributors and asking the user to choose one.
 *
 * Registered from Rust via `register_android_plugin` (unifiedpush.rs) and
 * reached only through `run_mobile_plugin`, so there is no JS surface and no
 * capability wiring — same arrangement as [SyncServicePlugin].
 *
 * Everything that happens *after* registration — endpoints arriving, messages,
 * revocations — lands in [PushEventService] instead, because it has to work
 * when no Activity exists.
 */
@TauriPlugin
class UnifiedPushPlugin(private val activity: Activity) : Plugin(activity) {
  private companion object {
    const val TAG = "quark"
  }

  /**
   * What Settings needs to explain the current state: which distributors are
   * installed, and which one (if any) we are using.
   *
   * An empty list is the normal state for a user who has not installed one —
   * it is not an error, it is the thing Settings has to tell them about.
   */
  @Command
  fun status(invoke: Invoke) {
    val result = JSObject()
    try {
      result.put("distributors", JSArray.from(UnifiedPush.getDistributors(activity).toTypedArray()))
      result.put("saved", UnifiedPush.getSavedDistributor(activity) ?: "")
    } catch (e: Throwable) {
      Log.w(TAG, "Could not read distributor state", e)
      result.put("distributors", JSArray())
      result.put("saved", "")
    }
    invoke.resolve(result)
  }

  /**
   * Start (or restart) registration.
   *
   * `tryUseCurrentOrDefaultDistributor` keeps the saved distributor if there is
   * one and otherwise picks the only installed one, prompting only when the
   * choice is genuinely ambiguous. That is why this needs an Activity, and why
   * it is the one part of push that cannot happen on the cold path.
   *
   * Resolving with `registered: false` means no distributor could be chosen —
   * usually none is installed. The endpoint itself does not arrive here; the
   * distributor delivers it to [PushEventService] moments later.
   */
  @Command
  fun register(invoke: Invoke) {
    try {
      UnifiedPush.tryUseCurrentOrDefaultDistributor(activity) { success ->
        if (success) {
          try {
            UnifiedPush.register(activity)
          } catch (e: Throwable) {
            Log.e(TAG, "Distributor registration failed", e)
            invoke.resolve(JSObject().apply { put("registered", false) })
            return@tryUseCurrentOrDefaultDistributor
          }
        }
        invoke.resolve(JSObject().apply { put("registered", success) })
      }
    } catch (e: Throwable) {
      Log.e(TAG, "Could not reach a distributor", e)
      invoke.resolve(JSObject().apply { put("registered", false) })
    }
  }

  /**
   * Adopt the distributor the user picked by name.
   *
   * The one case [register] cannot resolve: `tryUseCurrentOrDefaultDistributor`
   * declines precisely when the choice is ambiguous — two or more distributors
   * installed and none saved yet — so it reports `registered: false` and there
   * is nothing further the app can do on its own. Without this, Settings can
   * list what [status] found but never act on it, and the user waits forever
   * for a distributor they have already installed twice over.
   *
   * Saving the choice is what makes the ambiguity go away for good: every later
   * [register] finds a saved distributor and stops needing to guess.
   *
   * Failure resolves `registered: false` rather than throwing, matching how
   * [register] reports the same condition — Settings has one state to render
   * either way.
   */
  @Command
  fun selectDistributor(invoke: Invoke) {
    val name = invoke.parseArgs(DistributorArgs::class.java).distributor
    if (name.isNullOrBlank()) {
      invoke.resolve(JSObject().apply { put("registered", false) })
      return
    }
    try {
      UnifiedPush.saveDistributor(activity, name)
      UnifiedPush.register(activity)
    } catch (e: Throwable) {
      Log.e(TAG, "Could not register with the chosen distributor", e)
      invoke.resolve(JSObject().apply { put("registered", false) })
      return
    }
    invoke.resolve(JSObject().apply { put("registered", true) })
  }

  /** Argument shape for [selectDistributor]; Tauri deserialises into it by field name. */
  class DistributorArgs {
    var distributor: String? = null
  }

  /**
   * Dismiss every notification on screen for a room.
   *
   * Lives here rather than on the Rust registry because a push posts
   * notifications from a process that is usually gone by the time the user
   * reads the room — only the OS still knows about those.
   */
  @Command
  fun cancelRoom(invoke: Invoke) {
    val roomId = invoke.parseArgs(RoomArgs::class.java).roomId
    if (roomId.isNullOrEmpty()) {
      invoke.resolve()
      return
    }
    PushNotifier.cancelRoom(activity, roomId)
    invoke.resolve()
  }

  /** Argument shape for [cancelRoom]; Tauri deserialises into it by field name. */
  class RoomArgs {
    var roomId: String? = null
  }

  /**
   * Stop receiving pushes.
   *
   * Only tells the distributor. Removing the pusher from the homeserver is
   * Rust's job and happens either from the resulting `onUnregistered` or
   * directly from the Settings command — whichever gets there first, since
   * deleting a pusher twice is a no-op.
   */
  @Command
  fun unregister(invoke: Invoke) {
    try {
      UnifiedPush.unregister(activity)
      UnifiedPush.removeDistributor(activity)
    } catch (e: Throwable) {
      Log.w(TAG, "Unregistration failed", e)
    }
    invoke.resolve()
  }
}
