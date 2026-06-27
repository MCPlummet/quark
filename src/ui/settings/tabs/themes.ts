// Settings → Themes tab.
//
// Built-in theme buttons plus custom themes scanned from
// ~/.config/quark/themes/. Migrated from SettingsDialog._buildThemesTab;
// behaviour is unchanged.
//
// The module-level `_currentTheme` / `setCurrentThemeName` tracking lives here
// (it previously sat at the top of SettingsDialog). The startup theme loader in
// app/actions/theme.ts imports `setCurrentThemeName` from this module.

import { loadTheme } from "../../../app/actions.js";
import { getAppConfig, setAppConfig } from "../../../ipc/app_config.js";
import { listCustomThemes } from "../../../ipc/config.js";
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

export const themesTab: SettingsTab = {
  id: "themes",
  label: "Themes",
  build(ctx) {
    const { content, controls } = ctx;

    const builtinSection = document.createElement("div");
    builtinSection.className = "settings-dialog__section";
    builtinSection.appendChild(controls.sectionTitle("Built-in themes — click to apply"));

    const addThemeRow = (container: HTMLElement, label: string, id: string) => {
      const row = document.createElement("div");
      row.className = "settings-dialog__row settings-dialog__row--theme";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-dialog__theme-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        void loadTheme(id);
        _currentTheme = id;
        for (const el of content.querySelectorAll(".settings-dialog__current")) {
          el.remove();
        }
        const cur = document.createElement("span");
        cur.className = "settings-dialog__current";
        cur.textContent = "(current)";
        row.appendChild(cur);
        void getAppConfig().then((cfg) => {
          const updated = { ...cfg, general: { ...cfg.general, theme: id } };
          return setAppConfig(updated);
        }).catch((err) => {
          console.error("Failed to save theme to config:", err);
        });
      });

      row.appendChild(btn);

      if (id === _currentTheme) {
        const cur = document.createElement("span");
        cur.className = "settings-dialog__current";
        cur.textContent = "(current)";
        row.appendChild(cur);
      }

      container.appendChild(row);
    };

    for (const name of BUILTIN_THEMES) {
      addThemeRow(builtinSection, name, name);
    }

    content.appendChild(builtinSection);

    // Custom themes from ~/.config/quark/themes/ — loaded asynchronously.
    const customSection = document.createElement("div");
    customSection.className = "settings-dialog__section";
    const customTitle = controls.sectionTitle("Custom themes (~/.config/quark/themes/)");
    customSection.appendChild(customTitle);

    const loadingEl = document.createElement("div");
    loadingEl.className = "settings-dialog__hint";
    loadingEl.textContent = "Scanning…";
    customSection.appendChild(loadingEl);

    content.appendChild(customSection);

    void listCustomThemes().then((entries: CustomThemeEntry[]) => {
      loadingEl.remove();
      if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "settings-dialog__hint";
        empty.textContent = "No custom themes found. Place .toml files in ~/.config/quark/themes/.";
        customSection.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        addThemeRow(customSection, entry.name, entry.path);
      }
    }).catch(() => {
      loadingEl.textContent = "Failed to load custom themes.";
    });
  },
};
