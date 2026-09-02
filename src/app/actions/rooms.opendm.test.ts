import { describe, it, expect, beforeEach, vi } from "vitest";

// #68: clicking [message] in the profile view sometimes created a *new* room
// instead of opening the existing DM. The old resolver scanned the cached room
// list for `is_direct` rooms under a member-count bound and fetched each one's
// members over IPC to confirm, so it missed a DM that wasn't in the cache, one
// whose other party had left (they're no longer a member), and one still in the
// invite state — and every miss fell through to createRoom, silently producing
// a second DM with the same person.
//
// The lookup is now the backend's `m.direct` read, which is authoritative.

vi.mock("../../ipc/index.js", () => ({
  findDmRoom: vi.fn().mockResolvedValue(null),
  createRoom: vi.fn().mockResolvedValue("!created:x"),
  markRoomRead: vi.fn().mockResolvedValue(undefined),
  openRoomTimeline: vi.fn(),
  getRoomMembers: vi.fn().mockResolvedValue([]),
  getRoomReceipts: vi.fn().mockResolvedValue([]),
  downloadMedia: vi.fn().mockResolvedValue({ mime_type: "image/png", data_base64: "" }),
  getTimeline: vi.fn().mockResolvedValue({ events: [], prev_batch: null }),
  loadOlderTimeline: vi.fn().mockResolvedValue({ events: [], reached_start: true }),
  paginateForward: vi.fn().mockResolvedValue({ events: [], next_batch: null }),
  getEventContext: vi.fn(),
  getRooms: vi.fn().mockResolvedValue([]),
  getSpaceChildren: vi.fn().mockResolvedValue([]),
  getUserSpaces: vi.fn().mockResolvedValue([]),
  joinRoom: vi.fn(),
}));
vi.mock("../mobile.js", () => ({ isMobile: () => false, closeDrawer: vi.fn() }));
vi.mock("./threads.js", () => ({ closeThread: vi.fn() }));
vi.mock("./messages.js", () => ({ cancelReply: vi.fn(), cancelEdit: vi.fn() }));
vi.mock("./dialogs.js", () => ({ openRoomSettings: vi.fn() }));
vi.mock("./profile.js", () => ({ openProfileForUser: vi.fn() }));
vi.mock("../../ui/NotificationToast.js", () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock("./context.js", async (importActual) => {
  const actual = await importActual<typeof import("./context.js")>();
  return {
    ...actual,
    _downloadMessageImages: vi.fn(),
    _downloadReactionEmoji: vi.fn(),
    _downloadInlineEmoji: vi.fn(),
    _downloadMemberAvatars: vi.fn(),
    ensureSenderAvatarDownloaded: vi.fn(),
  };
});

import { openOrCreateDm } from "./rooms.js";
import { setComponents, _dmRoomByUser, _dmUserByRoom } from "./context.js";
import { AppState } from "../state.js";
import { findDmRoom, createRoom, getRooms, joinRoom } from "../../ipc/index.js";
import { showError } from "../../ui/NotificationToast.js";
import type { AppComponents } from "../../ui/App.js";
import type { RoomInfo } from "../../ipc/types.js";

function fakeComponents(): AppComponents {
  const stub = () => new Proxy({}, { get: () => vi.fn() });
  const typingIndicator = document.createElement("div");
  const txt = document.createElement("span");
  txt.className = "typing-indicator__text";
  typingIndicator.appendChild(txt);
  return {
    roomList: stub(), roomHeader: stub(), timeline: stub(),
    memberList: stub(), statusBar: stub(), mobileTopBar: stub(),
    input: stub(), typingIndicator, spaceStrip: stub(),
  } as unknown as AppComponents;
}

function makeRoom(id: string, over: Partial<RoomInfo> = {}): RoomInfo {
  return {
    room_id: id, name: id, topic: null, avatar_url: null,
    unread_count: 0, notification_count: 0, is_direct: true,
    is_encrypted: true, member_count: 2, last_activity_ts: 100, muted: false,
    ...over,
  };
}

describe("openOrCreateDm (#68)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _dmRoomByUser.clear();
    _dmUserByRoom.clear();
    setComponents(fakeComponents());
    // `clearAllMocks` clears calls but not implementations, so re-establish the
    // defaults the per-test overrides below replace.
    vi.mocked(getRooms).mockResolvedValue([]);
    vi.mocked(joinRoom).mockResolvedValue("!joined:x");
    AppState.patch({ roomListCache: [], currentRoomId: null, currentTimeline: [] });
  });

  it("opens the DM m.direct names, without creating anything", async () => {
    AppState.set("roomListCache", [makeRoom("!existing:x")]);
    vi.mocked(findDmRoom).mockResolvedValue("!existing:x");

    await openOrCreateDm("@alice:x");

    expect(findDmRoom).toHaveBeenCalledWith("@alice:x");
    expect(createRoom).not.toHaveBeenCalled();
    expect(AppState.get("currentRoomId")).toBe("!existing:x");
    expect(_dmRoomByUser.get("@alice:x")).toBe("!existing:x");
    expect(_dmUserByRoom.get("!existing:x")).toBe("@alice:x");
  });

  it("refreshes for a DM sync hasn't surfaced yet, without joining it", async () => {
    // One of the misses that produced the duplicate: the room is joined, just
    // not in the cache yet. The old scan only ever looked at the cache.
    AppState.set("roomListCache", []);
    vi.mocked(findDmRoom).mockResolvedValue("!late:x");
    vi.mocked(getRooms).mockResolvedValue([makeRoom("!late:x")]);

    await openOrCreateDm("@bob:x");

    expect(createRoom).not.toHaveBeenCalled();
    expect(getRooms).toHaveBeenCalled();
    expect(joinRoom).not.toHaveBeenCalled();
    expect(AppState.get("currentRoomId")).toBe("!late:x");
    expect(_dmRoomByUser.get("@bob:x")).toBe("!late:x");
  });

  it("accepts a pending DM invite, which no room-list refresh can surface", async () => {
    // The other miss: `find_dm_room` ranks invited rooms as candidates, but
    // `get_rooms` enumerates `joined_rooms()` alone — so refreshing can never
    // produce this one however many times it runs. Left unjoined, selectRoom
    // ran with no RoomInfo behind it at all: a raw "!id:server" in the header,
    // no topic/member count/encryption, and a getTimeline against a room this
    // account isn't in.
    AppState.set("roomListCache", []);
    vi.mocked(findDmRoom).mockResolvedValue("!invited:x");
    vi.mocked(joinRoom).mockImplementation(async () => {
      vi.mocked(getRooms).mockResolvedValue([makeRoom("!invited:x")]);
      return "!invited:x";
    });

    await openOrCreateDm("@bob:x");

    expect(createRoom).not.toHaveBeenCalled();
    expect(joinRoom).toHaveBeenCalledWith("!invited:x");
    expect(AppState.get("roomListCache").map((r) => r.room_id)).toContain("!invited:x");
    expect(AppState.get("currentRoomId")).toBe("!invited:x");
    expect(_dmRoomByUser.get("@bob:x")).toBe("!invited:x");
  });

  it("reports a failed invite accept instead of opening a room it cannot read", async () => {
    AppState.set("roomListCache", []);
    vi.mocked(findDmRoom).mockResolvedValue("!invited:x");
    vi.mocked(joinRoom).mockRejectedValue(new Error("invite withdrawn"));

    await openOrCreateDm("@bob:x");

    expect(showError).toHaveBeenCalled();
    expect(createRoom).not.toHaveBeenCalled();
    expect(AppState.get("currentRoomId")).toBeNull();
  });

  it("finds a DM the other party has left, which has no members to scan", async () => {
    AppState.set("roomListCache", [makeRoom("!abandoned:x", { member_count: 1 })]);
    vi.mocked(findDmRoom).mockResolvedValue("!abandoned:x");

    await openOrCreateDm("@carol:x");

    expect(createRoom).not.toHaveBeenCalled();
    expect(_dmRoomByUser.get("@carol:x")).toBe("!abandoned:x");
  });

  it("creates a DM only when m.direct genuinely has none", async () => {
    vi.mocked(findDmRoom).mockResolvedValue(null);

    await openOrCreateDm("@dave:x");

    expect(createRoom).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createRoom).mock.calls[0][0]).toMatchObject({
      is_direct: true,
      invite: ["@dave:x"],
      enable_encryption: true,
    });
    expect(_dmRoomByUser.get("@dave:x")).toBe("!created:x");
  });

  it("uses the cached mapping without asking the backend again", async () => {
    _dmRoomByUser.set("@erin:x", "!erin-room:x");
    AppState.set("roomListCache", [makeRoom("!erin-room:x")]);

    await openOrCreateDm("@erin:x");

    expect(findDmRoom).not.toHaveBeenCalled();
    expect(createRoom).not.toHaveBeenCalled();
    expect(AppState.get("currentRoomId")).toBe("!erin-room:x");
  });

  it("surfaces a lookup failure instead of creating a duplicate room", async () => {
    vi.mocked(findDmRoom).mockRejectedValue(new Error("store unavailable"));

    await openOrCreateDm("@frank:x");

    expect(createRoom).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("store unavailable"));
  });
});
