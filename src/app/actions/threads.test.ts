import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { TimelineEvent } from "../../ipc/types.js";

// Thread lifecycle, end to end through the real UI components: the sheet, the
// compose banner, the composer and the timeline, with only IPC stubbed.
//
// #131 was a family of split-state bugs — the banner, the inline panel and
// `threadRootEventId` each had their own idea of whether a thread was open, so
// closing one left the others behind and messages kept going into the thread.
// These tests drive the user-facing affordances and assert all three agree.

const getThreadTimeline = vi.fn<(roomId: string, rootId: string) => Promise<TimelineEvent[]>>();
const sendThreadReplyIpc = vi.fn<
  (roomId: string, root: string, body: string, html?: string, replyTo?: string) => Promise<string>
>();
const ipcSendMessage = vi.fn<
  (roomId: string, body: string, html?: string, replyTo?: string) => Promise<string>
>();
const getThumbnail = vi.fn();
let threadComplete = true;
vi.mock("../../ipc/index.js", () => ({
  // The tests fake the events; whether they are the whole thread is a switch.
  getThreadTimeline: async (...a: [string, string]) => ({ events: await getThreadTimeline(...a), complete: threadComplete }),
  sendThreadReplyIpc: (...a: [string, string, string, string?, string?]) => sendThreadReplyIpc(...a),
  sendMessage: (...a: [string, string, string?, string?]) => ipcSendMessage(...a),
  getEvent: vi.fn(async () => null),
  editMessage: vi.fn(),
  redactMessage: vi.fn(),
  getThumbnail: (...a: unknown[]) => getThumbnail(...a),
  downloadMedia: vi.fn(),
  getPresenceStatus: vi.fn(),
  getEmojiPacks: vi.fn(async () => []),
}));
vi.mock("../../ui/NotificationToast.js", () => ({ showError: vi.fn(), showSuccess: vi.fn(), showToast: vi.fn() }));
vi.mock("../mobile.js", async (importActual) => ({
  ...(await importActual<typeof import("../mobile.js")>()),
  isMobile: () => false,
  closeDrawer: vi.fn(),
}));

import { openThread, closeThread, isInOpenThread, THREAD_FOCUS_CLASS } from "./threads.js";
import { sendMessage, startReply, startEdit, dismissComposeBanner } from "./messages.js";
import { setComponents, _ownSentEventIds } from "./context.js";
import { renderLiveEvent } from "./live.js";
import { openQuickReactPicker } from "./reactions.js";
import { AppState } from "../state.js";
import { Timeline } from "../../ui/Timeline.js";
import { ThreadView } from "../../ui/ThreadView.js";
import { ReplyPreview } from "../../ui/ReplyPreview.js";
import { Input } from "../../ui/Input.js";
import type { AppComponents } from "../../ui/App.js";

const ROOM = "!room:x";

