package tel.quark.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import org.json.JSONObject

/**
 * Posts the notifications Rust decided on, when there is no Tauri to post them.
 *
 * Everything here is presentation. Whether a notification happens at all was
 * settled by `notify::evaluate` on the Rust side, using the same push rules,
 * mutes and quiet hours as the warm path — this only has to make the result
 * indistinguishable from a warm one, which means matching the notification
 * plugin's ids, channels, group keys and *intent extras* exactly. Diverge on
 * the extras and a tap opens the app on the wrong screen.
 */
object PushNotifier {
  private const val TAG = "quark"

  // Extra keys read by MainActivity.capturePendingNotificationAction, which is
  // what makes a cold tap land in the right room. They are the notification
  // plugin's own constants (TauriNotificationManager.kt) — including the typo
  // in "LocalNotficationObject", which must be reproduced, not corrected.
  private const val NOTIFICATION_INTENT_KEY = "NotificationId"
  private const val NOTIFICATION_OBJ_INTENT_KEY = "LocalNotficationObject"
  private const val ACTION_INTENT_KEY = "NotificationUserAction"
  private const val REMOTE_INPUT_KEY = "NotificationRemoteInput"

  /** Post every spec, adding a per-room summary once a room has more than one. */
  fun post(context: Context, specs: List<PushSpec>) {
    if (specs.isEmpty()) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    ensureChannels(manager)

    for (spec in specs) {
      try {
        manager.notify(spec.id, buildMessage(context, spec))
      } catch (e: Throwable) {
        Log.e(TAG, "Failed to post notification for ${spec.roomId}", e)
        continue
      }
      // Count what is actually on screen rather than what this call posted:
      // the room may already be showing notifications from an earlier push
      // whose process is long gone.
      val live = countInGroup(manager, spec.group)
      if (live > 1) {
        try {
          manager.notify(spec.summaryId, buildSummary(context, spec, live))
        } catch (e: Throwable) {
          Log.w(TAG, "Failed to post group summary for ${spec.roomId}", e)
        }
      }
    }
  }

  /**
   * Dismiss every notification belonging to a room.
   *
   * Asks the OS what is live instead of consulting a remembered list. The
   * Rust-side registry is per-process, so a notification posted by a push whose
   * process has since died is invisible to it — and that is precisely the
   * notification a user reading the room on another device wants gone.
   */
  fun cancelRoom(context: Context, roomId: String) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    try {
      for (active in manager.activeNotifications) {
        if (active.notification?.group == roomId) {
          manager.cancel(active.id)
        }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "Failed to clear notifications for $roomId", e)
    }
  }

  /**
   * Make sure the channels a spec can name exist.
   *
   * They are normally created by the frontend at startup
   * (`notify::setup_channels`), but a push can post before that has ever run —
   * on a fresh install, or into a process the webview never started in. On API
   * 26+ a notification sent to an unknown channel is dropped without an error,
   * which would look exactly like a broken JNI bridge.
   *
   * Definitions mirror `notify::setup_channels`. Creating one that exists is a
   * no-op — Android keeps the user's own importance and sound choices — so this
   * cannot override what they have configured.
   */
  private fun ensureChannels(manager: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    try {
      val messages = NotificationChannel(
        "messages",
        "Messages",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "New messages in your rooms"
        enableVibration(true)
      }
      val mentions = NotificationChannel(
        "mentions",
        "Mentions",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Messages that mention you"
        enableVibration(true)
        enableLights(true)
      }
      manager.createNotificationChannels(listOf(messages, mentions))
    } catch (e: Throwable) {
      Log.w(TAG, "Could not create notification channels", e)
    }
  }

  private fun countInGroup(manager: NotificationManager, group: String): Int =
    try {
      // Exclude the summary itself, or two messages would read "3 new".
      manager.activeNotifications.count {
        it.notification?.group == group &&
          (it.notification.flags and android.app.Notification.FLAG_GROUP_SUMMARY) == 0
      }
    } catch (e: Throwable) {
      Log.w(TAG, "Could not read active notifications", e)
      0
    }

  private fun buildMessage(context: Context, spec: PushSpec): android.app.Notification =
    NotificationCompat.Builder(context, spec.channel)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(spec.title)
      .setContentText(spec.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(spec.body))
      .setPriority(
        if (spec.highlight) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT
      )
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setGroup(spec.group)
      .setAutoCancel(true)
      .setContentIntent(actionIntent(context, spec, "tap"))
      .addAction(replyAction(context, spec))
      .addAction(
        NotificationCompat.Action.Builder(
          0,
          "Mark as read",
          actionIntent(context, spec, "mark_read")
        ).build()
      )
      .build()

  private fun buildSummary(context: Context, spec: PushSpec, count: Int): android.app.Notification =
    NotificationCompat.Builder(context, spec.channel)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(spec.roomName)
      .setContentText("$count new messages")
      .setGroup(spec.group)
      .setGroupSummary(true)
      .setAutoCancel(true)
      .setContentIntent(actionIntent(context, spec, "tap"))
      .build()

  private fun replyAction(context: Context, spec: PushSpec): NotificationCompat.Action =
    NotificationCompat.Action.Builder(0, "Reply", actionIntent(context, spec, "reply"))
      .addRemoteInput(RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel("Reply").build())
      .build()

  /**
   * Build the tap/action PendingIntent the way the notification plugin does, so
   * the existing cold-start replay in MainActivity recognises it.
   */
  private fun actionIntent(context: Context, spec: PushSpec, action: String): PendingIntent {
    val intent = Intent(context, MainActivity::class.java).apply {
      this.action = Intent.ACTION_MAIN
      addCategory(Intent.CATEGORY_LAUNCHER)
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra(NOTIFICATION_INTENT_KEY, spec.id)
      putExtra(ACTION_INTENT_KEY, action)
      putExtra(NOTIFICATION_OBJ_INTENT_KEY, sourceJson(spec))
    }
    // MUTABLE because the reply action's RemoteInput fills the typed text in.
    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      flags = flags or PendingIntent.FLAG_MUTABLE
    }
    // Distinct request codes per action, or the three intents collapse into one.
    return PendingIntent.getActivity(context, spec.id + action.hashCode(), intent, flags)
  }

  /**
   * The notification JSON the frontend reads on replay. `extra.room_id` is the
   * field `routeNotificationAction` routes on; everything else is context.
   */
  private fun sourceJson(spec: PushSpec): String =
    JSONObject().apply {
      put("id", spec.id)
      put("title", spec.title)
      put("body", spec.body)
      put("group", spec.group)
      put(
        "extra",
        JSONObject().apply {
          put("room_id", spec.roomId)
          put("event_id", spec.eventId)
        }
      )
    }.toString()
}
