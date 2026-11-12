// User colors IPC (#45) — the `tel.quark.usercolor` profile field and this
// device's local overrides.

import { invoke } from "./invoke.js";

/**
 * Set (or, with `null`, remove) this device's local color for another user.
 * Resolves to the color as stored (normalized `#rrggbb`); rejects on an
 * invalid user ID or color.
 */
export async function setUserColorOverride(userId: string, color: string | null): Promise<string | null> {
  return invoke<string | null>("set_user_color_override", { userId, color });
}

/** The account's published color and whether the homeserver lets it change
 *  (`null`: it doesn't say — saving will tell). */
export interface OwnUserColor {
  color: string | null;
  can_set: boolean | null;
}

export async function getOwnUserColor(): Promise<OwnUserColor> {
  return invoke<OwnUserColor>("get_own_user_color");
}

/**
 * Publish (or, with `null`, remove) your color as `tel.quark.usercolor`.
 * Resolves to the color as stored; rejects with the homeserver's reason —
 * "Your homeserver doesn't support custom profile fields." when it has none.
 */
export async function setOwnUserColor(color: string | null): Promise<string | null> {
  return invoke<string | null>("set_own_user_color", { color });
}

/** Emitted when a background lookup changes what's known of a user's color. */
export const EVENT_USER_COLOR = "quark://user-color";

export interface UserColorUpdate {
  user_id: string;
  color: string | null;
}

/**
 * What's known of `userIds`' colors right now (stale answers included,
 * unknown IDs absent). Lookups for unknown or stale IDs run in the background
 * and report through `listenUserColors`; the backend dedupes and rate-limits.
 */
export async function requestUserColors(userIds: string[]): Promise<Record<string, string | null>> {
  return invoke<Record<string, string | null>>("request_user_colors", { userIds });
}

/** Subscribe to color updates. Outside Tauri (mock dev) this is a no-op. */
export async function listenUserColors(onUpdate: (u: UserColorUpdate) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<UserColorUpdate>(EVENT_USER_COLOR, (e) => onUpdate(e.payload));
  } catch {
    return () => {};
  }
}
