// Auto-update IPC calls — mirror the Rust updater commands. Desktop-only;
// returns an error on mobile.

import { invoke } from "./invoke.js";

/** Release channel — matches config::app_config::UpdateChannel (lowercase). */
export type UpdateChannel = "stable" | "beta";

/** Available-update metadata — matches updater::UpdateInfo. */
export interface UpdateInfo {
  version: string;
  current_version: string;
  notes: string | null;
  date: string | null;
}

/** Download progress — matches updater::UpdateProgress (event quark://update/progress). */
export interface UpdateProgress {
  chunk_length: number;
  content_length: number | null;
}

let _updateSupported: Promise<boolean> | null = null;

/**
 * Whether in-app updates can work for this install — false on mobile and on
 * store-managed packagings (Nix, Flatpak, Snap), where updates come from the
 * system package manager. Matches `update_supported`. Cached: the answer
 * cannot change while the app runs.
 */
export function updateSupported(): Promise<boolean> {
  _updateSupported ??= invoke<boolean>("update_supported");
  return _updateSupported;
}

/**
 * Check the configured channel's feed. Resolves to the update metadata when one
 * is available, or `null` when already up to date. Matches `update_check`.
 */
export async function updateCheck(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("update_check");
}

/**
 * Download + install the pending update (from the last `updateCheck`), then the
 * backend relaunches the app. Matches `update_install`.
 */
export async function updateInstall(): Promise<void> {
  return invoke<void>("update_install");
}
