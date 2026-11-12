import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppConfig } from "../../../ipc/app_config.js";

const ipc = vi.hoisted(() => ({
  config: null as AppConfig | null,
  getAppConfig: vi.fn(),
  setAppConfig: vi.fn(),
}));

vi.mock("../../../ipc/app_config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../ipc/app_config.js")>();
  ipc.getAppConfig.mockImplementation(async () => structuredClone(ipc.config ?? actual.DEFAULT_APP_CONFIG));
  ipc.setAppConfig.mockResolvedValue(undefined);
  return { ...actual, getAppConfig: ipc.getAppConfig, setAppConfig: ipc.setAppConfig };
});
// The real module pulls in the whole app; the tab only needs this one call.
vi.mock("../../../app/actions.js", () => ({ applyReadReceiptVisibility: vi.fn() }));

import { generalTab } from "./general.js";
import { makeControls } from "../controls.js";
import { DEFAULT_APP_CONFIG } from "../../../ipc/app_config.js";
import { resetUserColors } from "../../../app/user_colors.js";

async function render(): Promise<HTMLElement> {
  const content = document.createElement("div");
  document.body.appendChild(content);
  await generalTab.build({ content, controls: makeControls(), isMobile: false, close: vi.fn(), dispatch: vi.fn() });
  return content;
}

function checkbox(content: HTMLElement, label: string): HTMLInputElement {
  const lbl = [...content.querySelectorAll("label")].find((l) => l.textContent?.trim() === label);
  if (!lbl) throw new Error(`no checkbox "${label}"`);
  return lbl.querySelector("input")!;
}

async function save(content: HTMLElement): Promise<void> {
  const btn = [...content.querySelectorAll("button")].find((b) => b.textContent === "[save]")!;
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
}

describe("General → Appearance → Show user color via…", () => {
  beforeEach(() => {
    resetUserColors();
    document.body.innerHTML = "";
    ipc.setAppConfig.mockClear();
    ipc.config = structuredClone(DEFAULT_APP_CONFIG);
  });

  it("shows the three toggles with config values", async () => {
    ipc.config!.user_colors = { name: true, avatar: false, border: true, overrides: {} };
    const content = await render();
    expect(content.textContent).toContain("Show user color via…");
    expect(checkbox(content, "Name").checked).toBe(true);
    expect(checkbox(content, "Avatar outline").checked).toBe(false);
    expect(checkbox(content, "Box border").checked).toBe(true);
  });

  it("saves toggles and applies them live", async () => {
    const content = await render();
    const avatar = checkbox(content, "Avatar outline");
    avatar.checked = true;
    avatar.dispatchEvent(new Event("change"));
    await save(content);
    expect(ipc.setAppConfig).toHaveBeenCalledTimes(1);
    expect(ipc.setAppConfig.mock.calls[0][0].user_colors.avatar).toBe(true);
    expect(document.documentElement.classList.contains("uc-avatar")).toBe(true);
  });

  it("keeps overrides untouched on save", async () => {
    ipc.config!.user_colors.overrides = { "@a:x": "#ff4466" };
    const content = await render();
    const name = checkbox(content, "Name");
    name.checked = false;
    name.dispatchEvent(new Event("change"));
    await save(content);
    expect(ipc.setAppConfig.mock.calls[0][0].user_colors.overrides).toEqual({ "@a:x": "#ff4466" });
  });
});
