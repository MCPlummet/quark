// Thread actions: opening and closing the thread sheet, and sending into it.
//
// "Composing into thread X" is exactly one fact: `AppState.threadRootEventId`.
// Every send path reads it; `openThread` and `closeThread` are the only writers
// and they move the sheet, the dimmed layout, the active panel and the compose
// banner with it. There is no second flag on the banner or the timeline to fall
// out of step — the split that left #131's reporter posting into a thread they
// believed they had left.

import { AppState } from "../state.js";
import { isMobile, closeDrawer } from "../mobile.js";

import { getEvent, getThreadTimeline, sendThreadReplyIpc } from "../../ipc/index.js";
import type { TimelineEvent } from "../../ipc/types.js";
import type { ThreadRootData } from "../../ui/ThreadView.js";

import { showError } from "../../ui/NotificationToast.js";

import {
  getComponents,
  _ownSentEventIds,
  prepareOutgoingBody,
  replyPreviewFor,
  stripReplyFallback,
  timelineEventToThreadMessage,
  _downloadMessageImages,
  _downloadInlineEmoji,
} from "./context.js";
import { disarmReply, refreshComposeBanner, setThreadSnippet } from "./compose_target.js";

/** Class on `.quark-layout` while a thread is open: dims everything but the
 *  thread sheet and the compose box, and freezes the room timeline. */
export const THREAD_FOCUS_CLASS = "quark-layout--thread-focus";

/**
 * The open thread's events (root first) as fetched with it, plus our own
 * replies once their send has returned. Thread replies never enter
 * `currentTimeline` when loaded with the thread, so reply and lookup paths
 * search here as well — otherwise replying to an older thread message found
 * nothing and silently did nothing.
 */
let _threadEvents: TimelineEvent[] = [];

/** The open thread's own events, root first. Empty when no thread is open. */
export function openThreadEvents(): readonly TimelineEvent[] {
  return _threadEvents;
}

/** An event the client has loaded — in the room buffer or the open thread. */
export function findLoadedEvent(eventId: string): TimelineEvent | undefined {
  return (
    AppState.get("currentTimeline").find((e) => e.event_id === eventId && !e.is_edit) ??
    _threadEvents.find((e) => e.event_id === eventId)
  );
}

/**
 * Whether `eventId` belongs to the open thread: its root, or one of its
 * replies (loaded with it, arrived live, or just sent from here). False when no
 * thread is open.
 */
export function isInOpenThread(eventId: string): boolean {
  const root = AppState.get("threadRootEventId");
  if (!root) return false;
  if (eventId === root) return true;
  if (_threadEvents.some((e) => e.event_id === eventId)) return true;
  if (AppState.get("currentTimeline").some((e) => e.event_id === eventId && e.thread_root === root)) return true;
  // Rows only the sheet knows about: our own reply between send and confirm.
  return getComponents().threadView?.hasMessage(eventId) ?? false;
}

function rootSnippet(e: TimelineEvent | undefined): string {
  if (!e) return "";
  const body = e.in_reply_to ? stripReplyFallback(e.body, e.formatted_body ?? undefined).body : e.body;
  return body.slice(0, 80);
}

function rootData(rootId: string, e: TimelineEvent | undefined): ThreadRootData {
  if (e) return timelineEventToThreadMessage(e, AppState.get("currentTimeline"));
  // Opened from outside the loaded window (a notification, a search hit): the
  // root arrives with the thread.
  return { id: rootId, senderName: "", timestamp: "", body: "loading…" };
}

/** Dim the rest of the layout and route keys to the thread — or undo both. */
function setThreadFocus(on: boolean): void {
  const { mainLayout } = getComponents();
  mainLayout?.classList.toggle(THREAD_FOCUS_CLASS, on);
  if (on) AppState.set("activePanel", "thread");
  else if (AppState.get("activePanel") === "thread") AppState.set("activePanel", "timeline");
}

/**
 * Open the thread rooted at `eventId`. Opening the thread that is already open
 * only brings it forward — rebuilding it threw away the reader's place and
 * snapped a long thread back to its top (#131). `focusEventId` scrolls to (and
 * flashes) one of its replies once loaded.
 */
