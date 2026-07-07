// Theme actions: loading a theme by name/path and applying the configured
// startup theme.

import { loadTheme as ipcLoadTheme } from "../../ipc/index.js";

import { applyTheme } from "../../theme/loader.js";
import { BUILTIN_THEME_MAP } from "../../theme/builtins.js";
import { getAppConfig } from "../../ipc/app_config.js";
import { setCurrentThemeName } from "../../ui/settings/tabs/themes.js";

import { showError, showSuccess } from "../../ui/NotificationToast.js";

/**
 * Load and apply a theme by name (built-in) or file path (custom).
 * Built-in themes are resolved from the embedded map without any IPC call.
 * Custom themes (containing path separators or ending in .toml) are loaded
 * via the Rust backend.
 */
export async function loadTheme(nameOrPath: string): Promise<void> {
  try {
    const builtin = BUILTIN_THEME_MAP[nameOrPath];
    if (builtin) {
      applyTheme(builtin);
      setCurrentThemeName(nameOrPath);
      showSuccess(`Theme "${nameOrPath}" applied`);
      return;
    }
    // Fall back to IPC for custom file paths
    const theme = await ipcLoadTheme(nameOrPath);
    applyTheme(theme);
    setCurrentThemeName(nameOrPath);
    const displayName = theme.meta?.name ?? nameOrPath;
    showSuccess(`Theme "${displayName}" applied`);
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
    if (themeName && themeName !== "phosphor") {
      await loadTheme(themeName);
    } else {
      setCurrentThemeName("phosphor");
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
