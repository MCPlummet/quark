import { describe, it, expect, beforeEach, vi } from "vitest";

// Same IPC mock graph as notifications.push.test.ts — none of it is reachable
// under vitest.
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

import { shouldShowInAppToast, muteRoom, unmuteRoom } from "./notifications.js";
import { muteRoomIpc, unmuteRoomIpc } from "../ipc/notifications.js";
import type { NotificationConfig } from "../ipc/notifications.js";

const ROOM = "!general:example.com";

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

/**
 * #50 fixed the *display* of server-side mutes — the room-list marker and the
 * Room Info dialog both read `RoomInfo.muted`. The two *decision* paths still
 * consulted the device-local `mute_rooms` list, so a room muted from Element
 * drew the muted marker and popped an in-app toast for every message.
 *
 * OS notifications were already correct: `notify::evaluate` gates on
 * `input.push.notify`, which is empty for a server-muted room. Only the in-app
 * path diverged, which reads as a Quark bug rather than a setting.
 */
describe("shouldShowInAppToast (#82)", () => {
  it("stays silent for a room the server ruleset reports as muted", () => {
    // Muted in Element: never muted *from this device*, so mute_rooms is empty.
    expect(shouldShowInAppToast(config(), ROOM, { muted: true })).toBe(false);
  });

  it("shows a toast for a room the server reports as unmuted", () => {
    expect(shouldShowInAppToast(config(), ROOM, { muted: false })).toBe(true);
  });

  // The server is the source of truth, so a stale local entry must not win.
  it("lets the server ruleset override a stale local mute_rooms entry", () => {
    const stale = config({ mute_rooms: [ROOM] });
    expect(shouldShowInAppToast(stale, ROOM, { muted: false })).toBe(true);
  });

  // mute_rooms survives only as the offline fallback: the record of "we tried
  // to mute this here" for a room the store has not synced yet.
  it("falls back to mute_rooms when the room is not in the cache at all", () => {
    const local = config({ mute_rooms: [ROOM] });
    expect(shouldShowInAppToast(local, ROOM, undefined)).toBe(false);
    expect(shouldShowInAppToast(config(), ROOM, undefined)).toBe(true);
  });

  // A payload predating the muted field must not be read as "muted".
  it("falls back to mute_rooms when the cached room has no muted field", () => {
    expect(shouldShowInAppToast(config({ mute_rooms: [ROOM] }), ROOM, {})).toBe(false);
    expect(shouldShowInAppToast(config(), ROOM, {})).toBe(true);
  });

  it("stays silent when notifications are off entirely", () => {
    expect(shouldShowInAppToast(config({ enabled: false }), ROOM, { muted: false })).toBe(false);
  });

  it("stays silent before the config has loaded", () => {
    expect(shouldShowInAppToast(null, ROOM, { muted: false })).toBe(false);
  });
});

/**
 * `commands::mute_room` returns `MuteOutcome { synced, warning }` and resolves
 * even when the rule write failed. Swallowing that let RoomInfoDialog patch
 * roomListCache optimistically against an unchanged account ruleset — the room
 * list and a reopened dialog both reported the new state, and the next
 * get_rooms silently flipped it back.
 */
describe("muteRoom / unmuteRoom return their outcome (#82)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands the caller the outcome of a successful mute", async () => {
    vi.mocked(muteRoomIpc).mockResolvedValue({ synced: true, warning: null });

    const outcome = await muteRoom(ROOM);

    expect(outcome.synced).toBe(true);
  });

  it("hands the caller a failed rule write instead of swallowing it", async () => {
    vi.mocked(muteRoomIpc).mockResolvedValue({
      synced: false,
      warning: "Homeserver unreachable; muted on this device only",
    });

    const outcome = await muteRoom(ROOM);

    expect(outcome.synced).toBe(false);
    expect(outcome.warning).toMatch(/unreachable/);
  });

  it("hands the caller a failed unmute too", async () => {
    vi.mocked(unmuteRoomIpc).mockResolvedValue({
      synced: false,
      warning: "Homeserver unreachable",
    });

    const outcome = await unmuteRoom(ROOM);

    expect(outcome.synced).toBe(false);
  });
});
