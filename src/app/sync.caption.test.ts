import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Regression test for #41 — an image caption only showed up after a reload.
//
// Bug: sending an image has no local echo, so the sent event paints when its own
// sync echo arrives (image sends aren't registered in _ownSentEventIds either).
// That live-tail path used sync.ts's private copy of timelineEventToMessage,
// which never mapped `caption` — unlike the shared mapper in actions/context.ts
// that the room-load path uses. So the image rendered bare until the room was
// reloaded, at which point the caption appeared.

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(event, (payload) => cb({ payload }));
    return () => {};
  }),
}));

vi.mock("./actions.js", () => ({
  refreshRooms: vi.fn(),
  selectRoom: vi.fn(),
  resolveDisplayName: (id: string) => id,
  consumeOwnSentEvent: () => false,
  applyIncomingReaction: vi.fn(),
  resolveInlineEmojiForTimeline: vi.fn(),
  handleIncomingVerificationRequest: vi.fn(),
  downloadSyncMessageImage: vi.fn(),
  resolveSenderAvatarUrl: () => undefined,
  ensureSenderAvatarDownloaded: vi.fn(),
  applyIncomingRedaction: vi.fn(),
  stripReplyFallback: (body: string, htmlBody?: string) => ({ body, htmlBody }),
  isInContextView: () => false,
  reloadCurrentRoomTimeline: vi.fn(),
  refreshPinnedMessagesIfOpen: vi.fn(),
  appendRoomTimelineCache: vi.fn(),
  bumpRoomActivity: vi.fn(),
  homeViewHandleMessage: vi.fn(),
  homeViewHandlePresence: vi.fn(),
}));
vi.mock("../ui/NotificationToast.js", () => ({ showToast: vi.fn() }));
vi.mock("./notifications.js", () => ({ handleIncomingMessage: vi.fn() }));

import { startSync, stopSync } from "./sync.js";
import { AppState } from "./state.js";
import type { AppComponents } from "../ui/App.js";
import type { TimelineEvent } from "../ipc/types.js";
import type { MessageData } from "../ui/Timeline.js";

const ROOM = "!room:example.com";

const appendMessage = vi.fn();

function makeComponents(): AppComponents {
  return {
    timeline: {
      appendMessage,
      getMessageElementById: () => null,
      appendInlineReply: vi.fn(),
      incrementThreadReplyCount: vi.fn(),
      updateMessageBody: vi.fn(),
      updateMessageMedia: vi.fn(),
    },
    roomList: { updateRoomBadge: vi.fn(), setRooms: vi.fn() },
    statusBar: { setStatusMessage: vi.fn(), setConnected: vi.fn() },
    typingIndicator: document.createElement("div"),
  } as unknown as AppComponents;
}

/** An m.image event as it arrives over sync (MSC2530: body carries the caption). */
function imageEvent(caption: string | null): TimelineEvent {
  return {
    event_id: "$img:example.com",
    sender: "@me:example.com",
    body: caption ?? "cat.png",
    formatted_body: null,
    timestamp: Date.now(),
    msg_type: "m.image",
    is_edit: false,
    relates_to_event_id: null,
    in_reply_to: null,
    thread_root: null,
    media_url: "mxc://example.com/abc",
    media_mimetype: "image/png",
    media_width: 800,
    media_height: 600,
    caption,
  };
}

/** Deliver an event on quark://sync/message and return the appended message. */
function deliver(event: TimelineEvent): MessageData {
  const handler = handlers.get("quark://sync/message");
  if (!handler) throw new Error("sync message listener not registered");
  handler({ room_id: ROOM, event });
  expect(appendMessage).toHaveBeenCalledTimes(1);
  return appendMessage.mock.calls[0][0] as MessageData;
}

describe("sync live-tail image messages", () => {
  beforeEach(async () => {
    handlers.clear();
    appendMessage.mockClear();
    AppState.set("currentRoomId", ROOM);
    AppState.set("currentTimeline", []);
    AppState.set("roomListCache", []);
    AppState.set("threadRootEventId", null);
    await startSync(makeComponents());
  });

  afterEach(() => {
    stopSync();
  });

  it("shows the caption on an image that arrives over sync (#41)", () => {
    const msg = deliver(imageEvent("look at this cat"));
    expect(msg.type).toBe("image");
    expect(msg.caption).toBe("look at this cat");
  });

  it("leaves the caption unset for an uncaptioned image", () => {
    const msg = deliver(imageEvent(null));
    expect(msg.type).toBe("image");
    expect(msg.caption).toBeUndefined();
  });
});
