// Settings dialog — General, Media, GIF, Emoji, Notifications, Themes tabs

import { getConfig, setNotificationConfig } from "../app/notifications.js";
import type { NotificationConfig } from "../app/notifications.js";
import { testNotification, getBackgroundSyncState, setBackgroundSync, requestBatteryExemption } from "../ipc/notifications.js";
import { showSuccess, showError } from "./NotificationToast.js";
import { getCacheStats, clearMediaCache, getEventCacheSize, clearEventCache, getEventCacheDiagnostics } from "../ipc/media.js";
import type { CacheStats, EventCacheDiagnostics } from "../ipc/media.js";
import { getAppConfig, setAppConfig } from "../ipc/app_config.js";
import type { AppConfig } from "../ipc/app_config.js";
import { loadTheme, applyCacheConfig, applyReadReceiptVisibility } from "../app/actions.js";
import { listCustomThemes } from "../ipc/config.js";
import type { CustomThemeEntry } from "../ipc/config.js";
import { AppState } from "../app/state.js";
import { DialogBase } from "./DialogBase.js";
import packageJson from "../../package.json";

type SettingsTab = "general" | "media" | "gif" | "emoji" | "notifications" | "themes";

const BUILTIN_THEMES = [
  "phosphor",
  "amber",
  "dracula",
  "nord",
  "solarized-dark",
  "solarized-light",
  "catppuccin-mocha",
  "catppuccin-latte",
  "gruvbox-dark",
  "high-contrast",
];

let _currentTheme = "phosphor";

export function setCurrentThemeName(name: string): void {
  _currentTheme = name;
}

export class SettingsDialog extends DialogBase {
  private _panelEl: HTMLElement;
  private _contentEl: HTMLElement;
  private _activeTab: SettingsTab = "general";

  private _tabEls: Record<SettingsTab, HTMLElement> = {} as Record<SettingsTab, HTMLElement>;

  constructor() {
    super({ prefix: "settings-dialog", ariaLabel: "Settings" });
    this._panelEl = this.content;

    // Header
    this.buildHeader("── settings ──", "Close settings");

    // Tab bar
    const tabs = document.createElement("div");
    tabs.className = "settings-dialog__tabs";
    tabs.setAttribute("role", "tablist");

    this._tabEls.general = this._makeTab("General", "general", tabs);
    this._tabEls.media = this._makeTab("Media", "media", tabs);
    this._tabEls.gif = this._makeTab("GIF", "gif", tabs);
    this._tabEls.emoji = this._makeTab("Emoji", "emoji", tabs);
    this._tabEls.notifications = this._makeTab("Notifications", "notifications", tabs);
    this._tabEls.themes = this._makeTab("Themes", "themes", tabs);

    this._panelEl.appendChild(tabs);

    // Content area
    this._contentEl = document.createElement("div");
    this._contentEl.className = "settings-dialog__content";
    this._panelEl.appendChild(this._contentEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "settings-dialog__footer";
    footer.setAttribute("aria-hidden", "true");

    const footerHint = document.createElement("span");
    footerHint.textContent = "Tab switch section · Esc close";
    footer.appendChild(footerHint);

    const footerVersion = document.createElement("span");
    footerVersion.className = "settings-dialog__footer-version";
    footerVersion.textContent = `v${packageJson.version}`;
    footer.appendChild(footerVersion);

    this._panelEl.appendChild(footer);
  }

  show(): void {
    this.reveal();
    this._switchTab("general");
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _makeTab(label: string, tab: SettingsTab, parent: HTMLElement): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__tab";
    btn.textContent = label;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => this._switchTab(tab));
    parent.appendChild(btn);
    return btn;
  }

