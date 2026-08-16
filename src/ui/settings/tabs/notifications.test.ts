// src/ui/settings/tabs/notifications.test.ts
import { describe, it, expect } from "vitest";
import { pushStatusLine, pushHint } from "./notifications.js";
import type { PushStatus } from "../../../ipc/notifications.js";

const status = (over: Partial<PushStatus> = {}): PushStatus => ({
  supported: true,
  enabled: true,
  registered: false,
  transport: "unified_push",
  app_id: null,
  gateway_url: null,
  readiness: "waiting",
  distributor: "org.ntfy",
  ...over,
});

describe("pushStatusLine", () => {
  it("says the app must stay running while push is off", () => {
    expect(pushStatusLine(status({ enabled: false, readiness: "off" }))).toContain(
      "must stay running",
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

  // iOS has no distributor — the OS supplies the token and the gateway is
  // Quark's own Sygnal. Naming one sends users after an app that does not
  // exist on their platform.
  it("never mentions a distributor on iOS", () => {
    for (const readiness of ["waiting", "no_transport"] as const) {
      const line = pushStatusLine(status({ transport: "apns", readiness, distributor: null }));
      expect(line).not.toContain("distributor");
      expect(line).toContain("iOS");
    }
  });
});

describe("pushHint", () => {
  it("tells Android users what to install", () => {
    const hint = pushHint(status());
    expect(hint).toContain("UnifiedPush distributor");
    expect(hint).toContain("ntfy");
  });

  // A user with nothing installed needs somewhere to go, not a description of
  // what they are missing.
  it("points at the distributor list when none is installed", () => {
    expect(pushHint(status({ readiness: "no_transport", distributor: null }))).toContain(
      "unifiedpush.org",
    );
  });

  it("tells iOS users there is nothing to install", () => {
    const hint = pushHint(status({ transport: "apns" }));
    expect(hint).not.toContain("UnifiedPush");
    expect(hint).toContain("nothing to install");
  });

  // The privacy guarantee is the same on both transports and is the whole
  // reason `event_id_only` is requested — it must not be dropped by either.
  it("states the privacy guarantee on every transport", () => {
    for (const transport of ["unified_push", "apns"] as const) {
      expect(pushHint(status({ transport }))).toContain("never message content");
    }
  });
});
