// Settings → Themes → Import: installing a theme someone handed over into the
// themes folder.
//
// Loaded on first use (see importThemeText in ./theme.ts), not at startup: it
// brings the TOML parser, the DEFLATE codec, the share schema and its
// dictionary, none of which the app otherwise needs.

import { importCustomTheme, listCustomThemes } from "../../ipc/index.js";
import type { CustomThemeEntry } from "../../ipc/index.js";

import { BUILTIN_THEME_MAP, builtinTheme } from "../../theme/builtins.js";
import { importTheme, themeFileText } from "../../theme/import.js";
import { themeSlug, type CompleteTheme } from "../../theme/share.js";

/** What an import fills missing or invalid settings in from: Phosphor. */
const IMPORT_BASE = BUILTIN_THEME_MAP.phosphor as CompleteTheme;

/** What an imported file says about itself, under its title line. */
const IMPORT_NOTES = ["Imported in Quark. To edit it, open https://quark.tel/theme/ and import this file."];

/** The backend's limit on a theme file name (`is_valid_theme_stem`). */
const MAX_STEM_LENGTH = 64;

/** Most `-2`, `-3` … tried for one name before giving up. */
const MAX_NUMBERED = 99;

/** The file name, less `.toml`, that a theme's name slugs to. */
export function themeFileStem(name: string): string {
  return themeSlug(name).slice(0, MAX_STEM_LENGTH).replace(/-+$/, "") || "theme";
}

/**
 * File names an imported theme can't take. A built-in theme's: a bare
 * `:theme nord` means the built-in, so an imported `nord.toml` would be
 * reachable only by its full file name. And the device names Windows reserves
 * in every folder (`nul.toml` there is the null device), which the backend
 * refuses.
 */
function isReservedStem(stem: string): boolean {
  return builtinTheme(stem) !== undefined || /^(?:con|prn|aux|nul|com\d|lpt\d)$/.test(stem);
}

/** `base` for the first try, then `base-2`, `base-3` …, cut to fit. */
function numberedStem(base: string, n: number): string {
  if (n === 1) return base;
  const suffix = `-${n}`;
  return base.slice(0, MAX_STEM_LENGTH - suffix.length).replace(/-+$/, "") + suffix;
}

/**
 * Where to save a theme called `name`, given what is installed: the first of
 * `<slug>`, `<slug>-2`, `<slug>-3` … that is free, or that holds a theme of
 * exactly this name — the same theme imported again, returned as `existing`.
 *
 * A file that slugs alike but holds a different theme is passed over, not
 * offered for replacing. The slug drops case, punctuation and every non-Latin
 * script — "Ночь" and "夕焼け" both slug to `theme` — so a slug clash says
 * nothing about whether two themes are the same.
 */
export function chooseThemeStem(
  name: string,
  installed: readonly CustomThemeEntry[],
): { stem: string; existing?: CustomThemeEntry } {
  const byId = new Map(installed.map((entry) => [entry.id, entry]));
  const base = themeFileStem(name);
  for (let n = 1; n <= MAX_NUMBERED; n++) {
    const stem = numberedStem(base, n);
    if (isReservedStem(stem)) continue;
    const existing = byId.get(`${stem}.toml`);
    if (!existing) return { stem };
    if (existing.name === name) return { stem, existing };
  }
  throw new Error(`Too many installed themes have names like "${name}" — rename this one first.`);
}

export type ThemeImportResult =
  /** Saved; `adjusted` settings were missing or invalid and were filled in. */
  | { status: "saved"; theme: CustomThemeEntry; adjusted: number }
  /** A theme of the same name is installed; nothing was written. */
  | { status: "exists"; theme: CustomThemeEntry };

/**
 * Install a theme someone handed over — a quark.tel/theme link, a bare share
 * string, theme TOML, or a message with a link in it — into the themes
 * folder, named after the theme.
 *
 * This works the same on every platform: mobile has no folder the user can
 * reach, but the app's own config folder has a `themes/` like any other.
 * The theme is completed the way the editor completes an import (gaps filled
 * from Phosphor) and saved as canonical TOML, so the file stands on its own.
 * It is not applied; the caller decides that.
 *
 * `overwrite` replaces an installed theme of the same name. It never replaces
 * a different theme whose file name happens to match; that one keeps its file
 * and this one gets the next free name.
 *
 * Throws an Error fit to show the user when the text isn't a theme.
 */
export async function importThemeText(
  text: string,
  { overwrite = false }: { overwrite?: boolean } = {},
): Promise<ThemeImportResult> {
  const { theme, issues } = importTheme(text, IMPORT_BASE);
  const { stem, existing } = chooseThemeStem(theme.meta.name, await listCustomThemes());
  if (existing && !overwrite) return { status: "exists", theme: existing };
  // Only the theme found above may be overwritten. If another file of this
  // name appeared since the listing, the backend reports it instead.
  const outcome = await importCustomTheme(
    stem,
    themeFileText(theme, IMPORT_NOTES),
    overwrite && existing !== undefined,
  );
  if (outcome.status === "exists") return outcome;
  return { ...outcome, adjusted: issues.length };
}