  private _switchTab(tab: SettingsTab): void {
    this._activeTab = tab;

    for (const [key, el] of Object.entries(this._tabEls)) {
      if (key === tab) {
        el.classList.add("settings-dialog__tab--active");
        el.setAttribute("aria-selected", "true");
      } else {
        el.classList.remove("settings-dialog__tab--active");
        el.setAttribute("aria-selected", "false");
      }
    }

    this._contentEl.innerHTML = "";

    switch (tab) {
      case "general":       void this._buildGeneralTab(); break;
      case "media":         void this._buildMediaTab(); break;
      case "gif":           void this._buildGifTab(); break;
      case "emoji":         void this._buildEmojiTab(); break;
      case "notifications": void this._buildNotificationsTab(); break;
      case "themes":        this._buildThemesTab(); break;
    }
  }

  // ── Shared helpers ────────────────────────────────────────────────────────────

  // Row builders delegate to DialogBase's shared implementations (these emit
  // the same `settings-dialog__*` classes). Thin private wrappers preserve the
  // existing call signatures used by the tab builders below.

  private _makeCheckbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
    return this.makeCheckbox(label, checked, onChange);
  }

  private _makeNumberRow(label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
    return this.makeNumberRow(label, value, onChange, { min, max });
  }

  private _makeSelectRow(label: string, value: string, options: [string, string][], onChange: (v: string) => void): HTMLElement {
    return this.makeSelectRow(label, value, options, onChange);
  }

  private _makeTextRow(label: string, value: string, placeholder: string, onChange: (v: string) => void): HTMLElement {
    return this.makeTextRow(label, value, placeholder, onChange).row;
  }

  private _makeSaveButton(onClick: () => Promise<void>): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__btn";
    btn.textContent = "[save]";
    btn.addEventListener("click", async () => {
      try {
        await onClick();
        btn.textContent = "[saved!]";
      } catch {
        btn.textContent = "[error]";
      }
      setTimeout(() => { btn.textContent = "[save]"; }, 1500);
    });
    return btn;
  }

  private _makeSectionTitle(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "settings-dialog__section-title";
    el.textContent = text;
    return el;
  }

  private _makeLoadingSection(): { section: HTMLElement; loading: HTMLElement } {
    const section = document.createElement("div");
    section.className = "settings-dialog__section";
    const loading = document.createElement("div");
    loading.className = "settings-dialog__row";
    loading.textContent = "Loading...";
    section.appendChild(loading);
    this._contentEl.appendChild(section);
    return { section, loading };
  }

  // ── General tab ───────────────────────────────────────────────────────────────

  private async _buildGeneralTab(): Promise<void> {
    const { section, loading } = this._makeLoadingSection();

    let cfg: AppConfig;
    try {
      cfg = await getAppConfig();
    } catch {
      loading.textContent = "Failed to load config.";
      return;
    }

    section.innerHTML = "";
    section.appendChild(this._makeSectionTitle("General"));

    let draft = structuredClone(cfg);

    section.appendChild(this._makeCheckbox(
      "Confirm before redacting messages",
      draft.general.confirm_redact,
      (v) => { draft = { ...draft, general: { ...draft.general, confirm_redact: v } }; },
    ));

    section.appendChild(this._makeSectionTitle("Input"));

    section.appendChild(this._makeCheckbox(
      "Vim mode (modal editing with Normal/Insert/Command modes)",
      draft.general.vim_mode,
      (v) => { draft = { ...draft, general: { ...draft.general, vim_mode: v } }; },
    ));

    section.appendChild(this._makeSectionTitle("Appearance"));

    section.appendChild(this._makeSelectRow(
      "Icon shape",
      draft.general.icon_radius ?? "50%",
      [
        ["50%", "Circle"],
        ["8px", "Rounded square"],
        ["0", "Square"],
      ],
      (v) => {
        draft = { ...draft, general: { ...draft.general, icon_radius: v } };
        document.documentElement.style.setProperty("--icon-radius", v);
      },
    ));

    section.appendChild(this._makeSectionTitle("Home"));

    section.appendChild(this._makeNumberRow(
      "Chats on the Home canvas",
      draft.home.dm_limit,
      1, 50,
      (v) => { draft = { ...draft, home: { ...draft.home, dm_limit: v } }; },
    ));

    section.appendChild(this._makeSectionTitle("Sync"));

    section.appendChild(this._makeCheckbox(
      "Use Sliding Sync (MSC4186)",
      draft.sync.sliding_sync,
      (v) => { draft = { ...draft, sync: { ...draft.sync, sliding_sync: v } }; },
    ));

    section.appendChild(this._makeNumberRow(
      "Timeline messages to load",
      draft.sync.timeline_limit,
      10, 500,
      (v) => { draft = { ...draft, sync: { ...draft.sync, timeline_limit: v } }; },
    ));

    section.appendChild(this._makeSectionTitle("Read receipts"));

    section.appendChild(this._makeCheckbox(
      "Send my read receipts (others see how far you've read)",
      draft.general.send_read_receipts,
      (v) => { draft = { ...draft, general: { ...draft.general, send_read_receipts: v } }; },
    ));

    section.appendChild(this._makeCheckbox(
      "Show others' read receipts in the timeline",
      draft.general.show_read_receipts,
      (v) => { draft = { ...draft, general: { ...draft.general, show_read_receipts: v } }; },
    ));

    section.appendChild(this._makeCheckbox(
      "Prompt to verify this session on startup (when unverified)",
      draft.general.prompt_session_verification,
      (v) => { draft = { ...draft, general: { ...draft.general, prompt_session_verification: v } }; },
    ));

    // Help — the keybindings/help screen is otherwise only reachable via `?`
    // or `:help`, which mouse/touch users can't discover. Surface it here.
    section.appendChild(this._makeSectionTitle("Help"));
    const helpRow = document.createElement("div");
    helpRow.className = "settings-dialog__row";
    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "settings-dialog__btn";
    helpBtn.textContent = "[keybindings & help]";
    helpBtn.setAttribute("aria-label", "Open keybindings and help");
    helpBtn.addEventListener("click", () => {
      // One overlay at a time: close settings, then open the help dialog.
      this.hide();
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action: "help" } }));
    });
    helpRow.appendChild(helpBtn);
    section.appendChild(helpRow);

    // Security — device verification and cross-signing are otherwise only
    // reachable via `:verify` / `:cross-sign`, which non-vim users can't find.
    section.appendChild(this._makeSectionTitle("Security"));
    const makeDispatchBtn = (label: string, ariaLabel: string, action: string): HTMLElement => {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-dialog__btn";
      btn.textContent = label;
      btn.setAttribute("aria-label", ariaLabel);
      btn.addEventListener("click", () => {
        // One overlay at a time: close settings before the flow takes over.
        this.hide();
        document.dispatchEvent(new CustomEvent("quark:action", { detail: { action } }));
      });
      row.appendChild(btn);
      return row;
    };
    section.appendChild(makeDispatchBtn("[verify a session]", "Verify one of your sessions", "verify-session"));
    section.appendChild(makeDispatchBtn("[set up cross-signing]", "Set up cross-signing", "setup-cross-signing"));

    section.appendChild(this._makeSectionTitle("Updates"));

    section.appendChild(this._makeSelectRow(
      "Release channel",
      draft.updater.channel,
      [
        ["stable", "Stable"],
        ["beta", "Beta (early releases)"],
      ],
      (v) => {
        if (v === "stable" || v === "beta") {
          draft = { ...draft, updater: { ...draft.updater, channel: v } };
        }
      },
    ));

    section.appendChild(this._makeCheckbox(
      "Check for updates automatically",
      draft.updater.auto_check,
      (v) => { draft = { ...draft, updater: { ...draft.updater, auto_check: v } }; },
    ));

    const actions = document.createElement("div");
    actions.className = "settings-dialog__section settings-dialog__actions";
    actions.appendChild(this._makeSaveButton(async () => {
      await setAppConfig(draft);
      // Apply runtime-visible changes immediately (the vim-mode state listener
      // drives editor behaviour; read-receipt visibility re-seeds/clears here).
      AppState.set("vimMode", draft.general.vim_mode);
      const receiptsChanged = draft.general.show_read_receipts !== cfg.general.show_read_receipts;
      AppState.set("showReadReceipts", draft.general.show_read_receipts);
      if (receiptsChanged) void applyReadReceiptVisibility();
    }));
    section.appendChild(actions);
  }

  // ── Media tab ─────────────────────────────────────────────────────────────────

  private async _buildMediaTab(): Promise<void> {
    const { section, loading } = this._makeLoadingSection();

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
    section.appendChild(this._makeSectionTitle("Image Display"));

    let draft = structuredClone(cfg);

    section.appendChild(this._makeCheckbox(
      "Auto-load inline images",
      draft.media.auto_load_images,
      (v) => { draft = { ...draft, media: { ...draft.media, auto_load_images: v } }; },
    ));

    section.appendChild(this._makeNumberRow(
      "Max image width (px)",
      draft.media.max_image_width,
      100, 4096,
      (v) => { draft = { ...draft, media: { ...draft.media, max_image_width: v } }; },
    ));

    section.appendChild(this._makeNumberRow(
      "Max image height (px)",
      draft.media.max_image_height,
      100, 4096,
      (v) => { draft = { ...draft, media: { ...draft.media, max_image_height: v } }; },
    ));

    section.appendChild(this._makeNumberRow(
      "Sticker max size (px)",
      draft.media.sticker_max_size,
      32, 1024,
      (v) => { draft = { ...draft, media: { ...draft.media, sticker_max_size: v } }; },
    ));

    section.appendChild(this._makeSectionTitle("Video"));

    section.appendChild(this._makeCheckbox(
      "Play videos inline",
      draft.media.inline_video,
      (v) => { draft = { ...draft, media: { ...draft.media, inline_video: v } }; },
    ));

    section.appendChild(this._makeSectionTitle("Cache"));

    // Cache stats (read-only)
    const fmtBytes = (b: number): string => {
      if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
      if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
      if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${b} B`;
    };

    const makeReadRow = (label: string, value: string): HTMLElement => {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const lbl = document.createElement("span");
      lbl.className = "settings-dialog__label";
      lbl.textContent = label;
      const val = document.createElement("span");
      val.className = "settings-dialog__value";
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      return row;
    };

    // Media cache (disk) — downloaded image/file bytes.
    section.appendChild(makeReadRow("Media cache (disk)", `${fmtBytes(stats.total_size_bytes)} · ${stats.entry_count} files · ${stats.usage_percent.toFixed(1)}%`));
    section.appendChild(this._makeNumberRow(
      "Media cache limit (MB)",
      draft.media.cache_size_mb,
      10, 10000,
      (v) => { draft = { ...draft, media: { ...draft.media, cache_size_mb: v } }; },
    ));

    // Search cache (disk) — the matrix-sdk event-cache store that search
    // persists scanned events into. Usually the largest store; growable by
    // deep searches and safe to clear (search just re-fetches afterward).
    section.appendChild(makeReadRow("Search cache (disk)", fmtBytes(eventCacheBytes)));

    // Event-cache contents — how much is actually cached (events / rooms). Lets
    // you see whether the cache is populating; mirrors the `:debug cache` view.
    // Skipped silently if the diagnostics call failed.
    if (eventCacheDiag) {
      section.appendChild(makeReadRow(
        "Event cache contents",
        `${eventCacheDiag.total_cached_events} events · ${eventCacheDiag.rooms_with_cached_events}/${eventCacheDiag.rooms_total} rooms`,
      ));
    }

    // In-memory caches — bound RAM used by the instant-open speedups.
    section.appendChild(this._makeNumberRow(
      "In-memory image cache (MB)",
      draft.cache.image_memory_mb,
      0, 4096,
      (v) => { draft = { ...draft, cache: { ...draft.cache, image_memory_mb: v } }; },
    ));
    section.appendChild(this._makeNumberRow(
      "Rooms to keep cached",
      draft.cache.timeline_rooms,
      1, 500,
      (v) => { draft = { ...draft, cache: { ...draft.cache, timeline_rooms: v } }; },
    ));

    // Actions row: save + clear buttons. Save also pushes the new in-memory caps
    // into the live caches so they apply without a restart.
    const actions = document.createElement("div");
    actions.className = "settings-dialog__section settings-dialog__actions";
    actions.appendChild(this._makeSaveButton(async () => {
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

    section.appendChild(actions);
  }

  // ── GIF tab ───────────────────────────────────────────────────────────────────

  private async _buildGifTab(): Promise<void> {
    const { section, loading } = this._makeLoadingSection();

    let cfg: AppConfig;
    try {
      cfg = await getAppConfig();
    } catch {
      loading.textContent = "Failed to load config.";
      return;
    }

    section.innerHTML = "";
    section.appendChild(this._makeSectionTitle("GIF Provider"));

    let draft = structuredClone(cfg);

    section.appendChild(this._makeSelectRow(
      "Provider",
      draft.gif.provider,
      [["tenor", "Tenor"], ["giphy", "Giphy"], ["klipy", "Klipy"]],
      (v) => { draft = { ...draft, gif: { ...draft.gif, provider: v as "tenor" | "giphy" | "klipy" } }; },
    ));

    section.appendChild(this._makeTextRow(
      "API key",
      draft.gif.api_key,
      "paste your API key here",
      (v) => { draft = { ...draft, gif: { ...draft.gif, api_key: v } }; },
    ));

    section.appendChild(this._makeSelectRow(
      "Content rating",
      draft.gif.rating,
      [["g", "G"], ["pg", "PG"], ["pg-13", "PG-13"], ["r", "R"]],
      (v) => { draft = { ...draft, gif: { ...draft.gif, rating: v as "g" | "pg" | "pg-13" | "r" } }; },
    ));

    section.appendChild(this._makeCheckbox(
      "Cache search results",
      draft.gif.cache_results,
      (v) => { draft = { ...draft, gif: { ...draft.gif, cache_results: v } }; },
    ));

    const actions = document.createElement("div");
    actions.className = "settings-dialog__section settings-dialog__actions";
    actions.appendChild(this._makeSaveButton(() => setAppConfig(draft)));
    section.appendChild(actions);
  }

  // ── Emoji tab ─────────────────────────────────────────────────────────────────

  private async _buildEmojiTab(): Promise<void> {
    const { section, loading } = this._makeLoadingSection();

    let cfg: AppConfig;
    try {
      cfg = await getAppConfig();
    } catch {
      loading.textContent = "Failed to load config.";
      return;
    }

    section.innerHTML = "";
    section.appendChild(this._makeSectionTitle("Emoji Autocomplete"));

    let draft = structuredClone(cfg);

    section.appendChild(this._makeCheckbox(
      "Enable :shortcode autocomplete",
      draft.emoji.shortcode_autocomplete,
      (v) => { draft = { ...draft, emoji: { ...draft.emoji, shortcode_autocomplete: v } }; },
    ));

    section.appendChild(this._makeNumberRow(
      "Min chars to trigger autocomplete",
      draft.emoji.autocomplete_min_chars,
      1, 10,
      (v) => { draft = { ...draft, emoji: { ...draft.emoji, autocomplete_min_chars: v } }; },
    ));

    const actions = document.createElement("div");
    actions.className = "settings-dialog__section settings-dialog__actions";
    actions.appendChild(this._makeSaveButton(() => setAppConfig(draft)));
    section.appendChild(actions);
  }

  // ── Notifications tab ─────────────────────────────────────────────────────────

  private async _buildNotificationsTab(): Promise<void> {
    const { section, loading } = this._makeLoadingSection();

    let config: NotificationConfig;
    try {
      config = await getConfig();
    } catch {
      loading.textContent = "Failed to load notification config.";
      return;
    }

    section.innerHTML = "";

    let draft = { ...config };

    section.appendChild(this._makeCheckbox("Enable notifications", draft.enabled, (v) => { draft = { ...draft, enabled: v }; }));
    section.appendChild(this._makeCheckbox("Show message preview", draft.show_body, (v) => { draft = { ...draft, show_body: v }; }));
    section.appendChild(this._makeCheckbox("Show sender name", draft.show_sender, (v) => { draft = { ...draft, show_sender: v }; }));

    // Background sync (Android-only — desktop/iOS report unsupported). The
    // toggle applies immediately (starts/stops the foreground service) rather
    // than waiting for [save], since the service state is what users come
    // here to flip.
    try {
      const bgState = await getBackgroundSyncState();
      if (bgState.supported) {
        const bgSection = document.createElement("div");
        bgSection.className = "settings-dialog__section";
        bgSection.appendChild(this._makeSectionTitle("Background sync"));

        const status = document.createElement("div");
        status.className = "settings-dialog__hint";
        const renderStatus = (s: { running: boolean; battery_exempt: boolean }) => {
          status.textContent =
            `service: ${s.running ? "running" : "stopped"} · ` +
            `battery optimization: ${s.battery_exempt ? "unrestricted" : "restricted"}`;
        };
        renderStatus(bgState);

        bgSection.appendChild(this._makeCheckbox(
          "Stay connected in the background (uses more battery)",
          bgState.enabled,
          (v) => {
            void setBackgroundSync(v)
              .then(getBackgroundSyncState)
              .then(renderStatus)
              .catch((err) => showError(`Background sync toggle failed: ${err instanceof Error ? err.message : String(err)}`));
          },
        ));
        bgSection.appendChild(status);

        if (!bgState.battery_exempt) {
          const exemptBtn = document.createElement("button");
          exemptBtn.type = "button";
          exemptBtn.className = "settings-dialog__save-btn";
          exemptBtn.textContent = "[ allow unrestricted battery ]";
          exemptBtn.addEventListener("click", () => {
            void requestBatteryExemption()
              .then(getBackgroundSyncState)
              .then((s) => {
                renderStatus(s);
                if (s.battery_exempt) exemptBtn.remove();
              })
              .catch(() => {/* user dismissed the system dialog */});
          });
          bgSection.appendChild(exemptBtn);
        }

        const hint = document.createElement("div");
        hint.className = "settings-dialog__hint";
        hint.textContent =
          "Per-category sound & importance (Messages / Mentions) is configured in Android Settings → Notifications.";
        bgSection.appendChild(hint);

        section.appendChild(bgSection);
      }
    } catch {
      // Non-critical — the rest of the tab still works.
    }

    // Quiet hours
    const qhSection = document.createElement("div");
    qhSection.className = "settings-dialog__section";
    qhSection.appendChild(this._makeSectionTitle("Quiet Hours"));

    const qhRow = document.createElement("div");
    qhRow.className = "settings-dialog__row settings-dialog__row--quiet-hours";

    const qhLabel = document.createElement("span");
    qhLabel.className = "settings-dialog__label";
    qhLabel.textContent = "start";
    qhRow.appendChild(qhLabel);

    const startInput = document.createElement("input");
    startInput.type = "time";
    startInput.className = "settings-dialog__time-input";
    if (draft.quiet_hours) {
      const h = String(draft.quiet_hours.start_hour).padStart(2, "0");
      const m = String(draft.quiet_hours.start_minute).padStart(2, "0");
      startInput.value = `${h}:${m}`;
    }
    qhRow.appendChild(startInput);

    const qhLabel2 = document.createElement("span");
    qhLabel2.className = "settings-dialog__label";
    qhLabel2.textContent = "end";
    qhRow.appendChild(qhLabel2);

    const endInput = document.createElement("input");
    endInput.type = "time";
    endInput.className = "settings-dialog__time-input";
    if (draft.quiet_hours) {
      const h = String(draft.quiet_hours.end_hour).padStart(2, "0");
      const m = String(draft.quiet_hours.end_minute).padStart(2, "0");
      endInput.value = `${h}:${m}`;
    }
    qhRow.appendChild(endInput);

    qhSection.appendChild(qhRow);

    const footer = document.createElement("div");
    footer.className = "settings-dialog__section settings-dialog__actions";

    const saveBtn = this._makeSaveButton(async () => {
      let quiet_hours = null;
      if (startInput.value && endInput.value) {
        const [sh, sm] = startInput.value.split(":").map(Number);
        const [eh, em] = endInput.value.split(":").map(Number);
        quiet_hours = { start_hour: sh, start_minute: sm, end_hour: eh, end_minute: em };
      }
      await setNotificationConfig({ ...draft, quiet_hours });
    });
    footer.appendChild(saveBtn);

    // Test button — sends a one-shot OS notification so the user can confirm
    // the permission grant and channel setup work end-to-end (especially on
    // Android, where missing POST_NOTIFICATIONS used to silently drop them).
    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "settings-dialog__save-btn";
    testBtn.textContent = "[ test notification ]";
    testBtn.style.marginLeft = "8px";
    testBtn.addEventListener("click", async () => {
      try {
        await testNotification();
        showSuccess("Sent test notification");
      } catch (err) {
        showError(`Test notification failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    footer.appendChild(testBtn);

    section.appendChild(qhSection);
    section.appendChild(footer);
  }

  // ── Themes tab ────────────────────────────────────────────────────────────────

  private _buildThemesTab(): void {
    const builtinSection = document.createElement("div");
    builtinSection.className = "settings-dialog__section";
    builtinSection.appendChild(this._makeSectionTitle("Built-in themes — click to apply"));

    const addThemeRow = (container: HTMLElement, label: string, id: string) => {
      const row = document.createElement("div");
      row.className = "settings-dialog__row settings-dialog__row--theme";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-dialog__theme-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        void loadTheme(id);
        _currentTheme = id;
        for (const el of this._contentEl.querySelectorAll(".settings-dialog__current")) {
          el.remove();
        }
        const cur = document.createElement("span");
        cur.className = "settings-dialog__current";
        cur.textContent = "(current)";
        row.appendChild(cur);
        void getAppConfig().then((cfg) => {
          const updated = { ...cfg, general: { ...cfg.general, theme: id } };
          return setAppConfig(updated);
        }).catch((err) => {
          console.error("Failed to save theme to config:", err);
        });
      });

      row.appendChild(btn);

      if (id === _currentTheme) {
        const cur = document.createElement("span");
        cur.className = "settings-dialog__current";
        cur.textContent = "(current)";
        row.appendChild(cur);
      }

      container.appendChild(row);
    };

    for (const name of BUILTIN_THEMES) {
      addThemeRow(builtinSection, name, name);
    }

    this._contentEl.appendChild(builtinSection);

    // Custom themes from ~/.config/quark/themes/ — loaded asynchronously.
    const customSection = document.createElement("div");
    customSection.className = "settings-dialog__section";
    const customTitle = this._makeSectionTitle("Custom themes (~/.config/quark/themes/)");
    customSection.appendChild(customTitle);

    const loadingEl = document.createElement("div");
    loadingEl.className = "settings-dialog__hint";
    loadingEl.textContent = "Scanning…";
    customSection.appendChild(loadingEl);

    this._contentEl.appendChild(customSection);

    void listCustomThemes().then((entries: CustomThemeEntry[]) => {
      loadingEl.remove();
      if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "settings-dialog__hint";
        empty.textContent = "No custom themes found. Place .toml files in ~/.config/quark/themes/.";
        customSection.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        addThemeRow(customSection, entry.name, entry.path);
      }
    }).catch(() => {
      loadingEl.textContent = "Failed to load custom themes.";
    });
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────────

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (e.key === "Tab") {
      e.preventDefault();
      const tabs: SettingsTab[] = ["general", "media", "gif", "emoji", "notifications", "themes"];
      const idx = tabs.indexOf(this._activeTab);
      this._switchTab(tabs[(idx + 1) % tabs.length]);
      return;
    }

    if (e.ctrlKey && e.key === "[") {
      e.preventDefault();
      this.hide();
      return;
    }

    this.routeKey(e);
  }
}
