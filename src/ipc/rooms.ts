// Room IPC calls

import { invoke } from "./invoke.js";
import { isTauri, mockListen } from "./mock.js";
import type { RoomInfo, CreateRoomOptions, RoomMember, PinnedEventInfo, PublicRoomInfo, ReadReceiptInfo, TimelineEvent, SearchSummary, HomeDmInfo } from "./types.js";

export type { RoomInfo, CreateRoomOptions, RoomMember, PinnedEventInfo, PublicRoomInfo, ReadReceiptInfo, HomeDmInfo };

/**
 * Get all joined rooms.
 * Matches the Rust `get_rooms` command.
 */
export async function getRooms(): Promise<RoomInfo[]> {
  return invoke<RoomInfo[]>("get_rooms");
}

/**
 * Get the most recently active 1:1 DMs with latest-message previews for the
 * Home view. Matches the Rust `get_home_data` command.
 */
export async function getHomeData(limit: number): Promise<HomeDmInfo[]> {
  return invoke<HomeDmInfo[]>("get_home_data", { limit });
}

/**
 * Join a room by ID or alias. Returns the canonical room ID.
 * Matches the Rust `join_room` command.
 */
export async function joinRoom(roomIdOrAlias: string): Promise<string> {
  return invoke<string>("join_room", { roomIdOrAlias });
}

/**
 * Leave a room by ID.
 * Matches the Rust `leave_room` command.
 */
export async function leaveRoom(roomId: string): Promise<void> {
  return invoke<void>("leave_room", { roomId });
}

/**
 * Create a new room. Returns the new room ID.
 * Matches the Rust `create_room` command.
 */
export async function createRoom(options: CreateRoomOptions): Promise<string> {
  return invoke<string>("create_room", { options });
}

/**
 * Resolve the existing DM room shared with `userId`, or null if there is none.
 *
 * Reads the account's `m.direct` mapping in the Rust store (no HTTP), which is
 * authoritative — unlike scanning the cached room list, it still finds a DM
 * whose other party has left, one that is only an invite so far, and one that
 * hasn't reached the frontend cache yet. Matches the Rust `find_dm_room`.
 */
export async function findDmRoom(userId: string): Promise<string | null> {
  return invoke<string | null>("find_dm_room", { userId });
}

/**
 * Get the member list for a room.
 * Matches the Rust `get_room_members` command.
 */
export async function getRoomMembers(roomId: string): Promise<RoomMember[]> {
  return invoke<RoomMember[]>("get_room_members", { roomId });
}

/**
 * Send a read receipt for the latest event in a room, clearing the unread count.
 * Matches the Rust `mark_room_read` command.
 */
export async function markRoomRead(roomId: string): Promise<void> {
  return invoke<void>("mark_room_read", { roomId });
}

/**
 * Get other members' latest public read positions for a room (initial seed for
 * the read-receipt avatars). Matches the Rust `get_room_receipts` command.
 */
export async function getRoomReceipts(roomId: string): Promise<ReadReceiptInfo[]> {
  return invoke<ReadReceiptInfo[]>("get_room_receipts", { roomId });
}

/**
 * Get pinned events for a room.
 * Matches the Rust `get_pinned_events` command.
 */
export async function getPinnedEvents(roomId: string): Promise<PinnedEventInfo[]> {
  return invoke<PinnedEventInfo[]>("get_pinned_events", { roomId });
}

/**
 * Search the public room directory.
 * Matches the Rust `search_room_directory` command.
 */
export async function searchRoomDirectory(filter?: string, limit?: number): Promise<PublicRoomInfo[]> {
  return invoke<PublicRoomInfo[]>("search_room_directory", {
    filter: filter ?? null,
    limit: limit ?? null,
  });
}

/**
 * Invite a user to the given room.
 * Matches the Rust `invite_user` command.
 */
export async function inviteUser(roomId: string, userId: string): Promise<void> {
  return invoke<void>("invite_user", { roomId, userId });
}

/**
 * Kick a user from the given room with an optional reason.
 * Matches the Rust `kick_user` command.
 */
export async function kickUser(roomId: string, userId: string, reason?: string): Promise<void> {
  return invoke<void>("kick_user", { roomId, userId, reason: reason ?? null });
}