function ev(id: string, over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    event_id: id,
    sender: "@bob:x",
    body: `body of ${id}`,
    formatted_body: null,
    timestamp: 1_700_000_000_000,
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

const ROOT_EV = ev("$root", { body: "the root", sender: "@alice:x" });
const MAIN_EV = ev("$m1", { body: "a room message" });
const T1 = ev("$t1", { body: "first in thread", thread_root: "$root", timestamp: 1_700_000_001_000 });
const T2 = ev("$t2", { body: "second in thread", thread_root: "$root", timestamp: 1_700_000_002_000 });

let timeline: Timeline;
let threadView: ThreadView;
let replyPreview: ReplyPreview;
let input: Input;
let mainLayout: HTMLElement;
const quickReactPicker = { show: vi.fn(), isVisible: () => false, setCustomEmoji: vi.fn() };

/** The pieces App and keyboard.ts wire together, wired the same way. */
function mount(): void {
  timeline = new Timeline();
  threadView = new ThreadView();
  timeline.getElement().appendChild(threadView.getElement());
  replyPreview = new ReplyPreview();
  input = new Input();
  mainLayout = document.createElement("div");
  mainLayout.append(timeline.getElement(), replyPreview.getElement(), input.getElement());
  document.body.appendChild(mainLayout);
  replyPreview.onDismiss(() => dismissComposeBanner());
  threadView.onClose(() => closeThread());
  setComponents({ timeline, threadView, replyPreview, input, mainLayout, quickReactPicker } as unknown as AppComponents);
}

const sheetOpen = () => threadView.getElement().style.display !== "none";
const bannerText = () =>
  replyPreview.isVisible() ? replyPreview.getElement().querySelector(".reply-preview-bar__sender")!.textContent : null;
const bannerSnippet = () => replyPreview.getElement().querySelector(".reply-preview-bar__snippet")!.textContent;
const bannerClose = () => replyPreview.getElement().querySelector<HTMLElement>(".reply-preview-bar__close")!;

/** The next thread send, held open until the test settles it. */
function deferredSend(): { resolve: (id: string) => void; reject: (e: unknown) => void } {
  let resolve!: (id: string) => void;
  let reject!: (e: unknown) => void;
  sendThreadReplyIpc.mockReturnValueOnce(new Promise<string>((res, rej) => { resolve = res; reject = rej; }));
  return { resolve, reject };
}
const threadRowIds = () =>
  [...threadView.getElement().querySelectorAll(".thread-view__timeline [data-message-id]")]
    .map((e) => e.getAttribute("data-message-id"));

/** Every observable piece agrees the thread is closed. */
function expectFullyClosed(): void {
  expect(AppState.get("threadRootEventId")).toBeNull();
  expect(sheetOpen()).toBe(false);
  expect(mainLayout.classList.contains(THREAD_FOCUS_CLASS)).toBe(false);
  expect(bannerText() ?? "").not.toMatch(/thread/i);
  expect(input.getFieldElement().placeholder).not.toMatch(/thread/);
  expect(AppState.get("activePanel")).not.toBe("thread");
}

let animate: typeof HTMLElement.prototype.animate | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  _ownSentEventIds.clear();
  // jsdom has no Web Animations; the send paths fly a clone with it.
  animate = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = (() => ({ finished: Promise.resolve() })) as unknown as typeof animate & {};
  AppState.patch({
    currentRoomId: ROOM,
    ownUserId: "@me:x",
    replyToEventId: null,
    editingEventId: null,
    threadRootEventId: null,
    activePanel: "timeline",
    currentTimeline: [ROOT_EV, MAIN_EV, T1],
  });
  getThreadTimeline.mockResolvedValue([ROOT_EV, T1, T2]);
  threadComplete = true;
  sendThreadReplyIpc.mockResolvedValue("$sent-in-thread");
  ipcSendMessage.mockResolvedValue("$sent-in-room");
  mount();
});

afterEach(() => {
  closeThread();
  mainLayout.remove();
  HTMLElement.prototype.animate = animate!;
});

describe("opening a thread", () => {
  it("shows the sheet, dims the layout, takes the keys and says so above the composer", async () => {
    await openThread("$root");

    expect(sheetOpen()).toBe(true);
    expect(mainLayout.classList.contains(THREAD_FOCUS_CLASS)).toBe(true);
    expect(AppState.get("activePanel")).toBe("thread");
    expect(bannerText()).toMatch(/Replying in thread/);
    expect(input.getFieldElement().placeholder).toBe("reply in thread…");
  });

  it("draws the root once, as the header — not again as the first reply", async () => {
    await openThread("$root");
    expect(threadRowIds()).toEqual(["$t1", "$t2"]);
    // Read to its end: no notice about missing replies.
    expect(threadView.getElement().querySelector<HTMLElement>(".thread-view__notice")!.style.display).toBe("none");
  });

  // #131: "thread jumps to the top if you click to reply in a thread". Every
  // click on the thread button/indicator rebuilt the panel scrolled to the top.
  it("re-opening the open thread keeps it as it was", async () => {
    await openThread("$root");
    const scroller = threadView.getScrollElement();
    scroller.scrollTop = 40;

    await openThread("$root");

    expect(getThreadTimeline).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(40);
  });

  it("disarms a reply armed on the main timeline", async () => {
    startReply("$m1", "Bob", "a room message");
    await openThread("$root");
    expect(AppState.get("replyToEventId")).toBeNull();
    expect(bannerText()).toMatch(/Replying in thread/);
  });

  // #131: "Only closing Quark and restarting gets out of the thread". A failed
  // load hid the banner but left threadRootEventId set, so every later message
  // went into a thread that was nowhere on screen.
  it("leaves the thread entirely when it fails to load", async () => {
    getThreadTimeline.mockRejectedValueOnce(new Error("boom"));
    await openThread("$root");
    expectFullyClosed();
  });

  it("stays closed if closed while still loading", async () => {
    let resolve!: (v: TimelineEvent[]) => void;
    getThreadTimeline.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const opening = openThread("$root");
    closeThread();
    resolve([ROOT_EV, T1]);
    await opening;
    expectFullyClosed();
  });
});

