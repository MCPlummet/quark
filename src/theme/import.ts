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
  themeToToml,
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

/**
 * `text` without the punctuation a link picks up from the message or markup
 * around it: `<https://…>`, `(https://…)`, quotes, a full stop after it.
 * Square brackets are left alone — `[colors]` is TOML.
 */
function unwrapped(text: string): string {
  return text.replace(/^[<("'`]+/, "").replace(/[>)"'`.,;:!?]+$/, "");
}

/**
 * The first link to a share string in `text` ("here's mine: https://…#Ae3U…"),
 * which is how a theme usually arrives — pasted from a chat along with the
 * message it came in. The fragment's alphabet ends the match, so trailing
 * punctuation is left behind.
 */
function linkIn(text: string): string | null {
  return /\bhttps?:\/\/[^\s#<>"'`]*#[A-Za-z0-9+/_-]+=*/.exec(text)?.[0] ?? null;
}

/** The TOML a share string or link carries, as an Error fit to show. */
function shareToml(share: string): string {
  try {
    return decodeThemeShare(share);
  } catch (err) {
    if (err instanceof ThemeShareVersionError) throw err;
    throw new Error(
      share.includes("#")
        ? "That theme link is damaged or cut short — copy it again."
        : "That doesn't look like TOML or a theme link.",
    );
  }
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
 * Read whatever the user handed us — theme TOML, a quark.tel/theme link, a
 * bare share string, or a message with a link in it. Throws an Error with a
 * message fit to show them.
 */
export function importTheme(text: string, base: CompleteTheme): ImportedTheme {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to import — paste a theme first.");
  const bare = unwrapped(trimmed);
  if (looksLikeShare(bare)) return parseThemeToml(shareToml(bare), base);
  try {
    return parseThemeToml(trimmed, base);
  } catch (err) {
    // Not a theme file. TOML is tried first so a file that mentions a link in
    // a comment is still read as the file.
    const link = linkIn(trimmed);
    if (link === null) throw err;
    return parseThemeToml(shareToml(link), base);
  }
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

/**
 * A theme as a file: `# <name> — a Quark theme`, then `notes` as more comment
 * lines, a blank line, and the canonical TOML (pass `toml` when it is already
 * serialized). The editor's download and the app's import both write this.
 */
export function themeFileText(
  theme: CompleteTheme,
  notes: readonly string[],
  toml = themeToToml(theme),
): string {
  return [
    `# ${tomlCommentText(theme.meta.name)} — a Quark theme`,
    ...notes.map((note) => `# ${tomlCommentText(note)}`),
    "",
    toml,
  ].join("\n");
}
