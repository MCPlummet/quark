import { describe, it, expect, beforeEach, vi } from "vitest";

// #106: replies whose original is outside the loaded window, and jumps to
// originals that the main timeline can't show.

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
  getEvent: vi.fn(),
  getRooms: vi.fn().mockResolvedValue([]),
  getSpaceChildren: vi.fn().mockResolvedValue([]),
  getUserSpaces: vi.fn().mockResolvedValue([]),
  joinRoom: vi.fn(),
  createRoom: vi.fn(),
}));
vi.mock("../mobile.js", () => ({ isMobile: () => false, closeDrawer: vi.fn() }));
vi.mock("./threads.js", () => ({ closeThread: vi.fn(), openThread: vi.fn().mockResolvedValue(undefined) }));
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

import { resolveReplyPreview, jumpToMessage } from "./rooms.js";
import { setComponents, _replyPreviewCache, _memberDisplayName } from "./context.js";
import { getEvent, getEventContext } from "../../ipc/index.js";
import { openThread } from "./threads.js";
import { showError } from "../../ui/NotificationToast.js";
import { AppState } from "../state.js";
import type { AppComponents } from "../../ui/App.js";
import type { TimelineEvent } from "../../ipc/types.js";

const updateReplyPreview = vi.fn();
const scrollToMessage = vi.fn().mockReturnValue(false);
const setMessages = vi.fn();

function fakeComponents(): AppComponents {
  const stub = () => new Proxy({}, { get: () => vi.fn() });
  const spies: Record<string, unknown> = { updateReplyPreview, scrollToMessage, setMessages };
  const timeline = new Proxy({}, { get: (_t, prop) => spies[prop as string] ?? vi.fn() });
  return {
    roomList: stub(), roomHeader: stub(), timeline,
    memberList: stub(), statusBar: stub(), mobileTopBar: stub(),
    input: stub(), typingIndicator: document.createElement("div"),
  } as unknown as AppComponents;
}

function makeEvent(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    event_id: "$e", sender: "@alice:x", body: "hi", formatted_body: null,
    timestamp: 1000, msg_type: "m.text", is_edit: false, relates_to_event_id: null,
    in_reply_to: null, thread_root: null, media_url: null, media_mimetype: null,
    media_width: null, media_height: null,
    ...over,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  scrollToMessage.mockReturnValue(false);
  _replyPreviewCache.clear();
  _memberDisplayName.clear();
  setComponents(fakeComponents());
  AppState.patch({ currentRoomId: "!r:x", currentTimeline: [] });
});

describe("resolveReplyPreview", () => {
  it("fetches an unloaded original and updates the preview", async () => {
    _memberDisplayName.set("@alice:x", "Alice");
    vi.mocked(getEvent).mockResolvedValue(makeEvent({ event_id: "$old", body: "long ago" }));

    resolveReplyPreview("$old");
    await flush();

    expect(getEvent).toHaveBeenCalledWith("!r:x", "$old");
    expect(updateReplyPreview).toHaveBeenCalledWith("$old", {
      eventId: "$old", senderName: "Alice", body: "long ago",
    });
    expect(_replyPreviewCache.has("$old")).toBe(true);
  });

  it("fetches once for a burst of replies to the same original", async () => {
    vi.mocked(getEvent).mockResolvedValue(makeEvent({ event_id: "$old" }));
    resolveReplyPreview("$old");
    resolveReplyPreview("$old");
    resolveReplyPreview("$old");
    await flush();
    expect(getEvent).toHaveBeenCalledTimes(1);
  });

  it("uses the loaded buffer when the original has since been paged in", async () => {
    AppState.set("currentTimeline", [makeEvent({ event_id: "$old", body: "paged in" })]);
    resolveReplyPreview("$old");
    expect(getEvent).not.toHaveBeenCalled();
    expect(updateReplyPreview).toHaveBeenCalledWith("$old", expect.objectContaining({ body: "paged in" }));
  });

  it("marks the preview unavailable when the event isn't a message", async () => {
    vi.mocked(getEvent).mockResolvedValue(null);
    resolveReplyPreview("$gone");
    await flush();
    expect(updateReplyPreview).toHaveBeenCalledWith("$gone", expect.objectContaining({ state: "unavailable" }));
  });

  it("does not cache a fetch failure, so a later render retries", async () => {
    vi.mocked(getEvent).mockRejectedValue(new Error("offline"));
    resolveReplyPreview("$old");
    await flush();
    expect(updateReplyPreview).toHaveBeenCalledWith("$old", expect.objectContaining({ state: "unavailable" }));
    expect(_replyPreviewCache.has("$old")).toBe(false);
  });

  it("does not cache an undecryptable original", async () => {
    vi.mocked(getEvent).mockResolvedValue(makeEvent({ event_id: "$utd", msg_type: "m.room.encrypted" }));
    resolveReplyPreview("$utd");
    await flush();
    expect(_replyPreviewCache.has("$utd")).toBe(false);
  });
});

describe("jumpToMessage", () => {
  it("opens the thread when the target is a loaded thread reply", async () => {
    AppState.set("currentTimeline", [makeEvent({ event_id: "$t", thread_root: "$root" })]);
    await jumpToMessage("$t");
    expect(openThread).toHaveBeenCalledWith("$root");
    expect(getEventContext).not.toHaveBeenCalled();
  });

  it("opens the thread when the fetched target is a thread reply", async () => {
    vi.mocked(getEventContext).mockResolvedValue({
      events: [makeEvent({ event_id: "$t", thread_root: "$root" })],
      target_event_id: "$t", prev_batch: null, next_batch: null,
    });
    await jumpToMessage("$t");
    expect(openThread).toHaveBeenCalledWith("$root");
    expect(setMessages).not.toHaveBeenCalled();
  });

  it("says so, and stays put, when the target isn't a renderable message", async () => {
    vi.mocked(getEventContext).mockResolvedValue({
      events: [makeEvent({ event_id: "$other" })],
      target_event_id: "$redacted", prev_batch: null, next_batch: null,
    });
    await jumpToMessage("$redacted");
    expect(showError).toHaveBeenCalled();
    expect(setMessages).not.toHaveBeenCalled();
  });
});
