import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression test for the live-message drop on a cached-room revisit.
//
// Bug: selectRoom's instant cache paint set `currentTimeline` to the *same array
// object* held in the per-room timeline cache. The sync handler's
// appendRoomTimelineCache() pushes each live event into that cache array before
// its dedup check reads `currentTimeline` — so a message arriving in the brief
// window after opening a revisited room was seen as "already in state" and never
// rendered (it only reappeared on re-entry). The fix copies the cache array into
// `currentTimeline` so the two never alias.

vi.mock("../../ipc/index.js", () => ({
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
  createRoom: vi.fn(),
}));
vi.mock("../mobile.js", () => ({ isMobile: () => false, closeDrawer: vi.fn() }));
vi.mock("./threads.js", () => ({ closeThread: vi.fn() }));
vi.mock("./messages.js", () => ({ cancelReply: vi.fn(), cancelEdit: vi.fn() }));
vi.mock("./dialogs.js", () => ({ openRoomSettings: vi.fn() }));
vi.mock("./profile.js", () => ({ openProfileForUser: vi.fn() }));
vi.mock("../../ui/NotificationToast.js", () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
// Keep context.js real (selectRoom relies on its paginationState, getComponents,
// timelineEventToMessage, …) but neutralize the media/emoji download helpers,
// which would otherwise call methods on the stubbed timeline component.
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
import { setComponents } from "./context.js";
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

function fakeComponents(): AppComponents {
  // Any method access on these components returns a fresh no-op spy.
  const stub = () => new Proxy({}, { get: () => vi.fn() });
  // typingIndicator is queried/mutated as a real element by selectRoom.
  const typingIndicator = document.createElement("div");
  const txt = document.createElement("span");
  txt.className = "typing-indicator__text";
  typingIndicator.appendChild(txt);
  return {
    roomList: stub(), roomHeader: stub(), timeline: stub(),
    memberList: stub(), statusBar: stub(), mobileTopBar: stub(),
    input: stub(), typingIndicator,
  } as unknown as AppComponents;
}

describe("selectRoom cache paint does not alias currentTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("a live event appended to the cache after a revisit paint is not deduped out of currentTimeline", async () => {
    const initial = [makeEvent("$1"), makeEvent("$2")];

    // First open: no cache yet, so the authoritative fetch populates the per-room cache.
    (ipc.openRoomTimeline as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ events: initial, reached_start: true });
    await selectRoom("!r:x");

    // Revisit: hang the authoritative fetch so we can inspect state immediately
    // after the synchronous instant cache paint, before reconciliation runs.
    let release: (v: unknown) => void = () => {};
    (ipc.openRoomTimeline as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((r) => { release = r; })
    );
    const pending = selectRoom("!r:x"); // runs the instant paint, then suspends at the fetch await

    // A live message lands and is appended to the room's cached tail.
    appendRoomTimelineCache("!r:x", makeEvent("$live"));

    const ct = AppState.get("currentTimeline");
    // Fixed: currentTimeline is a copy, so the cache push is NOT reflected here —
    // the sync handler's dedup would treat $live as new and render it.
    // (Pre-fix: aliased, so $live would already be present → silently dropped.)
    expect(ct.some((e) => e.event_id === "$live")).toBe(false);
    expect(ct.map((e) => e.event_id)).toEqual(["$1", "$2"]);

    release({ events: initial, reached_start: true });
    await pending;
  });
});
