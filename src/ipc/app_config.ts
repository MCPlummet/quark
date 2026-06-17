// App configuration IPC — wraps get_app_config / set_app_config Tauri commands.

import { invoke } from "./invoke.js";

export interface GeneralConfig {
  theme: string;
  notifications: boolean;
  confirm_redact: boolean;
  /** CSS border-radius for space/room icons, e.g. "50%" (circle), "8px" (rounded square), "0" (square) */
  icon_radius: string;
  /** Enable vim-style modal editing. When false, the app stays in Insert mode permanently. */
  vim_mode: boolean;
  /** Send public read receipts (m.read) so others see your read position. When
   *  false, only a private receipt is sent (unread counts still clear). */
  send_read_receipts: boolean;
  /** Show other users' read-receipt avatars in the timeline. */
  show_read_receipts: boolean;
  /** Prompt to verify a new/unverified session on startup (until verified or the
   *  user picks "Never ask"). */
  prompt_session_verification: boolean;
  /** What the Enter key does in the compose box:
   *  - "auto":    Enter sends on desktop; inserts a newline on mobile (send button).
   *  - "enter":   Enter always sends (Shift+Enter for a newline).
   *  - "newline": Enter always inserts a newline; send via the button / Ctrl·Cmd+Enter. */
  send_key_behavior: SendKeyBehavior;
}

export type SendKeyBehavior = "auto" | "enter" | "newline";

export interface SyncConfig {
  sliding_sync: boolean;
  timeline_limit: number;
}

export interface MediaConfig {
  auto_load_images: boolean;
  /** Play videos inline in the timeline; when false, videos open in the external player. */
  inline_video: boolean;
  max_image_width: number;
  max_image_height: number;
  sticker_max_size: number;
  cache_size_mb: number;
}

import type { GifProvider } from "./gif.js";
export type { GifProvider };
export type GifRating = "g" | "pg" | "pg-13" | "r";

export interface GifConfig {
  provider: GifProvider;
  api_key: string;
  rating: GifRating;
  cache_results: boolean;
}

export interface EmojiConfig {
  shortcode_autocomplete: boolean;
  autocomplete_min_chars: number;
}

export interface HomeConfig {
  /** Number of DM floaters shown on the Home canvas. */
  dm_limit: number;
}

export interface CacheConfig {
  /** In-memory cap (MB) for decoded message images/stickers (LRU). */
  image_memory_mb: number;
  /** Number of rooms whose timeline tail is kept in memory for instant re-open (LRU). */
  timeline_rooms: number;
}

export interface UpdaterConfig {
  /** Release channel the in-app updater follows. */
  channel: "stable" | "beta";
  /** Check for an update automatically shortly after sync starts. */
  auto_check: boolean;
}

export interface AppConfig {
  general: GeneralConfig;
  sync: SyncConfig;
  media: MediaConfig;
  gif: GifConfig;
  emoji: EmojiConfig;
  home: HomeConfig;
  cache: CacheConfig;
  updater: UpdaterConfig;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  general: { theme: "phosphor", notifications: true, confirm_redact: true, icon_radius: "50%", vim_mode: true, send_read_receipts: true, show_read_receipts: true, prompt_session_verification: true, send_key_behavior: "auto" },
  sync: { sliding_sync: true, timeline_limit: 50 },
  media: { auto_load_images: true, inline_video: true, max_image_width: 600, max_image_height: 400, sticker_max_size: 256, cache_size_mb: 500 },
  gif: { provider: "tenor", api_key: "", rating: "pg", cache_results: true },
  emoji: { shortcode_autocomplete: true, autocomplete_min_chars: 2 },
  home: { dm_limit: 12 },
  cache: { image_memory_mb: 150, timeline_rooms: 30 },
  updater: { channel: "stable", auto_check: true },
};

export async function getAppConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_app_config");
}

export async function setAppConfig(config: AppConfig): Promise<void> {
  return invoke<void>("set_app_config", { config });
}
