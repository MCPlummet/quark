import { describe, it, expect, beforeEach, vi } from "vitest";

// #140: switching Room B then quickly back to Room A must not let B's late
// open-timeline result overwrite A's state.

vi.mock("../../ipc/index.js", () => ({
  markRoomRead: vi.fn().mockResolvedValue(undefined),
  openRoomTimeline: vi.fn(),
  getRoomMembers: vi.fn().mockResolvedValue([]),
  getRoomReceipts: vi.fn().mockResolvedValue([]),
  downloadMedia: vi.fn().mockResolvedValue({ mime_type: "image/png", data_base64: "" }),
  getTimeline: vi.fn(),
  loadOlderTimeline: vi.fn(),
  paginateForward: vi.fn(),
  getEventContext: vi.fn(),
  getRooms: vi.fn().mockResolvedValue([]),
  getSpaceChildren: vi.fn().mockResolvedValue([]),
  getUserSpaces: vi.fn().mockResolvedValue([]),
  joinRoom: vi.fn(),
  createRoom: vi.fn(),
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

import { selectRoom, appendRoomTimelineCache } from "./rooms.js";
import { setComponents, paginationState } from "./context.js";
import { AppState } from "../state.js";
import * as ipc from "../../ipc/index.js";
import type { AppComponents } from "../../ui/App.js";
import type { TimelineEvent } from "../../ipc/types.js";

function makeEvent(id: string): TimelineEvent {
  return {
    event_id: id, sender: "@a:x", body: "hi", formatted_body: null,
    timestamp: Date.now(), msg_type: "m.text", is_edit: false,
    relates_to_event_id: null, in_reply_to: null, thread_root: null,
    media_url: null, media_mimetype: null, media_width: null, media_height: null,
  };
}

function fakeComponents(setMessages: ReturnType<typeof vi.fn>): AppComponents {
  const stub = () => new Proxy({}, { get: () => vi.fn() });
  const typingIndicator = document.createElement("div");
  const txt = document.createElement("span");
  txt.className = "typing-indicator__text";
  typingIndicator.appendChild(txt);
  const timeline = new Proxy({}, {
    get: (_t, k) => (k === "setMessages" ? setMessages : vi.fn()),
  });
  return {
    roomList: stub(), roomHeader: stub(), timeline, memberList: stub(),
    statusBar: stub(), mobileTopBar: stub(), input: stub(), typingIndicator,
  } as unknown as AppComponents;
}

describe("selectRoom ignores a stale open result (#140)", () => {
  const setMessages = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    setComponents(fakeComponents(setMessages));
    AppState.patch({ roomListCache: [], currentRoomId: null, currentTimeline: [] });
  });

  it("B's late result does not overwrite A after switching B -> A", async () => {
    const open = ipc.openRoomTimeline as ReturnType<typeof vi.fn>;
    let releaseB: (v: unknown) => void = () => {};
    open.mockReturnValueOnce(new Promise((r) => { releaseB = r; })); // B: slow
    open.mockResolvedValueOnce({ events: [makeEvent("$a1")], reached_start: true }); // A

    const pendingB = selectRoom("!b:x");
    await selectRoom("!a:x");
    expect(AppState.get("currentRoomId")).toBe("!a:x");
    const callsBefore = setMessages.mock.calls.length;

    releaseB({ events: [makeEvent("$b1")], reached_start: false });
    await pendingB;

    expect(AppState.get("currentRoomId")).toBe("!a:x");
    expect(AppState.get("currentTimeline").map((e) => e.event_id)).toEqual(["$a1"]);
    expect(paginationState.reachedStart).toBe(true);
    expect(setMessages.mock.calls.length).toBe(callsBefore);
  });

  // Each test below uses rooms of its own: the per-room cache outlives a test.
  const open = () => ipc.openRoomTimeline as ReturnType<typeof vi.fn>;
  const page = (...ids: string[]) => ({ events: ids.map(makeEvent), reached_start: true });
  /** Make the next open's fetch hang until the returned function releases it. */
  function slowOpen(): (v: unknown) => void {
    let release: (v: unknown) => void = () => {};
    open().mockReturnValueOnce(new Promise((r) => { release = r; }));
    return (v) => release(v);
  }
  const ids = () => AppState.get("currentTimeline").map((e) => e.event_id);
  /** What a fresh open of `roomId` paints from the cache, before its fetch returns. */
  function instantPaint(roomId: string): string[] {
    slowOpen();
    void selectRoom(roomId);
    return ids();
  }

  it("a room's slow first open does not land on top of its second (D -> C -> D)", async () => {
    const releaseD1 = slowOpen();
    open().mockResolvedValueOnce(page("$c1")); // C
    open().mockResolvedValueOnce(page("$d2")); // D, second open

    const pendingD1 = selectRoom("!d:x");
    await selectRoom("!c:x");
    await selectRoom("!d:x");
    expect(ids()).toEqual(["$d2"]);
    const callsBefore = setMessages.mock.calls.length;

    releaseD1({ events: [makeEvent("$d1-old")], reached_start: false });
    await pendingD1;

    expect(AppState.get("currentRoomId")).toBe("!d:x");
    expect(ids()).toEqual(["$d2"]);
    expect(paginationState.reachedStart).toBe(true);
    expect(setMessages.mock.calls.length).toBe(callsBefore);
  });

  it("keeps a first-visit room's late page warm for its next open", async () => {
    const releaseE = slowOpen();
    open().mockResolvedValueOnce(page("$f1"));
    const pendingE = selectRoom("!e:x");
    await selectRoom("!f:x");
    releaseE(page("$e1"));
    await pendingE;

    expect(instantPaint("!e:x")).toEqual(["$e1"]);
  });

  it("never overwrites a room's cached page with a late one", async () => {
    open().mockResolvedValueOnce(page("$g1"));
    open().mockResolvedValueOnce(page("$h1"));
    await selectRoom("!g:x"); // cached: [$g1]
    await selectRoom("!h:x");
    const releaseG = slowOpen();
    const pendingG = selectRoom("!g:x");
    open().mockResolvedValueOnce(page("$h1"));
    await selectRoom("!h:x"); // G's second open is now stale
    // A live event for G lands in its cache while that fetch is still out…
    appendRoomTimelineCache("!g:x", makeEvent("$g2"));
    // …and the late page, read before it, comes back.
    releaseG(page("$g1"));
    await pendingG;

    expect(instantPaint("!g:x")).toEqual(["$g1", "$g2"]);
  });
});
