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
vi.mock("../../ipc/index.js", () => ({
  loadTheme: vi.fn(),
  importCustomTheme: vi.fn(),
  listCustomThemes: vi.fn(),
}));
vi.mock("../../ipc/app_config.js", () => ({ getAppConfig: vi.fn() }));

import { importThemeText, loadTheme, loadThemeFromConfig, themeIdFor } from "./theme.js";
import { chooseThemeStem, themeFileStem } from "./theme_import.js";
import { importCustomTheme, listCustomThemes, loadTheme as ipcLoadTheme } from "../../ipc/index.js";
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

describe("loadTheme by name", () => {
  const custom = { meta: { name: "Constructor" }, colors: {} };

  it("doesn't find Object.prototype's keys among the built-ins", async () => {
    vi.mocked(ipcLoadTheme).mockResolvedValueOnce(custom);
    await loadTheme("constructor");

    // Asked the backend for constructor.toml rather than applying a function.
    expect(ipcLoadTheme).toHaveBeenCalledWith("constructor");
    expect(applyTheme).toHaveBeenCalledWith(custom);
    expect(setCurrentThemeName).toHaveBeenCalledWith("constructor.toml");
  });

  it("marks a custom theme current under the id Settings lists it by", async () => {
    vi.mocked(ipcLoadTheme).mockResolvedValueOnce(custom);
    await loadTheme("nord-tweaked");
    expect(setCurrentThemeName).toHaveBeenCalledWith("nord-tweaked.toml");
  });

  it("names themes as the backend resolves them", () => {
    expect(themeIdFor("nord")).toBe("nord");
    expect(themeIdFor("nord.toml")).toBe("nord.toml");
    expect(themeIdFor("nord-tweaked")).toBe("nord-tweaked.toml");
    expect(themeIdFor("/abs/where.toml")).toBe("/abs/where.toml");
    expect(themeIdFor("themes/foo")).toBe("themes/foo");
    expect(themeIdFor("..")).toBe("..");
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
  const share = encodeThemeShare(themeToToml(nord));
  const link = `https://quark.tel/theme/#${share}`;
  const entry = { name: "Nord Tweaked", id: "nord-tweaked.toml", path: "/cfg/themes/nord-tweaked.toml" };

  beforeEach(() => {
    vi.mocked(listCustomThemes).mockResolvedValue([]);
    vi.mocked(importCustomTheme).mockResolvedValue({ status: "saved", theme: entry });
  });

  it("saves a link's theme as canonical TOML, named after the theme", async () => {
    const result = await importThemeText(link);

    expect(result).toEqual({ status: "saved", theme: entry, adjusted: 0 });
    const [stem, content, overwrite] = vi.mocked(importCustomTheme).mock.calls[0];
    expect(stem).toBe("nord-tweaked");
    expect(overwrite).toBe(false);
    expect(content).toMatch(/^# Nord Tweaked — a Quark theme\n# Imported in Quark\./);
    expect(content).toContain(themeToToml(nord));
    // Saving is not applying: the caller picks it.
    expect(applyTheme).not.toHaveBeenCalled();
  });

  it("finds the link in a message it was pasted with", async () => {
    for (const text of [
      `here's mine: ${link}`,
      `<${link}>`,
      `${link}.`,
      `(${link}) — enjoy`,
      `${share}.`,
    ]) {
      vi.mocked(importCustomTheme).mockClear();
      await importThemeText(text);
      expect(vi.mocked(importCustomTheme).mock.calls[0]?.[0], text).toBe("nord-tweaked");
    }
  });

  it("reads TOML as TOML even when it mentions a link", async () => {
    const toml = `# from ${link}\n[meta]\nname = "Commented"\n\n[colors]\nbackground = "#000000"\n`;
    await importThemeText(toml);
    expect(vi.mocked(importCustomTheme).mock.calls[0][0]).toBe("commented");
  });

  it("counts what it had to fill in", async () => {
    const partial = '[meta]\nname = "Partial"\n\n[colors]\nbackground = "#000000"\n';
    const result = await importThemeText(partial);
    expect(result.status === "saved" && result.adjusted).toBeGreaterThan(0);
  });

  it("asks before replacing the same theme, and replaces it when told to", async () => {
    vi.mocked(listCustomThemes).mockResolvedValue([entry]);
    expect(await importThemeText(link)).toEqual({ status: "exists", theme: entry });
    expect(importCustomTheme).not.toHaveBeenCalled();

    await importThemeText(link, { overwrite: true });
    expect(vi.mocked(importCustomTheme).mock.calls[0].slice(0, 1)).toEqual(["nord-tweaked"]);
    expect(vi.mocked(importCustomTheme).mock.calls[0][2]).toBe(true);
  });

  it("never replaces a different theme whose file name matches", async () => {
    const other = { name: "nord tweaked!", id: "nord-tweaked.toml", path: "/cfg/themes/nord-tweaked.toml" };
    vi.mocked(listCustomThemes).mockResolvedValue([other]);
    await importThemeText(link, { overwrite: true });
    const [stem, , overwrite] = vi.mocked(importCustomTheme).mock.calls[0];
    expect(stem).toBe("nord-tweaked-2");
    expect(overwrite).toBe(false);
  });

  it("reports a file that appeared since the listing instead of replacing it", async () => {
    vi.mocked(importCustomTheme).mockResolvedValueOnce({ status: "exists", theme: entry });
    expect(await importThemeText(link, { overwrite: true })).toEqual({ status: "exists", theme: entry });
    expect(vi.mocked(importCustomTheme).mock.calls[0][2]).toBe(false);
  });

  it("refuses text that isn't a theme before touching the backend", async () => {
    await expect(importThemeText("https://quark.tel/theme/#A")).rejects.toThrow(/damaged/);
    await expect(importThemeText("Aurora")).rejects.toThrow(/TOML or a theme link/);
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

describe("chooseThemeStem", () => {
  const at = (id: string, name: string) => ({ name, id, path: `/cfg/themes/${id}` });

  it("gives themes whose names slug alike files of their own", () => {
    // Both names are entirely non-Latin, so both slug to `theme`.
    const installed = [at("theme.toml", "Ночь")];
    expect(chooseThemeStem("Ночь", installed)).toEqual({ stem: "theme", existing: installed[0] });
    expect(chooseThemeStem("夕焼け", installed)).toEqual({ stem: "theme-2" });

    const both = [...installed, at("theme-2.toml", "夕焼け")];
    expect(chooseThemeStem("夕焼け", both)).toEqual({ stem: "theme-2", existing: both[1] });
    expect(chooseThemeStem("Nord", [at("nord-2.toml", "nord")]).stem).toBe("nord-3");
  });

  it("leaves built-in names and Windows device names alone", () => {
    expect(chooseThemeStem("Nord", []).stem).toBe("nord-2");
    expect(chooseThemeStem("Aux", []).stem).toBe("aux-2");
    expect(chooseThemeStem("NUL", []).stem).toBe("nul-2");
    expect(chooseThemeStem("Constructor", []).stem).toBe("constructor");
  });

  it("keeps numbered names within the backend's length limit", () => {
    const name = "a".repeat(80);
    const stem = chooseThemeStem(name, [at(`${"a".repeat(64)}.toml`, "other")]).stem;
    expect(stem).toBe(`${"a".repeat(62)}-2`);
  });

  it("gives up rather than numbering forever", () => {
    const installed = Array.from({ length: 99 }, (_, i) => at(i ? `x-${i + 1}.toml` : "x.toml", `X${i}`));
    expect(() => chooseThemeStem("x", installed)).toThrow(/Too many/);
  });
});
