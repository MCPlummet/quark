// Space-strip notification badges (#148).
//
// A space shows what its rooms' rows in the room list would show: an unread
// dot when any of them is unread, a mention count when any of them mentions
// you. The two counters keep the room list's meaning (see `roomInfoToEntry`):
// `unread_count` drives the dot, `notification_count` the count. A muted room
// never lights the dot, but its mentions still count, exactly as on its row.

import type { RoomInfo, SpaceChild } from "../ipc/types.js";
import { PSEUDO_SPACES } from "./pseudo_spaces.js";
import { AppState } from "./state.js";

export interface SpaceBadge {
  unread: boolean;
  mentions: number;
}

export interface SpaceBadgeInput {
  rooms: RoomInfo[];
  /** Top-level space ID → the room IDs its room list shows. */
  spaceMembers: Record<string, string[]>;
  /** Rooms that belong to any space (drives the pseudo-space filters). */
  spaceRoomIds: Set<string>;
  /** The open room is exempt: its badge is cleared locally on open. */
  currentRoomId: string | null;
}

/** Badge state for every space and pseudo-space with something to show. */
export function computeSpaceBadges(input: SpaceBadgeInput): Map<string, SpaceBadge> {
  const { rooms, spaceMembers, spaceRoomIds, currentRoomId } = input;
  const byId = new Map(rooms.map((r) => [r.room_id, r]));
  const out = new Map<string, SpaceBadge>();

  const fold = (id: string, members: Iterable<RoomInfo>) => {
    let unread = false;
    let mentions = 0;
    for (const r of members) {
      if (r.room_id === currentRoomId) continue;
      if (r.unread_count > 0 && !r.muted) unread = true;
      mentions += r.notification_count;
    }
    if (unread || mentions > 0) out.set(id, { unread, mentions });
  };

  for (const [spaceId, roomIds] of Object.entries(spaceMembers)) {
    fold(spaceId, roomIds.flatMap((id) => byId.get(id) ?? []));
  }
  for (const ps of PSEUDO_SPACES) {
    fold(ps.id, rooms.filter((r) => ps.filter(r, spaceRoomIds)));
  }
  return out;
}

/** The count as drawn on a space icon. */
export function formatMentionCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export interface SpaceMembership {
  /** Space ID → its direct rooms plus one level of subspace rooms. */
  members: Record<string, string[]>;
  /** Direct children (rooms and subspaces) of every listed space. */
  spaceRoomIds: Set<string>;
  /** Subspaces among those children. */
  subspaceIds: Set<string>;
}

/**
 * Which rooms each space's list shows, matching `renderSpaceView`: a space's
 * direct rooms and the rooms of its direct subspaces. Each space's children
 * are read at most once, and a space or subspace that fails to load is
 * skipped rather than failing the rest.
 */
export async function buildSpaceMembership(
  spaceIds: string[],
  getChildren: (spaceId: string) => Promise<SpaceChild[]>,
): Promise<SpaceMembership> {
  const memo = new Map<string, Promise<SpaceChild[] | null>>();
  const childrenOf = (id: string) => {
    let p = memo.get(id);
    if (!p) {
      p = getChildren(id).catch(() => null);
      memo.set(id, p);
    }
    return p;
  };

  const members: Record<string, string[]> = {};
  const spaceRoomIds = new Set<string>();
  const subspaceIds = new Set<string>();

  await Promise.all(
    spaceIds.map(async (spaceId) => {
      const children = await childrenOf(spaceId);
      if (!children) return;
      const rooms = new Set<string>();
      for (const c of children) {
        spaceRoomIds.add(c.room_id);
        if (c.is_space) subspaceIds.add(c.room_id);
        else rooms.add(c.room_id);
      }
      const subs = await Promise.all(
        children.filter((c) => c.is_space).map((c) => childrenOf(c.room_id)),
      );
      for (const list of subs) {
        for (const c of list ?? []) if (!c.is_space) rooms.add(c.room_id);
      }
      members[spaceId] = [...rooms];
    }),
  );

  return { members, spaceRoomIds, subspaceIds };
}

/**
 * Keep a strip's badges current: recompute whenever the rooms' unread state,
 * space membership or the open room changes. Every unread path (live sync,
 * mark-as-read, opening a room, mute, refresh) writes `roomListCache`, so this
 * is the one place badges have to listen. Returns an unbind function.
 */
export function bindSpaceBadges(strip: { setBadges(badges: Map<string, SpaceBadge>): void }): () => void {
  const update = () =>
    strip.setBadges(
      computeSpaceBadges({
        rooms: AppState.get("roomListCache"),
        spaceMembers: AppState.get("spaceMembers"),
        spaceRoomIds: new Set(AppState.get("spaceRoomIds")),
        currentRoomId: AppState.get("currentRoomId"),
      }),
    );
  const unbinds = [
    AppState.on("roomListCache", update),
    AppState.on("spaceMembers", update),
    AppState.on("spaceRoomIds", update),
    AppState.on("currentRoomId", update),
  ];
  update();
  return () => unbinds.forEach((u) => u());
}
