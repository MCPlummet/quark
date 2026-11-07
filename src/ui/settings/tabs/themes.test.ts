import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../app/actions.js", () => ({
  loadTheme: vi.fn(async () => {}),
  importThemeText: vi.fn(),
}));
vi.mock("../../../ipc/config.js", () => ({
  customThemesDir: vi.fn(),
  listCustomThemes: vi.fn(),
}));
vi.mock("../../../ipc/app_config.js", () => ({
  getAppConfig: vi.fn(async () => ({ general: { theme: "phosphor" } })),
  setAppConfig: vi.fn(async () => {}),
}));

import { themesTab, setCurrentThemeName } from "./themes.js";
import { makeControls } from "../controls.js";
import { importThemeText, loadTheme } from "../../../app/actions.js";
import { customThemesDir, listCustomThemes } from "../../../ipc/config.js";
import { setAppConfig } from "../../../ipc/app_config.js";

const DESKTOP_DIR = "/home/u/.config/quark/themes";
const imported = { name: "Nord Tweaked", id: "nord-tweaked.toml", path: `${DESKTOP_DIR}/nord-tweaked.toml` };

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function render(): Promise<HTMLElement> {
  const content = document.createElement("div");
  themesTab.build({ content, controls: makeControls(), isMobile: false, close: vi.fn(), dispatch: vi.fn() });
  await settle();
  return content;
}

const field = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>(".settings-dialog__import-field")!;
const importButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>(".settings-dialog__import .settings-dialog__btn")!;
const status = (el: HTMLElement) => el.querySelector(".settings-dialog__import .settings-dialog__field-status")!.textContent;
const current = (el: HTMLElement) =>
  [...el.querySelectorAll(".settings-dialog__current")].map((c) => c.parentElement!.dataset.themeId);

beforeEach(() => {
  vi.clearAllMocks();
  setCurrentThemeName("phosphor");
  vi.mocked(customThemesDir).mockResolvedValue(DESKTOP_DIR);
  vi.mocked(listCustomThemes).mockResolvedValue([]);
});

describe("themesTab — where custom themes come from", () => {
  it("names the real themes folder on desktop", async () => {
    const el = await render();
    expect(el.textContent).toContain(`Theme files in ${DESKTOP_DIR}`);
    expect(el.textContent).toMatch(/put \.toml files in that folder, or import one/);
  });

  it("says nothing about a folder on mobile, where there is none to reach", async () => {
    vi.mocked(customThemesDir).mockResolvedValue(null);
    const el = await render();
    expect(el.textContent).not.toMatch(/\.config|folder|directory|\.toml files/i);
    expect(el.textContent).toMatch(/None yet — import one below/);
    expect(field(el)).toBeTruthy();
  });
});

describe("themesTab — the current marker", () => {
  it("marks a custom theme saved by file name", async () => {
    vi.mocked(listCustomThemes).mockResolvedValue([imported]);
    setCurrentThemeName(imported.id);
    expect(current(await render())).toEqual([imported.id]);
  });

  it("still marks one an older config saved by absolute path", async () => {
    vi.mocked(listCustomThemes).mockResolvedValue([imported]);
    setCurrentThemeName(imported.path);
    expect(current(await render())).toEqual([imported.id]);
  });

  it("saves a picked custom theme by file name", async () => {
    vi.mocked(listCustomThemes).mockResolvedValue([imported]);
    const el = await render();
    el.querySelector<HTMLButtonElement>(`[data-theme-id="${imported.id}"] button`)!.click();
    await settle();
    expect(loadTheme).toHaveBeenCalledWith(imported.id);
    expect(vi.mocked(setAppConfig).mock.calls[0][0].general.theme).toBe(imported.id);
    expect(current(el)).toEqual([imported.id]);
  });
});

describe("themesTab — import", () => {
  const LINK = "https://quark.tel/theme/#W21ldGFd";

  it("installs, lists, applies and saves an imported theme", async () => {
    vi.mocked(importThemeText).mockResolvedValue({ status: "saved", theme: imported, adjusted: 2 });
    const el = await render();
    vi.mocked(listCustomThemes).mockResolvedValue([imported]);

    field(el).value = LINK;
    importButton(el).click();
    await settle();

    expect(importThemeText).toHaveBeenCalledWith(LINK, { overwrite: false });
    expect(loadTheme).toHaveBeenCalledWith(imported.id);
    expect(vi.mocked(setAppConfig).mock.calls[0][0].general.theme).toBe(imported.id);
    expect(current(el)).toEqual([imported.id]);
    expect(field(el).value).toBe("");
    expect(status(el)).toBe("imported as nord-tweaked.toml — 2 settings filled in or fixed to load");
  });

  it("asks before replacing an installed theme, and only for the same text", async () => {
    vi.mocked(importThemeText).mockResolvedValueOnce({ status: "exists", theme: imported });
    const el = await render();

    field(el).value = LINK;
    importButton(el).click();
    await settle();
    expect(importButton(el).textContent).toBe("[replace]");
    expect(status(el)).toMatch(/already installed as nord-tweaked\.toml/);
    expect(loadTheme).not.toHaveBeenCalled();

    // Edited text is a different import: back to [import].
    field(el).value = `${LINK}A`;
    field(el).dispatchEvent(new Event("input"));
    expect(importButton(el).textContent).toBe("[import]");

    field(el).value = LINK;
    field(el).dispatchEvent(new Event("input"));
    vi.mocked(importThemeText).mockResolvedValueOnce({ status: "exists", theme: imported });
    importButton(el).click();
    await settle();
    vi.mocked(importThemeText).mockResolvedValueOnce({ status: "saved", theme: imported, adjusted: 0 });
    importButton(el).click();
    await settle();
    expect(vi.mocked(importThemeText).mock.lastCall).toEqual([LINK, { overwrite: true }]);
    expect(importButton(el).textContent).toBe("[import]");
    expect(status(el)).toBe("imported as nord-tweaked.toml");
  });

  it("shows why text could not be imported", async () => {
    vi.mocked(importThemeText).mockRejectedValue(new Error("That doesn't look like TOML or a theme link."));
    const el = await render();
    field(el).value = "nonsense";
    field(el).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await settle();
    expect(status(el)).toBe("That doesn't look like TOML or a theme link.");
    expect(loadTheme).not.toHaveBeenCalled();
  });
});
