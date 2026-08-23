import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the IPC graph before importing the unit under test, the way
// notification_routing.test.ts does — none of it is reachable under vitest.
vi.mock("../ipc/notifications.js", () => ({
  getNotificationConfig: vi.fn(),
  setNotificationConfig: vi.fn(async () => undefined),
  muteRoomIpc: vi.fn(),
  unmuteRoomIpc: vi.fn(),
  initNotificationChannels: vi.fn(async () => undefined),
  setBackgroundSync: vi.fn(async () => undefined),
  setPushEnabled: vi.fn(async () => undefined),
}));
vi.mock("../ipc/index.js", () => ({
  getPlatform: vi.fn(async () => "ios"),
}));
vi.mock("../ipc/invoke.js", () => ({
  invoke: vi.fn(async () => true),
}));
vi.mock("../ipc/mock.js", () => ({
  isTauri: () => true,
}));
vi.mock("../ui/NotificationToast.js", () => ({
  showToast: vi.fn(),
  showError: vi.fn(),
}));

import { derivedPushEnabled, initNotifications } from "./notifications.js";
import { getNotificationConfig, setPushEnabled } from "../ipc/notifications.js";
import { getPlatform } from "../ipc/index.js";
import { invoke } from "../ipc/invoke.js";

const config = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  show_body: true,
  show_sender: true,
  mute_rooms: [],
  background_sync: false,
  push_enabled: false,
  push_gateway_override: null,
  ...over,
});

describe("derivedPushEnabled", () => {
  it("turns push on when notifications are on and iOS allows them", () => {
    expect(derivedPushEnabled("ios", true, true)).toBe(true);
  });

  // A pusher for a device that cannot display anything hands the gateway an
  // address for nothing.
  it("leaves push off when the permission was declined", () => {
    expect(derivedPushEnabled("ios", true, false)).toBe(false);
  });

  it("turns push off with the notifications the user just switched off", () => {
    expect(derivedPushEnabled("ios", false, true)).toBe(false);
  });

  // Android has a real alternative in background sync, and picking a
  // distributor is a choice about who carries the traffic — so push stays the
  // user's own switch there.
  it("derives nothing on Android", () => {
    expect(derivedPushEnabled("android", true, true)).toBeNull();
  });

  it("derives nothing on desktop, which has no pusher at all", () => {
    expect(derivedPushEnabled("linux", true, true)).toBeNull();
  });
});

describe("initNotifications, on iOS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatform).mockResolvedValue("ios");
    vi.mocked(invoke).mockResolvedValue(true);
  });

  it("registers a pusher once notifications are on and permitted", async () => {
    vi.mocked(getNotificationConfig).mockResolvedValue(config({ push_enabled: false }));

    await initNotifications();

    expect(setPushEnabled).toHaveBeenCalledWith(true);
  });

  // Every launch runs this. Re-asserting a value that already holds would put
  // a pusher round-trip on the login path for nothing.
  it("says nothing when push already matches", async () => {
    vi.mocked(getNotificationConfig).mockResolvedValue(config({ push_enabled: true }));

    await initNotifications();

    expect(setPushEnabled).not.toHaveBeenCalled();
  });

  it("unregisters the pusher when notifications are off", async () => {
    vi.mocked(getNotificationConfig).mockResolvedValue(
      config({ enabled: false, push_enabled: true })
    );

    await initNotifications();

    expect(setPushEnabled).toHaveBeenCalledWith(false);
  });

  it("leaves push alone on Android", async () => {
    vi.mocked(getPlatform).mockResolvedValue("android");
    vi.mocked(getNotificationConfig).mockResolvedValue(config({ push_enabled: false }));

    await initNotifications();

    expect(setPushEnabled).not.toHaveBeenCalled();
  });
});
