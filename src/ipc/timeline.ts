// Timeline IPC calls

import { invoke } from "./invoke.js";
import type { TimelineEvent, TimelinePage, EventContextPage, TimelineForwardPage, CachedTimelinePage } from "./types.js";

export type { TimelineEvent, TimelinePage, EventContextPage, TimelineForwardPage, CachedTimelinePage };

/**
 * Open a room's timeline from the matrix-sdk event cache (the cache-backed live
 * path). Returns currently-cached events oldest-first; `reached_start` replaces
 * the `prev_batch` token. Matches the Rust `open_room_timeline` command.
 */
export async function openRoomTimeline(
  roomId: string,
  limit?: number,
): Promise<CachedTimelinePage> {
  return invoke<CachedTimelinePage>("open_room_timeline", { roomId, limit });
}

/**
 * Load older history into the cache and return only the newly-prepended events
 * (oldest-first). `reached_start === true` means the start of the room has been
 * reached. Matches the Rust `load_older_timeline` command.
 */
export async function loadOlderTimeline(
  roomId: string,
  batchSize?: number,
): Promise<CachedTimelinePage> {
  return invoke<CachedTimelinePage>("load_older_timeline", { roomId, batchSize });
}

/**
 * Fetch a page of timeline events for a room.
 * Pass `before` (from a previous `TimelinePage.prev_batch`) to load older messages.
 * Matches the Rust `get_timeline` command.
 */
export async function getTimeline(
  roomId: string,
  opts?: { limit?: number; before?: string },
): Promise<TimelinePage> {
  return invoke<TimelinePage>("get_timeline", {
    roomId,
    limit: opts?.limit,
    before: opts?.before,
  });
}

/**
 * Fetch events surrounding a specific event (Matrix /context endpoint).
 * Returns a window of events centered on the target, oldest-first.
 * Matches the Rust `get_event_context` command.
 */
export async function getEventContext(
  roomId: string,
  eventId: string,
  contextSize?: number,
): Promise<EventContextPage> {
  return invoke<EventContextPage>("get_event_context", { roomId, eventId, contextSize });
}

/**
 * Fetch a single message by event ID, or null when the event exists but is
 * not a displayable message. Used to resolve a reply preview whose original
 * is outside the loaded window. Matches the Rust `get_event` command.
 */
export async function getEvent(roomId: string, eventId: string): Promise<TimelineEvent | null> {
  return invoke<TimelineEvent | null>("get_event", { roomId, eventId });
}

/**
 * Fetch newer events using a forward-pagination token from a prior
 * `get_event_context` or `paginate_forward` response.
 * Returns events in chronological order. `next_batch === null` means the live
 * tail has been reached. Matches the Rust `paginate_forward` command.
 */
export async function paginateForward(
  roomId: string,
  after: string,
  limit?: number,
): Promise<TimelineForwardPage> {
  return invoke<TimelineForwardPage>("paginate_forward", { roomId, after, limit });
}

/**
 * Send a plain-text (or HTML) message. Returns the new event ID.
 * Matches the Rust `send_message` command.
 */
export async function sendMessage(
  roomId: string,
  body: string,
  formattedBody?: string,
  inReplyTo?: string,
): Promise<string> {
  return invoke<string>("send_message", { roomId, body, formattedBody, inReplyTo });
}

/**
 * Edit an existing message. Returns the edit event ID.
 * Matches the Rust `edit_message` command.
 */
export async function editMessage(
  roomId: string,
  eventId: string,
  newBody: string,
  newFormattedBody?: string,
): Promise<string> {
  return invoke<string>("edit_message", {
    roomId,
    eventId,
    newBody,
    newFormattedBody,
  });
}

/**
 * Fetch all edit revisions (m.replace relations) for a given event, oldest-first.
 * Matches the Rust `get_message_revisions` command.
 */
export async function getMessageRevisions(
  roomId: string,
  eventId: string,
): Promise<TimelineEvent[]> {
  return invoke<TimelineEvent[]>("get_message_revisions", { roomId, eventId });
}

/**
 * Redact (delete) a message. Returns the redaction event ID.
 * Matches the Rust `redact_message` command.
 */
export async function redactMessage(
  roomId: string,
  eventId: string,
  reason?: string,
): Promise<string> {
  return invoke<string>("redact_message", { roomId, eventId, reason });
}
