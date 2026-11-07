// Reading a theme someone handed over — a quark.tel/theme link, a bare share
// string, or theme TOML — into a complete theme plus a list of what had to be
// fixed on the way in.
//
// Shared by the theme editor (its Import dialog and the link it was opened
// with) and the app (Settings → Themes → Import), so both accept the same
// input and report problems the same way. See DESIGN.md → Theme Editor &
// Sharing.

import { parse, TomlError } from "smol-toml";

import {
  THEME_FIELDS,
  ThemeShareVersionError,
  completeTheme,
  decodeThemeShare,
  getField,
  type CompleteTheme,
  type ThemeIssue,
} from "./share.js";

export interface ImportedTheme {
  theme: CompleteTheme;
  /** Fields that were missing, invalid or unknown, and what was done instead. */
  issues: ThemeIssue[];
}

/**
 * A share string or link, as opposed to TOML: base64 never contains the
 * quotes, brackets or spaces-around-`=` every theme file has.
 */
function looksLikeShare(text: string): boolean {
  return /^(?:[^\s#]*#)?[A-Za-z0-9+/_\s-]+=*$/.test(text);
}

/** Parse TOML text into a theme, as an Error with a readable message. */
export function parseThemeToml(toml: string, base: CompleteTheme): ImportedTheme {
  let parsed: unknown;
  try {
    parsed = parse(toml);
  } catch (err) {
    if (err instanceof TomlError) {
      const what = err.message.split("\n")[0].replace(/^Invalid TOML document: /, "");
      throw new Error(`TOML error on line ${err.line}: ${what}`);
    }
    throw err;
  }
  if (!THEME_FIELDS.some(({ path }) => getField(parsed, path) !== undefined)) {
    throw new Error("That's valid TOML, but it has no Quark theme settings in it.");
  }
  return completeTheme(parsed, base);
}

/**
 * Read whatever the user handed us — theme TOML, a quark.tel/theme link, or a
 * bare share string. Throws an Error with a message fit to show them.
 */
export function importTheme(text: string, base: CompleteTheme): ImportedTheme {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to import — paste a theme first.");
  if (looksLikeShare(trimmed)) {
    let toml: string;
    try {
      toml = decodeThemeShare(trimmed);
    } catch (err) {
      if (err instanceof ThemeShareVersionError) throw err;
      throw new Error("That doesn't look like TOML or a theme link.");
    }
    return parseThemeToml(toml, base);
  }
  return parseThemeToml(trimmed, base);
}

/**
 * Control characters, which TOML allows nowhere in a comment but tab. A name
 * carrying one is fine as a value (tomlString escapes it); copied into a
 * header comment it would make the whole file unparseable.
 */
const COMMENT_UNSAFE = /[\u0000-\u0008\u000a-\u001f\u007f]+/g;

/** `text` made safe to follow `# ` on a TOML comment line. */
export function tomlCommentText(text: string): string {
  return text.replace(COMMENT_UNSAFE, " ");
}
