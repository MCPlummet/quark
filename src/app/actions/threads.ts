// Thread panel actions: opening/closing the inline thread and sending replies.

import { AppState } from "../state.js";
import { isMobile, closeDrawer } from "../mobile.js";

import {
  getThreadTimeline,
  sendThreadReplyIpc,
} from "../../ipc/index.js";

import { showError } from "../../ui/NotificationToast.js";

import {
  getComponents,
  _ownSentEventIds,
  resolveDisplayName,
  prepareOutgoingBody,
  _downloadMessageImages,
} from "./context.js";

/**
 * Open the inline thread panel for a given root event.
 * The panel expands directly below the root message in the timeline.
 */
export async function openThread(eventId: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  const { timeline } = getComponents();
  AppState.set("threadRootEventId", eventId);

  // Mobile is one-overlay-at-a-time: opening a thread pulls focus away from
  // the drawer.
  if (isMobile()) closeDrawer();

  const ownUserId = AppState.get("ownUserId");

  // Show the thread banner in the reply-preview bar so the compose box is
  // visually marked as "sending to thread".
  const { replyPreview } = getComponents();
  const rootEvent = AppState.get("currentTimeline").find((e) => e.event_id === eventId);
  const rootSnippet = rootEvent ? rootEvent.body.slice(0, 80) : "";
  replyPreview.showThread(rootSnippet);

  try {
    const replies = await getThreadTimeline(roomId, eventId);
    const replyData = replies.map((e) => ({
      id: e.event_id,
      senderName: resolveDisplayName(e.sender),
      isOwn: ownUserId ? e.sender === ownUserId : false,
      timestamp: new Date(e.timestamp).toISOString(),
      body: e.body,
      htmlBody: e.formatted_body ?? undefined,
      type: (e.msg_type === "m.image" ? "image" : e.msg_type === "m.sticker" ? "sticker" : e.msg_type === "m.video" ? "video" : e.msg_type === "m.file" ? "file" : "text") as "text" | "image" | "sticker" | "video" | "file",
      mediaUrl: e.media_url ?? undefined,
      mediaAlt: e.body,
      mediaMimeType: e.media_mimetype ?? undefined,
      mediaEncryptionInfo: e.media_encryption_info ?? undefined,
      mediaThumbnailUrl: e.media_thumbnail_url ?? undefined,
      mediaThumbnailEncryptionInfo: e.media_thumbnail_encryption_info ?? undefined,
    }));
    timeline.openInlineThread(eventId, replyData);
    _downloadMessageImages(replies, {
      updateMessageMedia: (id: string, url: string) => timeline.updateInlineThreadMedia(id, url),
    });
  } catch (err) {
    showError(`Failed to load thread: ${err instanceof Error ? err.message : String(err)}`);
    replyPreview.hide();
  }
}

/**
 * Close the inline thread panel.
 */
export function closeThread(): void {
  const { timeline, replyPreview } = getComponents();
  AppState.set("threadRootEventId", null);
  timeline.closeInlineThread();
  if (replyPreview.isThreadMode()) replyPreview.hide();
}

/**
 * Send a reply into the open inline thread.
 * Uses a text-clone fly animation from the compose field to the thread panel.
 */
export async function sendThreadReply(body: string, threadRootId: string, roomId: string): Promise<void> {
  const { timeline, input } = getComponents();
  const ownUserId = AppState.get("ownUserId");
  const ownName = AppState.get("ownDisplayName") ?? ownUserId ?? "me";

  // Resolve emoji before composing the optimistic reply (see sendMessage): Unicode
  // shortcodes become glyphs in the plain body, custom emoji become inline images
  // in the formatted body.
  const prepared = prepareOutgoingBody(body);
  body = prepared.body;

  const optimisticId = `local-thread-${Date.now()}`;
  const optimisticMsg = {
    id: optimisticId,
    senderName: ownName,
    isOwn: true,
    timestamp: new Date().toISOString(),
    body,
  };

  // Append hidden to thread panel so we can measure its position.
  timeline.appendInlineReply(optimisticMsg);
  // Optimistically update the reply count indicator on the thread root.
  timeline.incrementThreadReplyCount(threadRootId);

  const fieldEl = input.getFieldElement();
  const fieldRect = fieldEl.getBoundingClientRect();
  const fieldStyle = getComputedStyle(fieldEl);

  // Find the just-appended message element's body as the target.
  const targetEl = timeline.getInlineThreadMessageEl(optimisticId);
  const targetRect = targetEl?.getBoundingClientRect() ?? null;

  input.setValue("");

  // Fly a text clone from the compose field to the target in the thread panel.
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

  if (targetRect) {
    const dx = targetRect.left - fieldRect.left - parseFloat(fieldStyle.paddingLeft);
    const dy = targetRect.top - fieldRect.top - parseFloat(fieldStyle.paddingTop);

    const anim = textClone.animate(
      [
        { transform: "translate(0,0)", opacity: "0.9" },
        { transform: `translate(${dx}px,${dy}px)`, opacity: "0" },
      ],
      { duration: 240, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" }
    );
    void anim.finished.then(() => textClone.remove());
  } else {
    textClone.remove();
  }

  input.animateSent();

  const threadFormattedBody = prepared.formattedBody;

  try {
    const eventId = await sendThreadReplyIpc(roomId, threadRootId, body, threadFormattedBody);
    _ownSentEventIds.add(eventId);
  } catch (err) {
    showError(`Failed to send thread reply: ${err instanceof Error ? err.message : String(err)}`);
  }
}
