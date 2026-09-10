import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The backend has emitted quark://sync/unread_count for every synced message
// since the event was added, and nothing ever listened to it. The badge was
// drawn instead from a local "+1" that only ever counted up, so a mention
// arriving while the app was open did not light the mention badge until the
// next room-list refresh, and reading a room on another device never cleared
// this one's count.

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(event, (payload) => cb({ payload }));
    return () => {};
  }),
}));

vi.mock("./actions.js", async (importActual) => {
  const actual = await importActual<typeof import("./actions.js")>();
  return {
    ...actual,
    refreshRooms: vi.fn(),
    downloadSyncMessageImage: vi.fn(),
    ensureSenderAvatarDownloaded: vi.fn(),
    resolveInlineEmojiForTimeline: vi.fn(),
    reloadCurrentRoomTimeline: vi.fn(),
    refreshPinnedMessagesIfOpen: vi.fn(),
    appendRoomTimelineCache: vi.fn(),
    bumpRoomActivity: vi.fn(),
    homeViewHandleMessage: vi.fn(),
    homeViewHandlePresence: vi.fn(),
  };
});
vi.mock("../ui/NotificationToast.js", () => ({ showToast: vi.fn() }));
vi.mock("./notifications.js", () => ({ handleIncomingMessage: vi.fn() }));

import { startSync, stopSync } from "./sync.js";
import { AppState } from "./state.js";
import type { AppComponents } from "../ui/App.js";
import type { RoomInfo } from "../ipc/types.js";

const OPEN_ROOM = "!open:example.com";
const OTHER_ROOM = "!other:example.com";

const updateRoomBadge = vi.fn();

function makeComponents(): AppComponents {
  return {
    timeline: {
      appendMessage: vi.fn(),
      getMessageElementById: () => null,
      appendInlineReply: vi.fn(),
      incrementThreadReplyCount: vi.fn(),
      updateMessageBody: vi.fn(),
      updateMessageMedia: vi.fn(),
      updateInlineThreadMedia: vi.fn(),
    },
    roomList: { updateRoomBadge, setRooms: vi.fn() },
    statusBar: { setStatusMessage: vi.fn(), setConnected: vi.fn() },
    typingIndicator: document.createElement("div"),
  } as unknown as AppComponents;
}

function room(id: string, over: Partial<RoomInfo> = {}): RoomInfo {
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
    last_activity_ts: null,
    muted: false,
    ...over,
  } as RoomInfo;
}

function deliverUnread(roomId: string, unread: number, mentions: number): void {
  const handler = handlers.get("quark://sync/unread_count");
  if (!handler) throw new Error("unread listener not registered");
  handler({ room_id: roomId, unread_count: unread, notification_count: mentions });
}

const cached = (id: string): RoomInfo | undefined =>
  AppState.get("roomListCache").find((r) => r.room_id === id);

describe("sync applies the server's unread counts to the room list", () => {
  beforeEach(async () => {
    handlers.clear();
    updateRoomBadge.mockClear();
    AppState.set("currentRoomId", OPEN_ROOM);
    AppState.set("currentTimeline", []);
    AppState.set("roomListCache", [room(OPEN_ROOM), room(OTHER_ROOM)]);
    await startSync(makeComponents());
  });

  afterEach(() => {
    stopSync();
  });

  it("registers a listener for the event the backend was already emitting", () => {
    expect(handlers.has("quark://sync/unread_count")).toBe(true);
  });

  it("applies both counts to the cached room and redraws its badge", () => {
    deliverUnread(OTHER_ROOM, 5, 2);

    expect(cached(OTHER_ROOM)?.unread_count).toBe(5);
    expect(cached(OTHER_ROOM)?.notification_count).toBe(2);
    expect(updateRoomBadge).toHaveBeenCalledWith(OTHER_ROOM, 5, 2);
  });

  // The gap the local "+1" could not close: it only ever counted up, and it
  // never touched the mention count at all.
  it("lets a count fall when the room was read on another device", () => {
    AppState.set("roomListCache", [
      room(OPEN_ROOM),
      room(OTHER_ROOM, { unread_count: 9, notification_count: 3 }),
    ]);

    deliverUnread(OTHER_ROOM, 0, 0);

    expect(cached(OTHER_ROOM)?.unread_count).toBe(0);
    expect(cached(OTHER_ROOM)?.notification_count).toBe(0);
    expect(updateRoomBadge).toHaveBeenCalledWith(OTHER_ROOM, 0, 0);
  });

  // The open room clears its badge locally on open and only sends the read
  // receipt then, so the server's count for it keeps climbing while the user
  // sits reading. Honouring it would badge the room they are looking at.
  it("leaves the open room's badge alone", () => {
    deliverUnread(OPEN_ROOM, 4, 1);

    expect(cached(OPEN_ROOM)?.unread_count).toBe(0);
    expect(cached(OPEN_ROOM)?.notification_count).toBe(0);
    expect(updateRoomBadge).not.toHaveBeenCalled();
  });

  it("does not redraw when the counts are unchanged", () => {
    deliverUnread(OTHER_ROOM, 0, 0);
    expect(updateRoomBadge).not.toHaveBeenCalled();
  });

  it("ignores a room it has never cached", () => {
    deliverUnread("!unknown:example.com", 3, 1);
    expect(updateRoomBadge).not.toHaveBeenCalled();
    expect(AppState.get("roomListCache")).toHaveLength(2);
  });
});
