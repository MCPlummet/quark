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
  setPushEnabled,
} from "../ipc/notifications.js";
import { getPlatform } from "../ipc/index.js";
import { invoke } from "../ipc/invoke.js";
import { isTauri } from "../ipc/mock.js";
import { showToast } from "../ui/NotificationToast.js";
import type { MuteOutcome, NotificationConfig } from "../ipc/notifications.js";

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
  await _syncPushWithNotifications(await _ensureNotificationPermission());
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
 * Where the OS notification permission stands.
 *
 * `prompt` and `unavailable` are deliberately distinct. The plugin answers
 * `null` to `is_permission_granted` for two unrelated situations — a permission
 * that has never been requested (iOS undetermined, Android 13+ before the first
 * ask) and one it could not ask about at all — and collapsing them is what
 * stopped fresh installs being prompted at all: an unasked permission looked
 * like an unanswerable one and returned before reaching the request.
 */
type NotificationPermission = "granted" | "denied" | "prompt" | "unavailable";

/** Read the current permission state, without ever surfacing a dialog. */
async function _permissionState(): Promise<NotificationPermission> {
  if (!isTauri()) return "unavailable";
  try {
    // Option<bool> on the Rust side: null is PermissionState::Prompt — asked of
    // nobody yet, which is exactly the new install this has to prompt.
    const granted = await invoke<boolean | null>(
      "plugin:notification|is_permission_granted"
    );
    if (granted === null || granted === undefined) return "prompt";
    return granted ? "granted" : "denied";
  } catch (err) {
    // Plugin may be missing in some build configurations (e.g. minimal mobile
    // smoke builds). Log and keep going — in-app toasts still function.
    console.warn("Notification permission check failed:", err);
    return "unavailable";
  }
}

/**
 * Is the OS notification permission granted? `null` when the question could not
 * be asked at all — desktop, mock mode, a build without the plugin, or a
 * permission nobody has been asked for yet.
 *
 * The three-way answer matters because push follows it: an unknown must leave
 * push exactly as it is, while a plain `false` is a decision to act on.
 */
async function _permissionGranted(): Promise<boolean | null> {
  const state = await _permissionState();
  if (state === "granted") return true;
  if (state === "denied") return false;
  return null;
}

/**
 * Check + request the OS notification permission, reporting where it landed.
 *
 * On Android 13+ and iOS this surfaces the system dialog the first time it
 * runs — iOS reaches `requestAuthorization` through the plugin, which is the
 * only place it is called from. Called after login rather than at launch: the
 * prompt then follows something the user just did, instead of meeting them on
 * the login screen.
 */
async function _ensureNotificationPermission(): Promise<boolean | null> {
  const state = await _permissionState();
  if (state === "granted") return true;
  // Nothing to ask, and nobody to ask it of.
  if (state === "unavailable") return null;
  // `denied` asks again as well: the OS answers a re-request for a declined
  // permission itself, without a dialog, so this costs nothing and picks up a
  // grant the user made in system settings since.
  try {
    // request_permission returns "granted" | "denied" | "default".
    const result = await invoke<string>("plugin:notification|request_permission");
    return result === "granted";
  } catch (err) {
    console.warn("Notification permission request failed:", err);
    return null;
  }
}

/**
 * What `push_enabled` has to be, or `null` where push is the user's own switch.
 *
 * iOS has no second way to hear about a message while the app is closed — no
 * background sync service, no long-lived connection — so a separate push opt-in
 * there only produces the state where notifications are on and nothing ever
 * arrives. It follows the master switch instead, and the permission with it: a
 * pusher for a device that cannot display anything hands the gateway an address
 * for nothing.
 *
 * Android keeps its own switch. Background sync is a real alternative there,
 * and choosing a distributor is choosing who carries this device's push
 * traffic — not a decision to make on the user's behalf.
 */
export function derivedPushEnabled(
  platform: string,
  enabled: boolean,
  permissionGranted: boolean
): boolean | null {
  if (platform !== "ios") return null;
  return enabled && permissionGranted;
}

/** Bring the pusher into line with the notification settings, where it follows. */
async function _syncPushWithNotifications(granted: boolean | null): Promise<void> {
  if (granted === null || !_config) return;
  let platform: string;
  try {
    platform = await getPlatform();
  } catch {
    return;
  }
  const desired = derivedPushEnabled(platform, _config.enabled, granted);
  // Nothing to do is the common case — this runs on every login, and asserting
  // a value that already holds would put a pusher round-trip on that path.
  if (desired === null || desired === _config.push_enabled) return;
  try {
    await setPushEnabled(desired);
    _config = { ..._config, push_enabled: desired };
  } catch (err) {
    console.warn("Could not bring push into line with the notification setting:", err);
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
 *
 * The mute that counts is the server-side push rule, and it can fail on its own
 * while the local change succeeds. That mismatch used to be a log line; under
 * push it means the homeserver keeps waking the phone for a muted room, so it
 * is surfaced to the user instead.
 */
export async function muteRoom(roomId: string): Promise<void> {
  const outcome = await muteRoomIpc(roomId);
  if (_config && !_config.mute_rooms.includes(roomId)) {
    _config = { ..._config, mute_rooms: [..._config.mute_rooms, roomId] };
  }
  warnIfUnsynced(outcome);
}

/**
 * Unmute a room: resume notifications from it.
 * Updates both the local cache and the persisted backend state.
 *
 * The failure to surface here is the worse of the two: a server-side mute rule
 * that outlives the unmute leaves the room silent on every client while this
 * one shows it as unmuted.
 */
export async function unmuteRoom(roomId: string): Promise<void> {
  const outcome = await unmuteRoomIpc(roomId);
  if (_config) {
    _config = {
      ..._config,
      mute_rooms: _config.mute_rooms.filter((r) => r !== roomId),
    };
  }
  warnIfUnsynced(outcome);
}

/** Show the backend's explanation when a mute change didn't reach the server. */
function warnIfUnsynced(outcome: MuteOutcome): void {
  if (!outcome.synced && outcome.warning) {
    showToast(outcome.warning, "error", 8000);
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
  // Re-read rather than cache the draft: the backend takes only the fields
  // Settings owns (`NotificationConfig::with_preferences`), so a draft built
  // when the dialog opened can carry a push_enabled or mute list the save
  // deliberately ignored.
  await _loadConfig();
  await _syncPushWithNotifications(await _permissionGranted());
}

/**
 * Return the cached notification config, loading it first if needed.
 */
export async function getConfig(): Promise<NotificationConfig> {
  if (_config) return _config;
  return _loadConfig();
}
