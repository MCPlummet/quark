import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyLocalRoomMeta, pickSpaceTargetRoom } from "./rooms.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";
import type { AppComponents } from "../../ui/App.js";
import type { RoomInfo } from "../../ipc/types.js";

// applyLocalRoomMeta reflects a name/topic edit into the cached room list and,
// when the edited room is the open one, into the header — without waiting for a
// sync round-trip (the "reflect room name/topic edits live" behaviour).

function makeRoom(over: Partial<RoomInfo> = {}): RoomInfo {
  return {
    room_id: "!r:x",
    name: "Old name",
    topic: "Old topic",
    avatar_url: null,
    unread_count: 0,
    notification_count: 0,
    is_direct: false,
    is_encrypted: false,
    member_count: 2,
    ...over,
  };
}

const roomHeader = { setRoom: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  setComponents({ roomHeader } as unknown as AppComponents);
  AppState.patch({
    roomListCache: [makeRoom({ room_id: "!a:x" }), makeRoom({ room_id: "!b:x" })],
    currentRoomId: null,
  });
});

describe("applyLocalRoomMeta", () => {
  it("updates only the named fields on the matching cached room", () => {
    applyLocalRoomMeta("!a:x", { name: "New name" });
    const cache = AppState.get("roomListCache");
    const a = cache.find((r) => r.room_id === "!a:x")!;
    expect(a.name).toBe("New name");
    expect(a.topic).toBe("Old topic"); // untouched — not in meta
  });

  it("leaves other rooms in the cache untouched", () => {
    applyLocalRoomMeta("!a:x", { name: "New name", topic: "New topic" });
    const b = AppState.get("roomListCache").find((r) => r.room_id === "!b:x")!;
    expect(b).toMatchObject({ name: "Old name", topic: "Old topic" });
  });

  it("updates the header when the edited room is the open one", () => {
    AppState.set("currentRoomId", "!a:x");
    applyLocalRoomMeta("!a:x", { name: "New name", topic: "New topic" });
    expect(roomHeader.setRoom).toHaveBeenCalledExactlyOnceWith("New name", "New topic");
  });

  it("does not touch the header when a different room is edited", () => {
    AppState.set("currentRoomId", "!a:x");
    applyLocalRoomMeta("!b:x", { name: "New name" });
    expect(roomHeader.setRoom).not.toHaveBeenCalled();
  });
});

// pickSpaceTargetRoom decides which room a space switch should load into the
// timeline: the space's remembered last-active chat when it's still listed,
// otherwise the first room, so the timeline never lingers on a foreign room (#11).
describe("pickSpaceTargetRoom", () => {
  const list = ["!a:x", "!b:x", "!c:x"];

  it("restores the remembered room when it is still in the space's list", () => {
    expect(pickSpaceTargetRoom(list, "!b:x")).toBe("!b:x");
  });

  it("falls back to the first room when the remembered room is gone", () => {
    expect(pickSpaceTargetRoom(list, "!gone:x")).toBe("!a:x");
  });

  it("opens the first room when nothing is remembered", () => {
    expect(pickSpaceTargetRoom(list, undefined)).toBe("!a:x");
  });

  it("returns null for an empty space", () => {
    expect(pickSpaceTargetRoom([], "!b:x")).toBeNull();
    expect(pickSpaceTargetRoom([], undefined)).toBeNull();
  });
});
