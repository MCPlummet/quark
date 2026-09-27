// Live timeline events: painting one message into the open room as it happens.
//
// Two producers feed this. The sync listener (`sync.ts`) is the obvious one.
// The other is this device's own attachment sends, which paint the event the
// send just produced instead of waiting for the sync loop to echo it back (#112).
// They share one path so an event is rendered — and deduplicated — the same
// way whichever of the two gets there first.

import { AppState } from "../state.js";
import type { TimelineEvent } from "../../ipc/types.js";
import type { Timeline } from "../../ui/Timeline.js";

import {
  getComponents,
  consumeOwnSentEvent,
  isInContextView,
  downloadSyncMessageImage,
  ensureSenderAvatarDownloaded,
  resolveInlineEmojiForTimeline,
  timelineEventToMessage,
  timelineEventToThreadMessage,
} from "./context.js";
import { appendRoomTimelineCache, bumpRoomActivity } from "./rooms.js";
import { homeViewHandleMessage } from "./home.js";

/**
 * Record a live event everywhere that tracks a room's recent history, whether
 * or not the room is open: the per-room timeline cache, the room's recency and
 * the Home canvas. Every one of these is idempotent by event id or harmless to
 * repeat, so an event arriving twice (local echo, then sync) is fine.
 */
export function recordLiveEvent(roomId: string, event: TimelineEvent): void {
  // Keep the per-room timeline cache warm for any room we've loaded this
  // session (not just the current one), so revisiting it paints the latest
  // messages instantly instead of a stale tail. No-op for uncached rooms.
  appendRoomTimelineCache(roomId, event);

  // Bump the room's recency so the pseudo-space views (Home/DMs/Groups)
  // re-sort as messages arrive — own echoes included, so sending also
  // floats the room to the top.
  bumpRoomActivity(roomId, event.timestamp);

  // Keep the Home canvas's bubbles live (no-op when it isn't showing).
  homeViewHandleMessage(roomId, event);
}

/**
 * Paint a live event into the open room's timeline (or its open thread panel).
 * The caller has already established that `event` belongs to the open room and
 * that the room is showing its live tail (not context view).
 *
 * Idempotent by event id: an event already in state or in the DOM is left
 * alone, so the second of two deliveries is a no-op.
 *
 * Returns whether the event is now drawn somewhere the user can see it — not
 * the same as "its room is open": a thread reply with its panel closed lands
 * nowhere, and the caller's toast is then the only sign it arrived (#89).
 */
export function renderLiveEvent(event: TimelineEvent, timeline: Timeline): boolean {
  // Deduplicate: skip events already in the state cache (e.g. initial sync
  // replay of messages already loaded via getTimeline, an attachment's local
  // echo followed by its sync echo, or a second client emitting the same event
  // in dev hot-reload scenarios).
  const current = AppState.get("currentTimeline");
  const alreadyInState = current.some((e) => e.event_id === event.event_id);
  if (!alreadyInState) {
    AppState.set("currentTimeline", [...current, event]);
  }

  // Skip rendering if: (a) already in state (replay), (b) it's our own
  // echo (deduplication via _ownSentEventIds), or (c) it's already in the
  // DOM (race: echo arrived after confirmMessage but before add-to-set).
  const alreadyInDom = !!timeline.getMessageElementById(event.event_id);
  if (alreadyInState || alreadyInDom || consumeOwnSentEvent(event.event_id)) {
    return true;
  }

  if (event.thread_root) {
    // Thread replies never appear in the main timeline. Route to the thread
    // panel if the matching thread is open, and always update the reply count
    // indicator on the thread root message.
    const openThreadId = AppState.get("threadRootEventId");
    let rendered = false;
    if (openThreadId !== null && event.thread_root === openThreadId) {
      // Map with the same converter the thread-open path uses, so a reply that
      // arrives live renders with its media (image/video/sticker/file) instead
      // of a bare filename line.
      timeline.appendInlineReply(timelineEventToThreadMessage(event));
      // …and resolve its mxc:// media into the panel, mirroring what
      // openThread() does for the replies it loads.
      downloadSyncMessageImage(event, {
        updateMessageMedia: (id, url) => timeline.updateInlineThreadMedia(id, url),
      });
      // Inline custom emoji in the reply (or its caption) need the same
      // treatment as the main-timeline append below — the panel renders into
      // the timeline's list, so one resolver covers both.
      if (event.formatted_body || event.caption_formatted) {
        resolveInlineEmojiForTimeline(timeline);
      }
      rendered = true;
    }
    // Otherwise the panel is closed, or showing a different thread. The reply
    // lands in neither the main timeline nor the panel, so the toast is the
    // only signal that it arrived — the reply-count bump below is a number on
    // an existing message, easily missed.
    timeline.incrementThreadReplyCount(event.thread_root);
    return rendered;
  }

  if (event.is_edit && event.relates_to_event_id) {
    // Edit: update the original message body in place
    timeline.updateMessageBody(
      event.relates_to_event_id,
      event.body,
      event.formatted_body ?? undefined,
    );
    // An edit can introduce custom (MSC2545) emoji that were not in the
    // original body — resolve their mxc:// srcs like the append path.
    if (event.formatted_body) resolveInlineEmojiForTimeline(timeline);
    return true;
  }

  // `currentTimeline` (already including this event, appended above) is the
  // lookup list for the reply preview — the same list the room-load path passes.
  timeline.appendMessage(timelineEventToMessage(event, AppState.get("currentTimeline")));
  downloadSyncMessageImage(event, timeline);
  ensureSenderAvatarDownloaded(event.sender, timeline);
  resolveInlineEmojiForTimeline(timeline);
  return true;
}

/**
 * Show an event this device has just sent, without waiting for sync to echo it.
 *
 * Text, stickers and GIFs have always painted optimistically; attachments did
 * not, and relied on the sync loop alone to bring the sent event back (#112).
 * That loop is exactly what cannot be relied on right after picking a file on
 * a phone: the system picker backgrounds the app, and the loop comes back from
 * that holding a long-poll or a backoff sleep. The send has the event in hand
 * the moment it returns, so it paints it then; the sync echo that follows is
 * deduplicated by id in {@link renderLiveEvent}.
 */
export function showSentEvent(roomId: string, event: TimelineEvent): void {
  recordLiveEvent(roomId, event);
  if (roomId !== AppState.get("currentRoomId") || isInContextView()) return;
  renderLiveEvent(event, getComponents().timeline);
}
