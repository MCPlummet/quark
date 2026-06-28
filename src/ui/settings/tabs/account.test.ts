import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the backend IPC. Note: app_config.js is intentionally NOT mocked here —
// the Security section's "prompt to verify" checkbox loads via getAppConfig,
// which falls through to the mock IPC backend in jsdom (no Tauri present).
vi.mock("../../../ipc/index.js", () => ({
  listSessions: vi.fn(async () => ([
    { device_id: "CUR", display_name: "This", last_seen_ts: null, last_seen_ip: null, is_current: true, is_verified: true, is_cross_signed: true, trust_level: "cross-signed" },
    { device_id: "OTH", display_name: "Phone", last_seen_ts: 1000, last_seen_ip: "1.2.3.4", is_current: false, is_verified: false, is_cross_signed: false, trust_level: "unverified" },
  ])),
  deleteDevices: vi.fn(async (_ids: string[], pw?: string) => { if (!pw) throw "UIAA_REQUIRED"; }),
  renameDevice: vi.fn(async () => {}),
  resetCrossSigning: vi.fn(async (_pw?: string) => {}),
  getKeyBackupStatus: vi.fn(async () => ({ enabled: true, exists_on_server: true })),
}));

vi.mock("../../../app/actions/crypto.js", () => ({
  startVerification: vi.fn(async () => {}),
}));

import { accountTab } from "./account.js";
import { makeControls } from "../controls.js";
import * as ipc from "../../../ipc/index.js";
import * as cryptoActions from "../../../app/actions/crypto.js";

async function tick(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

async function render() {
  const content = document.createElement("div");
  document.body.appendChild(content);
  await accountTab.build({ content, controls: makeControls(), isMobile: false, close: vi.fn(), dispatch: vi.fn() });
  await tick();
  return content;
}

/** Find a control button (dispatchButton / saveButton) by its visible label, scoped to `root`. */
function btn(root: ParentNode, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button.settings-dialog__btn"))
    .find((b) => b.textContent === label);
}

describe("accountTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders current + other sessions (incl. the other's IP)", async () => {
    const el = await render();
    expect(el.textContent).toContain("This");
    expect(el.textContent).toContain("Phone");
    expect(el.textContent).toMatch(/1\.2\.3\.4/);
  });

  it("shows read-only key backup status", async () => {
    const el = await render();
    expect(el.textContent).toMatch(/backup/i);
    expect(el.textContent).toMatch(/server/i);
  });

  it("calls startVerification with the typed user id when [verify] is clicked", async () => {
    const closeSpy = vi.fn();
    const content = document.createElement("div");
    document.body.appendChild(content);
    await accountTab.build({ content, controls: makeControls(), isMobile: false, close: closeSpy, dispatch: vi.fn() });
    await tick();

    const verifyInput = content.querySelector<HTMLInputElement>("input[placeholder='@user:server']");
    expect(verifyInput).toBeTruthy();

    verifyInput!.value = "@bob:example.org";
    verifyInput!.dispatchEvent(new Event("input"));

    const verifyBtn = btn(content, "[verify]");
    expect(verifyBtn).toBeTruthy();
    verifyBtn!.click();
    await tick();

    expect(cryptoActions.startVerification).toHaveBeenCalledWith("@bob:example.org");
    expect(closeSpy).toHaveBeenCalled();
  });

  it("does NOT call startVerification when the user id is invalid (no @)", async () => {
    const content = document.createElement("div");
    document.body.appendChild(content);
    await accountTab.build({ content, controls: makeControls(), isMobile: false, close: vi.fn(), dispatch: vi.fn() });
    await tick();

    const verifyInput = content.querySelector<HTMLInputElement>("input[placeholder='@user:server']");
    verifyInput!.value = "notavalidid";
    verifyInput!.dispatchEvent(new Event("input"));

    const verifyBtn = btn(content, "[verify]");
    verifyBtn!.click();
    await tick();

    expect(cryptoActions.startVerification).not.toHaveBeenCalled();
  });

  it("removing an other session opens a confirm dialog, then runs the UIAA password flow", async () => {
    const el = await render();

    const removeBtn = btn(el, "[remove]");
    expect(removeBtn).toBeTruthy();
    removeBtn!.click();
    await tick();

    // ConfirmDialog mounted on document.body — confirm the removal.
    const confirmBtn = document.body.querySelector<HTMLButtonElement>("[data-act='confirm']");
    expect(confirmBtn).toBeTruthy();
    confirmBtn!.click();
    await tick();

    // First delete with no password throws UIAA_REQUIRED.
    expect(ipc.deleteDevices).toHaveBeenCalled();
    expect((ipc.deleteDevices as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toEqual(["OTH"]);

    // PasswordPromptDialog mounted — supply a password and submit.
    const pwInput = document.body.querySelector<HTMLInputElement>("input[type='password']");
    expect(pwInput).toBeTruthy();
    pwInput!.value = "secret";
    const submitBtn = document.body.querySelector<HTMLButtonElement>("[data-act='submit']");
    expect(submitBtn).toBeTruthy();
    submitBtn!.click();
    await tick();

    // Retried with the password.
    expect(ipc.deleteDevices).toHaveBeenLastCalledWith(["OTH"], "secret");
  });
});
