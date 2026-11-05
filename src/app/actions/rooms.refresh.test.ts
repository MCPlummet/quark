import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { RoomInfo, SpaceChild } from "../../ipc/types.js";

// refreshRooms is what `quark://sync/rooms` drives, so it is the path a room
// joined, left or moved from another client takes into the UI. Before #14 it
// re-rendered pseudo-spaces only: a real space kept showing its old rooms until
// it was re-selected, which read as "joining from another client does nothing".

vi.mock("../../ipc/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/index.js")>();
  return {
    ...actual,
    getRooms: vi.fn(async () => [] as RoomInfo[]),
    getUserSpaces: vi.fn(async () => [] as SpaceChild[]),
    getSpaceChildren: vi.fn(async () => [] as SpaceChild[]),
    getInvites: vi.fn(async () => []),
    reorderSpaceChildren: vi.fn(async () => 1),
  };
});
vi.mock("../../ui/NotificationToast.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/NotificationToast.js")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn(), showToast: vi.fn() };
});

const { refreshRooms } = await import("./rooms.js");
const { applySpaceOrder, moveRoomInSpace } = await import("./space_edit.js");
const { setComponents } = await import("./context.js");
const { AppState } = await import("../state.js");
const { RoomList } = await import("../../ui/RoomList.js");
const ipc = await import("../../ipc/index.js");
const { showError } = await import("../../ui/NotificationToast.js");

function room(id: string): RoomInfo {
  return {
    room_id: id, name: id.slice(1, id.indexOf(":")), topic: null, avatar_url: null,
    unread_count: 0, notification_count: 0, is_direct: false, is_encrypted: false, member_count: 3,
  };
}

function child(id: string, over: Partial<SpaceChild> = {}): SpaceChild {
  return { room_id: id, name: id, topic: null, avatar_url: null, is_space: false, member_count: 3, order: null, canonical_alias: null, ...over };
}

const SPACE = child("!work:x", { is_space: true, name: "Work" });

let roomList: InstanceType<typeof RoomList>;
const spaceStrip = { setSpaces: vi.fn(), setActiveSpace: vi.fn(), hasResolvedAvatar: () => true };
const listed = () =>
  Array.from(roomList.getElement().querySelectorAll<HTMLElement>(".room-list__item")).map((e) => e.dataset.roomId);

beforeEach(() => {
  vi.clearAllMocks();
  roomList = new RoomList();
  document.body.appendChild(roomList.getElement());
  const timeline = { setMessages: vi.fn() };
  const roomHeader = { setRoom: vi.fn() };
  const input = { setAttachmentRoom: vi.fn() };
  setComponents({ roomList, spaceStrip, timeline, roomHeader, input } as never);
  AppState.patch({ currentSpaceId: "!work:x", currentRoomId: null, homeViewActive: false, roomListCache: [] });
  vi.mocked(ipc.getUserSpaces).mockResolvedValue([SPACE]);
});

afterEach(() => roomList.getElement().remove());

