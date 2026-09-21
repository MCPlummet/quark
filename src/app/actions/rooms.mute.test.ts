import { describe, it, expect, beforeEach, vi } from "vitest";
import { setRoomMuted } from "./rooms.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";
import { muteRoom, unmuteRoom } from "../notifications.js";
import { showSuccess } from "../../ui/NotificationToast.js";
import type { AppComponents } from "../../ui/App.js";

// Every surface that offers muting funnels through setRoomMuted, because the
// four that existed had each implemented a different subset of the flow: the
// room-list context menu and the mobile overflow menu called muteRoom and
// dropped the outcome, leaving the row they had just muted styled as unmuted and
// still offering "Mute" until the next room-list refresh.

vi.mock("../notifications.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../notifications.js")>();
  return { ...actual, muteRoom: vi.fn(), unmuteRoom: vi.fn() };
});

vi.mock("../../ui/NotificationToast.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/NotificationToast.js")>();
  return { ...actual, showSuccess: vi.fn(), showError: vi.fn() };
});

const roomList = { updateRoomMuted: vi.fn() };

const cachedMuted = (): boolean | undefined =>
  AppState.get("roomListCache").find((r) => r.room_id === "!room:x")?.muted;

beforeEach(() => {
  vi.clearAllMocks();
  setComponents({ roomList } as unknown as AppComponents);
  AppState.patch({
    currentRoomId: "!room:x",
    roomListCache: [
      { room_id: "!room:x", name: "x", muted: false } as never,
      { room_id: "!other:x", name: "other", muted: false } as never,
    ],
  });
});

describe("setRoomMuted", () => {
  it("patches the cache, repaints the row, and reports, on a synced mute", async () => {
    vi.mocked(muteRoom).mockResolvedValue({ synced: true, warning: null } as never);

    await expect(setRoomMuted("!room:x", true)).resolves.toBe(true);

    expect(cachedMuted()).toBe(true);
    expect(roomList.updateRoomMuted).toHaveBeenCalledWith("!room:x", true);
    expect(showSuccess).toHaveBeenCalledWith("Room muted");
  });

  it("does the same in reverse on a synced unmute", async () => {
    vi.mocked(unmuteRoom).mockResolvedValue({ synced: true, warning: null } as never);
    AppState.set("roomListCache", [{ room_id: "!room:x", name: "x", muted: true } as never]);

    await expect(setRoomMuted("!room:x", false)).resolves.toBe(false);

    expect(cachedMuted()).toBe(false);
    expect(roomList.updateRoomMuted).toHaveBeenCalledWith("!room:x", false);
    expect(showSuccess).toHaveBeenCalledWith("Room unmuted");
  });

  // The mute that counts is the server-side push rule, and it can fail on its
  // own. Patching anything on the strength of a write the server refused is what
  // #82 was: the app reported a mute the homeserver never got, until the next
  // get_rooms flipped it back.
  it("changes nothing when the homeserver did not take the rule", async () => {
    vi.mocked(muteRoom).mockResolvedValue({ synced: false, warning: "no can do" } as never);

    await expect(setRoomMuted("!room:x", true)).resolves.toBe(false);

    expect(cachedMuted()).toBe(false);
    expect(roomList.updateRoomMuted).not.toHaveBeenCalled();
    expect(showSuccess).not.toHaveBeenCalled();
  });

  it("leaves every other room's cache entry alone", async () => {
    vi.mocked(muteRoom).mockResolvedValue({ synced: true, warning: null } as never);
    await setRoomMuted("!room:x", true);
    expect(AppState.get("roomListCache").find((r) => r.room_id === "!other:x")?.muted).toBe(false);
  });
});
