// Where the next message goes — and the banner above the compose box that says
// so.
//
// The target is three AppState keys and nothing else: `editingEventId`,
// `replyToEventId` and `threadRootEventId`. Every send path reads them
// (text, attachments, stickers, GIFs), so they are the single source of truth.
//
// The banner used to be driven by imperative show/hide calls scattered across
// the reply, edit and thread actions, with a "thread mode" flag of its own. The
// two drifted: dismissing the thread banner hid it and dropped the flag while
// `threadRootEventId` stayed set, so every later message still went into the
// thread with nothing on screen saying so (#131); committing an edit with a
// thread open hid the thread banner the same way. Now the actions only change
// state and call {@link refreshComposeBanner}, which derives the banner — and
// the compose placeholder — from that state alone.

import { AppState } from "../state.js";
import { getComponents } from "./context.js";
import type { ReplyPreviewData } from "../../ui/ReplyPreview.js";

/** Display data for the armed reply. Kept beside `replyToEventId` because the
 *  banner needs a sender and a snippet, which the bare ID can't supply. */
let _reply: ReplyPreviewData | null = null;
/** Snippet of the message being edited, for the edit banner. */
let _editSnippet = "";
/** Snippet of the open thread's root, for the thread banner. */
let _threadSnippet = "";

/** Arm a reply to `label.eventId`. Callers decide whether that means leaving
 *  an open thread first (see `startReply`). */
export function armReply(label: ReplyPreviewData): void {
  _reply = label;
  AppState.set("replyToEventId", label.eventId);
  refreshComposeBanner();
}

/** Drop the armed reply, if any. */
export function disarmReply(): void {
  _reply = null;
  AppState.set("replyToEventId", null);
  refreshComposeBanner();
}

/** Follow a reply target from one event ID to another (optimistic → real). */
export function renameReplyTarget(fromId: string, toId: string): void {
  if (AppState.get("replyToEventId") !== fromId) return;
  if (_reply?.eventId === fromId) _reply = { ..._reply, eventId: toId };
  AppState.set("replyToEventId", toId);
}

export function setEditSnippet(snippet: string): void {
  _editSnippet = snippet;
}

export function setThreadSnippet(snippet: string): void {
  _threadSnippet = snippet;
}

/**
 * Draw the banner for the current target. Precedence follows what a submit
 * does (see `resolveComposeSubmit`): an edit commits first; otherwise a reply
 * — inside the open thread if one is open — and otherwise the thread itself.
 */
export function refreshComposeBanner(): void {
  const { replyPreview, input } = getComponents();
  const threadRoot = AppState.get("threadRootEventId");
  const replyTo = AppState.get("replyToEventId");

  if (AppState.get("editingEventId")) {
    replyPreview.showEdit(_editSnippet);
  } else if (replyTo) {
    const label = _reply?.eventId === replyTo ? _reply : { eventId: replyTo, senderName: "", snippet: "" };
    replyPreview.show(label, { inThread: threadRoot !== null });
  } else if (threadRoot) {
    replyPreview.showThread(_threadSnippet);
  } else {
    replyPreview.hide();
  }
  // Optional: partial component stubs in tests need not model the composer.
  input?.setThreadMode?.(threadRoot !== null);
}