describe("closing a thread — every affordance ends all of it (#131)", () => {
  beforeEach(async () => {
    await openThread("$root");
  });

  it("the compose banner's [x]", () => {
    replyPreview.getElement().querySelector<HTMLElement>(".reply-preview-bar__close")!.click();
    expectFullyClosed();
  });

  it("the sheet's [x]", () => {
    threadView.getElement().querySelector<HTMLElement>(".thread-view__close")!.click();
    expectFullyClosed();
    expect(replyPreview.isVisible()).toBe(false);
  });

  it("a click on the dimmed room behind the sheet", () => {
    threadView.getElement().querySelector<HTMLElement>(".thread-view__backdrop")!.click();
    expectFullyClosed();
  });

  it("…and a message sent afterwards goes to the room", async () => {
    replyPreview.getElement().querySelector<HTMLElement>(".reply-preview-bar__close")!.click();
    await sendMessage("back in the room");
    expect(sendThreadReplyIpc).not.toHaveBeenCalled();
    expect(ipcSendMessage).toHaveBeenCalledWith(ROOM, "back in the room", undefined, undefined);
  });
});

describe("replying with a thread open", () => {
  beforeEach(async () => {
    await openThread("$root");
  });

  // #131: "if you are in thread reply mode and click reply on someone's
  // message, you're stuck in the thread" — the reply went into the thread,
  // without its quote, and the thread stayed open.
  it("a reply to a room message leaves the thread and goes to the room", async () => {
    startReply("$m1", "Bob", "a room message");

    expectFullyClosed();
    expect(AppState.get("replyToEventId")).toBe("$m1");
    expect(bannerText()).toBe("<Bob>");

    await sendMessage("answering in the room");
    expect(sendThreadReplyIpc).not.toHaveBeenCalled();
    expect(ipcSendMessage).toHaveBeenCalledWith(ROOM, "answering in the room", undefined, "$m1");
  });

  it("a reply to a thread message quotes it inside the thread", async () => {
    startReply("$t2", "Bob", "second in thread");

    expect(AppState.get("threadRootEventId")).toBe("$root");
    expect(bannerText()).toBe("⌥ ↩ <Bob>");

    await sendMessage("answering in the thread");
    expect(ipcSendMessage).not.toHaveBeenCalled();
    expect(sendThreadReplyIpc).toHaveBeenCalledWith(ROOM, "$root", "answering in the thread", undefined, "$t2");
    // The quote is consumed; the thread stays open for the next message.
    expect(AppState.get("replyToEventId")).toBeNull();
    expect(bannerText()).toMatch(/Replying in thread/);
    // The sent row shows the quote it was sent with, like every other one.
    const row = threadView.getMessageEl("$sent-in-thread")!;
    expect(row.querySelector(".reply-preview__body")?.textContent).toBe("second in thread");
  });

  it("a reply to a thread message that only the thread fetch loaded still works", async () => {
    // $t2 was never in the room buffer; it came with the thread.
    expect(AppState.get("currentTimeline").some((e) => e.event_id === "$t2")).toBe(false);
    expect(isInOpenThread("$t2")).toBe(true);
  });

  it("cancelling an in-thread reply leaves you in the thread; a second [x] leaves it", () => {
    startReply("$t1", "Bob", "first in thread");
    const close = replyPreview.getElement().querySelector<HTMLElement>(".reply-preview-bar__close")!;

    close.click();
    expect(AppState.get("replyToEventId")).toBeNull();
    expect(AppState.get("threadRootEventId")).toBe("$root");
    expect(bannerText()).toMatch(/Replying in thread/);

    close.click();
    expectFullyClosed();
  });

  // With focus on the banner's [x], the banner handles Esc itself. Left to
  // bubble, the same press reached the document's Esc as well — the thread
  // panel's close, which peeled a second layer and closed the thread too.
  it("Esc on the banner peels one layer, not two", () => {
    // Stands in for keyboard.ts's document handler: Esc in Normal runs the
    // thread panel's close.
    const documentEscape = (e: KeyboardEvent) => { if (e.key === "Escape") dismissComposeBanner(); };
    document.addEventListener("keydown", documentEscape);
    try {
      startReply("$t1", "Bob", "first in thread");
      bannerClose().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(AppState.get("replyToEventId")).toBeNull();
      expect(AppState.get("threadRootEventId")).toBe("$root");
      expect(bannerText()).toMatch(/Replying in thread/);
    } finally {
      document.removeEventListener("keydown", documentEscape);
    }
  });

  it("closing the thread drops a reply armed inside it", () => {
    startReply("$t1", "Bob", "first in thread");
    closeThread();
    expect(AppState.get("replyToEventId")).toBeNull();
    expect(replyPreview.isVisible()).toBe(false);
  });

  it("editing a room message leaves the thread", () => {
    startEdit("$m1", "a room message");
    expectFullyClosed();
    expect(bannerText()).toBe("Editing");
  });

  it("a plain thread message goes into the thread with no quote", async () => {
    await sendMessage("just chatting");
    expect(sendThreadReplyIpc).toHaveBeenCalledWith(ROOM, "$root", "just chatting", undefined, undefined);
    expect(isInOpenThread("$sent-in-thread")).toBe(true);
  });
});

