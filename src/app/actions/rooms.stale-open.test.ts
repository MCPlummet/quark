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

import { selectRoom } from "./rooms.js";
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
});
