// Settings → Themes tab.
//
// Built-in theme buttons, custom themes scanned from the themes folder
// (`<config dir>/themes/`), and an importer that installs a theme from a
// quark.tel/theme link into that folder.
//
// The folder is real on every platform, but only desktop users can reach it —
// on iOS and Android it is inside the app sandbox, and `customThemesDir()`
// returns null. There the tab says nothing about a folder: import is the way
// in.
//
// The module-level `_currentTheme` / `setCurrentThemeName` tracking lives here
// (it previously sat at the top of SettingsDialog). The startup theme loader in
// app/actions/theme.ts imports `setCurrentThemeName` from this module.

import { importThemeText, loadTheme } from "../../../app/actions.js";
import { getAppConfig, setAppConfig } from "../../../ipc/app_config.js";
import { customThemesDir, listCustomThemes } from "../../../ipc/config.js";
import type { CustomThemeEntry } from "../../../ipc/config.js";
import type { SettingsTab } from "../types.js";

const BUILTIN_THEMES = [
  "phosphor",
  "amber",
  "dracula",
  "nord",
  "solarized-dark",
  "solarized-light",
  "catppuccin-mocha",
  "catppuccin-latte",
  "gruvbox-dark",
  "high-contrast",
];

let _currentTheme = "phosphor";

export function setCurrentThemeName(name: string): void {
  _currentTheme = name;
}

type StatusKind = "saving" | "dirty" | "saved" | "error" | null;