// #131: "of two reply messages in a thread, one shows the quoted reply text and
// the other doesn't". The thread printed raw bodies: a reply from a client that
// still sends the rich-reply fallback showed its `> quote`, one from a client
// that doesn't (MSC2781 — and Quark's own, which dropped the reply entirely)
// showed nothing.
describe("in-thread replies render one way", () => {
  it("with or without the quote fallback in the body", async () => {
    getThreadTimeline.mockResolvedValue([
      ROOT_EV,
      T1,
      ev("$withFallback", {
        thread_root: "$root",
        in_reply_to: "$t1",
        body: "> <@bob:x> first in thread\n\nagreed",
        formatted_body: "<mx-reply><blockquote>first in thread</blockquote></mx-reply>agreed",
      }),
      ev("$without", { thread_root: "$root", in_reply_to: "$t1", body: "agreed too" }),
    ]);
    await openThread("$root");

    for (const id of ["$withFallback", "$without"]) {
      const row = threadView.getMessageEl(id)!;
      expect(row.querySelector(":scope > .reply-preview .reply-preview__body")?.textContent).toBe("first in thread");
      const body = row.querySelector(".thread-view__message-body")!;
      expect(body.textContent).not.toMatch(/first in thread|^>/);
      expect(body.querySelector("blockquote")).toBeNull();
    }
  });

  it("a plain thread message (its reply pointer is only the fallback) gets no banner", async () => {
    await openThread("$root");
    expect(threadView.getMessageEl("$t1")!.querySelector(".reply-preview")).toBeNull();
  });
});

// renderFormattedBody parks a custom emoji's mxc:// in data-mxc until a
// resolver runs; the sheet is its own emoji host now that it is not inside the
// timeline's list, so opening a thread must resolve its own.
it("resolves inline custom emoji in the replies it loads", async () => {
  getThumbnail.mockResolvedValue({ mime_type: "image/png", data_base64: "AAAA" });
  getThreadTimeline.mockResolvedValue([
    ROOT_EV,
    ev("$emoji", { thread_root: "$root", body: ":party:", formatted_body: '<img data-mx-emoticon src="mxc://e/1" alt=":party:">' }),
  ]);
  await openThread("$root");
  expect(getThumbnail).toHaveBeenCalledWith("mxc://e/1", expect.any(Number), expect.any(Number));
});

