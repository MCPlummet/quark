import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppComponents } from "../../ui/App.js";
import type { TimelineEvent } from "../../ipc/types.js";

// #112: an attachment's own event is painted from the send's result, then its
// sync echo arrives through the same render path. The pair must produce one
// message on screen, in the right room, and nothing in a room not being shown.

vi.mock("./context.js", async (importActual) => ({
  ...(await importActual<typeof import("./context.js")>()),
  downloadSyncMessageImage: vi.fn(),
  ensureSenderAvatarDownloaded: vi.fn(),
  resolveInlineEmojiForTimeline: vi.fn(),
}));
const appendRoomTimelineCache = vi.fn();
const bumpRoomActivity = vi.fn();
vi.mock("./rooms.js", () => ({
  appendRoomTimelineCache: (...a: unknown[]) => appendRoomTimelineCache(...a),
  bumpRoomActivity: (...a: unknown[]) => bumpRoomActivity(...a),
}));
vi.mock("./home.js", () => ({ homeViewHandleMessage: vi.fn() }));

import { showSentEvent, renderLiveEvent } from "./live.js";
import { getComponents, setComponents, setContextView } from "./context.js";
import { AppState } from "../state.js";

const ROOM = "!room:x";
const appendMessage = vi.fn();
const appendInlineReply = vi.fn();
const incrementThreadReplyCount = vi.fn();
// The DOM as the timeline would report it: whatever has been appended.
const rendered = new Set<string>();

function makeTimeline() {
  return {
    appendMessage: (msg: { id: string }) => {
      rendered.add(msg.id);
      appendMessage(msg);
    },
    getMessageElementById: (id: string) => (rendered.has(id) ? ({} as HTMLElement) : null),
    appendInlineReply,
    incrementThreadReplyCount,
    updateMessageBody: vi.fn(),
    updateMessageMedia: vi.fn(),
    updateInlineThreadMedia: vi.fn(),
  };
}

function image(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    event_id: "$img:x",
    sender: "@me:x",
    body: "cat.png",
    formatted_body: null,
    timestamp: 1_700_000_000_000,
    msg_type: "m.image",
    is_edit: false,
    relates_to_event_id: null,
    in_reply_to: null,
    thread_root: null,
    media_url: "mxc://x/cat",
    media_mimetype: "image/png",
    media_width: null,
    media_height: null,
    ...over,
  } as TimelineEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  rendered.clear();
  setComponents({ timeline: makeTimeline() } as unknown as AppComponents);
  AppState.patch({
    currentRoomId: ROOM,
    threadRootEventId: null,
    currentTimeline: [],
    ownUserId: "@me:x",
  });
  setContextView(false);
});

describe("showSentEvent (#112)", () => {
  it("paints a sent image into the open room straight away", () => {
    showSentEvent(ROOM, image());

    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(appendMessage.mock.calls[0][0]).toMatchObject({ id: "$img:x", isOwn: true });
    expect(AppState.get("currentTimeline").map((e) => e.event_id)).toEqual(["$img:x"]);
  });

  it("is not painted a second time when its sync echo arrives", () => {
    showSentEvent(ROOM, image());
    renderLiveEvent(image(), getComponents().timeline);

    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(AppState.get("currentTimeline")).toHaveLength(1);
  });

  it("is not painted a second time when sync got there first", () => {
    renderLiveEvent(image(), getComponents().timeline);
    showSentEvent(ROOM, image());

    expect(appendMessage).toHaveBeenCalledTimes(1);
  });

  it("still records the event for a room the user has since left", () => {
    // The room's cache and recency must learn about it; its timeline is not on
    // screen, so nothing is painted into whatever room is.
    AppState.set("currentRoomId", "!other:x");

    showSentEvent(ROOM, image());

    expect(appendMessage).not.toHaveBeenCalled();
    expect(appendRoomTimelineCache).toHaveBeenCalledWith(ROOM, expect.objectContaining({ event_id: "$img:x" }));
    expect(bumpRoomActivity).toHaveBeenCalledWith(ROOM, 1_700_000_000_000);
  });

  it("does not paint into a room showing context view", () => {
    setContextView(true);
    showSentEvent(ROOM, image());
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("routes a sent thread reply into its open thread panel, not the main timeline", () => {
    AppState.set("threadRootEventId", "$root:x");

    showSentEvent(ROOM, image({ thread_root: "$root:x" }));

    expect(appendMessage).not.toHaveBeenCalled();
    expect(appendInlineReply).toHaveBeenCalledTimes(1);
    expect(incrementThreadReplyCount).toHaveBeenCalledWith("$root:x");
  });
});
