import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The module's app wiring imports these; the controller under test gets its
// dependencies injected, so they only need to exist.
vi.mock("../../ipc/index.js", () => ({
  acceptVerificationRequest: vi.fn(),
  cancelSasVerification: vi.fn(),
  confirmSasVerification: vi.fn(),
  getUserDevices: vi.fn(),
  getVerificationState: vi.fn(),
  getVerificationStatus: vi.fn(),
  pendingVerificationRequests: vi.fn(),
  startSasVerification: vi.fn(),
}));
vi.mock("../../ui/NotificationToast.js", () => ({
  showToast: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

import {
  VerificationController,
  BACKSTOP_POLL_MS,
  mergeUpdate,
  newFlow,
  viewFor,
  cancelMessage,
  type VerificationIpc,
  type Notifier,
} from "./verification.js";
import { Verification } from "../../ui/Verification.js";
import { modalManager } from "../../ui/ModalManager.js";
import type { VerificationPhase, VerificationUpdate } from "../../ipc/types.js";

const ME = "@me:example.org";
const EMOJI: [string, string][] = [
  ["🐶", "Dog"], ["🌙", "Moon"], ["🎩", "Hat"], ["🌹", "Rose"],
  ["🏠", "House"], ["🐧", "Penguin"], ["🎉", "Party"],
];

function upd(flowId: string, phase: VerificationPhase, extra: Partial<VerificationUpdate> = {}): VerificationUpdate {
  return {
    flow_id: flowId,
    user_id: ME,
    other_device_id: "OTHERDEV",
    we_started: false,
    phase,
    emoji: phase === "keys_exchanged" ? EMOJI : [],
    decimals: null,
    cancel_code: null,
    cancel_reason: null,
    cancelled_by_us: null,
    ...extra,
  };
}

// ── Pure core ────────────────────────────────────────────────────────────────

describe("mergeUpdate", () => {
  const base = newFlow({ flowId: "f1", userId: ME, weStarted: true });

  it("moves forward", () => {
    const next = mergeUpdate(base, upd("f1", "keys_exchanged", { we_started: true }));
    expect(next?.phase).toBe("keys_exchanged");
    expect(next?.emoji).toHaveLength(7);
  });

  it("never moves backwards (a late poll can't undo a newer event)", () => {
    const comparing = mergeUpdate(base, upd("f1", "keys_exchanged", { we_started: true }))!;
    expect(mergeUpdate(comparing, upd("f1", "started", { we_started: true }))).toBeNull();
  });

  it("treats done and cancelled as final", () => {
    const done = mergeUpdate(base, upd("f1", "done", { we_started: true }))!;
    expect(mergeUpdate(done, upd("f1", "cancelled", { we_started: true }))).toBeNull();
    const cancelled = mergeUpdate(base, upd("f1", "cancelled", { we_started: true }))!;
    expect(mergeUpdate(cancelled, upd("f1", "done", { we_started: true }))).toBeNull();
  });

  it("ignores updates for another flow", () => {
    expect(mergeUpdate(base, upd("f2", "keys_exchanged"))).toBeNull();
  });

  it("keeps the emoji once the SAS moves past the comparison", () => {
    const comparing = mergeUpdate(base, upd("f1", "keys_exchanged", { we_started: true }))!;
    const confirmed = mergeUpdate(comparing, upd("f1", "confirmed", { we_started: true }))!;
    expect(confirmed.emoji).toHaveLength(7);
  });
});

describe("viewFor", () => {
  it("offers Accept only for an unanswered incoming request", () => {
    const incoming = newFlow({ flowId: "f", userId: ME, weStarted: false });
    expect(viewFor(incoming).state).toBe("incoming");
    expect(viewFor({ ...incoming, accepted: true }).state).toBe("waiting");
    expect(viewFor(newFlow({ flowId: "f", userId: ME, weStarted: true })).state).toBe("waiting");
  });

  it("reports a mismatch as failed and other cancels as cancelled", () => {
    const f = newFlow({ flowId: "f", userId: ME, weStarted: true });
    expect(viewFor({ ...f, phase: "cancelled", cancelCode: "m.mismatched_sas" }).state).toBe("failed");
    expect(viewFor({ ...f, phase: "cancelled", cancelCode: "m.timeout" }).state).toBe("cancelled");
  });

  it("says who cancelled", () => {
    expect(cancelMessage("m.user", null, false)).toMatch(/other device/);
    expect(cancelMessage("m.user", null, true)).toBe("Verification cancelled.");
    expect(cancelMessage("tel.quark.unknown_device", null, false)).toMatch(/keys/);
  });
});

// ── Controller ───────────────────────────────────────────────────────────────

describe("VerificationController", () => {
  let ui: Verification;
  let ipc: { [K in keyof VerificationIpc]: ReturnType<typeof vi.fn> };
  let notify: { [K in keyof Notifier]: ReturnType<typeof vi.fn> };
  let prompt: { visible: boolean; isVisible(): boolean; hide(): void };
  let ctl: VerificationController;

  const status = (): string =>
    ui.getElement().querySelector(".verification-dialog__status")?.textContent ?? "";
  const btn = (mod: string): HTMLButtonElement =>
    ui.getElement().querySelector(`.verification-dialog__btn--${mod}`) as HTMLButtonElement;
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    ui = new Verification();
    document.body.appendChild(ui.getElement());
    ipc = {
      start: vi.fn(async () => "out-1"),
      accept: vi.fn(async () => {}),
      confirm: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      state: vi.fn(async () => null),
    };
    notify = { info: vi.fn(), error: vi.fn(), success: vi.fn() };
    prompt = {
      visible: true,
      isVisible() { return this.visible; },
      hide() { this.visible = false; },
    };
    ctl = new VerificationController(ui, ipc as unknown as VerificationIpc, notify, () => [prompt]);
  });

  afterEach(() => {
    ui.hide();
    ui.getElement().remove();
    vi.useRealTimers();
  });

  it("an incoming request dismisses the startup prompt that would cover it", () => {
    ctl.handleIncoming({ user_id: ME, device_id: "NEWDEV", device_name: "Quark on Android", flow_id: "in-1" });
    expect(prompt.visible).toBe(false);
    expect(ui.isVisible()).toBe(true);
    expect(ui.state).toBe("incoming");
    expect(ui.getElement().textContent).toContain("Quark on Android (NEWDEV)");
  });

  it("accepts once even if Accept fires twice (no second start_sas)", async () => {
    let release!: () => void;
    ipc.accept.mockImplementation(() => new Promise<void>((r) => { release = r; }));
    ctl.handleIncoming({ user_id: ME, device_id: "NEWDEV", flow_id: "in-1" });
    btn("confirm").click();
    btn("confirm").click();
    await flush();
    release();
    await flush();
    expect(ipc.accept).toHaveBeenCalledTimes(1);
    expect(ipc.accept).toHaveBeenCalledWith(ME, "in-1");
    expect(ui.state).toBe("waiting");
  });

  it("follows backend state to emoji, confirm, and done", async () => {
    await ctl.startOutgoing(ME, "OTHERDEV");
    expect(ui.state).toBe("waiting");
    expect(status()).toContain("OTHERDEV");

    ctl.handleUpdate(upd("out-1", "keys_exchanged", { we_started: true }));
    expect(ui.state).toBe("comparing");
    expect(ui.getElement().querySelectorAll(".verification-dialog__emoji-cell")).toHaveLength(7);

    btn("confirm").click();
    await flush();
    expect(ipc.confirm).toHaveBeenCalledWith(ME, "out-1");
    expect(ui.state).toBe("confirmed");
    expect(btn("deny").style.display).toBe(""); // Cancel stays available

    ctl.handleUpdate(upd("out-1", "done", { we_started: true }));
    expect(ui.state).toBe("verified");
  });

  it("shows a remote cancel instead of waiting forever", async () => {
    await ctl.startOutgoing(ME, "OTHERDEV");
    ctl.handleUpdate(upd("out-1", "cancelled", {
      we_started: true, cancel_code: "m.user", cancelled_by_us: false,
    }));
    expect(ui.state).toBe("cancelled");
    expect(status()).toMatch(/cancelled on the other device/);
  });

  it("an off-screen cancel says what happened", () => {
    // The SDK's own cancel on arrival (another flow with the same user open).
    ctl.handleUpdate(upd("in-a", "cancelled", { cancel_code: "m.user", cancelled_by_us: true }));
    expect(notify.info).toHaveBeenLastCalledWith(expect.stringMatching(/still open/));
    ctl.handleUpdate(upd("in-b", "cancelled", { cancel_code: "m.user", cancelled_by_us: false }));
    expect(notify.info).toHaveBeenLastCalledWith(expect.stringMatching(/cancelled on the other device/));
    ctl.handleUpdate(upd("in-c", "cancelled", { cancel_code: "m.timeout", cancelled_by_us: false }));
    expect(notify.info).toHaveBeenLastCalledWith(expect.stringMatching(/timed out/));
    ctl.handleUpdate(upd("in-d", "cancelled", { cancel_code: "tel.quark.request_dropped", cancelled_by_us: true }));
    expect(notify.info).toHaveBeenLastCalledWith(expect.not.stringMatching(/keys|still open/));
  });

  it("has no client-side timeout: a slow human on the other device is fine", async () => {
    ipc.state.mockImplementation(async () => upd("out-1", "requested", { we_started: true }));
    await ctl.startOutgoing(ME, "OTHERDEV");
    for (let i = 0; i < 10 * 60_000 / BACKSTOP_POLL_MS; i++) {
      await vi.advanceTimersByTimeAsync(BACKSTOP_POLL_MS);
    }
    expect(ui.state).toBe("waiting");
    expect(ipc.cancel).not.toHaveBeenCalled();
    expect(ipc.state.mock.calls.length).toBeGreaterThan(100);
  });

  it("cancelling while waiting tells the backend (and so the other device)", async () => {
    await ctl.startOutgoing(ME, "OTHERDEV");
    btn("deny").click(); // "[ Cancel ]"
    await flush();
    expect(ipc.cancel).toHaveBeenCalledWith(ME, "out-1", false);
    expect(ui.state).toBe("cancelled");
  });

  it("rejecting an incoming request cancels it on the backend", async () => {
    ctl.handleIncoming({ user_id: ME, device_id: "NEWDEV", flow_id: "in-1" });
    btn("deny").click();
    await flush();
    expect(ipc.cancel).toHaveBeenCalledWith(ME, "in-1", false);
  });

  it("'They don't match' reports a mismatch", async () => {
    await ctl.startOutgoing(ME, "OTHERDEV");
    ctl.handleUpdate(upd("out-1", "keys_exchanged", { we_started: true }));
    btn("deny").click();
    await flush();
    expect(ipc.cancel).toHaveBeenCalledWith(ME, "out-1", true);
    expect(ui.state).toBe("failed");
  });

  describe("closing the dialog at the emoji step is a cancel, not a mismatch", () => {
    beforeEach(async () => {
      await ctl.startOutgoing(ME, "OTHERDEV");
      ctl.handleUpdate(upd("out-1", "keys_exchanged", { we_started: true }));
    });

    const expectPlainCancel = async (): Promise<void> => {
      await flush();
      expect(ipc.cancel).toHaveBeenCalledWith(ME, "out-1", false);
      expect(ipc.cancel).not.toHaveBeenCalledWith(ME, "out-1", true);
      expect(ctl.flow?.cancelCode).toBe("m.user");
    };

    it("Escape", async () => {
      ui.getElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await expectPlainCancel();
    });

    it("the X", async () => {
      (ui.getElement().querySelector(".dialog-close-btn") as HTMLButtonElement).click();
      await expectPlainCancel();
    });

    it("the backdrop", async () => {
      ui.getElement().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await expectPlainCancel();
    });

    it("Android back / Escape with focus outside the dialog", async () => {
      expect(modalManager.closeTopMost()).toBe(true);
      expect(ui.isVisible()).toBe(false);
      await expectPlainCancel();
    });
  });

  describe("another user's request while a flow is live", () => {
    const mallory = { user_id: "@mallory:x", device_id: "EVIL", flow_id: "in-m" };

    it("doesn't end the flow on screen", async () => {
      await ctl.startOutgoing(ME, "OTHERDEV");
      ctl.handleUpdate(upd("out-1", "keys_exchanged", { we_started: true }));
      ctl.handleIncoming(mallory);
      // Its state update takes the missed-request path; still held, one toast.
      ctl.handleUpdate(upd("in-m", "requested", { user_id: "@mallory:x", other_device_id: "EVIL" }));
      expect(ipc.cancel).not.toHaveBeenCalled();
      expect(ctl.flow?.flowId).toBe("out-1");
      expect(ui.state).toBe("comparing");
      expect(notify.info).toHaveBeenCalledTimes(1);
      expect(notify.info).toHaveBeenCalledWith(expect.stringMatching(/@mallory:x wants to verify/));
    });

    it("opens once the dialog is closed, if it's still waiting", async () => {
      await ctl.startOutgoing(ME, "OTHERDEV");
      ctl.handleIncoming(mallory);
      ctl.handleUpdate(upd("out-1", "done", { we_started: true }));
      ipc.state.mockResolvedValueOnce(upd("in-m", "requested", { user_id: "@mallory:x", other_device_id: "EVIL" }));
      btn("dismiss").click();
      await flush();
      expect(ipc.state).toHaveBeenCalledWith("@mallory:x", "in-m");
      expect(ctl.flow?.flowId).toBe("in-m");
      expect(ui.state).toBe("incoming");
    });

    it("is dropped if it ended in the meantime", async () => {
      await ctl.startOutgoing(ME, "OTHERDEV");
      ctl.handleIncoming(mallory);
      ctl.handleUpdate(upd("in-m", "cancelled", {
        user_id: "@mallory:x", cancel_code: "m.user", cancelled_by_us: false,
      }));
      ui.getElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flush();
      expect(ipc.cancel).toHaveBeenCalledWith(ME, "out-1", false);
      expect(ipc.state).not.toHaveBeenCalledWith("@mallory:x", "in-m");
      expect(ctl.flow?.flowId).toBe("out-1");
      expect(ui.isVisible()).toBe(false);
    });
  });

  it("a failed accept cancels the request on the backend", async () => {
    ipc.accept.mockRejectedValueOnce(new Error("Failed to accept verification request: network"));
    ctl.handleIncoming({ user_id: ME, device_id: "NEWDEV", flow_id: "in-1" });
    btn("confirm").click();
    await flush();
    expect(ui.state).toBe("cancelled");
    expect(ipc.cancel).toHaveBeenCalledWith(ME, "in-1", false);
  });

  it("an older flow's late updates don't touch the dialog of a newer attempt", async () => {
    await ctl.startOutgoing(ME, "OTHERDEV");
    ipc.start.mockResolvedValueOnce("out-2");
    await ctl.startOutgoing(ME, "OTHERDEV");
    ctl.handleUpdate(upd("out-1", "cancelled", { we_started: true, cancel_code: "m.user", cancelled_by_us: true }));
    expect(ctl.flow?.flowId).toBe("out-2");
    expect(ui.state).toBe("waiting");
    expect(notify.info).not.toHaveBeenCalled();
  });

  it("joins an incoming request from the device the user picked", async () => {
    ctl.handleIncoming({ user_id: ME, device_id: "NEWDEV", flow_id: "in-1" });
    ipc.start.mockResolvedValueOnce("in-1"); // backend accepted it instead
    await ctl.startOutgoing(ME, "NEWDEV");
    expect(ctl.flow?.flowId).toBe("in-1");
    expect(ctl.flow?.accepted).toBe(true);
    expect(ui.state).toBe("waiting");
  });

  it("picks up a request whose event was missed from its state update", () => {
    ctl.handleUpdate(upd("in-9", "requested"));
    expect(ctl.flow?.flowId).toBe("in-9");
    expect(ui.state).toBe("incoming");
  });

  it("explains a request the SDK dropped instead of showing a dead prompt", () => {
    ctl.handleUpdate(upd("in-7", "cancelled", {
      cancel_code: "tel.quark.unknown_device", cancelled_by_us: true,
    }));
    expect(ui.isVisible()).toBe(false);
    expect(notify.info).toHaveBeenCalledWith(expect.stringMatching(/didn't have that device's keys/));
  });

  it("gives up only when the backend no longer knows the flow", async () => {
    await ctl.startOutgoing(ME, "OTHERDEV");
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(BACKSTOP_POLL_MS);
    expect(ui.state).toBe("cancelled");
  });

  it("a failed confirm surfaces the error instead of claiming success", async () => {
    ipc.confirm.mockRejectedValueOnce(new Error("The verification was cancelled: timeout"));
    await ctl.startOutgoing(ME, "OTHERDEV");
    ctl.handleUpdate(upd("out-1", "keys_exchanged", { we_started: true }));
    btn("confirm").click();
    await flush();
    expect(ui.state).toBe("cancelled");
    expect(notify.error).toHaveBeenCalled();
  });
});
