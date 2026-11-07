// Getting themes in and out of the editor: reading pasted/dropped/linked
// themes, and the downloadable file.

import { themeToToml, type CompleteTheme } from "../theme/share.js";
import { themeFileText as fileText } from "../theme/import.js";

export { importTheme, parseThemeToml, type ImportedTheme } from "../theme/import.js";

/** What the downloaded file says about itself, under its title line. */
const DOWNLOAD_NOTES = [
  "Install: save to Quark's themes folder, then pick it in Settings → Themes.",
  "  Linux    ~/.config/quark/themes/",
  "  macOS    ~/Library/Application Support/quark/themes/",
  "  Windows  %APPDATA%\\quark\\config\\themes\\",
  "Edit: open https://quark.tel/theme/ and import this file.",
];

/**
 * The .toml file as downloaded: a short header, then the canonical TOML
 * (pass `toml` when it is already serialized).
 */
export function themeFileText(theme: CompleteTheme, toml = themeToToml(theme)): string {
  return fileText(theme, DOWNLOAD_NOTES, toml);
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
