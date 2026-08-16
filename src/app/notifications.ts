// Frontend notification manager
//
// Integrates with the Tauri sync event system. When new messages arrive:
//   - The Rust backend fires OS notifications when the window is not focused.
//   - This module handles in-app toast notifications and exposes config helpers.

import {
  getNotificationConfig,
  setNotificationConfig as setNotificationConfigIpc,
  muteRoomIpc,
  unmuteRoomIpc,
  initNotificationChannels,
  setBackgroundSync,
} from "../ipc/notifications.js";
import { invoke } from "../ipc/invoke.js";
import { isTauri } from "../ipc/mock.js";
import { showToast } from "../ui/NotificationToast.js";
import type { NotificationConfig } from "../ipc/notifications.js";

// Re-export the type so consumers only need to import from this module.
export type { NotificationConfig } from "../ipc/notifications.js";

// ── Module state ──────────────────────────────────────────────────────────────

let _config: NotificationConfig | null = null;

/** Returns true when the browser/webview window currently has focus. */
function _isWindowFocused(): boolean {
  return document.hasFocus();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Load config from backend and cache it locally. */
async function _loadConfig(): Promise<NotificationConfig> {
  try {
    _config = await getNotificationConfig();
  } catch {
    // Backend may not be ready yet; use a sensible default.
    _config = {
      enabled: true,
      show_body: true,
      show_sender: true,
      mute_rooms: [],
      quiet_hours: null,
      background_sync: false,
      push_enabled: false,
      push_gateway_override: null,
    };
  }
  return _config;
}

/** Return true if notifications are enabled and the room is not muted. */
function _shouldShowInAppToast(roomId: string): boolean {
  if (!_config) return false;
  if (!_config.enabled) return false;
  if (_config.mute_rooms.includes(roomId)) return false;
  return true;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initialise the notification manager.
 *
 * Call this once during app startup. It loads the persisted config from the
 * Rust backend so that subsequent calls to `shouldNotifyInApp` reflect the
 * user's preferences, and (on Android 13+) prompts the user for the
 * POST_NOTIFICATIONS runtime permission. Without that, all OS notifications
 * the Rust backend tries to emit are silently dropped.
 */
export async function initNotifications(): Promise<void> {
  await _loadConfig();
  await _ensureNotificationPermission();
  // Create the Android notification channels (Messages / Mentions /
  // Background sync) — the backend's rich notifications post to them, and a
  // notification on a missing channel never fires. No-op off Android.
  try {
    await initNotificationChannels();
  } catch (err) {
    console.warn("Notification channel init failed:", err);
  }
  // Re-arm the background-sync foreground service when the user has it
  // enabled — the service usually outlives the activity, but a cold process
  // start needs the start call again. No-op off Android.
  if (_config?.background_sync) {
    try {
      await setBackgroundSync(true);
    } catch (err) {
      console.warn("Background sync start failed:", err);
    }
  }
}

/**
 * Check + request the OS notification permission. No-op on desktop and in
 * non-Tauri contexts. On Android 13+ this surfaces the system permission
 * dialog the first time it runs. The result is fire-and-forget — if the
 * user denies, we keep going (in-app toasts still work).
 */
async function _ensureNotificationPermission(): Promise<void> {
  if (!isTauri()) return;
  try {
    const granted = await invoke<boolean>("plugin:notification|is_permission_granted");
    if (granted) return;
    // request_permission returns "granted" | "denied" | "default" on most
    // platforms. We don't act on the result here — the user's choice is
    // remembered by the OS and the Rust backend will simply fail to emit
    // notifications if they declined.
    await invoke("plugin:notification|request_permission");
  } catch (err) {
    // Plugin may be missing in some build configurations (e.g. minimal mobile
    // smoke builds). Log and keep going — in-app toasts still function.
    console.warn("Notification permission check failed:", err);
  }
}

/**
 * Handle an incoming message event.
 *
 * Called by the sync handler whenever a new message arrives. Shows an in-app
 * toast if the window is focused (OS notifications are handled by the Rust
 * backend when the window is not focused).
 *
 * @param roomId     The room the message arrived in.
 * @param sender     The sender's Matrix ID.
 * @param body       The message body text.
 * @param roomName   Human-readable room name.
 */
export function handleIncomingMessage(
  roomId: string,
  sender: string,
  body: string,
  roomName: string
): void {
  if (!_isWindowFocused()) {
    // Window is not focused — the Rust backend handles OS notifications.
    return;
  }

  if (!_shouldShowInAppToast(roomId)) {
    return;
  }

  const title = _config?.show_sender ? `${sender} in ${roomName}` : "New message";
  const displayBody = _config?.show_body ? body : "You have a new message";

  showToast(`${title}: ${displayBody}`, "info", 4000);
}

/**
 * Mute a room: suppress notifications from it.
 * Updates both the local cache and the persisted backend state.
 */
export async function muteRoom(roomId: string): Promise<void> {
  await muteRoomIpc(roomId);
  if (_config && !_config.mute_rooms.includes(roomId)) {
    _config = { ..._config, mute_rooms: [..._config.mute_rooms, roomId] };
  }
}

/**
 * Unmute a room: resume notifications from it.
 * Updates both the local cache and the persisted backend state.
 */
export async function unmuteRoom(roomId: string): Promise<void> {
  await unmuteRoomIpc(roomId);
  if (_config) {
    _config = {
      ..._config,
      mute_rooms: _config.mute_rooms.filter((r) => r !== roomId),
    };
  }
}

/**
 * Update the full notification config.
 * Persists to the backend and refreshes the local cache.
 */
export async function setNotificationConfig(
  config: NotificationConfig
): Promise<void> {
  await setNotificationConfigIpc(config);
  _config = config;
}

/**
 * Return the cached notification config, loading it first if needed.
 */
export async function getConfig(): Promise<NotificationConfig> {
  if (_config) return _config;
  return _loadConfig();
}
