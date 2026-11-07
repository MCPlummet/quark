// Theme actions: loading a theme by name/path and applying the configured
// startup theme.

import { importCustomTheme, loadTheme as ipcLoadTheme } from "../../ipc/index.js";
import type { CustomThemeEntry } from "../../ipc/index.js";

import { applyTheme } from "../../theme/loader.js";
import { BUILTIN_THEME_MAP } from "../../theme/builtins.js";
import { importTheme, tomlCommentText } from "../../theme/import.js";
import { themeSlug, themeToToml, type CompleteTheme } from "../../theme/share.js";
import { getAppConfig } from "../../ipc/app_config.js";
import { setCurrentThemeName } from "../../ui/settings/tabs/themes.js";

import { showError, showSuccess } from "../../ui/NotificationToast.js";

/**
 * The theme applied when nothing names one. `general.theme` carries this value
 * whenever the user has not chosen a theme, so it doubles as "unset" — see
 * {@link configThemeOverridesRc}.
 */
export const DEFAULT_THEME = "phosphor";

/**
 * Whether `config.toml`'s `general.theme` outranks a quarkrc `colorscheme`
 * directive (#91).
 *
 * A theme can be named in two places, and before this the winner was whichever
 * startup path happened to run last — the rc file, because `setupKeyboard()` is
 * called after the session restore that loads the config. So a theme picked in
 * Settings, which writes `general.theme` and never touches quarkrc, came back
 * as the old one on the next launch with nothing explaining why.
 *
 * The rule now: `config.toml` is the active theme because that is what the UI
 * writes, and `colorscheme` is the default it falls back to. The default theme
 * name reads as "not chosen" so a quarkrc-only setup — the common one, and the
 * only one that worked before — is unaffected.
 *
 * The gap this leaves: explicitly picking the default theme in Settings while
 * quarkrc names another still reverts, because the two are indistinguishable on
 * disk. Closing it needs `general.theme` to gain a real unset state, which is a
 * config schema change rather than a fix.
 */
export function configThemeOverridesRc(theme: string | undefined): boolean {
  return !!theme && theme !== DEFAULT_THEME;
}

/** Options for {@link loadTheme}. */
export interface LoadThemeOptions {
  /**
   * Whether to confirm the change with a toast. Default `true`.
   *
   * The confirmation answers a user action — `:theme <name>`, or picking one in
   * Settings. Startup is not that: the user asked for nothing, so applying what
   * they configured last time is not news. Worse, a theme can be configured in
   * two places at once (config.toml's `general.theme` and quarkrc's
   * `colorscheme`, which the default config sets together), and both startup
   * paths ran — so launching announced the same theme twice. Nobody saw it until
   * #80 gave toasts a stylesheet.
   *
   * Failures are announced either way: a theme named in config that no longer
   * loads leaves the user on the default with no other clue why.
   */
  announce?: boolean;
}

/**
 * Load and apply a theme by built-in name, or a custom theme by file name in
 * the themes folder (`nord-tweaked.toml`) or absolute path.
 * Built-in themes are resolved from the embedded map without any IPC call;
 * anything else is loaded via the Rust backend.
 */
export async function loadTheme(
  nameOrPath: string,
  { announce = true }: LoadThemeOptions = {},
): Promise<void> {
  try {
    const builtin = BUILTIN_THEME_MAP[nameOrPath];
    if (builtin) {
      applyTheme(builtin);
      setCurrentThemeName(nameOrPath);
      if (announce) showSuccess(`Theme "${nameOrPath}" applied`);
      return;
    }
    // Fall back to IPC for custom file paths
    const theme = await ipcLoadTheme(nameOrPath);
    applyTheme(theme);
    setCurrentThemeName(nameOrPath);
    const displayName = theme.meta?.name ?? nameOrPath;
    if (announce) showSuccess(`Theme "${displayName}" applied`);
  } catch (err) {
    showError(`Failed to load theme: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Load the theme specified in config.toml and apply it on startup.
 * Silently falls back to the default if config is absent or theme is invalid.
 */
export async function loadThemeFromConfig(): Promise<void> {
  try {
    const config = await getAppConfig();
    const themeName = config.general.theme;
    if (configThemeOverridesRc(themeName)) {
      await loadTheme(themeName, { announce: false });
    } else {
      setCurrentThemeName(DEFAULT_THEME);
    }
    // Apply app-level CSS variables from config
    const iconRadius = config.general.icon_radius;
    if (iconRadius) {
      document.documentElement.style.setProperty("--icon-radius", iconRadius);
    }
  } catch (err) {
    console.warn("Failed to load theme from config:", err);
  }
}

// ── Import ───────────────────────────────────────────────────────────────────

/** What an import fills missing or invalid settings in from. */
const IMPORT_BASE = BUILTIN_THEME_MAP[DEFAULT_THEME] as CompleteTheme;

/** The backend's limit on a theme file name (`is_valid_theme_stem`). */
const MAX_STEM_LENGTH = 64;

/** The file name, less `.toml`, an imported theme is saved under. */
export function themeFileStem(name: string): string {
  return themeSlug(name).slice(0, MAX_STEM_LENGTH).replace(/-+$/, "") || "theme";
}

/** The file an imported theme is saved as: a short header, then canonical TOML. */
export function importedThemeFileText(theme: CompleteTheme): string {
  return [
    `# ${tomlCommentText(theme.meta.name)} — a Quark theme`,
    "# Imported in Quark. To edit it, open https://quark.tel/theme/ and import this file.",
    "",
    themeToToml(theme),
  ].join("\n");
}

export type ThemeImportResult =
  /** Saved; `adjusted` settings were missing or invalid and were filled in. */
  | { status: "saved"; theme: CustomThemeEntry; adjusted: number }
  /** A theme with the same file name is installed; nothing was written. */
  | { status: "exists"; theme: CustomThemeEntry };

/**
 * Install a theme someone handed over — a quark.tel/theme link, a bare share
 * string, or theme TOML — into the themes folder, named after the theme.
 *
 * This works the same on every platform: mobile has no folder the user can
 * reach, but the app's own config folder has a `themes/` like any other.
 * The theme is completed the way the editor completes an import (gaps filled
 * from Phosphor) and saved as canonical TOML, so the file stands on its own.
 * It is not applied; the caller decides that.
 *
 * Throws an Error fit to show the user when the text isn't a theme.
 */
export async function importThemeText(
  text: string,
  { overwrite = false }: { overwrite?: boolean } = {},
): Promise<ThemeImportResult> {
  const { theme, issues } = importTheme(text, IMPORT_BASE);
  const outcome = await importCustomTheme(
    themeFileStem(theme.meta.name),
    importedThemeFileText(theme),
    overwrite,
  );
  if (outcome.status === "exists") return outcome;
  return { ...outcome, adjusted: issues.length };
}
