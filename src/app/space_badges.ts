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

/**
 * What a space's room list is built from: its own children, in its order, and
 * each direct subspace with that subspace's children. One level only — a
 * subspace's own subspaces are not listed. A subspace that fails to load is
 * left out; the space's own read failing rejects.
 */
export interface SpaceListing {
  children: SpaceChild[];
  subspaces: { space: SpaceChild; children: SpaceChild[] }[];
}

export async function readSpaceListing(
  spaceId: string,
  getChildren: (spaceId: string) => Promise<SpaceChild[]>,
): Promise<SpaceListing> {
  const children = await getChildren(spaceId);
  const subspaces = await Promise.all(
    children.filter((c) => c.is_space).map(async (space) => {
      try {
        return { space, children: await getChildren(space.room_id) };
      } catch {
        return null;
      }
    }),
  );
  return { children, subspaces: subspaces.filter((s) => s !== null) };
}

/** The room IDs a space's list shows (joined or not — the cache decides). */
export function listedRoomIds(listing: SpaceListing): string[] {
  const rooms = new Set<string>();
  for (const list of [listing.children, ...listing.subspaces.map((s) => s.children)]) {
    for (const c of list) if (!c.is_space) rooms.add(c.room_id);
  }
  return [...rooms];
}

export interface SpaceMembership {
  /** Space ID → its direct rooms. */
  members: Record<string, string[]>;
  /** Direct children (rooms and subspaces) of every listed space. */
  spaceRoomIds: Set<string>;
  /** Subspaces among those children. */
  subspaceIds: Set<string>;
  /** Top-level spaces' `members` with their subspace rooms, once they're read. */
  complete: Promise<Record<string, string[]>>;
  /**
   * The memoized children read behind all of this, for the open space's list
   * in the same refresh (`renderSpaceView`) — so it costs no second read.
   */
  childrenOf: (spaceId: string) => Promise<SpaceChild[]>;
}

/**
 * Which rooms each space's list shows (`readSpaceListing`, as `renderSpaceView`
 * draws it).
 *
 * In two steps, because the second can be slow: a subspace the account never
 * joined is read with a (possibly federated) `/hierarchy` request. The
 * returned promise settles once every listed space's own children are known —
 * all the room list needs — and `complete` follows with the top-level spaces'
 * subspace rooms. Each space's children are read at most once, and a space or
 * subspace that fails to load is skipped rather than failing the rest.
 */
export async function buildSpaceMembership(
  spaceIds: string[],
  getChildren: (spaceId: string) => Promise<SpaceChild[]>,
): Promise<SpaceMembership> {
  const memo = new Map<string, Promise<SpaceChild[]>>();
  const childrenOf = (id: string) => {
    let p = memo.get(id);
    if (!p) {
      p = getChildren(id);
      memo.set(id, p);
    }
    return p;
  };

  const members: Record<string, string[]> = {};
  const spaceRoomIds = new Set<string>();
  const subspaceIds = new Set<string>();

  await Promise.all(
    spaceIds.map(async (spaceId) => {
      const children = await childrenOf(spaceId).catch(() => null);
      if (!children) return;
      for (const c of children) {
        spaceRoomIds.add(c.room_id);
        if (c.is_space) subspaceIds.add(c.room_id);
      }
      members[spaceId] = children.filter((c) => !c.is_space).map((c) => c.room_id);
    }),
  );

  // Only top-level spaces get a badge, and a subspace's list is never shown on
  // its own: expanding a joined subspace would read a level no list shows.
  const complete = (async () => {
    const full: Record<string, string[]> = {};
    await Promise.all(
      Object.keys(members)
        .filter((id) => !subspaceIds.has(id))
        .map(async (spaceId) => {
          full[spaceId] = listedRoomIds(await readSpaceListing(spaceId, childrenOf));
        }),
    );
    return full;
  })();

  return { members, spaceRoomIds, subspaceIds, complete, childrenOf };
}

/** Bumped per publish, so a slow `complete` from an older refresh is dropped. */
let _publishGeneration = 0;

/**
 * Publish the top-level spaces' membership: their direct rooms at once, then
 * their subspace rooms when `complete` settles — unless a newer refresh has
 * published since. Until then each space keeps the rooms it was last shown
 * with, so a badge lit only by a subspace room doesn't blink off while those
 * rooms are re-read; `complete` then drops whatever no longer belongs.
 */
export function publishSpaceMembers(
  membership: Pick<SpaceMembership, "members" | "complete">,
  topLevelIds: string[],
): void {
  const generation = ++_publishGeneration;
  const previous = AppState.get("spaceMembers");
  const pick = (m: Record<string, string[]>) =>
    Object.fromEntries(topLevelIds.map((id) => [id, m[id] ?? []]));
  const interim = pick(membership.members);
  if (previous) {
    for (const id of topLevelIds) {
      interim[id] = [...new Set([...interim[id], ...(previous[id] ?? [])])];
    }
  }
  AppState.set("spaceMembers", interim);
  void membership.complete.then((full) => {
    if (generation === _publishGeneration) AppState.set("spaceMembers", pick(full));
  });
}

/**
 * Keep a strip's badges current: recompute whenever the rooms' unread state,
 * space membership or the open room changes. Every unread path (live sync,
 * mark-as-read, opening a room, mute, refresh) writes `roomListCache`, so this
 * is the one place badges have to listen. Returns an unbind function.
 */
export function bindSpaceBadges(strip: { setBadges(badges: Map<string, SpaceBadge>): void }): () => void {
  const update = () => {
    const spaceMembers = AppState.get("spaceMembers");
    // Until membership is known the pseudo-space filters would count rooms
    // that belong to spaces — Home would flash a count it then drops.
    if (!spaceMembers) {
      strip.setBadges(new Map());
      return;
    }
    strip.setBadges(
      computeSpaceBadges({
        rooms: AppState.get("roomListCache"),
        spaceMembers,
        spaceRoomIds: new Set(AppState.get("spaceRoomIds")),
        currentRoomId: AppState.get("currentRoomId"),
      }),
    );
  };
  const unbinds = [
    AppState.on("roomListCache", update),
    AppState.on("spaceMembers", update),
    AppState.on("spaceRoomIds", update),
    AppState.on("currentRoomId", update),
  ];
  update();
  return () => unbinds.forEach((u) => u());
}
