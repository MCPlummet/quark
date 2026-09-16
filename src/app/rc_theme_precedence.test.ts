import { describe, it, expect, beforeEach, vi } from "vitest";

// #91: a theme picked in Settings silently reverted on the next launch whenever
// quarkrc carried a `colorscheme` line. Both startup paths applied a theme and
// the rc file happened to run second, so it won — not by decision, just by the
// order startup was sequenced in.
//
// The rule is now deliberate: `config.toml`'s `general.theme` is the active
// theme, and `colorscheme` is the default that applies only when config.toml has
// not chosen one. The default theme name reads as "not chosen", so a
// quarkrc-only setup keeps working.

vi.mock("./actions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actions.js")>();
  return { ...actual, loadTheme: vi.fn() };
});
vi.mock("../ipc/app_config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ipc/app_config.js")>();
  return { ...actual, getAppConfig: vi.fn(), setAppConfig: vi.fn().mockResolvedValue(undefined) };
});

import { applyRcDirectives } from "./keyboard.js";
import { loadTheme } from "./actions.js";
import { getAppConfig, DEFAULT_APP_CONFIG } from "../ipc/app_config.js";
import type { ParsedRc } from "../ipc/types.js";

const rcWithColorscheme = (name: string): ParsedRc =>
  ({ directives: [{ type: "colorscheme", name }], errors: [] }) as unknown as ParsedRc;

const configWithTheme = (theme: string) => ({
  ...structuredClone(DEFAULT_APP_CONFIG),
  general: { ...structuredClone(DEFAULT_APP_CONFIG).general, theme },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("quarkrc colorscheme vs config.toml general.theme (#91)", () => {
  it("applies colorscheme when config.toml has not chosen a theme", async () => {
    vi.mocked(getAppConfig).mockResolvedValue(configWithTheme("phosphor"));

    await applyRcDirectives(rcWithColorscheme("amber"));

    expect(loadTheme).toHaveBeenCalledWith("amber", { announce: false });
  });

  // The reported symptom: pick nord in Settings, relaunch, get amber back.
  it("ignores colorscheme when config.toml names a theme", async () => {
    vi.mocked(getAppConfig).mockResolvedValue(configWithTheme("nord"));

    await applyRcDirectives(rcWithColorscheme("amber"));

    expect(loadTheme).not.toHaveBeenCalled();
  });

  // Losing the config read must not also lose the rc file's theme — falling back
  // to the old behaviour is better than falling back to no theme at all.
  it("applies colorscheme when config.toml cannot be read", async () => {
    vi.mocked(getAppConfig).mockRejectedValue(new Error("no config"));

    await applyRcDirectives(rcWithColorscheme("amber"));

    expect(loadTheme).toHaveBeenCalledWith("amber", { announce: false });
  });
});
