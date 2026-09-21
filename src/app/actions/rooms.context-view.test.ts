import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression: switching rooms while in context view left the timeline believing
// it was still there.
//
// `paginationState.inContextView` and the timeline's own `_inContextView` were
// independent fields. Four places reset the former; selectRoom was the one that
// forgot `timeline.setContextView(false)`. So after jumping to a message (a
// search hit, a pinned message, a notification) and then switching rooms, the
// new room's timeline still read `_inContextView === true`, which:
//
//   • pinned the jump-to-latest button on — and made it undismissable, since
//     clicking it recomputed `_inContextView || _scrolledUp` back to true; and
//   • fired forward-pagination fetches on scroll-to-bottom for a room that had
//     never been in a context window.
//
// The field is gone now; setContextView drives both. This pins the behaviour.

vi.mock("../../ipc/index.js", () => ({
  markRoomRead: vi.fn().mockResolvedValue(undefined),
  openRoomTimeline: vi.fn().mockResolvedValue({ events: [], reached_start: true }),
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
import { setComponents, setContextView, isInContextView } from "./context.js";
import { AppState } from "../state.js";
import type { AppComponents } from "../../ui/App.js";

/** Stable spy for setContextView; everything else is a throwaway no-op. */
const timelineSetContextView = vi.fn();

function fakeComponents(): AppComponents {
  const stub = () => new Proxy({}, { get: () => vi.fn() });
  const typingIndicator = document.createElement("div");
  const txt = document.createElement("span");
  txt.className = "typing-indicator__text";
  typingIndicator.appendChild(txt);
  const timeline = new Proxy({}, {
    get: (_t, prop) => (prop === "setContextView" ? timelineSetContextView : vi.fn()),
  });
  return {
    roomList: stub(), roomHeader: stub(), timeline,
    memberList: stub(), statusBar: stub(), mobileTopBar: stub(),
    input: stub(), typingIndicator,
  } as unknown as AppComponents;
}

beforeEach(() => {
  vi.clearAllMocks();
  timelineSetContextView.mockClear();
  setComponents(fakeComponents());
  AppState.patch({
    roomListCache: [{
      room_id: "!r:x", name: "Room", topic: null, avatar_url: null,
      unread_count: 0, notification_count: 0, is_direct: false,
      is_encrypted: false, member_count: 2,
    }],
    currentRoomId: null,
    currentTimeline: [],
  });
});

describe("selectRoom leaves context view", () => {
  it("tells the timeline, not just the pagination state", async () => {
    // Stand in for a jump-to-message: the user is reading a context window.
    setContextView(true);
    expect(isInContextView()).toBe(true);
    timelineSetContextView.mockClear();

    await selectRoom("!r:x");

    expect(isInContextView()).toBe(false);
    expect(timelineSetContextView).toHaveBeenCalledWith(false);
  });

  it("leaves the timeline out of context view on an ordinary room open", async () => {
    await selectRoom("!r:x");
    expect(isInContextView()).toBe(false);
    expect(timelineSetContextView).toHaveBeenLastCalledWith(false);
  });
});