// Counting replies, and replies still on their way. Typing past a homeserver
// rate limit leaves sends queued for seconds each: the count used to go up when
// a reply was sent *and* when its echo beat the send back, never came down for
// one that failed, and a reply still queued when the thread was closed and
// reopened was gone from it — its echo, our own, suppressed.
describe("reply counts and replies still sending", () => {
  const roomCount = () =>
    timeline.getMessageElementById("$root")?.querySelector(".message__thread-indicator")?.textContent ?? null;
  const panelCount = () => threadView.getElement().querySelector(".thread-view__count")!.textContent;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(async () => {
    timeline.setMessages([
      { id: "$root", senderName: "Alice", timestamp: "2024-01-01T12:00:00Z", body: "the root", isThreadRoot: true, threadReplyCount: 7 },
    ]);
    await openThread("$root");
  });

  it("opening a thread sets the room's count to the replies it loaded", () => {
    expect(roomCount()).toBe("⌥ 2 replies");
    expect(panelCount()).toBe("2 replies");
  });

  it("counts our reply once when its echo beats the send back", async () => {
    const send = deferredSend();
    const sent = sendMessage("hi");
    renderLiveEvent(ev("$hi", { sender: "@me:x", body: "hi", thread_root: "$root" }), timeline, threadView);
    send.resolve("$hi");
    await sent;
    expect(roomCount()).toBe("⌥ 3 replies");
    expect(panelCount()).toBe("3 replies");
    expect(threadRowIds().filter((id) => id === "$hi")).toHaveLength(1);
  });

  it("counts our reply once when the send comes back first", async () => {
    await sendMessage("hi");
    renderLiveEvent(ev("$sent-in-thread", { sender: "@me:x", body: "hi", thread_root: "$root" }), timeline, threadView);
    expect(roomCount()).toBe("⌥ 3 replies");
    expect(panelCount()).toBe("3 replies");
  });

  it("does not count a reply that failed to send", async () => {
    const send = deferredSend();
    const sent = sendMessage("hi");
    send.reject(new Error("offline"));
    await sent;
    expect(roomCount()).toBe("⌥ 2 replies");
    expect(panelCount()).toBe("2 replies");
  });

  it("counts sent replies, and says how many are still sending", async () => {
    const send = deferredSend();
    const sent = sendMessage("queued");
    await flush();
    expect(panelCount()).toBe("2 replies · 1 sending");
    expect(roomCount()).toBe("⌥ 2 replies");
    send.resolve("$queued");
    await sent;
  });

  it("shows a reply still sending when the thread is reopened, and lands it", async () => {
    const send = deferredSend();
    const sent = sendMessage("queued");
    closeThread();
    await openThread("$root");
    const rows = () => [...threadView.getElement().querySelectorAll(".thread-view__timeline [data-message-id]")];
    expect(rows().map((r) => r.textContent).join()).toContain("queued");
    expect(panelCount()).toBe("2 replies · 1 sending");

    send.resolve("$queued");
    await sent;
    expect(threadView.getMessageEl("$queued")).not.toBeNull();
    expect(rows()).toHaveLength(3);
    expect(panelCount()).toBe("3 replies");
    expect(roomCount()).toBe("⌥ 3 replies");
  });

  it("shows a reply that landed while its thread was closed in no other thread", async () => {
    const send = deferredSend();
    const sent = sendMessage("queued");
    closeThread();
    getThreadTimeline.mockResolvedValue([MAIN_EV]);
    await openThread("$m1");
    send.resolve("$queued");
    await sent;
    expect(threadView.getMessageEl("$queued")).toBeNull();
    expect(threadRowIds()).toEqual([]);
  });
});

// The panel's header stands in for the root's row in the room, which is hidden
// while the thread is open. Once the thread loaded, the header was redrawn from
// the backend's copy of the root — no edits applied, no reactions — so an
// edited root went back to its first wording and its reactions disappeared.
describe("the header reads as the root's row in the room does", () => {
  const header = () => threadView.getElement().querySelector<HTMLElement>(".thread-view__root .thread-view__message")!;
  const headerBody = () => header().querySelector(".thread-view__message-body")!.textContent;
  const edit = (id: string, body: string, at: number) =>
    ev(id, { is_edit: true, relates_to_event_id: "$root", body, timestamp: ROOT_EV.timestamp + at });

  beforeEach(() => {
    AppState.set("currentTimeline", [
      { ...ROOT_EV, reactions: [{ key: "👍", count: 3, senders: [], own: false, own_event_id: null }] },
      edit("$edit", "the root, edited", 1),
      MAIN_EV,
    ]);
    // The backend's root, as it comes with the thread: first wording, no reactions.
    getThreadTimeline.mockResolvedValue([ROOT_EV, T1, T2]);
  });

  it("keeps the root's edit and reactions once the thread has loaded", async () => {
    await openThread("$root");
    expect(headerBody()).toBe("the root, edited");
    expect(header().querySelector(".reaction-bar")?.textContent).toContain("3");
    expect(bannerSnippet()).toBe("the root, edited");
  });

  it("takes an edit of the root that arrives while the thread is open", async () => {
    await openThread("$root");
    renderLiveEvent(edit("$edit2", "edited again", 2), timeline, threadView);
    expect(headerBody()).toBe("edited again");
    expect(bannerSnippet()).toBe("edited again");
  });

  it("uses the backend's root for a root the room has not loaded", async () => {
    AppState.set("currentTimeline", [MAIN_EV]);
    await openThread("$root");
    expect(headerBody()).toBe("the root");
  });
});

