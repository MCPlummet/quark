import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Regression tests for #41 and its bug class — a live-tail message rendering
// with fewer fields than the same message after a room reload.
//
// Root cause: sending media has no local echo, so the sent event paints when its
// own sync echo arrives. That live-tail path used a private copy of
// timelineEventToMessage inside sync.ts which had drifted from the shared mapper
// in actions/context.ts that the room-load path uses — it dropped `caption`
// (the reported bug), the image dimensions, the video thumbnail and `isOwn`.
// sync.ts now maps through the shared converters, and these tests pin that.

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(event, (payload) => cb({ payload }));
    return () => {};
  }),
}));

// Partial mock (see Timeline.links.test.ts): the real actions module is loaded so the
// mapper under test is the real, shared one — only the network/IPC-touching
// helpers sync.ts calls after appending are stubbed out. Hand-enumerating every
// export here is what previously made an unrelated new import break this file.
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
import { _ownSentEventIds } from "./actions/context.js";
import type { AppComponents } from "../ui/App.js";
import type { TimelineEvent } from "../ipc/types.js";
import type { MessageData } from "../ui/Timeline.js";
import type { ThreadMessageData } from "../ui/ThreadView.js";

const ROOM = "!room:example.com";
const ME = "@me:example.com";

const appendMessage = vi.fn();
const appendInlineReply = vi.fn();
const incrementThreadReplyCount = vi.fn();

function makeComponents(): AppComponents {
  return {
    timeline: {
      appendMessage,
      getMessageElementById: () => null,
      appendInlineReply,
      incrementThreadReplyCount,
      updateMessageBody: vi.fn(),
      updateMessageMedia: vi.fn(),
      updateInlineThreadMedia: vi.fn(),
    },
    roomList: { updateRoomBadge: vi.fn(), setRooms: vi.fn() },
    statusBar: { setStatusMessage: vi.fn(), setConnected: vi.fn() },
    typingIndicator: document.createElement("div"),
  } as unknown as AppComponents;
}

function makeEvent(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    event_id: "$e:example.com",
    sender: ME,
    body: "hi",
    formatted_body: null,
    timestamp: Date.now(),
    msg_type: "m.text",
    is_edit: false,
    relates_to_event_id: null,
    in_reply_to: null,
    thread_root: null,
    media_url: null,
    media_mimetype: null,
    media_width: null,
    media_height: null,
    ...over,
  };
}

/** An m.image event as it arrives over sync (MSC2530: body carries the caption). */
function imageEvent(caption: string | null, over: Partial<TimelineEvent> = {}): TimelineEvent {
  return makeEvent({
    event_id: "$img:example.com",
    body: caption ?? "cat.png",
    msg_type: "m.image",
    media_url: "mxc://example.com/abc",
    media_mimetype: "image/png",
    media_width: 800,
    media_height: 600,
    caption,
    ...over,
  });
}

/** Deliver an event on quark://sync/message. */
function deliver(event: TimelineEvent): void {
  const handler = handlers.get("quark://sync/message");
  if (!handler) throw new Error("sync message listener not registered");
  handler({ room_id: ROOM, event });
}

/** Deliver an event and return the MessageData handed to the timeline. */
function deliverToTimeline(event: TimelineEvent): MessageData {
  deliver(event);
  expect(appendMessage).toHaveBeenCalledTimes(1);
  return appendMessage.mock.calls[0][0] as MessageData;
}

