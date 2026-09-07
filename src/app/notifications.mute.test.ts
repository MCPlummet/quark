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

import { muteRoom, unmuteRoom, getConfig } from "./notifications.js";
import { muteRoomIpc, unmuteRoomIpc, getNotificationConfig } from "../ipc/notifications.js";

const ROOM = "!general:example.com";

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

/**
 * `commands::mute_room` records only the mutes the homeserver refused: a
 * successful mute is already enforced by the push rule everywhere, and an entry
 * that outlived it could not be told apart from a genuine failure. The cached
 * config has to mirror that exactly — a mute in this session's config that the
 * persisted one lacks gets written back to disk by the next Settings save.
 */
describe("muteRoom mirrors what the backend writes to mute_rooms", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(getNotificationConfig).mockResolvedValue({
      enabled: true,
      show_body: true,
      show_sender: true,
      mute_rooms: [],
      background_sync: false,
      push_enabled: false,
      push_gateway_override: null,
    });
    // Force a reload so each case starts from the config above.
    await getConfig();
  });

  it("records a mute the homeserver refused, so this device still silences it", async () => {
    vi.mocked(muteRoomIpc).mockResolvedValue({ synced: false, warning: "unreachable" });

    await muteRoom(ROOM);

    expect((await getConfig()).mute_rooms).toContain(ROOM);
  });

  it("records nothing for a mute that synced — the push rule is the mute", async () => {
    vi.mocked(muteRoomIpc).mockResolvedValue({ synced: true, warning: null });

    await muteRoom(ROOM);

    expect((await getConfig()).mute_rooms).not.toContain(ROOM);
  });

  it("clears an earlier failed entry once a retry syncs", async () => {
    vi.mocked(muteRoomIpc).mockResolvedValue({ synced: false, warning: "unreachable" });
    await muteRoom(ROOM);
    expect((await getConfig()).mute_rooms).toContain(ROOM);

    vi.mocked(muteRoomIpc).mockResolvedValue({ synced: true, warning: null });
    await muteRoom(ROOM);

    expect((await getConfig()).mute_rooms).not.toContain(ROOM);
  });

  it("drops the entry on unmute", async () => {
    vi.mocked(muteRoomIpc).mockResolvedValue({ synced: false, warning: "unreachable" });
    await muteRoom(ROOM);

    vi.mocked(unmuteRoomIpc).mockResolvedValue({ synced: true, warning: null });
    await unmuteRoom(ROOM);

    expect((await getConfig()).mute_rooms).not.toContain(ROOM);
  });
});
