import { describe, it, expect, beforeEach, vi } from "vitest";

// `loadTheme` announces a theme change, which is right for a user action —
// `:theme catppuccin-mocha`, or picking one in Settings. Two startup paths
// reused it to apply *configured* state: `loadThemeFromConfig` (config.toml's
// `general.theme`) and the quarkrc `colorscheme` directive. Declare the theme in
// both, as the default config does, and launching announced it twice.
//
// Nobody saw either toast until #80 gave the component a stylesheet.

vi.mock("../../ui/NotificationToast.js", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));
vi.mock("../../theme/loader.js", () => ({ applyTheme: vi.fn() }));
vi.mock("../../ui/settings/tabs/themes.js", () => ({ setCurrentThemeName: vi.fn() }));
vi.mock("../../ipc/index.js", () => ({ loadTheme: vi.fn() }));
vi.mock("../../ipc/app_config.js", () => ({ getAppConfig: vi.fn() }));

import { loadTheme, loadThemeFromConfig } from "./theme.js";
import { showError, showSuccess } from "../../ui/NotificationToast.js";
import { applyTheme } from "../../theme/loader.js";
import { setCurrentThemeName } from "../../ui/settings/tabs/themes.js";
import { getAppConfig } from "../../ipc/app_config.js";

const THEME = "catppuccin-mocha";

const appConfig = (theme: string) => ({
  general: {
    theme,
    icon_radius: "50%",
    show_read_receipts: true,
  },
}) as unknown as Awaited<ReturnType<typeof getAppConfig>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppConfig).mockResolvedValue(appConfig(THEME));
});

describe("loadTheme announces, because a user asked for it", () => {
  it("applies the theme and says so", async () => {
    await loadTheme(THEME);

    expect(applyTheme).toHaveBeenCalledTimes(1);
    expect(setCurrentThemeName).toHaveBeenCalledWith(THEME);
    expect(showSuccess).toHaveBeenCalledTimes(1);
  });

  it("reports a theme it cannot load", async () => {
    await loadTheme("no-such-theme");

    expect(showError).toHaveBeenCalledTimes(1);
    expect(showSuccess).not.toHaveBeenCalled();
  });
});

describe("startup applies the configured theme without announcing it", () => {
  it("does not toast for a theme the user did not just ask for", async () => {
    await loadThemeFromConfig();

    expect(applyTheme).toHaveBeenCalledTimes(1);
    expect(setCurrentThemeName).toHaveBeenCalledWith(THEME);
    expect(showSuccess).not.toHaveBeenCalled();
  });

  // The reported bug: config.toml and quarkrc both name a theme, both startup
  // paths run, and each announced its own application.
  it("stays silent even when quarkrc applies the same theme again", async () => {
    await loadThemeFromConfig();
    await loadTheme(THEME, { announce: false });

    expect(showSuccess).not.toHaveBeenCalled();
  });

  // A theme named in config that no longer exists is worth surfacing: the user
  // gets the default and would otherwise have no idea why.
  it("still reports a configured theme that fails to load", async () => {
    vi.mocked(getAppConfig).mockResolvedValue(appConfig("deleted-theme"));

    await loadThemeFromConfig();

    expect(showError).toHaveBeenCalledTimes(1);
  });
});
