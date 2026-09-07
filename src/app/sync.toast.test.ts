import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A live message reaches the user one of two ways: it is painted into something
// on screen, or it is announced by a toast. sync.ts decides which, and the
// decision used to be made on the wrong question — "is this message's room
// open?" rather than "is this message being drawn?".
//
// Those come apart for a thread reply. Thread replies are never appended to the
// main timeline (they belong to the panel), so with the panel closed the room
// is open, the reply is drawn nowhere, and suppressing the toast on the
// strength of the open room dropped the message entirely.

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
    isInContextView: vi.fn(() => false),
  };
});
vi.mock("../ui/NotificationToast.js", () => ({ showToast: vi.fn() }));

const handleIncomingMessage = vi.fn();
vi.mock("./notifications.js", () => ({
  handleIncomingMessage: (...args: unknown[]) => handleIncomingMessage(...args),
}));

import { startSync, stopSync } from "./sync.js";
import { AppState } from "./state.js";
import { _ownSentEventIds } from "./actions/context.js";
import { isInContextView } from "./actions.js";
import type { AppComponents } from "../ui/App.js";
import type { TimelineEvent } from "../ipc/types.js";

const ROOM = "!room:example.com";
const OTHER_ROOM = "!other:example.com";
const ME = "@me:example.com";
const ALICE = "@alice:example.com";
const THREAD = "$root:example.com";

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
    sender: ALICE,
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

function deliver(event: TimelineEvent, roomId = ROOM): void {
  const handler = handlers.get("quark://sync/message");
  if (!handler) throw new Error("sync message listener not registered");
  handler({ room_id: roomId, event });
}

/** Whether sync.ts told the notification layer this message was drawn. */
function reportedAsRendered(): boolean {
  expect(handleIncomingMessage).toHaveBeenCalledTimes(1);
  return (handleIncomingMessage.mock.calls[0][0] as { isRendered: boolean }).isRendered;
}

describe("sync tells the toast layer whether the message was actually drawn", () => {
  beforeEach(async () => {
    handlers.clear();
    appendMessage.mockClear();
    appendInlineReply.mockClear();
    incrementThreadReplyCount.mockClear();
    handleIncomingMessage.mockClear();
    vi.mocked(isInContextView).mockReturnValue(false);
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

  it("reports an ordinary message in the open room as drawn", () => {
    deliver(makeEvent());
    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(reportedAsRendered()).toBe(true);
  });

  it("reports a message in another room as not drawn", () => {
    deliver(makeEvent(), OTHER_ROOM);
    expect(appendMessage).not.toHaveBeenCalled();
    expect(reportedAsRendered()).toBe(false);
  });

  // The regression this file exists for: the reply is not in the main timeline
  // and not in the (closed) panel, so the toast is the only thing left.
  it("reports a thread reply as not drawn when the thread panel is closed", () => {
    AppState.set("threadRootEventId", null);
    deliver(makeEvent({ thread_root: THREAD }));

    expect(appendMessage).not.toHaveBeenCalled();
    expect(appendInlineReply).not.toHaveBeenCalled();
    expect(incrementThreadReplyCount).toHaveBeenCalledWith(THREAD);
    expect(reportedAsRendered()).toBe(false);
  });

  it("reports a thread reply as not drawn when a different thread is open", () => {
    AppState.set("threadRootEventId", "$some-other-root:example.com");
    deliver(makeEvent({ thread_root: THREAD }));

    expect(appendInlineReply).not.toHaveBeenCalled();
    expect(reportedAsRendered()).toBe(false);
  });

  it("reports a thread reply as drawn when its own thread panel is open", () => {
    AppState.set("threadRootEventId", THREAD);
    deliver(makeEvent({ thread_root: THREAD }));

    expect(appendInlineReply).toHaveBeenCalledTimes(1);
    expect(reportedAsRendered()).toBe(true);
  });

  // #89: context view keeps the room open while the live tail is not rendered.
  it("reports a message as not drawn in context view", () => {
    vi.mocked(isInContextView).mockReturnValue(true);
    deliver(makeEvent());

    expect(appendMessage).not.toHaveBeenCalled();
    expect(reportedAsRendered()).toBe(false);
  });
});
