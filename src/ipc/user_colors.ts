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
