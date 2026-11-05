// Getting themes in and out of the editor: reading pasted/dropped/linked
// themes, and the downloadable file.

import { parse, TomlError } from "smol-toml";

import {
  THEME_FIELDS,
  completeTheme,
  decodeThemeShare,
  getField,
  themeToToml,
  type CompleteTheme,
  type ThemeIssue,
} from "../theme/share.js";

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
    } catch {
      throw new Error("That doesn't look like TOML or a theme link.");
    }
    return parseThemeToml(toml, base);
  }
  return parseThemeToml(trimmed, base);
}

/** The .toml file as downloaded: a short header, then the canonical TOML. */
export function themeFileText(theme: CompleteTheme): string {
  return [
    `# ${theme.meta.name.replace(/[\r\n]+/g, " ")} — a Quark theme`,
    "# Install: save to ~/.config/quark/themes/, then pick it in Settings → Themes.",
    "# Edit: open https://quark.tel/theme/ and import this file.",
    "",
    themeToToml(theme),
  ].join("\n");
}

export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/toml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission denied or insecure context: fall through.
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("copy failed");
}
