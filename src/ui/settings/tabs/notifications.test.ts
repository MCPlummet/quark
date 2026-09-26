// src/ui/settings/tabs/notifications.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  pushStatusLine,
  pushHint,
  accountMuteNotice,
  ACCOUNT_MUTE_MESSAGE,
} from "./notifications.js";
import type { PushStatus } from "../../../ipc/notifications.js";

const toasts = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock("../../NotificationToast.js", () => toasts);

const status = (over: Partial<PushStatus> = {}): PushStatus => ({
  supported: true,
  enabled: true,
  registered: false,
  transport: "unified_push",
  app_id: null,
  gateway_url: null,
  readiness: "waiting",
  distributor: "org.ntfy",
  distributors: ["org.ntfy"],
  account_muted: false,
  ...over,
});

describe("pushStatusLine", () => {
  it("says the app must stay running while push is off", () => {
    expect(pushStatusLine(status({ enabled: false, readiness: "off" }))).toContain(
      "only notify while it is running",
    );
  });

  it("names the gateway once a pusher exists", () => {
    const line = pushStatusLine(status({
      readiness: "ready",
      registered: true,
      gateway_url: "https://ntfy.example.org/_matrix/push/v1/notify",
    }));
    expect(line).toContain("ntfy.example.org");
  });

  // The likeliest reason push does nothing on Android, and the only one the
  // user can fix. Reporting it as "waiting" would leave them watching a line
  // that never changes.
  it("distinguishes no distributor installed from waiting for one", () => {
    const missing = pushStatusLine(status({ readiness: "no_transport", distributor: null }));
    const waiting = pushStatusLine(status({ readiness: "waiting" }));
    expect(missing).not.toEqual(waiting);
    expect(missing).toContain("no distributor");
  });

  // Which distributor is delivering matters when several are installed —
  // "waiting" against the wrong one is a different fix to "waiting" at all.
  it("names the distributor it is waiting on", () => {
    expect(pushStatusLine(status({ readiness: "waiting", distributor: "org.ntfy" }))).toContain(
      "org.ntfy",
    );
  });

  // The dead end this whole picker exists for: UnifiedPush declines to choose
  // between two installed distributors, so registration never happens and no
  // amount of waiting fixes it. The line has to send the user to the control.
  it("asks the user to choose when several distributors are installed", () => {
    const line = pushStatusLine(status({
      readiness: "waiting",
      distributor: null,
      distributors: ["org.ntfy", "org.unifiedpush.distributor.nextpush"],
    }));
    expect(line).not.toContain("waiting");
    expect(line).toContain("pick one");
  });

  // Once one is saved the tie is broken, so this is an ordinary wait again
  // even though the others are still installed.
  it("goes back to a plain wait once a distributor is saved", () => {
    const line = pushStatusLine(status({
      readiness: "waiting",
      distributor: "org.ntfy",
      distributors: ["org.ntfy", "org.unifiedpush.distributor.nextpush"],
    }));
    expect(line).toContain("waiting for org.ntfy");
  });

  // iOS has no distributor — the OS supplies the token and the gateway is
  // Quark's own Sygnal. Naming one sends users after an app that does not
  // exist on their platform, and a populated list (which iOS never has) must
  // not drag those users into the Android choice.
  it("never mentions a distributor on iOS", () => {
    for (const readiness of ["waiting", "no_transport"] as const) {
      const line = pushStatusLine(status({
        transport: "apns",
        readiness,
        distributor: null,
        distributors: ["org.ntfy", "org.unifiedpush.distributor.nextpush"],
      }));
      expect(line).not.toContain("distributor");
      expect(line).toContain("iOS");
    }
  });
});

describe("pushHint", () => {
  // A user with nothing installed needs to know what to install.
  it("tells Android users to install a distributor when none is installed", () => {
    const hint = pushHint(status({ readiness: "no_transport", distributor: null }));
    expect(hint).toContain("UnifiedPush distributor");
    expect(hint).toContain("ntfy");
  });

  // #113: the hint is for what the user can do, not how push works. States
  // with nothing to act on show no hint at all.
  it("says nothing when there is nothing for the user to do", () => {
    expect(pushHint(status())).toBe("");
    expect(pushHint(status({ readiness: "ready", registered: true }))).toBe("");
    expect(pushHint(status({ distributor: null, distributors: ["a", "b"] }))).toBe("");
    expect(pushHint(status({ transport: "apns" }))).toBe("");
    expect(pushHint(status({ transport: "apns", readiness: "no_transport" }))).toBe("");
  });

  it("never leaks implementation notes", () => {
    for (const transport of ["unified_push", "apns"] as const) {
      for (const readiness of ["off", "ready", "waiting", "no_transport", "muted_account"] as const) {
        const hint = pushHint(status({ transport, readiness }));
        expect(hint).not.toMatch(/gateway|event ID|room ID/i);
      }
    }
  });
});

// ─── The account-wide mute (issue #60) ───────────────────────────────────────
//
// The failure this whole state exists for: another client wrote
// `.m.rule.master`, the homeserver stopped notifying for the entire account,
// and Quark reported push as ready with every rung of the ladder green.

describe("account-wide mute", () => {
  const muted = status({ readiness: "muted_account", registered: true, account_muted: true });

  it("never reports a muted account as working push", () => {
    const line = pushStatusLine(muted);
    expect(line).not.toContain("registered ·");
    expect(line).toContain("disabled for your account");
  });

  // A registered pusher over a working distributor is still delivering
  // nothing, so the transport advice would send the user to fix a chain that
  // is already fine.
  it("points at the notice instead of the transport, on every platform", () => {
    for (const transport of ["unified_push", "apns"] as const) {
      const hint = pushHint(status({ ...muted, transport }));
      expect(hint).toContain("top of this tab");
      expect(hint).not.toContain("UnifiedPush");
    }
  });
});

describe("accountMuteNotice", () => {
  it("explains the state and offers a way out of it", () => {
    const notice = accountMuteNotice(async () => {});
    expect(notice.textContent).toContain(ACCOUNT_MUTE_MESSAGE);
    expect(notice.querySelector("button")).not.toBeNull();
  });

  // The mouse/touch path the project requires for every action: no vim command
  // or keyboard-only affordance is involved in clearing this.
  it("clears the mute on click and takes the notice away", async () => {
    const onFix = vi.fn(async () => {});
    const notice = accountMuteNotice(onFix);
    document.body.appendChild(notice);

    notice.querySelector("button")!.click();
    await vi.waitFor(() => expect(notice.isConnected).toBe(false));
    expect(onFix).toHaveBeenCalledTimes(1);
  });

  // A failed write leaves the account silent, so the notice is still true —
  // removing it would put the UI back to claiming everything is fine, which is
  // the failure this state was added to stop.
  it("keeps the notice standing when the rule write fails", async () => {
    const notice = accountMuteNotice(async () => {
      throw new Error("homeserver said no");
    });
    document.body.appendChild(notice);
    const btn = notice.querySelector("button") as HTMLButtonElement;

    btn.click();
    await vi.waitFor(() => expect(btn.disabled).toBe(false));
    expect(notice.isConnected).toBe(true);
    expect(toasts.showError).toHaveBeenCalled();
  });
});
