// Notification IPC calls — mirrors the Rust notification commands.

import { invoke } from "./invoke.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Quiet-hours window — matches notifications::QuietHours */
export interface QuietHours {
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
}

/** Notification preferences — matches notifications::NotificationConfig */
export interface NotificationConfig {
  enabled: boolean;
  show_body: boolean;
  show_sender: boolean;
  mute_rooms: string[];
  quiet_hours: QuietHours | null;
  /** Keep the sync loop alive in the background (Android foreground service). */
  background_sync: boolean;
  /** Register a pusher so the homeserver wakes the device (mobile only). */
  push_enabled: boolean;
  /** Override the discovered push gateway URL (self-hosters). */
  push_gateway_override: string | null;
}

/** How a platform pushes — matches push::PlatformTransport */
export type PlatformTransport = "unified_push" | "apns";

/** Push snapshot for the Settings UI — matches push::PushStatus */
export interface PushStatus {
  /** This platform has a push transport (mobile only). */
  supported: boolean;
  /** The user's persisted preference. */
  enabled: boolean;
  /** A pusher is registered with the homeserver right now. */
  registered: boolean;
  /**
   * How this platform pushes, set whether or not a pusher exists yet — so the
   * UI can say what push is still waiting on without inferring it from
   * `app_id`, which is null in exactly that case.
   */
  transport: PlatformTransport | null;
  /** app_id of the registered pusher, if any. */
  app_id: string | null;
  /** The gateway actually in use — the user's own, or the public fallback. */
  gateway_url: string | null;
  /**
   * How far along push actually is. `enabled` says what the user asked for;
   * this says what they are getting, and the two differ whenever the transport
   * chain is incomplete.
   */
  readiness: PushReadiness;
  /** The transport delivering pushes (the distributor, on Android). */
  distributor: string | null;
}

/** How far push has got — matches push::PushReadiness */
export type PushReadiness = "off" | "no_transport" | "waiting" | "ready";

/** Background-sync snapshot — matches mobile_sync::BackgroundSyncState */
export interface BackgroundSyncState {
  supported: boolean;
  enabled: boolean;
  running: boolean;
  battery_exempt: boolean;
}

// ─── IPC Functions ────────────────────────────────────────────────────────────

/** Fetch the current notification configuration from the backend. */
export async function getNotificationConfig(): Promise<NotificationConfig> {
  return invoke<NotificationConfig>("get_notification_config");
}

/** Replace the current notification configuration on the backend. */
export async function setNotificationConfig(
  config: NotificationConfig
): Promise<void> {
  return invoke<void>("set_notification_config", { config });
}

/** Add a room to the mute list. */
export async function muteRoomIpc(roomId: string): Promise<MuteOutcome> {
  return invoke<MuteOutcome>("mute_room", { roomId });
}

/** Remove a room from the mute list. */
export async function unmuteRoomIpc(roomId: string): Promise<MuteOutcome> {
  return invoke<MuteOutcome>("unmute_room", { roomId });
}

/**
 * Whether a mute/unmute reached the homeserver — matches
 * notifications::MuteOutcome.
 *
 * Not an error, because the change did take effect on this device. But the
 * mute that matters is the server-side push rule, and when only one of the two
 * lands the user is the only one who can decide what to do about it.
 */
export interface MuteOutcome {
  synced: boolean;
  warning: string | null;
}

/** Send a test OS notification to verify the system is working. */
export async function testNotification(): Promise<void> {
  return invoke<void>("test_notification");
}

/**
 * A notification tap/action captured by MainActivity while no JS listener was
 * alive (Android cold start) — matches notify::PendingNotificationAction.
 * `notification` is the plugin's notification JSON (carries `extra.room_id`).
 */
export interface PendingNotificationAction {
  ts: number;
  actionId: string | null;
  inputValue: string | null;
  notification: { extra?: Record<string, unknown> } | null;
}

/** Create the Android notification channels (no-op elsewhere). */
export async function initNotificationChannels(): Promise<void> {
  return invoke<void>("init_notification_channels");
}

/** Dismiss all live OS notifications for a room. */
export async function clearRoomNotificationsIpc(roomId: string): Promise<void> {
  return invoke<void>("clear_room_notifications", { roomId });
}

/**
 * Read-and-delete the cold-start notification action (Android). Returns null
 * everywhere else, when there is none, or when the stored action went stale.
 */
export async function takePendingNotificationAction(): Promise<PendingNotificationAction | null> {
  return invoke<PendingNotificationAction | null>("take_pending_notification_action");
}

/** Persist the background-sync choice and start/stop the Android service. */
export async function setBackgroundSync(enabled: boolean): Promise<void> {
  return invoke<void>("set_background_sync", { enabled });
}

/** Current background-sync state for the Settings UI. */
export async function getBackgroundSyncState(): Promise<BackgroundSyncState> {
  return invoke<BackgroundSyncState>("get_background_sync_state");
}

/** Surface the Android battery-optimization exemption prompt. */
export async function requestBatteryExemption(): Promise<void> {
  return invoke<void>("request_battery_exemption");
}

/** Current push state for the Settings UI. */
export async function getPushStatus(): Promise<PushStatus> {
  return invoke<PushStatus>("get_push_status");
}

/**
 * Turn push on or off. Switching it off unregisters the pusher immediately;
 * switching it on records the preference and lets the platform transport
 * register once it has an address.
 */
export async function setPushEnabled(enabled: boolean): Promise<void> {
  return invoke<void>("set_push_enabled", { enabled });
}
