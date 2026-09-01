import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRoomDirectness, convertRoomDirectness, resortPseudoSpaceView } from "./rooms.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";
import { RoomList } from "../../ui/RoomList.js";
import { setRoomDirect } from "../../ipc/index.js";
import { showError, showSuccess } from "../../ui/NotificationToast.js";
import type { AppComponents } from "../../ui/App.js";
import type { RoomInfo } from "../../ipc/types.js";

// `:converttodm` / `:converttoroom` and the Room Settings button flip the
// room's m.direct entry. The server echo only lands on the next sync, so the
// cached flag is updated locally and the sidebar re-sorted — which is what
// moves the room between the DMs and Group Rooms pseudo-spaces.

vi.mock("../../ipc/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/index.js")>();
  return { ...actual, setRoomDirect: vi.fn(async () => {}) };
});

vi.mock("../../ui/NotificationToast.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/NotificationToast.js")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

function makeRoom(id: string, over: Partial<RoomInfo> = {}): RoomInfo {
  return {
    room_id: id,
    name: id,
    topic: null,
    avatar_url: null,
    unread_count: 0,
    notification_count: 0,
    is_direct: false,
    is_encrypted: false,
    member_count: 2,
    last_activity_ts: 100,
    ...over,
  };
}

let roomList: RoomList;

function renderedIds(): string[] {
  return Array.from(
    roomList.getElement().querySelectorAll<HTMLElement>(".room-list__item"),
  ).map((el) => el.dataset.roomId!);
}

beforeEach(() => {
  vi.clearAllMocks();
  roomList = new RoomList();
  document.body.appendChild(roomList.getElement());
  setComponents({ roomList } as unknown as AppComponents);
  AppState.patch({
    roomListCache: [makeRoom("!dm:x", { is_direct: true }), makeRoom("!group:x")],
    currentSpaceId: "__dms__",
    spaceRoomIds: [],
    homeViewActive: false,
  });
  resortPseudoSpaceView();
});

afterEach(() => {
  roomList.getElement().remove();
});

function cached(id: string): RoomInfo {
  return AppState.get("roomListCache").find((r) => r.room_id === id)!;
}

describe("setRoomDirectness", () => {
  it("sends the flag over IPC and returns what was applied", async () => {
    await expect(setRoomDirectness("!group:x", true)).resolves.toBe(true);
    expect(setRoomDirect).toHaveBeenCalledWith("!group:x", true);
  });

  it("flips the cached is_direct flag without touching other rooms", async () => {
    await setRoomDirectness("!group:x", true);
    expect(cached("!group:x").is_direct).toBe(true);
    expect(cached("!dm:x").is_direct).toBe(true);
  });

  it("moves a converted room into the DMs view", async () => {
    expect(renderedIds()).toEqual(["!dm:x"]);
    await setRoomDirectness("!group:x", true);
    expect(renderedIds()).toContain("!group:x");
  });

  it("drops a DM out of the DMs view when converted back to a room", async () => {
    await setRoomDirectness("!dm:x", false);
    expect(cached("!dm:x").is_direct).toBe(false);
    expect(renderedIds()).not.toContain("!dm:x");
  });

  it("propagates IPC failures and leaves the cache untouched", async () => {
    vi.mocked(setRoomDirect).mockRejectedValueOnce(new Error("no can do"));
    await expect(setRoomDirectness("!group:x", true)).rejects.toThrow("no can do");
    expect(cached("!group:x").is_direct).toBe(false);
  });
});

describe("convertRoomDirectness", () => {
  it("reports success with the target type", async () => {
    await convertRoomDirectness("!group:x", true);
    expect(showSuccess).toHaveBeenCalledWith("Converted to DM");
    expect(showError).not.toHaveBeenCalled();
  });

  it("reports failure instead of throwing", async () => {
    vi.mocked(setRoomDirect).mockRejectedValueOnce(new Error("forbidden"));
    await expect(convertRoomDirectness("!dm:x", false)).resolves.toBeUndefined();
    expect(showError).toHaveBeenCalledWith("Failed to convert to room: forbidden");
    expect(showSuccess).not.toHaveBeenCalled();
  });
});
