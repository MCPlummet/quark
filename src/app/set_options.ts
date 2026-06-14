// Pure `:set`/quarkrc option application. Split out of keyboard.ts so the
// option-name → config-field mapping can be unit-tested directly — a typo or
// dropped case here silently no-ops a user's setting, which is exactly the
// kind of drift we want a test to catch.

import type { AppConfig } from "../ipc/app_config.js";

/** A single resolved `set name=value` directive. */
export interface SetOption {
  name: string;
  value: boolean | number | string;
}

/**
 * Apply a batch of `set` directives onto a copy of `cfg`, returning the updated
 * config. Type-mismatched values are ignored (a `set` parsed as the wrong type
 * leaves the field untouched); unknown option names warn and are skipped.
 */
export function applySetOptions(cfg: AppConfig, sets: SetOption[]): AppConfig {
  const updated: AppConfig = {
    general: { ...cfg.general },
    sync: { ...cfg.sync },
    media: { ...cfg.media },
    gif: { ...cfg.gif },
    emoji: { ...cfg.emoji },
    home: { ...cfg.home },
    cache: { ...cfg.cache },
    updater: { ...cfg.updater },
  };

  for (const { name, value } of sets) {
    switch (name) {
      // general
      case "theme":           if (typeof value === "string")  updated.general.theme = value; break;
      case "notifications":   if (typeof value === "boolean") updated.general.notifications = value; break;
      case "confirm_redact":  if (typeof value === "boolean") updated.general.confirm_redact = value; break;
      case "icon_radius":     if (typeof value === "string")  updated.general.icon_radius = value; break;
      case "vim_mode":        if (typeof value === "boolean") updated.general.vim_mode = value; break;
      // sync
      case "sliding_sync":    if (typeof value === "boolean") updated.sync.sliding_sync = value; break;
      case "timeline_limit":  if (typeof value === "number")  updated.sync.timeline_limit = value; break;
      // media
      case "auto_load_images":  if (typeof value === "boolean") updated.media.auto_load_images = value; break;
      case "inline_video":      if (typeof value === "boolean") updated.media.inline_video = value; break;
      case "max_image_width":   if (typeof value === "number")  updated.media.max_image_width = value; break;
      case "max_image_height":  if (typeof value === "number")  updated.media.max_image_height = value; break;
      case "sticker_max_size":  if (typeof value === "number")  updated.media.sticker_max_size = value; break;
      case "cache_size_mb":     if (typeof value === "number")  updated.media.cache_size_mb = value; break;
      // gif
      case "gif_provider":      if (typeof value === "string")  updated.gif.provider = value as "tenor" | "giphy"; break;
      case "gif_rating":        if (typeof value === "string")  updated.gif.rating = value as "g" | "pg" | "pg-13" | "r"; break;
      case "gif_api_key":       if (typeof value === "string")  updated.gif.api_key = value; break;
      case "gif_cache_results": if (typeof value === "boolean") updated.gif.cache_results = value; break;
      // emoji
      case "shortcode_autocomplete": if (typeof value === "boolean") updated.emoji.shortcode_autocomplete = value; break;
      case "autocomplete_min_chars": if (typeof value === "number")  updated.emoji.autocomplete_min_chars = value; break;
      // home
      case "home_dm_limit":     if (typeof value === "number")  updated.home.dm_limit = value; break;
      // cache
      case "image_memory_mb":   if (typeof value === "number")  updated.cache.image_memory_mb = value; break;
      case "timeline_rooms":    if (typeof value === "number")  updated.cache.timeline_rooms = value; break;
      // updater
      case "update_channel": if (value === "stable" || value === "beta") updated.updater.channel = value; break;
      case "auto_update":    if (typeof value === "boolean") updated.updater.auto_check = value; break;
      default:
        console.warn(`[quarkrc] unknown set option: "${name}"`);
    }
  }

  return updated;
}
