// Thread IPC calls

import { invoke } from "./invoke.js";
import { inSendOrder } from "./send_order.js";
import type { TimelineEvent, ThreadRoot } from "./types.js";

export type { ThreadRoot };

/**
 * Get all thread roots in a room.
 * Matches the Rust `get_thread_roots` command.
 */
export async function getThreadRoots(roomId: string): Promise<ThreadRoot[]> {
  return invoke<ThreadRoot[]>("get_thread_roots", { roomId });
}

/**
 * Get the full timeline of a thread (root + replies).
 * Matches the Rust `get_thread_timeline` command.
 */
export async function getThreadTimeline(
  roomId: string,
  threadRootEventId: string,
): Promise<TimelineEvent[]> {
  return invoke<TimelineEvent[]>("get_thread_timeline", {
    roomId,
    threadRootEventId,
  });
}

/**
 * Send a message into a thread. Returns the new event ID.
 * Matches the Rust `send_thread_reply` command.
 *
 * With `replyToEventId` (one of the thread's own messages) the event is a
 * reply inside the thread — `m.thread` carrying that event as a real
 * `m.in_reply_to` — rather than a plain thread message whose reply pointer is
 * only the `is_falling_back` one.
 */
export async function sendThreadReplyIpc(
  roomId: string,
  threadRootEventId: string,
  body: string,
  formattedBody?: string,
  replyToEventId?: string,
): Promise<string> {
  return inSendOrder(roomId, () => invoke<string>("send_thread_reply", {
    roomId,
    threadRootEventId,
    body,
    formattedBody,
    replyToEventId: replyToEventId ?? null,
  }));
}
