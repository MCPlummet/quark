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
