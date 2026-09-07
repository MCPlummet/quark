import { describe, it, expect, vi } from "vitest";

// Same IPC mock graph as the other notifications tests — none of it is
// reachable under vitest.
vi.mock("../ipc/notifications.js", () => ({
  getNotificationConfig: vi.fn(),
  setNotificationConfig: vi.fn(async () => undefined),
  muteRoomIpc: vi.fn(),
  unmuteRoomIpc: vi.fn(),
  initNotificationChannels: vi.fn(async () => undefined),
  setBackgroundSync: vi.fn(async () => undefined),
  setPushEnabled: vi.fn(async () => undefined),
}));
vi.mock("../ipc/index.js", () => ({ getPlatform: vi.fn(async () => "linux") }));
vi.mock("../ipc/invoke.js", () => ({ invoke: vi.fn(async () => true) }));
vi.mock("../ipc/mock.js", () => ({ isTauri: () => true }));
vi.mock("../ui/NotificationToast.js", () => ({
  showToast: vi.fn(),
  showError: vi.fn(),
}));

import { shouldShowInAppToast } from "./notifications.js";
import type { InAppToastInput } from "./notifications.js";
import type { NotificationConfig } from "../ipc/notifications.js";

const ROOM = "!general:example.com";
const ME = "@me:example.com";
const ALICE = "@alice:example.com";

const config = (over: Partial<NotificationConfig> = {}): NotificationConfig =>
  ({
    enabled: true,
    show_body: true,
    show_sender: true,
    mute_rooms: [],
    background_sync: false,
    push_enabled: false,
    push_gateway_override: null,
    ...over,
  }) as NotificationConfig;

/** A message from someone else, in a room the user is not currently reading. */
const input = (over: Partial<InAppToastInput> = {}): InAppToastInput => ({
  config: config(),
  roomId: ROOM,
  senderId: ALICE,
  ownUserId: ME,
  isRendered: false,
  cachedRoom: { muted: false },
  ...over,
});

/**
 * Both rules below were long-standing but unobservable: no toast has ever been
 * painted on screen until #80 gave the component a stylesheet. The OS path had
 * the first rule all along — `notify::evaluate` opens with `if input.is_own ||
 * input.window_focused` — so only the in-app path diverged (#89).
 */
describe("shouldShowInAppToast: own-message echo (#89)", () => {
  it("stays silent for the user's own message echoed back over sync", () => {
    expect(shouldShowInAppToast(input({ senderId: ME }))).toBe(false);
  });

  it("still toasts for someone else's message in the same room", () => {
    expect(shouldShowInAppToast(input({ senderId: ALICE }))).toBe(true);
  });

  // A message sent from the user's phone echoes into their desktop session with
  // the same sender — still their own message, still no toast.
  it("stays silent for the user's own message sent from another client", () => {
    expect(shouldShowInAppToast(input({ senderId: ME, isRendered: false }))).toBe(false);
  });

  // Before the session resolves ownUserId there is nothing to compare against;
  // suppressing on a null would silence every room.
  it("does not suppress everything when the own user id is not known yet", () => {
    expect(shouldShowInAppToast(input({ ownUserId: null }))).toBe(true);
  });
});

describe("shouldShowInAppToast: the room being read (#89)", () => {
  it("stays silent when the message is rendering in the open live tail", () => {
    expect(shouldShowInAppToast(input({ isRendered: true }))).toBe(false);
  });

  it("toasts for a message in some other room", () => {
    expect(shouldShowInAppToast(input({ isRendered: false }))).toBe(true);
  });

  /**
   * Context view keeps the room open while the user is scrolled into the past,
   * and live-tail events are deliberately not rendered there (sync.ts). The
   * toast is then the only signal the message arrived, so it must survive —
   * the rule is "open AND rendering", not "open".
   */
  it("still toasts in context view, where the live tail is not rendered", () => {
    expect(shouldShowInAppToast(input({ isRendered: false }))).toBe(true);
  });
});

/**
 * #50 fixed the *display* of server-side mutes; the decision path still read
 * the device-local list, so a room muted from Element drew the muted marker and
 * toasted on every message (#82).
 */
describe("shouldShowInAppToast: mute precedence (#82)", () => {
  it("stays silent for a room the server ruleset reports as muted", () => {
    expect(shouldShowInAppToast(input({ cachedRoom: { muted: true } }))).toBe(false);
  });

  it("shows a toast for a room the server reports as unmuted", () => {
    expect(shouldShowInAppToast(input({ cachedRoom: { muted: false } }))).toBe(true);
  });

  it("lets the server ruleset override a stale local mute_rooms entry", () => {
    const stale = config({ mute_rooms: [ROOM] });
    expect(shouldShowInAppToast(input({ config: stale, cachedRoom: { muted: false } }))).toBe(true);
  });

  // mute_rooms survives only as the offline fallback: the record of "we tried
  // to mute this here" for a room the store has not synced yet.
  it("falls back to mute_rooms when the room is not in the cache at all", () => {
    const local = config({ mute_rooms: [ROOM] });
    expect(shouldShowInAppToast(input({ config: local, cachedRoom: undefined }))).toBe(false);
    expect(shouldShowInAppToast(input({ cachedRoom: undefined }))).toBe(true);
  });

  // A payload predating the muted field must not be read as "muted".
  it("falls back to mute_rooms when the cached room has no muted field", () => {
    const local = config({ mute_rooms: [ROOM] });
    expect(shouldShowInAppToast(input({ config: local, cachedRoom: {} }))).toBe(false);
    expect(shouldShowInAppToast(input({ cachedRoom: {} }))).toBe(true);
  });
});

describe("shouldShowInAppToast: global gates", () => {
  it("stays silent when notifications are off entirely", () => {
    expect(shouldShowInAppToast(input({ config: config({ enabled: false }) }))).toBe(false);
  });

  it("stays silent before the config has loaded", () => {
    expect(shouldShowInAppToast(input({ config: null }))).toBe(false);
  });
});