// A thread reply that failed after its thread was left went back into whatever
// composer was current — another room's, with no thread banner, one Enter from
// posting it there. And the quote it was sent with was dropped.
describe("a thread reply that fails to send", () => {
  beforeEach(async () => {
    await openThread("$root");
  });

  it("comes back to the composer with its quote while its thread is open", async () => {
    startReply("$t1", "Bob", "first in thread");
    const send = deferredSend();
    const sent = sendMessage("agreed");
    expect(AppState.get("replyToEventId")).toBeNull();
    send.reject(new Error("offline"));
    await sent;

    expect(input.getValue()).toBe("agreed");
    expect(AppState.get("replyToEventId")).toBe("$t1");
    expect(bannerText()).toBe("⌥ ↩ <Bob>");
  });

  it("stays out of another room's composer, and is back when its thread is", async () => {
    const send = deferredSend();
    const sent = sendMessage("for the thread only");
    // Switching rooms closes the thread and brings up that room's (empty) draft.
    closeThread();
    AppState.set("currentRoomId", "!other:x");
    send.reject(new Error("offline"));
    await sent;
    expect(input.getValue()).toBe("");

    AppState.set("currentRoomId", ROOM);
    await openThread("$root");
    expect(input.getValue()).toBe("for the thread only");
    expect(bannerText()).toMatch(/Replying in thread/);
  });

  it("stays out of the room's own composer once its thread is closed", async () => {
    const send = deferredSend();
    const sent = sendMessage("for the thread only");
    closeThread();
    send.reject(new Error("offline"));
    await sent;
    expect(input.getValue()).toBe("");

    await sendMessage("to the room");
    expect(ipcSendMessage).toHaveBeenCalledWith(ROOM, "to the room", undefined, undefined);
  });

  it("does not overwrite what was typed since", async () => {
    const send = deferredSend();
    const sent = sendMessage("first try");
    input.setValue("something new");
    send.reject(new Error("offline"));
    await sent;
    expect(input.getValue()).toBe("something new");
  });
});

// The root is drawn twice while its thread is open: its room row, hidden behind
// the panel, and the panel's header. Reacting to it anchored the picker to the
// hidden row, so it opened away from both.
it("anchors the reaction picker to the thread's row of the root, not the room's", async () => {
  timeline.setMessages([{ id: "$root", senderName: "Alice", timestamp: "2024-01-01T12:00:00Z", body: "the root" }]);
  await openThread("$root");
  openQuickReactPicker("$root");
  const anchor = quickReactPicker.show.mock.calls[0][1] as HTMLElement;
  expect(anchor).toBe(threadView.getMessageEl("$root"));
  expect(threadView.getElement().contains(anchor)).toBe(true);
});

// One failed /relations page used to throw away the whole thread, and the panel
// closed. Now the replies that loaded — the newest — are shown, with a notice
// above them, and the room keeps its count: a partial thread is not the whole.
it("shows the newest replies of a thread it could not read to the end", async () => {
  threadComplete = false;
  timeline.setMessages([
    { id: "$root", senderName: "Alice", timestamp: "2024-01-01T12:00:00Z", body: "the root", isThreadRoot: true, threadReplyCount: 900 },
  ]);
  await openThread("$root");
  expect(threadRowIds()).toEqual(["$t1", "$t2"]);
  const notice = threadView.getElement().querySelector<HTMLElement>(".thread-view__notice")!;
  expect(notice.style.display).toBe("");
  expect(notice.textContent).toMatch(/Older replies couldn't be loaded/);
  expect(timeline.getMessageElementById("$root")!.querySelector(".message__thread-indicator")!.textContent).toBe("⌥ 900 replies");
});
