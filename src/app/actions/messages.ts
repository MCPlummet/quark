// Message composition & lifecycle actions: sending, replying, editing,
// and redacting messages (plus the send/merge fly animations).

import { AppState } from "../state.js";

import {
  sendMessage as ipcSendMessage,
  editMessage as ipcEditMessage,
  redactMessage as ipcRedactMessage,
} from "../../ipc/index.js";

import type { MessageData, ReplyPreviewData } from "../../ui/Timeline.js";

import { showError, showSuccess } from "../../ui/NotificationToast.js";

import {
  getComponents,
  _ownSentEventIds,
  _memberAvatarMxc,
  _avatarDataUrl,
  replaceUnicodeEmojiShortcodes,
  prepareOutgoingBody,
  _downloadInlineEmoji,
} from "./context.js";
import { sendThreadReply } from "./threads.js";

/**
 * Send a message in the current room. Optimistically appends to timeline.
 */
export async function sendMessage(body: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId || !body.trim()) return;

  // Route to thread when one is open.
  const threadRootId = AppState.get("threadRootEventId");
  if (threadRootId) {
    await sendThreadReply(body, threadRootId, roomId);
    return;
  }

  // Resolve emoji up front: Unicode shortcodes (:smile: → 😄) in the plain body,
  // custom (MSC2545) shortcodes into <img> in the formatted body. Doing it here
  // means the optimistic bubble and the fly-in clones already show the glyph.
  const prepared = prepareOutgoingBody(body);
  body = prepared.body;

  const { timeline, input, replyPreview } = getComponents();
  const replyToEventId = AppState.get("replyToEventId");

  const composeBoxEl = input.getComposeBoxElement();
  const composeRect = composeBoxEl.getBoundingClientRect();

  let replyTo: ReplyPreviewData | undefined;
  if (replyToEventId) {
    const events = AppState.get("currentTimeline");
    const parent = events.find((e) => e.event_id === replyToEventId);
    if (parent) {
      replyTo = { eventId: parent.event_id, senderName: parent.sender, body: parent.body.slice(0, 80) };
    }
  }

  const ownUserId = AppState.get("ownUserId");
  const ownDisplayName = AppState.get("ownDisplayName");
  const ownSenderName = ownDisplayName ?? ownUserId ?? "you";

  const ownAvatarMxc = ownUserId ? _memberAvatarMxc.get(ownUserId) : undefined;
  const ownAvatarUrl = (ownAvatarMxc && _avatarDataUrl.get(ownAvatarMxc)) ?? undefined;

  // Formatted body (custom-emoji <img> + inline markdown) built above, rendered
  // immediately in the optimistic message rather than waiting for the sync echo.
  const formattedBody = prepared.formattedBody;

  const optimisticMsg: MessageData = {
    id: `optimistic-${Date.now()}`,
    senderId: ownUserId ?? undefined,
    senderName: ownSenderName,
    senderAvatarUrl: ownAvatarUrl,
    isOwn: true,
    timestamp: new Date().toISOString(),
    body,
    htmlBody: formattedBody,
    type: "text",
    replyTo,
  };
  timeline.appendMessageHidden(optimisticMsg);

  // Determine if this merged into an existing bubble or created a new one
  const hiddenEl = timeline.getLastHiddenEl();
  const isMerge = !!hiddenEl && !hiddenEl.classList.contains("message-group-wrapper");

  input.setValue("");

  if (isMerge) {
    // ── Merge: border fades out, text clone flies up into the bubble ─────────
    const fieldEl = input.getFieldElement();
    const fieldRect = fieldEl.getBoundingClientRect();
    const targetBodyEl = hiddenEl?.querySelector<HTMLElement>(".message__body");
    const targetRect = targetBodyEl?.getBoundingClientRect() ?? null;

    // Create a fixed text clone positioned over the input field
    const textClone = document.createElement("div");
    textClone.textContent = body;
    const fieldStyle = getComputedStyle(fieldEl);
    Object.assign(textClone.style, {
      position: "fixed",
      left: `${fieldRect.left + parseFloat(fieldStyle.paddingLeft)}px`,
      top: `${fieldRect.top + parseFloat(fieldStyle.paddingTop)}px`,
      maxWidth: `${fieldRect.width - parseFloat(fieldStyle.paddingLeft) - parseFloat(fieldStyle.paddingRight)}px`,
      fontFamily: fieldStyle.fontFamily,
      fontSize: fieldStyle.fontSize,
      lineHeight: fieldStyle.lineHeight,
      color: fieldStyle.color,
      padding: "0",
      margin: "0",
      zIndex: "500",
      pointerEvents: "none",
      background: "transparent",
      whiteSpace: "pre-wrap",
      overflow: "hidden",
    });
    document.body.appendChild(textClone);

    input.animateMerge();

    if (targetRect) {
      const dx = targetRect.left - fieldRect.left - parseFloat(fieldStyle.paddingLeft);
      const dy = targetRect.top - fieldRect.top - parseFloat(fieldStyle.paddingTop);

      const DURATION = 260;

      const anim = textClone.animate(
        [
          { transform: "translate(0, 0)" },
          { transform: `translate(${dx}px, ${dy}px)` },
        ],
        { duration: DURATION, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" }
      );

      void anim.finished.then(() => {
        timeline.showLastHiddenMessage(hiddenEl ?? undefined);
        requestAnimationFrame(() => textClone.remove());
      });
    } else {
      textClone.remove();
      timeline.showLastHiddenMessage(hiddenEl ?? undefined);
    }
  } else {
    // ── New group: clone compose box (+ reply bar if replying) and fly up ────
    // appendMessageHidden() did an instant scroll so hiddenEl's layout position
    // is accurate right now (counter-animation is deferred to the next rAF).
    const targetGroupEl = hiddenEl?.querySelector<HTMLElement>(".message-group") ?? hiddenEl;
    const targetRect = targetGroupEl?.getBoundingClientRect();

    if (replyToEventId && replyPreview.isVisible()) {
      // ── Reply send: fly a combined [reply-bar + compose-box] clone so the
      // quoted preview visually travels into the timeline with the message text.
      const replyBarEl = replyPreview.getElement();
      const replyBarRect = replyBarEl.getBoundingClientRect();
      // Natural pixel gap between the reply bar bottom and the compose box top.
      const gap = Math.max(0, composeRect.top - replyBarRect.bottom);
      const startH = replyBarRect.height + gap + composeRect.height;

      // Clone the reply bar (strip its layout margins; wrapper controls position)
      const replyBarClone = replyBarEl.cloneNode(true) as HTMLElement;
      replyBarClone.style.margin = "0";
      replyBarClone.style.flexShrink = "0";

      // Clone the compose box with the typed text
      const composeClone = composeBoxEl.cloneNode(true) as HTMLElement;
      const cloneField2 = composeClone.querySelector<HTMLTextAreaElement>("textarea");
      if (cloneField2) cloneField2.value = body;
      Object.assign(composeClone.style, {
        margin: "0",
        flex: "",
        flexShrink: "0",
        width: `${composeRect.width}px`,
        height: `${composeRect.height}px`,
        background: getComputedStyle(composeBoxEl).backgroundColor || "var(--bg)",
      });

      // Wrapper: fixed column containing [reply-bar, gap-spacer, compose-box]
      const combinedClone = document.createElement("div");
      Object.assign(combinedClone.style, {
        position: "fixed",
        top: `${replyBarRect.top}px`,
        left: `${replyBarRect.left}px`,
        width: `${replyBarRect.width}px`,
        height: `${startH}px`,
        zIndex: "500",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      });
      combinedClone.appendChild(replyBarClone);
      if (gap > 0) {
        const spacer = document.createElement("div");
        spacer.style.cssText = `height:${gap}px;flex-shrink:0`;
        combinedClone.appendChild(spacer);
      }
      combinedClone.appendChild(composeClone);
      document.body.appendChild(combinedClone);

      // Hide originals: compose box via opacity (keeps layout); reply bar via
      // visibility (also keeps layout so that cancelReply below can collapse it
      // without the UI jumping before we've measured the target position).
      composeBoxEl.style.opacity = "0";
      replyBarEl.style.visibility = "hidden";

      // Cancel the reply state NOW so the reply bar collapses from the layout
      // before we measure deltaY. If we defer this to anim.finished, the bar's
      // ~30px height is removed at that point: the timeline grows, scrollTop is
      // clamped down, and the target message shifts ~30px below where the clone
      // landed — producing the visible downward jump.
      cancelReply();

      // Measure target after layout has settled. Align the clone's reply bar
      // with the .reply-preview element inside the target bubble (not the
      // message-group border, which sits above the reply preview by ~13px).
      const inlineReplyEl = hiddenEl?.querySelector<HTMLElement>(".reply-preview");
      const alignTop = inlineReplyEl
        ? inlineReplyEl.getBoundingClientRect().top
        : (targetRect?.top ?? composeRect.top - 60);
      const deltaY = alignTop - replyBarRect.top;

      // Slide the clone up — pure translation, no size/border morphing.
      // Remove + reveal in the same synchronous tick so the browser paints both
      // in one frame with no visible gap.
      const anim = combinedClone.animate(
        [
          { transform: "translate(0,0)" },
          { transform: `translate(0,${deltaY}px)` },
        ],
        { duration: 260, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" }
      );

      void anim.finished.then(() => {
        combinedClone.remove();
        timeline.showLastHiddenMessage(hiddenEl ?? undefined);
        replyBarEl.style.visibility = "";
        composeBoxEl.style.opacity = "";
        input.animateSent();
      });
    } else {
      // ── Normal send: fly the compose box clone alone ──────────────────────
      const deltaY = (targetRect?.top ?? composeRect.top - 60) - composeRect.top;

      const clone = composeBoxEl.cloneNode(true) as HTMLElement;
      const cloneField = clone.querySelector<HTMLTextAreaElement>("textarea");
      if (cloneField) cloneField.value = body;
      Object.assign(clone.style, {
        position: "fixed",
        left: `${composeRect.left}px`,
        top: `${composeRect.top}px`,
        width: `${composeRect.width}px`,
        height: `${composeRect.height}px`,
        margin: "0",
        zIndex: "500",
        pointerEvents: "none",
        boxSizing: "border-box",
        background: getComputedStyle(composeBoxEl).backgroundColor || "var(--bg)",
      });
      document.body.appendChild(clone);
      composeBoxEl.style.opacity = "0";

      const anim = clone.animate(
        [
          { transform: "translate(0,0)", borderRadius: "0px 8px 8px 0px" },
          { transform: `translate(0,${deltaY}px)`, borderRadius: "8px" },
        ],
        { duration: 260, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" }
      );

      void anim.finished.then(() => {
        clone.remove();
        timeline.showLastHiddenMessage(hiddenEl ?? undefined);
        composeBoxEl.style.opacity = "";
        input.animateSent();
      });
    }
  }

  // Resolve inline emoji in the optimistic message now that it's in the DOM.
  // This converts the data-mxc attributes set by Timeline into actual image srcs.
  {
    const { timeline: tl } = getComponents();
    _downloadInlineEmoji(tl);
  }

  try {
    const eventId = await ipcSendMessage(roomId, body, formattedBody, replyToEventId ?? undefined);
    // Promote the optimistic message to its real server-assigned event ID and
    // register it so the sync echo is ignored (preventing a duplicate).
    const { timeline } = getComponents();
    timeline.confirmMessage(optimisticMsg.id, eventId);
    _ownSentEventIds.add(eventId);
  } catch (err) {
    showError(`Failed to send: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Start composing a reply to a message.
 */
export function startReply(eventId: string, senderName: string, snippet: string): void {
  const { replyPreview } = getComponents();
  AppState.set("replyToEventId", eventId);
  replyPreview.show({ eventId, senderName, snippet });
}

/**
 * Cancel the current reply without touching thread mode.
 */
export function cancelReply(): void {
  const { replyPreview } = getComponents();
  AppState.set("replyToEventId", null);
  // Don't hide if we're in thread mode — thread has its own banner.
  if (!replyPreview.isThreadMode()) {
    replyPreview.hide();
  }
}

/**
 * Begin inline editing of an own message — loads the body into the compose box
 * and shows the edit banner above it.
 */
export function startEdit(eventId: string, body: string): void {
  const { replyPreview, input } = getComponents();
  AppState.set("editingEventId", eventId);
  replyPreview.showEdit(body);
  input.setValue(body);
}

/**
 * Cancel an in-progress inline edit — clears the compose box and the banner.
 */
export function cancelEdit(): void {
  const { replyPreview, input } = getComponents();
  if (AppState.get("editingEventId") === null) return;
  AppState.set("editingEventId", null);
  input.setValue("");
  replyPreview.hide();
}

/**
 * Edit an existing message.
 */
export async function editMessage(eventId: string, newBody: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  // Convert Unicode emoji shortcodes (:smile: → 😄) in the edited text. Custom
  // (MSC2545) emoji are left as :shortcodes: here: the optimistic update writes
  // the body as plain text and the sync echo is suppressed, so a custom-emoji
  // <img> would have no chance to resolve and would render broken.
  const body = replaceUnicodeEmojiShortcodes(newBody);

  try {
    const editEventId = await ipcEditMessage(roomId, eventId, body);
    // Suppress the sync echo so it doesn't double-apply the update.
    _ownSentEventIds.add(editEventId);
    // Optimistically update the DOM immediately without waiting for sync.
    const { timeline } = getComponents();
    timeline.updateMessageBody(eventId, body);
    showSuccess("Message edited");
  } catch (err) {
    showError(`Failed to edit: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Apply a redaction from another user (incoming via sync).
 * Removes the message from the DOM and state cache.
 */
export function applyIncomingRedaction(eventId: string): void {
  const { timeline } = getComponents();
  timeline.removeMessage(eventId);
  AppState.set(
    "currentTimeline",
    AppState.get("currentTimeline").filter((e) => e.event_id !== eventId)
  );
}

/**
 * Redact (delete) a message.
 */
export async function redactMessage(eventId: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  try {
    await ipcRedactMessage(roomId, eventId);
    // Remove immediately from DOM and state cache
    const { timeline } = getComponents();
    timeline.removeMessage(eventId);
    AppState.set(
      "currentTimeline",
      AppState.get("currentTimeline").filter((e) => e.event_id !== eventId)
    );
    showSuccess("Message deleted");
  } catch (err) {
    showError(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
  }
}
