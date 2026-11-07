import { describe, it, expect, beforeEach, vi } from "vitest";

// `loadTheme` announces a theme change, which is right for a user action —
// `:theme catppuccin-mocha`, or picking one in Settings. Two startup paths
// reused it to apply *configured* state: `loadThemeFromConfig` (config.toml's
// `general.theme`) and the quarkrc `colorscheme` directive. Declare the theme in
// both, as the default config does, and launching announced it twice.
//
// Nobody saw either toast until #80 gave the component a stylesheet.

vi.mock("../../ui/NotificationToast.js", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));
vi.mock("../../theme/loader.js", async (importOriginal) => ({
  // The share schema (via the importer) reads BORDER_STYLES at load time.
  ...(await importOriginal<typeof import("../../theme/loader.js")>()),
  applyTheme: vi.fn(),
}));
vi.mock("../../ui/settings/tabs/themes.js", () => ({ setCurrentThemeName: vi.fn() }));
vi.mock("../../ipc/index.js", () => ({ loadTheme: vi.fn(), importCustomTheme: vi.fn() }));
vi.mock("../../ipc/app_config.js", () => ({ getAppConfig: vi.fn() }));

import { importThemeText, loadTheme, loadThemeFromConfig, themeFileStem } from "./theme.js";
import { importCustomTheme } from "../../ipc/index.js";
import { BUILTIN_THEME_MAP } from "../../theme/builtins.js";
import { encodeThemeShare, setField, themeToToml, type CompleteTheme } from "../../theme/share.js";
import { showError, showSuccess } from "../../ui/NotificationToast.js";
import { applyTheme } from "../../theme/loader.js";
import { setCurrentThemeName } from "../../ui/settings/tabs/themes.js";
import { getAppConfig } from "../../ipc/app_config.js";

const THEME = "catppuccin-mocha";

const appConfig = (theme: string) => ({
  general: {
    theme,
    icon_radius: "50%",
    show_read_receipts: true,
  },
}) as unknown as Awaited<ReturnType<typeof getAppConfig>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppConfig).mockResolvedValue(appConfig(THEME));
});

describe("loadTheme announces, because a user asked for it", () => {
  it("applies the theme and says so", async () => {
    await loadTheme(THEME);

    expect(applyTheme).toHaveBeenCalledTimes(1);
    expect(setCurrentThemeName).toHaveBeenCalledWith(THEME);
    expect(showSuccess).toHaveBeenCalledTimes(1);
  });

  it("reports a theme it cannot load", async () => {
    await loadTheme("no-such-theme");

    expect(showError).toHaveBeenCalledTimes(1);
    expect(showSuccess).not.toHaveBeenCalled();
  });
});

describe("startup applies the configured theme without announcing it", () => {
  it("does not toast for a theme the user did not just ask for", async () => {
    await loadThemeFromConfig();

    expect(applyTheme).toHaveBeenCalledTimes(1);
    expect(setCurrentThemeName).toHaveBeenCalledWith(THEME);
    expect(showSuccess).not.toHaveBeenCalled();
  });

  // The reported bug: config.toml and quarkrc both name a theme, both startup
  // paths run, and each announced its own application.
  it("stays silent even when quarkrc applies the same theme again", async () => {
    await loadThemeFromConfig();
    await loadTheme(THEME, { announce: false });

    expect(showSuccess).not.toHaveBeenCalled();
  });

  // A theme named in config that no longer exists is worth surfacing: the user
  // gets the default and would otherwise have no idea why.
  it("still reports a configured theme that fails to load", async () => {
    vi.mocked(getAppConfig).mockResolvedValue(appConfig("deleted-theme"));

    await loadThemeFromConfig();

    expect(showError).toHaveBeenCalledTimes(1);
  });
});

describe("importThemeText installs a shared theme", () => {
  const nord = setField(BUILTIN_THEME_MAP.nord as CompleteTheme, "meta.name", "Nord Tweaked");
  const link = `https://quark.tel/theme/#${encodeThemeShare(themeToToml(nord))}`;
  const entry = { name: "Nord Tweaked", id: "nord-tweaked.toml", path: "/cfg/themes/nord-tweaked.toml" };

  beforeEach(() => {
    vi.mocked(importCustomTheme).mockResolvedValue({ status: "saved", theme: entry });
  });

  it("saves a link's theme as canonical TOML, named after the theme", async () => {
    const result = await importThemeText(link);

    expect(result).toEqual({ status: "saved", theme: entry, adjusted: 0 });
    const [stem, content, overwrite] = vi.mocked(importCustomTheme).mock.calls[0];
    expect(stem).toBe("nord-tweaked");
    expect(overwrite).toBe(false);
    expect(content).toMatch(/^# Nord Tweaked — a Quark theme\n/);
    expect(content).toContain(themeToToml(nord));
    // Saving is not applying: the caller picks it.
    expect(applyTheme).not.toHaveBeenCalled();
  });

  it("counts what it had to fill in", async () => {
    const partial = '[meta]\nname = "Partial"\n\n[colors]\nbackground = "#000000"\n';
    const result = await importThemeText(partial);
    expect(result.status === "saved" && result.adjusted).toBeGreaterThan(0);
  });

  it("passes overwrite through, and reports a clash without writing", async () => {
    vi.mocked(importCustomTheme).mockResolvedValueOnce({ status: "exists", theme: entry });
    expect(await importThemeText(link)).toEqual({ status: "exists", theme: entry });

    await importThemeText(link, { overwrite: true });
    expect(vi.mocked(importCustomTheme).mock.calls[1][2]).toBe(true);
  });

  it("refuses text that isn't a theme before touching the backend", async () => {
    await expect(importThemeText("https://quark.tel/theme/#A")).rejects.toThrow(/TOML or a theme link/);
    await expect(importThemeText("")).rejects.toThrow(/Nothing to import/);
    expect(importCustomTheme).not.toHaveBeenCalled();
  });
});

describe("themeFileStem", () => {
  it("fits the backend's file-name rule", () => {
    const rule = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    for (const name of ["Catppuccin Mocha", "  --x--  ", "日本", "a".repeat(70), `${"ab-".repeat(30)}`]) {
      const stem = themeFileStem(name);
      expect(stem).toMatch(rule);
      expect(stem.length).toBeLessThanOrEqual(64);
    }
    expect(themeFileStem("Catppuccin Mocha")).toBe("catppuccin-mocha");
    expect(themeFileStem("日本")).toBe("theme");
  });
});
