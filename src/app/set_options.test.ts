import { describe, it, expect, vi, afterEach } from "vitest";
import { applySetOptions } from "./set_options.js";
import { DEFAULT_APP_CONFIG, type AppConfig } from "../ipc/app_config.js";

// The `:set` / quarkrc option mapping is a wide switch where a typo or a
// dropped case silently no-ops a user's setting. These tests pin each section's
// wiring and the type-guard / unknown-option behaviour.

function baseConfig(): AppConfig {
  return structuredClone(DEFAULT_APP_CONFIG);
}

describe("applySetOptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies string, boolean and number options", () => {
    const out = applySetOptions(baseConfig(), [
      { name: "theme", value: "gruvbox" },
      { name: "notifications", value: false },
      { name: "timeline_limit", value: 200 },
    ]);
    expect(out.general.theme).toBe("gruvbox");
    expect(out.general.notifications).toBe(false);
    expect(out.sync.timeline_limit).toBe(200);
  });

  it("routes each option to the correct config section", () => {
    const out = applySetOptions(baseConfig(), [
      { name: "vim_mode", value: false }, // general
      { name: "sliding_sync", value: false }, // sync
      { name: "cache_size_mb", value: 123 }, // media
      { name: "gif_provider", value: "giphy" }, // gif
      { name: "shortcode_autocomplete", value: false }, // emoji
      { name: "home_dm_limit", value: 7 }, // home
    ]);
    expect(out.general.vim_mode).toBe(false);
    expect(out.sync.sliding_sync).toBe(false);
    expect(out.media.cache_size_mb).toBe(123);
    expect(out.gif.provider).toBe("giphy");
    expect(out.emoji.shortcode_autocomplete).toBe(false);
    expect(out.home.dm_limit).toBe(7);
  });

  it("ignores a value of the wrong type (leaves the field untouched)", () => {
    const cfg = baseConfig();
    const out = applySetOptions(cfg, [
      { name: "theme", value: true }, // theme expects a string
      { name: "timeline_limit", value: "lots" }, // expects a number
    ]);
    expect(out.general.theme).toBe(cfg.general.theme);
    expect(out.sync.timeline_limit).toBe(cfg.sync.timeline_limit);
  });

  it("warns on an unknown option and leaves config unchanged", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = baseConfig();
    const out = applySetOptions(cfg, [{ name: "no_such_option", value: 1 }]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("no_such_option");
    expect(out).toEqual(cfg);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = structuredClone(cfg);
    applySetOptions(cfg, [{ name: "theme", value: "changed" }]);
    expect(cfg).toEqual(snapshot);
  });

  it("applies a batch in order (last write wins for the same option)", () => {
    const out = applySetOptions(baseConfig(), [
      { name: "theme", value: "first" },
      { name: "theme", value: "second" },
    ]);
    expect(out.general.theme).toBe("second");
  });

  it("returns an unchanged copy for an empty directive list", () => {
    const cfg = baseConfig();
    expect(applySetOptions(cfg, [])).toEqual(cfg);
  });
});

describe("applySetOptions — updater", () => {
  it("sets the update channel to beta", () => {
    const out = applySetOptions(DEFAULT_APP_CONFIG, [{ name: "update_channel", value: "beta" }]);
    expect(out.updater.channel).toBe("beta");
  });

  it("ignores an invalid channel value", () => {
    const out = applySetOptions(DEFAULT_APP_CONFIG, [{ name: "update_channel", value: "nightly" }]);
    expect(out.updater.channel).toBe("stable");
  });

  it("toggles auto_update", () => {
    const out = applySetOptions(DEFAULT_APP_CONFIG, [{ name: "auto_update", value: false }]);
    expect(out.updater.auto_check).toBe(false);
  });

  it("preserves the updater section when other options change", () => {
    const base = { ...DEFAULT_APP_CONFIG, updater: { channel: "beta" as const, auto_check: false } };
    const out = applySetOptions(base, [{ name: "theme", value: "amber" }]);
    expect(out.updater).toEqual({ channel: "beta", auto_check: false });
  });
});