describe("refreshRooms", () => {
  it("shows a room joined elsewhere in the space being viewed", async () => {
    vi.mocked(ipc.getRooms).mockResolvedValue([room("!a:x")]);
    vi.mocked(ipc.getSpaceChildren).mockResolvedValue([child("!a:x")]);
    await refreshRooms();
    expect(listed()).toEqual(["!a:x"]);

    // Joined from another client: the next sync's refresh picks it up.
    vi.mocked(ipc.getRooms).mockResolvedValue([room("!a:x"), room("!b:x")]);
    vi.mocked(ipc.getSpaceChildren).mockResolvedValue([child("!a:x"), child("!b:x")]);
    await refreshRooms();
    expect(listed()).toEqual(["!a:x", "!b:x"]);
  });

  it("lists only joined children, in the space's order", async () => {
    vi.mocked(ipc.getRooms).mockResolvedValue([room("!a:x"), room("!c:x")]);
    vi.mocked(ipc.getSpaceChildren).mockResolvedValue([child("!c:x"), child("!b:x"), child("!a:x")]);
    await refreshRooms();
    expect(listed()).toEqual(["!c:x", "!a:x"]);
  });

  it("clears the open room when it was left elsewhere", async () => {
    AppState.set("currentRoomId", "!gone:x");
    vi.mocked(ipc.getRooms).mockResolvedValue([room("!a:x")]);
    await refreshRooms();
    expect(AppState.get("currentRoomId")).toBeNull();
  });

  it("doesn't eject the user from a space joined a moment ago", async () => {
    // Created or accepted: joined, but sync hasn't delivered its m.room.create
    // yet, so get_user_spaces (which needs the room type) doesn't list it.
    AppState.set("currentSpaceId", "!fresh:x");
    vi.mocked(ipc.getUserSpaces).mockResolvedValue([SPACE]);
    vi.mocked(ipc.getRooms).mockResolvedValue([room("!fresh:x")]);
    await refreshRooms();
    expect(AppState.get("currentSpaceId")).toBe("!fresh:x");
  });

  it("returns to Home when the space being viewed was left elsewhere", async () => {
    AppState.set("currentSpaceId", "!gone:x");
    vi.mocked(ipc.getRooms).mockResolvedValue([room("!a:x")]);
    await refreshRooms();
    expect(AppState.get("currentSpaceId")).toBe("__home__");
  });

  it("coalesces overlapping calls into one follow-up run", async () => {
    let release!: () => void;
    vi.mocked(ipc.getRooms).mockImplementationOnce(
      () => new Promise<RoomInfo[]>((r) => { release = () => r([]); }),
    );
    const first = refreshRooms();
    const second = refreshRooms();
    const third = refreshRooms();
    expect(second).toBe(third);
    release();
    await Promise.all([first, second, third]);
    // The first run, and exactly one more for the two that arrived during it.
    expect(ipc.getRooms).toHaveBeenCalledTimes(2);
  });
});

describe("reordering a space", () => {
  beforeEach(async () => {
    vi.mocked(ipc.getRooms).mockResolvedValue([room("!a:x"), room("!b:x"), room("!c:x")]);
    vi.mocked(ipc.getSpaceChildren).mockResolvedValue([child("!a:x"), child("!b:x"), child("!c:x")]);
    await refreshRooms();
  });

  it("moves a room at once, then asks the server", async () => {
    await moveRoomInSpace("!c:x", -1);
    expect(listed()).toEqual(["!a:x", "!c:x", "!b:x"]);
    expect(ipc.reorderSpaceChildren).toHaveBeenCalledWith("!work:x", ["!a:x", "!c:x", "!b:x"]);
  });

  it("does nothing at the edge of the section", async () => {
    await moveRoomInSpace("!a:x", -1);
    expect(ipc.reorderSpaceChildren).not.toHaveBeenCalled();
  });

  it("puts the list back when the server refuses", async () => {
    vi.mocked(ipc.reorderSpaceChildren).mockRejectedValueOnce(new Error("M_FORBIDDEN"));
    await applySpaceOrder("!work:x", ["!b:x", "!a:x", "!c:x"], "!b:x");
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("M_FORBIDDEN"));
    expect(listed()).toEqual(["!a:x", "!b:x", "!c:x"]);
  });

  it("sends rapid moves one at a time, in order", async () => {
    const calls: string[][] = [];
    let release!: () => void;
    vi.mocked(ipc.reorderSpaceChildren)
      .mockImplementationOnce(async (_s, ids) => {
        calls.push(ids);
        await new Promise<void>((r) => { release = r; });
        return 1;
      })
      .mockImplementation(async (_s, ids) => { calls.push(ids); return 1; });
    const one = moveRoomInSpace("!c:x", -1);
    const two = moveRoomInSpace("!c:x", -1);
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    release();
    await Promise.all([one, two]);
    expect(calls).toEqual([["!a:x", "!c:x", "!b:x"], ["!c:x", "!a:x", "!b:x"]]);
  });

  it("refuses to reorder a pseudo-space", async () => {
    AppState.set("currentSpaceId", "__groups__");
    roomList.setRooms([{ id: "!a:x", name: "a" }]);
    await moveRoomInSpace("!a:x", 1);
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("inside a space"));
  });
});