/**
 * Ban a user from the given room with an optional reason.
 * Matches the Rust `ban_user` command.
 */
export async function banUser(roomId: string, userId: string, reason?: string): Promise<void> {
  return invoke<void>("ban_user", { roomId, userId, reason: reason ?? null });
}

/**
 * Unban a user from the given room.
 * Matches the Rust `unban_user` command.
 */
export async function unbanUser(roomId: string, userId: string): Promise<void> {
  return invoke<void>("unban_user", { roomId, userId });
}

// ─── Message search ───────────────────────────────────────────────────────────

/** Tauri event names emitted by the streaming server-side search command. */
export const EVENT_SEARCH_HIT = "quark://search/hit";
export const EVENT_SEARCH_PROGRESS = "quark://search/progress";

/** Payload of an `EVENT_SEARCH_HIT` event — one matched message. */
export interface SearchHitPayload {
  room_id: string;
  event: TimelineEvent;
}

/** Payload of an `EVENT_SEARCH_PROGRESS` event. */
export interface SearchProgressPayload {
  scanned: number;
  /** Oldest message timestamp (epoch ms) scanned so far, as a running minimum.
   *  Absent until at least one timestamped event has been scanned. Drives the
   *  "back to «date»" readout and the date-scope progress bar. */
  oldest_ts?: number | null;
}

/**
 * Tier 2 — search the locally cached/persisted events (matrix-sdk event cache)
 * for the given room. Fast, offline, bounded result set. Matches the Rust
 * `search_room_cache` command.
 */
export async function searchRoomCache(roomId: string, query: string): Promise<TimelineEvent[]> {
  return invoke<TimelineEvent[]>("search_room_cache", { roomId, query });
}

/**
 * Tiers 3/4 — server-side streaming search. Paginates the room backward,
 * matching as it goes and emitting each hit via `EVENT_SEARCH_HIT` plus
 * progress via `EVENT_SEARCH_PROGRESS`. Subscribe with `listenSearchEvents`
 * *before* calling this. Resolves with a summary when the scan ends.
 *
 * @param untilTs   epoch ms; stop once events are older than this (date-range
 *                  scan). Omit to scan to the start of the room.
 * @param maxEvents safety cap on events scanned.
 * Matches the Rust `search_room_messages` command.
 */
export async function searchRoomMessages(
  roomId: string,
  query: string,
  untilTs?: number,
  maxEvents?: number,
): Promise<SearchSummary> {
  return invoke<SearchSummary>("search_room_messages", {
    roomId,
    query,
    untilTs: untilTs ?? null,
    maxEvents: maxEvents ?? null,
  });
}

/** Cancel an in-progress server-side search. Matches `cancel_room_search`. */
export async function cancelRoomSearch(): Promise<void> {
  return invoke<void>("cancel_room_search");
}

/**
 * Last-known total event count for a room, recorded when a prior "entire
 * history" search ran to completion (reached the start of the room). Returns
 * null if no full scan has been recorded yet. Used to seed a real percentage
 * progress bar for the "entire history" tier. Matches `get_room_scan_total`.
 */
export async function getRoomScanTotal(roomId: string): Promise<number | null> {
  return invoke<number | null>("get_room_scan_total", { roomId });
}

/**
 * Subscribe to streaming search events. Works in both Tauri (real backend) and
 * mock/browser dev mode. Returns an unlisten function that removes both
 * listeners.
 */
export async function listenSearchEvents(
  onHit: (p: SearchHitPayload) => void,
  onProgress: (p: SearchProgressPayload) => void,
): Promise<() => void> {
  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    const unHit = await listen<SearchHitPayload>(EVENT_SEARCH_HIT, (e) => onHit(e.payload));
    const unProg = await listen<SearchProgressPayload>(EVENT_SEARCH_PROGRESS, (e) => onProgress(e.payload));
    return () => {
      unHit();
      unProg();
    };
  }
  const unHit = mockListen(EVENT_SEARCH_HIT, (p) => onHit(p as SearchHitPayload));
  const unProg = mockListen(EVENT_SEARCH_PROGRESS, (p) => onProgress(p as SearchProgressPayload));
  return () => {
    unHit();
    unProg();
  };
}
