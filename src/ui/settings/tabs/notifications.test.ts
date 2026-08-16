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
  ...over,
});

describe("pushStatusLine", () => {
  it("says the app must stay running while push is off", () => {
    expect(pushStatusLine(status({ enabled: false }))).toContain("must stay running");
  });

  it("names the gateway once a pusher exists", () => {
    const line = pushStatusLine(status({
      registered: true,
      gateway_url: "https://ntfy.example.org/_matrix/push/v1/notify",
    }));
    expect(line).toContain("registered");
    expect(line).toContain("ntfy.example.org");
  });

  // The un-registered line is the one that has to be transport-specific: it is
  // shown before any pusher exists, which is exactly when `app_id` is null and
  // cannot identify the platform.
  it("tells Android users a distributor is what is missing", () => {
    expect(pushStatusLine(status())).toContain("distributor");
  });

  // iOS has no distributor — the OS supplies the token and the gateway is
  // Quark's own Sygnal. Naming one sends users after an app that does not
  // exist on their platform.
  it("never mentions a distributor on iOS", () => {
    const line = pushStatusLine(status({ transport: "apns" }));
    expect(line).not.toContain("distributor");
    expect(line).toContain("iOS");
  });
});

describe("pushHint", () => {
  it("tells Android users what to install", () => {
    const hint = pushHint(status());
    expect(hint).toContain("UnifiedPush distributor");
    expect(hint).toContain("ntfy");
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