export async function openThread(eventId: string, opts: { focusEventId?: string } = {}): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;
  const { threadView } = getComponents();

  if (AppState.get("threadRootEventId") === eventId && threadView.rootId === eventId) {
    AppState.set("activePanel", "thread");
    if (opts.focusEventId) threadView.scrollToMessage(opts.focusEventId);
    return;
  }
  // Switching threads: leave the old one completely first.
  if (AppState.get("threadRootEventId")) closeThread();

  // Mobile is one-overlay-at-a-time: opening a thread pulls focus away from
  // the drawer.
  if (isMobile()) closeDrawer();

  // A reply armed on the main timeline is a reply in the room, not in this
  // thread. Sending it into the thread would quote an event the thread does not
  // contain, so drop it — the banner is about to say "thread", not "reply".
  disarmReply();

  const rootEvent = findLoadedEvent(eventId);
  _threadEvents = rootEvent ? [rootEvent] : [];
  setThreadSnippet(rootSnippet(rootEvent));
  AppState.set("threadRootEventId", eventId);
  threadView.open(rootData(eventId, rootEvent));
  setThreadFocus(true);
  refreshComposeBanner();

  let events: TimelineEvent[];
  try {
    events = await getThreadTimeline(roomId, eventId);
  } catch (err) {
    // Leave the thread entirely. Keeping `threadRootEventId` set with nothing
    // on screen is how a failed load used to swallow every later message.
    if (AppState.get("threadRootEventId") === eventId) closeThread();
    showError(`Failed to load thread: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  // Closed, switched or the room changed while loading.
  if (AppState.get("threadRootEventId") !== eventId || AppState.get("currentRoomId") !== roomId) return;

  // The backend returns the root along with its replies; it is the sheet's
  // header, not one of the replies (it used to be drawn twice and counted).
  let root = events.find((e) => e.event_id === eventId) ?? rootEvent;
  const replies = events.filter((e) => e.event_id !== eventId && !e.is_edit);
  if (!root) {
    // Older than the window the backend scans for the thread: fetch it alone.
    root = (await getEvent(roomId, eventId).catch(() => null)) ?? undefined;
    if (AppState.get("threadRootEventId") !== eventId) return;
  }
  _threadEvents = root ? [root, ...replies] : [...replies];

  if (root && root !== rootEvent) {
    setThreadSnippet(rootSnippet(root));
    threadView.updateRoot(timelineEventToThreadMessage(root, _threadEvents, AppState.get("currentTimeline")));
    refreshComposeBanner();
  }
  threadView.setReplies(
    replies.map((e) => timelineEventToThreadMessage(e, _threadEvents, AppState.get("currentTimeline"))),
  );
  _downloadMessageImages(events, {
    updateMessageMedia: (id: string, url: string) => threadView.updateMessageMedia(id, url),
  });
  // Custom emoji render with their mxc:// parked in data-mxc until resolved.
  _downloadInlineEmoji(threadView);
  if (opts.focusEventId) threadView.scrollToMessage(opts.focusEventId);
}

/**
 * Close the open thread, completely: the sheet, the dimmed layout, the banner,
 * the routing of sends — and a reply armed inside it. Every close affordance
 * (the sheet's [x], the backdrop, the banner's [x], Esc, `t`, Android back,
 * switching rooms, replying to a message outside the thread) lands here.
 */
export function closeThread(): void {
  const { threadView } = getComponents();
  const replyTo = AppState.get("replyToEventId");
  if (replyTo && isInOpenThread(replyTo)) disarmReply();
  AppState.set("threadRootEventId", null);
  _threadEvents = [];
  threadView.close();
  setThreadFocus(false);
  refreshComposeBanner();
}

/**
 * Send a message into the open thread — as a reply to `replyToEventId` when one
 * of the thread's messages is quoted, else as a plain thread message. Uses a
 * text-clone fly animation from the compose field to the new row.
 */
export async function sendThreadReply(
  body: string,
  threadRootId: string,
  roomId: string,
  replyToEventId?: string,
): Promise<void> {
  const { timeline, threadView, input } = getComponents();
  const ownUserId = AppState.get("ownUserId");
  const ownName = AppState.get("ownDisplayName") ?? ownUserId ?? "me";

  // Resolve emoji before composing the optimistic reply (see sendMessage): Unicode
  // shortcodes become glyphs in the plain body, custom emoji become inline images
  // in the formatted body.
  const prepared = prepareOutgoingBody(body);
  body = prepared.body;

  const optimisticId = `local-thread-${Date.now()}`;
  threadView.appendReply({
    id: optimisticId,
    senderName: ownName,
    isOwn: true,
    timestamp: new Date().toISOString(),
    body,
    htmlBody: prepared.formattedBody,
    replyTo: replyToEventId
      ? replyPreviewFor(replyToEventId, _threadEvents, AppState.get("currentTimeline"))
      : undefined,
  });
  // Optimistically update the reply count indicator on the thread root.
  timeline.incrementThreadReplyCount(threadRootId);
  // The quoted message is consumed by this send, as a main-timeline reply is.
  if (replyToEventId) disarmReply();

  const fieldEl = input.getFieldElement();
  const fieldRect = fieldEl.getBoundingClientRect();
  const fieldStyle = getComputedStyle(fieldEl);
  const targetRect = threadView.getMessageEl(optimisticId)?.getBoundingClientRect() ?? null;

  input.setValue("");

  // Fly a text clone from the compose field to the new row in the sheet.
  const textClone = document.createElement("div");
  textClone.textContent = body;
  Object.assign(textClone.style, {
    position: "fixed",
    left: `${fieldRect.left + parseFloat(fieldStyle.paddingLeft)}px`,
    top: `${fieldRect.top + parseFloat(fieldStyle.paddingTop)}px`,
    maxWidth: `${fieldRect.width - parseFloat(fieldStyle.paddingLeft) - parseFloat(fieldStyle.paddingRight)}px`,
    fontFamily: fieldStyle.fontFamily,
    fontSize: fieldStyle.fontSize,
    lineHeight: fieldStyle.lineHeight,
    color: "var(--msg-thread-indicator)",
    padding: "0",
    margin: "0",
    zIndex: "500",
    pointerEvents: "none",
    background: "transparent",
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    opacity: "0.9",
  });
  document.body.appendChild(textClone);

  if (targetRect && typeof textClone.animate === "function") {
    const dx = targetRect.left - fieldRect.left - parseFloat(fieldStyle.paddingLeft);
    const dy = targetRect.top - fieldRect.top - parseFloat(fieldStyle.paddingTop);
    const anim = textClone.animate(
      [
        { transform: "translate(0,0)", opacity: "0.9" },
        { transform: `translate(${dx}px,${dy}px)`, opacity: "0" },
      ],
      { duration: 240, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" },
    );
    void anim.finished.then(() => textClone.remove());
  } else {
    textClone.remove();
  }

  input.animateSent?.();

  try {
    const eventId = await sendThreadReplyIpc(roomId, threadRootId, body, prepared.formattedBody, replyToEventId);
    _ownSentEventIds.add(eventId);
    threadView.confirmMessage(optimisticId, eventId);
    // Make our own reply findable (to quote it, react to it) before its sync
    // echo — which is suppressed — would have put it anywhere.
    if (AppState.get("threadRootEventId") === threadRootId && ownUserId) {
      _threadEvents.push({
        event_id: eventId,
        sender: ownUserId,
        body,
        formatted_body: prepared.formattedBody ?? null,
        timestamp: Date.now(),
        msg_type: "m.text",
        is_edit: false,
        relates_to_event_id: null,
        in_reply_to: replyToEventId ?? null,
        thread_root: threadRootId,
        media_url: null,
        media_mimetype: null,
        media_width: null,
        media_height: null,
      });
    }
  } catch (err) {
    threadView.removeMessage(optimisticId);
    // Hand the text back rather than lose it, unless something new was typed.
    if (input.getValue().trim().length === 0) input.setValue(body);
    showError(`Failed to send thread reply: ${err instanceof Error ? err.message : String(err)}`);
  }
}
