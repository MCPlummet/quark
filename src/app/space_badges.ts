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
  /** Space ID → its direct rooms. */
  members: Record<string, string[]>;
  /** Direct children (rooms and subspaces) of every listed space. */
  spaceRoomIds: Set<string>;
  /** Subspaces among those children. */
  subspaceIds: Set<string>;
  /** `members` with one level of subspace rooms added, once they're read. */
  complete: Promise<Record<string, string[]>>;
}

/**
 * Which rooms each space's list shows, matching `renderSpaceView`: a space's
 * direct rooms and the rooms of its direct subspaces.
 *
 * In two steps, because the second can be slow: a subspace the account never
 * joined is read with a (possibly federated) `/hierarchy` request. The
 * returned promise settles once every listed space's own children are known —
 * all the room list needs — and `complete` follows with the subspace rooms.
 * Each space's children are read at most once, and a space or subspace that
 * fails to load is skipped rather than failing the rest.
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
  const subspacesOf = new Map<string, string[]>();

  await Promise.all(
    spaceIds.map(async (spaceId) => {
      const children = await childrenOf(spaceId);
      if (!children) return;
      for (const c of children) {
        spaceRoomIds.add(c.room_id);
        if (c.is_space) subspaceIds.add(c.room_id);
      }
      members[spaceId] = children.filter((c) => !c.is_space).map((c) => c.room_id);
      subspacesOf.set(spaceId, children.filter((c) => c.is_space).map((c) => c.room_id));
    }),
  );

  const complete = (async () => {
    const full: Record<string, string[]> = {};
    await Promise.all(
      Object.entries(members).map(async ([spaceId, direct]) => {
        const rooms = new Set(direct);
        const subs = await Promise.all((subspacesOf.get(spaceId) ?? []).map(childrenOf));
        for (const list of subs) {
          for (const c of list ?? []) if (!c.is_space) rooms.add(c.room_id);
        }
        full[spaceId] = [...rooms];
      }),
    );
    return full;
  })();

  return { members, spaceRoomIds, subspaceIds, complete };
}

/** Bumped per publish, so a slow `complete` from an older refresh is dropped. */
let _publishGeneration = 0;

/**
 * Publish the top-level spaces' membership: their direct rooms at once, then
 * their subspace rooms when `complete` settles — unless a newer refresh has
 * published since.
 */
export function publishSpaceMembers(
  membership: Pick<SpaceMembership, "members" | "complete">,
  topLevelIds: string[],
): void {
  const generation = ++_publishGeneration;
  const pick = (m: Record<string, string[]>) =>
    Object.fromEntries(topLevelIds.map((id) => [id, m[id] ?? []]));
  AppState.set("spaceMembers", pick(membership.members));
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