function hint(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "settings-dialog__hint";
  el.textContent = text;
  return el;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const themesTab: SettingsTab = {
  id: "themes",
  label: "Themes",
  build(ctx) {
    const { content, controls } = ctx;

    // ── Theme rows ──────────────────────────────────────────────────────
    //
    // Each row carries the ids it answers to, so the "(current)" marker can be
    // redrawn across both lists. A custom theme answers to its file name and,
    // for configs saved before themes were named by file, its absolute path.

    const isCurrent = (row: HTMLElement): boolean =>
      row.dataset.themeId === _currentTheme || row.dataset.themePath === _currentTheme;

    const markCurrent = (): void => {
      for (const el of content.querySelectorAll(".settings-dialog__current")) el.remove();
      for (const row of content.querySelectorAll<HTMLElement>(".settings-dialog__row--theme")) {
        if (!isCurrent(row)) continue;
        const cur = document.createElement("span");
        cur.className = "settings-dialog__current";
        cur.textContent = "(current)";
        row.appendChild(cur);
      }
    };

    /** Apply a theme and make it the one Quark starts with. */
    const chooseTheme = (id: string): void => {
      void loadTheme(id);
      _currentTheme = id;
      markCurrent();
      void getAppConfig().then((cfg) => {
        const updated = { ...cfg, general: { ...cfg.general, theme: id } };
        return setAppConfig(updated);
      }).catch((err) => {
        console.error("Failed to save theme to config:", err);
      });
    };

    const addThemeRow = (container: HTMLElement, label: string, id: string, path?: string) => {
      const row = document.createElement("div");
      row.className = "settings-dialog__row settings-dialog__row--theme";
      row.dataset.themeId = id;
      if (path) row.dataset.themePath = path;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-dialog__theme-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => chooseTheme(id));
      row.appendChild(btn);

      container.appendChild(row);
    };

    // ── Built-in ────────────────────────────────────────────────────────

    const builtinSection = document.createElement("div");
    builtinSection.className = "settings-dialog__section";
    builtinSection.appendChild(controls.sectionTitle("Built-in themes — click to apply"));
    for (const name of BUILTIN_THEMES) {
      addThemeRow(builtinSection, name, name);
    }
    content.appendChild(builtinSection);

    // ── Custom ──────────────────────────────────────────────────────────

    const customSection = document.createElement("div");
    customSection.className = "settings-dialog__section";
    customSection.appendChild(controls.sectionTitle("Custom themes"));
    const folderHint = hint("");
    folderHint.classList.add("settings-dialog__hint--path");
    folderHint.hidden = true;
    customSection.appendChild(folderHint);
    const customList = document.createElement("div");
    customList.appendChild(hint("Scanning…"));
    customSection.appendChild(customList);
    content.appendChild(customSection);

    // Where custom themes come from, once the backend says (null on mobile).
    const folder = customThemesDir().catch(() => null);
    void folder.then((dir) => {
      if (!dir) return;
      folderHint.textContent = `Theme files in ${dir}`;
      folderHint.hidden = false;
    });

    const renderCustom = (entries: CustomThemeEntry[], dir: string | null): void => {
      customList.replaceChildren();
      if (entries.length === 0) {
        customList.appendChild(hint(
          dir
            ? "None yet — put .toml files in that folder, or import one below."
            : "None yet — import one below.",
        ));
      }
      for (const entry of entries) {
        addThemeRow(customList, entry.name, entry.id, entry.path);
      }
      markCurrent();
    };

    const refreshCustom = async (): Promise<void> => {
      const [entries, dir] = await Promise.all([listCustomThemes(), folder]);
      renderCustom(entries, dir);
    };

    // ── Import ──────────────────────────────────────────────────────────

    const importSection = document.createElement("div");
    importSection.className = "settings-dialog__section settings-dialog__import";
    importSection.appendChild(controls.sectionTitle("Import a theme"));
    importSection.appendChild(hint(
      "Paste a theme link from quark.tel/theme — or its share string, or a theme's TOML.",
    ));

    const importRow = document.createElement("div");
    importRow.className = "settings-dialog__row";
    const field = document.createElement("textarea");
    field.className = "settings-dialog__text-input settings-dialog__import-field";
    field.rows = 2;
    field.placeholder = "https://quark.tel/theme/#…";
    field.spellcheck = false;
    field.autocapitalize = "off";
    field.setAttribute("autocomplete", "off");
    field.setAttribute("aria-label", "Theme link, share string or TOML");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-dialog__btn";
    button.textContent = "[import]";
    importRow.append(field, button);
    importSection.appendChild(importRow);

    const statusEl = document.createElement("div");
    statusEl.className = "settings-dialog__field-status";
    statusEl.setAttribute("aria-live", "polite");
    importSection.appendChild(statusEl);
    content.appendChild(importSection);

    const status = (kind: StatusKind, text = ""): void => {
      statusEl.className = "settings-dialog__field-status" + (kind ? ` settings-dialog__field-status--${kind}` : "");
      statusEl.textContent = text;
    };

    // A theme with the same file name is already installed: the button becomes
    // [replace] for exactly the text that found it. Editing the text is a new
    // import and asks again.
    let replacing: string | null = null;
    const setReplacing = (text: string | null): void => {
      replacing = text;
      button.textContent = text === null ? "[import]" : "[replace]";
      button.classList.toggle("settings-dialog__btn--danger", text !== null);
    };

    field.addEventListener("input", () => {
      if (replacing !== null && field.value !== replacing) {
        setReplacing(null);
        status(null);
      }
    });

    let busy = false;
    const runImport = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      const text = field.value;
      status("saving", "importing…");
      try {
        const result = await importThemeText(text, { overwrite: replacing === text });
        if (result.status === "exists") {
          setReplacing(text);
          status("dirty", `"${result.theme.name}" is already installed as ${result.theme.id} — [replace] to overwrite it`);
          return;
        }
        setReplacing(null);
        field.value = "";
        await refreshCustom();
        chooseTheme(result.theme.id);
        const n = result.adjusted;
        status("saved", `imported as ${result.theme.id}` +
          (n ? ` — ${n} setting${n === 1 ? "" : "s"} filled in or fixed to load` : ""));
      } catch (err) {
        status("error", errorText(err));
      } finally {
        busy = false;
      }
    };

    button.addEventListener("click", () => void runImport());
    // Enter imports, as it saves in the other settings fields; Shift+Enter is
    // still a newline for anyone typing TOML. Pasting never sends a keydown.
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void runImport();
      }
    });

    markCurrent();
    void refreshCustom().catch(() => {
      customList.replaceChildren(hint("Failed to load custom themes."));
    });
  },
};
