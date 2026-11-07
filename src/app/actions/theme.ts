// Theme actions: loading a theme by name/path, applying the configured
// startup theme, and importing one (see ./theme_import.ts).

import { loadTheme as ipcLoadTheme } from "../../ipc/index.js";

import { applyTheme } from "../../theme/loader.js";
import { builtinTheme } from "../../theme/builtins.js";
import { getAppConfig } from "../../ipc/app_config.js";
import { setCurrentThemeName } from "../../ui/settings/tabs/themes.js";
import { showError, showSuccess } from "../../ui/NotificationToast.js";

import type { ThemeImportResult } from "./theme_import.js";

export type { ThemeImportResult };

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
 * The id a theme is listed under in Settings, for `nameOrPath` as given to
 * {@link loadTheme}: a built-in's name, a custom theme's file name
 * (`nord-tweaked` and `nord-tweaked.toml` are both `nord-tweaked.toml`), or a
 * path as given. Mirrors the backend's `resolve_theme_path`: only a bare file
 * name is a theme in the themes folder.
 */
export function themeIdFor(nameOrPath: string): string {
  if (builtinTheme(nameOrPath)) return nameOrPath;
  const bare = !/[\\/]/.test(nameOrPath) && nameOrPath !== "." && nameOrPath !== "..";
  return bare && !nameOrPath.endsWith(".toml") ? `${nameOrPath}.toml` : nameOrPath;
}

/**
 * Load and apply a theme: a built-in by name, a custom theme by file name in
 * the themes folder (`nord-tweaked.toml`, or `nord-tweaked`), or a theme file
 * by path. A bare name means the built-in when there is one; `nord.toml`
 * always means the file. Built-in themes are resolved from the embedded map
 * without any IPC call; anything else is loaded via the Rust backend.
 */
export async function loadTheme(
  nameOrPath: string,
  { announce = true }: LoadThemeOptions = {},
): Promise<void> {
  try {
    const builtin = builtinTheme(nameOrPath);
    if (builtin) {
      applyTheme(builtin);
      setCurrentThemeName(nameOrPath);
      if (announce) showSuccess(`Theme "${nameOrPath}" applied`);
      return;
    }
    const theme = await ipcLoadTheme(nameOrPath);
    applyTheme(theme);
    setCurrentThemeName(themeIdFor(nameOrPath));
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

/**
 * Install a theme someone handed over into the themes folder — see
 * `importThemeText` in ./theme_import.ts, loaded here on first use so its
 * TOML parser and DEFLATE codec stay out of the startup bundle.
 */
export async function importThemeText(
  text: string,
  options?: { overwrite?: boolean },
): Promise<ThemeImportResult> {
  const { importThemeText: install } = await import("./theme_import.js");
  return install(text, options);
}
