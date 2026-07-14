import { describe, it, expect, vi } from "vitest";
import { aboutTab } from "./about.js";
import { makeControls } from "../controls.js";
import { updateSupported } from "../../../ipc/updater.js";

vi.mock("../../../ipc/updater.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../ipc/updater.js")>();
  return { ...actual, updateSupported: vi.fn(async () => true) };
});

function render(isMobile: boolean): HTMLElement {
  const content = document.createElement("div");
  aboutTab.build({ content, controls: makeControls(), isMobile, close: vi.fn(), dispatch: vi.fn() });
  return content;
}

describe("aboutTab", () => {
  it("shows version and a GitHub link", () => {
    const el = render(false);
    expect(el.textContent).toMatch(/v\d+\.\d+\.\d+/);
    expect(el.querySelector("a,button[data-link='github']")).toBeTruthy();
  });
  it("shows Updates section on desktop", () => {
    expect(render(false).textContent).toMatch(/Release channel/i);
  });
  it("hides Updates section on mobile", () => {
    expect(render(true).textContent).not.toMatch(/Release channel/i);
  });
  it("swaps the Updates controls for a package-manager note on immutable installs (#28)", async () => {
    vi.mocked(updateSupported).mockResolvedValueOnce(false);
    const el = render(false);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(el.textContent).not.toMatch(/Release channel/i);
    expect(el.textContent).toMatch(/package manager/i);
  });
});

describe("aboutTab — save splices only updater into the real config", () => {
  // Mock the IPC module so the save handler sees a real config (vim_mode: true),
  // not the defaults (vim_mode: true also in DEFAULT_APP_CONFIG, so we flip it
  // by giving the "real" config a distinct value for a field that differs from
  // the default — theme: "custom" vs "phosphor").
  vi.mock("../../../ipc/app_config.js", () => ({
    DEFAULT_APP_CONFIG: {
      general: { theme: "phosphor", notifications: true, confirm_redact: true, icon_radius: "50%", vim_mode: false, send_read_receipts: true, show_read_receipts: true, prompt_session_verification: true, send_key_behavior: "auto" },
      sync: { sliding_sync: true, timeline_limit: 50 },
      media: { auto_load_images: true, inline_video: true, max_image_width: 600, max_image_height: 400, sticker_max_size: 256, cache_size_mb: 500 },
      gif: { provider: "tenor", api_key: "", rating: "pg", cache_results: true },
      emoji: { shortcode_autocomplete: true, autocomplete_min_chars: 2 },
      home: { dm_limit: 12 },
      cache: { image_memory_mb: 150, timeline_rooms: 30 },
      updater: { channel: "stable", auto_check: false },
    },
    getAppConfig: vi.fn(async () => ({
      general: { theme: "phosphor", notifications: true, confirm_redact: true, icon_radius: "50%", vim_mode: true, send_read_receipts: true, show_read_receipts: true, prompt_session_verification: true, send_key_behavior: "auto" },
      sync: { sliding_sync: true, timeline_limit: 50 },
      media: { auto_load_images: true, inline_video: true, max_image_width: 600, max_image_height: 400, sticker_max_size: 256, cache_size_mb: 500 },
      gif: { provider: "tenor", api_key: "", rating: "pg", cache_results: true },
      emoji: { shortcode_autocomplete: true, autocomplete_min_chars: 2 },
      home: { dm_limit: 12 },
      cache: { image_memory_mb: 150, timeline_rooms: 30 },
      updater: { channel: "beta", auto_check: true },
    })),
    setAppConfig: vi.fn(async () => {}),
  }));

  it("save merges updater into the real fetched config, not into defaults", async () => {
    const { setAppConfig } = await import("../../../ipc/app_config.js");

    const content = document.createElement("div");
    aboutTab.build({ content, controls: makeControls(), isMobile: false, close: vi.fn(), dispatch: vi.fn() });

    // Click Save — saveButton renders as a <button class="settings-dialog__btn"> with text "[save]".
    const saveBtn = Array.from(content.querySelectorAll("button.settings-dialog__btn"))
      .find((b) => b.textContent === "[save]") as HTMLButtonElement | undefined;
    expect(saveBtn).toBeTruthy();
    saveBtn!.click();

    // Flush microtasks so the async save handler and getAppConfig resolve.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // setAppConfig must have been called with the REAL fetched general config
    // (vim_mode: true), not the default (vim_mode: false).
    expect(setAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        general: expect.objectContaining({ vim_mode: true }),
      }),
    );
  });
});
