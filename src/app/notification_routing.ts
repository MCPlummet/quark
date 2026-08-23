// Notification tap & quick-action routing (mobile).
//
// Registers the `quark_message` action type (Reply with inline input + Mark
// as read), listens for the plugin's `actionPerformed` events (warm path:
// the app process and webview are alive when the user taps), and replays the
// cold-start action MainActivity mirrored to a file — the plugin silently
// drops events fired before this listener exists, e.g. a tap that launches
// the app, or one that recreates the webview while the foreground sync
// service kept the process alive.

import { listen } from "@tauri-apps/api/event";
import { onAction, registerActionTypes } from "@tauri-apps/plugin-notification";
import { isTauri } from "../ipc/mock.js";
import { getPlatform, sendMessage, markRoomRead } from "../ipc/index.js";
import {
  clearRoomNotificationsIpc,
  takePendingNotificationAction,
  type PendingNotificationAction,
} from "../ipc/notifications.js";
import { selectRoom } from "./actions.js";
import { showError } from "../ui/NotificationToast.js";

/** Shape of the plugin's warm `actionPerformed` payload (Android/iOS). */
interface NotificationActionEvent {
  actionId?: string | null;
  inputValue?: string | null;
  notification?: { extra?: Record<string, unknown> } | null;
}

/**
 * Initialise routing. Call once after login/session-restore, when the room
 * list machinery is ready to honour `selectRoom`. No-op on desktop (the
 * plugin exposes no click events there) and in mock/browser mode.
 */
export async function initNotificationRouting(): Promise<void> {
  if (!isTauri()) return;
  let platform: string;
  try {
    platform = await getPlatform();
  } catch {
    return;
  }
  if (platform !== "android" && platform !== "ios") return;

  try {
    await registerActionTypes([
      {
        id: "quark_message",
        actions: [
          {
            id: "reply",
            title: "Reply",
            input: true,
            inputButtonTitle: "Send",
            inputPlaceholder: "Message…",
          },
          { id: "mark_read", title: "Mark as read" },
        ],
      },
    ]);
  } catch (err) {
    console.warn("registerActionTypes failed:", err);
  }

  try {
    await onAction((event) => {
      // The plugin's TS type claims `Options`, but the native payload is
      // `{actionId, inputValue, notification}` (see the Kotlin/Swift sources).
      void routeNotificationAction(event as unknown as NotificationActionEvent);
      // A warm tap also went through MainActivity, which mirrored it to the
      // pending file — consume the duplicate so the next boot doesn't replay.
      void takePendingNotificationAction().catch(() => null);
    });
  } catch (err) {
    console.warn("notification onAction listener failed:", err);
  }

  // iOS warm taps on *pushed* notifications never reach the plugin — its
  // delegate ignores push-triggered responses by design — so the native hook
  // writes the pending file and fires this event to say so. Consuming the file
  // rather than carrying a payload keeps one source of truth with the
  // cold-start replay below, and take-once semantics make the pair safe.
  try {
    await listen("quark://notification/tap", () => {
      void replayPendingAction();
    });
  } catch (err) {
    console.warn("notification tap listener failed:", err);
  }

  // Cold-start replay: a tap delivered before this listener existed.
  await replayPendingAction();
}

async function replayPendingAction(): Promise<void> {
  try {
    const pending = await takePendingNotificationAction();
    if (pending) {
      await routeNotificationAction(pendingToEvent(pending));
    }
  } catch (err) {
    console.warn("pending notification action replay failed:", err);
  }
}

function pendingToEvent(p: PendingNotificationAction): NotificationActionEvent {
  return {
    actionId: p.actionId ?? "tap",
    inputValue: p.inputValue,
    notification: p.notification,
  };
}

/**
 * Dispatch a notification action: tap → open the room; reply → send the typed
 * text to that room (and mark it read); mark_read → read receipt + dismiss.
 * Exported for tests.
 */
export async function routeNotificationAction(
  event: NotificationActionEvent,
): Promise<void> {
  const roomId = event.notification?.extra?.["room_id"];
  if (typeof roomId !== "string" || !roomId) return;

  switch (event.actionId ?? "tap") {
    case "reply": {
      const text = event.inputValue?.trim();
      if (text) {
        try {
          await sendMessage(roomId, text);
          await markRoomRead(roomId);
          await clearRoomNotificationsIpc(roomId);
        } catch (err) {
          showError(
            `Reply failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          // Fall back to opening the room so the user can retry.
          await selectRoom(roomId);
        }
      } else {
        await selectRoom(roomId);
      }
      break;
    }
    case "mark_read":
      try {
        await markRoomRead(roomId);
        await clearRoomNotificationsIpc(roomId);
      } catch {
        // Non-critical — the receipt will retry on next room open.
      }
      break;
    default:
      // "tap" (or an unknown action): open the conversation.
      await selectRoom(roomId);
      break;
  }
}
