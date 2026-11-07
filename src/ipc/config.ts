// Config IPC calls

import { invoke } from "./invoke.js";
import type { Theme } from "../theme/loader.js";
import type { ParsedRc } from "./types.js";

export type { ParsedRc };

export interface CustomThemeEntry {
  /** Display name from `[meta]`, or the file stem. */
  name: string;
  /**
   * File name in the themes folder (`nord-tweaked.toml`) — what to store as
   * `general.theme` and pass to {@link loadTheme}. Unlike `path` it survives
   * the app container moving, which iOS does on update.
   */
  id: string;
  /** Absolute path on disk; what older configs stored as the theme. */
  path: string;
}

/**
 * What {@link importCustomTheme} did: saved the theme, or found one with the
 * same file name and, not told to overwrite, left it alone.
 */
export type ImportThemeOutcome =
  | { status: "saved"; theme: CustomThemeEntry }
  | { status: "exists"; theme: CustomThemeEntry };

/**
 * Load a theme by absolute path, or by name of a file in the themes folder
 * (`nord-tweaked.toml`, or `nord-tweaked`).
 * The Rust backend parses the TOML leniently — only valid TOML syntax is
 * required; any subset of Theme fields is accepted. Missing fields simply
 * fall back to the CSS defaults in vars.css.
 * Matches the Rust `load_theme` command.
 */
export async function loadTheme(themePath: string): Promise<Theme> {
  return invoke<Theme>("load_theme", { themePath });
}

/**
 * Scan the themes folder (`<config dir>/themes/`) for *.toml files.
 * Matches the Rust `list_custom_themes` command.
 */
export async function listCustomThemes(): Promise<CustomThemeEntry[]> {
  return invoke<CustomThemeEntry[]>("list_custom_themes");
}

/**
 * Save theme TOML into the themes folder as `<fileStem>.toml`. `fileStem` must
 * be what `themeSlug` produces; the backend refuses anything else.
 * Matches the Rust `import_custom_theme` command.
 */
export async function importCustomTheme(
  fileStem: string,
  content: string,
  overwrite: boolean,
): Promise<ImportThemeOutcome> {
  return invoke<ImportThemeOutcome>("import_custom_theme", { fileStem, content, overwrite });
}

/**
 * The themes folder's path, for telling the user where to put theme files —
 * or `null` on iOS and Android, where it is inside the app sandbox.
 * Matches the Rust `custom_themes_dir` command.
 */
export async function customThemesDir(): Promise<string | null> {
  return invoke<string | null>("custom_themes_dir");
}

/**
 * Parse the contents of a quarkrc file.
 * Matches the Rust `parse_quarkrc` command.
 */
export async function parseQuarkrc(content: string): Promise<ParsedRc> {
  return invoke<ParsedRc>("parse_quarkrc", { content });
}

/**
 * Load and parse the user's quarkrc from the XDG config dir.
 * Returns an empty ParsedRc if the file does not exist.
 * Matches the Rust `load_quarkrc` command.
 */
export async function loadQuarkrc(): Promise<ParsedRc> {
  return invoke<ParsedRc>("load_quarkrc");
}
