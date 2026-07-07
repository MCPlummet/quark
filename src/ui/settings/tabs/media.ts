// Settings → Media tab.
//
// Image/video display options plus cache stats and clear actions. Migrated from
// SettingsDialog._buildMediaTab; behaviour is unchanged. The read-only stat
// rows now use controls.readRow; the danger "clear" buttons stay local (no
// shared control exists for the transient-feedback danger variant).

import { getAppConfig, setAppConfig } from "../../../ipc/app_config.js";
import type { AppConfig } from "../../../ipc/app_config.js";
import {
  getCacheStats,
  clearMediaCache,
  getEventCacheSize,
  clearEventCache,
  getEventCacheDiagnostics,
} from "../../../ipc/media.js";
import type { CacheStats, EventCacheDiagnostics } from "../../../ipc/media.js";
import { applyCacheConfig } from "../../../app/actions.js";
import type { SettingsTab } from "../types.js";

export const mediaTab: SettingsTab = {
  id: "media",
  label: "Media",
  async build(ctx) {
    const { content, controls } = ctx;
    const { section, loading } = controls.loadingSection(content);

    let cfg: AppConfig | null = null;
    let stats: CacheStats | null = null;
    let eventCacheBytes = 0;
    let eventCacheDiag: EventCacheDiagnostics | null = null;

    try {
      [cfg, stats, eventCacheBytes, eventCacheDiag] = await Promise.all([
        getAppConfig(),
        getCacheStats(),
        getEventCacheSize().catch(() => 0),
        getEventCacheDiagnostics().catch(() => null),
      ]);
    } catch {
      loading.textContent = "Failed to load media config.";
      return;
    }

    section.innerHTML = "";
    section.appendChild(controls.sectionTitle("Image Display"));

    let draft = structuredClone(cfg);

    section.appendChild(controls.checkbox(
      "Auto-load inline images",
      draft.media.auto_load_images,
      (v) => { draft = { ...draft, media: { ...draft.media, auto_load_images: v } }; },
    ));

    section.appendChild(controls.numberRow(
      "Max image width (px)",
      draft.media.max_image_width,
      100, 4096,
      (v) => { draft = { ...draft, media: { ...draft.media, max_image_width: v } }; },
    ));

    section.appendChild(controls.numberRow(
      "Max image height (px)",
      draft.media.max_image_height,
      100, 4096,
      (v) => { draft = { ...draft, media: { ...draft.media, max_image_height: v } }; },
    ));

    section.appendChild(controls.numberRow(
      "Sticker max size (px)",
      draft.media.sticker_max_size,
      32, 1024,
      (v) => { draft = { ...draft, media: { ...draft.media, sticker_max_size: v } }; },
    ));

    section.appendChild(controls.sectionTitle("Video"));

    section.appendChild(controls.checkbox(
      "Play videos inline",
      draft.media.inline_video,
      (v) => { draft = { ...draft, media: { ...draft.media, inline_video: v } }; },
    ));

    section.appendChild(controls.sectionTitle("Cache"));

    // Cache stats (read-only)
    const fmtBytes = (b: number): string => {
      if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
      if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
      if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${b} B`;
    };

    // Media cache (disk) — downloaded image/file bytes.
    section.appendChild(controls.readRow("Media cache (disk)", `${fmtBytes(stats.total_size_bytes)} · ${stats.entry_count} files · ${stats.usage_percent.toFixed(1)}%`));
    section.appendChild(controls.numberRow(
      "Media cache limit (MB)",
      draft.media.cache_size_mb,
      10, 10000,
      (v) => { draft = { ...draft, media: { ...draft.media, cache_size_mb: v } }; },
    ));

    // Search cache (disk) — the matrix-sdk event-cache store that search
    // persists scanned events into. Usually the largest store; growable by
    // deep searches and safe to clear (search just re-fetches afterward).
    section.appendChild(controls.readRow("Search cache (disk)", fmtBytes(eventCacheBytes)));

    // Event-cache contents — how much is actually cached (events / rooms). Lets
    // you see whether the cache is populating; mirrors the `:debug cache` view.
    // Skipped silently if the diagnostics call failed.
    if (eventCacheDiag) {
      section.appendChild(controls.readRow(
        "Event cache contents",
        `${eventCacheDiag.total_cached_events} events · ${eventCacheDiag.rooms_with_cached_events}/${eventCacheDiag.rooms_total} rooms`,
      ));
    }

    // In-memory caches — bound RAM used by the instant-open speedups.
    section.appendChild(controls.numberRow(
      "In-memory image cache (MB)",
      draft.cache.image_memory_mb,
      0, 4096,
      (v) => { draft = { ...draft, cache: { ...draft.cache, image_memory_mb: v } }; },
    ));
    section.appendChild(controls.numberRow(
      "Rooms to keep cached",
      draft.cache.timeline_rooms,
      1, 500,
      (v) => { draft = { ...draft, cache: { ...draft.cache, timeline_rooms: v } }; },
    ));

    // Actions row: save + clear buttons. Save also pushes the new in-memory caps
    // into the live caches so they apply without a restart.
    const actions = document.createElement("div");
    actions.className = "settings-dialog__actions";
    actions.appendChild(controls.saveButton(async () => {
      await setAppConfig(draft);
      applyCacheConfig(draft);
    }));

    const makeClearBtn = (label: string, action: () => Promise<void>): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-dialog__btn settings-dialog__btn--danger";
      btn.textContent = `[${label}]`;
      btn.addEventListener("click", async () => {
        try {
          await action();
          btn.textContent = "[cleared!]";
        } catch {
          btn.textContent = "[error]";
        }
        setTimeout(() => { btn.textContent = `[${label}]`; }, 1500);
      });
      return btn;
    };

    actions.appendChild(makeClearBtn("clear media cache", () => clearMediaCache()));
    // Clearing wipes content; the on-disk file shrinks only after a restart (SQLite).
    actions.appendChild(makeClearBtn("clear search cache", async () => {
      await clearEventCache();
      const updated = await getEventCacheSize().catch(() => eventCacheBytes);
      eventCacheBytes = updated;
    }));

    content.appendChild(actions);
  },
};
