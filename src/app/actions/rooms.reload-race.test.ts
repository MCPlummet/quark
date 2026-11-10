import { describe, it, expect, beforeEach, vi } from "vitest";

// #143: a send landing while reloadCurrentRoomTimeline's fetch is in flight
// must survive the rebuild.

vi.mock("../../ipc/index.js", () => ({
  markRoomRead: vi.fn().mockResolvedValue(undefined),
  openRoomTimeline: vi.fn(),
  getRoomMembers: vi.fn().mockResolvedValue([]),
  getRoomReceipts: vi.fn().mockResolvedValue([]),
  downloadMedia: vi.fn(),
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
vi.mock("./threads.js", () => ({ closeThread: vi.fn(), openThreadEvents: () => [], applyEditToOpenThread: vi.fn() }));
vi.mock("./home.js", () => ({ homeViewHandleMessage: vi.fn() }));
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
    downloadSyncMessageImage: vi.fn(),
    ensureSenderAvatarDownloaded: vi.fn(),
    resolveInlineEmojiForTimeline: vi.fn(),
  };
});

import { reloadCurrentRoomTimeline } from "./rooms.js";
import { renderLiveEvent } from "./live.js";
import { setComponents, timelineEventToMessage, _ownSentEventIds } from "./context.js";
import { Timeline } from "../../ui/Timeline.js";
import type { ThreadView } from "../../ui/ThreadView.js";
import { AppState } from "../state.js";
import * as ipc from "../../ipc/index.js";
import type { AppComponents } from "../../ui/App.js";
import type { TimelineEvent } from "../../ipc/types.js";

function ev(id: string, ts: number, type = "m.text"): TimelineEvent {
  return {
    event_id: id, sender: "@a:x", body: id, formatted_body: null,
    timestamp: ts, msg_type: type, is_edit: false,
    relates_to_event_id: null, in_reply_to: null, thread_root: null,
    media_url: null, media_mimetype: null, media_width: null, media_height: null,
  };
}

describe("reloadCurrentRoomTimeline keeps events that arrive mid-fetch (#143)", () => {
  const setMessages = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    const timeline = new Proxy({}, {
      get: (_t, k) => (k === "setMessages" ? setMessages : vi.fn()),
    });
    setComponents({ timeline } as unknown as AppComponents);
  });

  it("merges a just-sent message missing from the fetched page", async () => {
    AppState.patch({
      currentRoomId: "!r:x",
      currentTimeline: [ev("$1", 100), ev("$utd", 200, "m.room.encrypted")],
    });
    let release: (v: unknown) => void = () => {};
    (ipc.openRoomTimeline as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((r) => { release = r; }),
    );
    const pending = reloadCurrentRoomTimeline();

    // Own message echoes in while the fetch is outstanding.
    AppState.set("currentTimeline", [...AppState.get("currentTimeline"), ev("$mine", 300)]);

    release({ events: [ev("$1", 100), ev("$utd", 200)], reached_start: true });
    await pending;

    expect(AppState.get("currentTimeline").map((e) => e.event_id)).toEqual(["$1", "$utd", "$mine"]);
    const rendered = setMessages.mock.calls[setMessages.mock.calls.length - 1]![0] as { id?: string; eventId?: string }[];
    expect(rendered.length).toBe(3);
  });
});

// The send's own room-key event (a new megolm session) sets off the reload
// while the message is still going out, so the rebuild can land before the
// sync echo. The bubble is then only a timeline row, in no event list the
// rebuild could carry over; the echo has to draw it again.
describe("own message survives a reload that lands before its sync echo (#143)", () => {
  const ROOM = "!r:x";
  const OPTIMISTIC = "optimistic-1";
  const MINE = "$mine";
  const held = [ev("$1", 100), ev("$utd", 200, "m.room.encrypted")];
  const threadView = new Proxy({}, { get: () => vi.fn() }) as unknown as ThreadView;
  let timeline: Timeline;

  beforeEach(() => {
    vi.clearAllMocks();
    _ownSentEventIds.clear();
    timeline = new Timeline();
    setComponents({ timeline, threadView } as unknown as AppComponents);
    AppState.patch({ currentRoomId: ROOM, currentTimeline: [...held], threadRootEventId: null });
    timeline.setMessages(held.map((e) => timelineEventToMessage(e, held)));
  });

  /** Start a reload whose fetch returns the pre-send page when released. */
  function startReload(): () => Promise<void> {
    let release: (v: unknown) => void = () => {};
    (ipc.openRoomTimeline as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((r) => { release = r; }),
    );
    const pending = reloadCurrentRoomTimeline();
    return async () => {
      release({ events: [ev("$1", 100), ev("$utd", 200)], reached_start: true });
      await pending;
    };
  }
  const sendBubble = () => timeline.appendMessage(timelineEventToMessage(ev(OPTIMISTIC, 300), held));
  const sendReturns = () => {
    timeline.confirmMessage(OPTIMISTIC, MINE);
    _ownSentEventIds.add(MINE);
  };
  const echo = () => renderLiveEvent(ev(MINE, 300), timeline, threadView);
  const rows = (id: string) => timeline.getElement().querySelectorAll(`[data-message-id="${id}"]`).length;

  it("when the reload lands while the send is still in flight", async () => {
    sendBubble();
    const finishReload = startReload();
    await finishReload();
    expect(timeline.hasMessage(OPTIMISTIC)).toBe(false); // the rebuild took the bubble

    sendReturns();
    echo();

    expect(timeline.hasMessage(MINE)).toBe(true);
    expect(rows(MINE)).toBe(1);
  });

  it("when the reload lands after the send returned but before the echo", async () => {
    sendBubble();
    const finishReload = startReload();
    sendReturns();
    await finishReload();
    expect(timeline.hasMessage(MINE)).toBe(false);

    echo();

    expect(timeline.hasMessage(MINE)).toBe(true);
    expect(rows(MINE)).toBe(1);
  });

  it("without a reload, the echo adds no second row", () => {
    sendBubble();
    sendReturns();
    echo();

    expect(rows(MINE)).toBe(1);
  });
});