describe("sync live-tail messages use the shared mapper", () => {
  beforeEach(async () => {
    handlers.clear();
    appendMessage.mockClear();
    appendInlineReply.mockClear();
    incrementThreadReplyCount.mockClear();
    _ownSentEventIds.clear();
    AppState.set("currentRoomId", ROOM);
    AppState.set("currentTimeline", []);
    AppState.set("roomListCache", []);
    AppState.set("threadRootEventId", null);
    AppState.set("ownUserId", ME);
    await startSync(makeComponents());
  });

  afterEach(() => {
    stopSync();
  });

  it("shows the caption on an image that arrives over sync (#41)", () => {
    const msg = deliverToTimeline(imageEvent("look at this cat"));
    expect(msg.type).toBe("image");
    expect(msg.caption).toBe("look at this cat");
  });

  it("leaves the caption unset for an uncaptioned image", () => {
    const msg = deliverToTimeline(imageEvent(null));
    expect(msg.type).toBe("image");
    expect(msg.caption).toBeUndefined();
  });

  it("carries the image dimensions so the live tail can pre-size the image", () => {
    const msg = deliverToTimeline(imageEvent("look at this cat"));
    expect(msg.mediaWidth).toBe(800);
    expect(msg.mediaHeight).toBe(600);
  });

  it("marks an own-sent image as own so it gets own-sender styling immediately", () => {
    const msg = deliverToTimeline(imageEvent(null));
    expect(msg.isOwn).toBe(true);
  });

  it("does not mark another user's message as own", () => {
    const msg = deliverToTimeline(imageEvent(null, { sender: "@bob:example.com" }));
    expect(msg.isOwn).toBe(false);
  });

  it("carries the video thumbnail so the live tail renders a poster", () => {
    const msg = deliverToTimeline(
      makeEvent({
        event_id: "$vid:example.com",
        body: "clip.mp4",
        msg_type: "m.video",
        media_url: "mxc://example.com/vid",
        media_mimetype: "video/mp4",
        media_thumbnail_url: "mxc://example.com/thumb",
        media_thumbnail_encryption_info: '{"key":"k"}',
      }),
    );
    expect(msg.type).toBe("video");
    expect(msg.mediaThumbnailUrl).toBe("mxc://example.com/thumb");
    expect(msg.mediaThumbnailEncryptionInfo).toBe('{"key":"k"}');
  });

  it("resolves the reply preview against the current timeline", () => {
    const parent = makeEvent({ event_id: "$parent:example.com", sender: "@bob:example.com", body: "the question" });
    AppState.set("currentTimeline", [parent]);
    const msg = deliverToTimeline(
      makeEvent({ event_id: "$reply:example.com", body: "the answer", in_reply_to: "$parent:example.com" }),
    );
    expect(msg.replyTo).toEqual({
      eventId: "$parent:example.com",
      senderName: "@bob:example.com",
      body: "the question",
    });
  });

  it("still suppresses the echo of a message this client sent (dedup)", () => {
    _ownSentEventIds.add("$img:example.com");
    deliver(imageEvent("look at this cat"));
    expect(appendMessage).not.toHaveBeenCalled();
  });
});

describe("sync live-tail thread replies", () => {
  const THREAD_ROOT = "$root:example.com";

  beforeEach(async () => {
    handlers.clear();
    appendMessage.mockClear();
    appendInlineReply.mockClear();
    incrementThreadReplyCount.mockClear();
    _ownSentEventIds.clear();
    AppState.set("currentRoomId", ROOM);
    AppState.set("currentTimeline", []);
    AppState.set("roomListCache", []);
    AppState.set("threadRootEventId", THREAD_ROOT);
    AppState.set("ownUserId", ME);
    await startSync(makeComponents());
  });

  afterEach(() => {
    stopSync();
  });

  it("forwards media fields for an image sent into the open thread", () => {
    deliver(imageEvent("look at this cat", {
      thread_root: THREAD_ROOT,
      media_encryption_info: '{"key":"k"}',
    }));

    expect(appendMessage).not.toHaveBeenCalled();
    expect(appendInlineReply).toHaveBeenCalledTimes(1);
    const reply = appendInlineReply.mock.calls[0][0] as ThreadMessageData;
    expect(reply).toMatchObject({
      id: "$img:example.com",
      type: "image",
      mediaUrl: "mxc://example.com/abc",
      mediaMimeType: "image/png",
      mediaEncryptionInfo: '{"key":"k"}',
      isOwn: true,
    });
    expect(incrementThreadReplyCount).toHaveBeenCalledWith(THREAD_ROOT);
  });

  it("forwards the thumbnail for a video sent into the open thread", () => {
    deliver(makeEvent({
      event_id: "$vid:example.com",
      body: "clip.mp4",
      msg_type: "m.video",
      thread_root: THREAD_ROOT,
      sender: "@bob:example.com",
      media_url: "mxc://example.com/vid",
      media_mimetype: "video/mp4",
      media_thumbnail_url: "mxc://example.com/thumb",
    }));

    const reply = appendInlineReply.mock.calls[0][0] as ThreadMessageData;
    expect(reply).toMatchObject({
      type: "video",
      mediaThumbnailUrl: "mxc://example.com/thumb",
      isOwn: false,
    });
  });

  it("only counts a reply belonging to another thread", () => {
    deliver(makeEvent({ event_id: "$other:example.com", thread_root: "$another:example.com" }));
    expect(appendInlineReply).not.toHaveBeenCalled();
    expect(incrementThreadReplyCount).toHaveBeenCalledWith("$another:example.com");
  });
});
