import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RoomInfo, SpaceChild } from "../ipc/types.js";
import { AppState } from "./state.js";
import {
  bindSpaceBadges,
  buildSpaceMembership,
  computeSpaceBadges,
  formatMentionCount,
  type SpaceBadge,
} from "./space_badges.js";

function room(
  room_id: string,
  { unread = 0, mentions = 0, muted = false, is_direct = false } = {},
): RoomInfo {
  return {
    room_id,
    name: room_id,
    topic: null,
    avatar_url: null,
    unread_count: unread,
    notification_count: mentions,
    is_direct,
    is_encrypted: false,
    member_count: 2,
    muted,
  };
}

function child(room_id: string, is_space = false): SpaceChild {
  return {
    room_id,
    name: room_id,
    topic: null,
    avatar_url: null,
    is_space,
    member_count: null,
    order: null,
    canonical_alias: null,
  };
}

const S = "!space:x";
const S2 = "!space2:x";

function badges(
  rooms: RoomInfo[],
  spaceMembers: Record<string, string[]>,
  { currentRoomId = null as string | null, spaceRoomIds = null as Set<string> | null } = {},
) {
  const inSpaces = spaceRoomIds ?? new Set(Object.values(spaceMembers).flat());
  return computeSpaceBadges({ rooms, spaceMembers, spaceRoomIds: inSpaces, currentRoomId });
}

describe("computeSpaceBadges", () => {
  it("dot when a member room is unread", () => {
    const b = badges([room("!a", { unread: 2 })], { [S]: ["!a"] });
    expect(b.get(S)).toEqual({ unread: true, mentions: 0 });
  });

  it("sums mention counts", () => {
    const b = badges(
      [room("!a", { unread: 2, mentions: 2 }), room("!b", { unread: 3, mentions: 3 })],
      { [S]: ["!a", "!b"] },
    );
    expect(b.get(S)?.mentions).toBe(5);
  });

  it("ignores muted rooms for the dot", () => {
    const b = badges([room("!a", { unread: 4, muted: true })], { [S]: ["!a"] });
    expect(b.has(S)).toBe(false);
  });

  it("counts mentions in muted rooms", () => {
    const b = badges([room("!a", { unread: 1, mentions: 1, muted: true })], { [S]: ["!a"] });
    expect(b.get(S)).toEqual({ unread: false, mentions: 1 });
  });

  it("excludes the open room", () => {
    const b = badges([room("!a", { unread: 1, mentions: 1 })], { [S]: ["!a"] }, { currentRoomId: "!a" });
    expect(b.has(S)).toBe(false);
  });

  it("ignores rooms missing from the cache", () => {
    const b = badges([], { [S]: ["!gone"] });
    expect(b.has(S)).toBe(false);
  });

  it("counts a room toward every space listing it", () => {
    const b = badges([room("!a", { unread: 1 })], { [S]: ["!a"], [S2]: ["!a"] });
    expect(b.get(S)?.unread).toBe(true);
    expect(b.get(S2)?.unread).toBe(true);
  });

  it("covers pseudo-spaces with their filters", () => {
    const dm = badges([room("!d", { unread: 1, is_direct: true })], {}, { spaceRoomIds: new Set() });
    expect(dm.has("__home__")).toBe(true);
    expect(dm.has("__dms__")).toBe(true);
    expect(dm.has("__groups__")).toBe(false);

    const group = badges([room("!g", { unread: 1 })], {}, { spaceRoomIds: new Set() });
    expect(group.has("__home__")).toBe(true);
    expect(group.has("__groups__")).toBe(true);
    expect(group.has("__dms__")).toBe(false);
  });

  it("omits spaces with nothing to show", () => {
    const b = badges([room("!a"), room("!d", { is_direct: true })], { [S]: ["!a"] });
    expect(b.size).toBe(0);
  });
});

describe("formatMentionCount", () => {
  it("prints small counts as-is", () => expect(formatMentionCount(7)).toBe("7"));
  it("caps at 99+", () => {
    expect(formatMentionCount(99)).toBe("99");
    expect(formatMentionCount(100)).toBe("99+");
  });
});

describe("buildSpaceMembership", () => {
  const S3 = "!space3:x";
  const tree: Record<string, SpaceChild[]> = {
    [S]: [child("!r1"), child(S2, true)],
    [S2]: [child("!r2"), child(S3, true)],
    [S3]: [child("!r3")],
  };
  const fromTree = () => vi.fn(async (id: string) => tree[id] ?? []);

  it("includes direct rooms and one level of subspace rooms", async () => {
    const { members } = await buildSpaceMembership([S], fromTree());
    expect([...members[S]].sort()).toEqual(["!r1", "!r2"]);
  });

  it("keeps today's spaceRoomIds semantics: direct children of every listed space, subspaces included", async () => {
    const { spaceRoomIds, subspaceIds } = await buildSpaceMembership([S, S2], fromTree());
    expect([...spaceRoomIds].sort()).toEqual(["!r1", "!r2", S2, S3].sort());
    expect([...subspaceIds].sort()).toEqual([S2, S3].sort());
  });

  it("fetches each space's children at most once", async () => {
    const getChildren = fromTree();
    await buildSpaceMembership([S, S2], getChildren);
    expect(getChildren.mock.calls.filter(([id]) => id === S2)).toHaveLength(1);
  });

  it("skips a space or subspace whose children fail to load", async () => {
    const getChildren = vi.fn(async (id: string) => {
      if (id === S2) throw new Error("unreachable");
      return tree[id] ?? [];
    });
    const { members } = await buildSpaceMembership([S], getChildren);
    expect(members[S]).toEqual(["!r1"]);
  });
});

describe("bindSpaceBadges", () => {
  // AppState is a singleton: reset what these tests touch.
  beforeEach(() => {
    AppState.set("currentRoomId", null);
    AppState.set("spaceRoomIds", []);
    AppState.set("spaceMembers", {});
    AppState.set("roomListCache", []);
  });

  const fakeStrip = () => {
    const calls: Map<string, SpaceBadge>[] = [];
    return { calls, last: () => calls[calls.length - 1], setBadges: (b: Map<string, SpaceBadge>) => void calls.push(b) };
  };

  it("pushes badges on bind and on roomListCache changes", () => {
    AppState.set("spaceRoomIds", ["!a"]);
    AppState.set("spaceMembers", { [S]: ["!a"] });
    AppState.set("roomListCache", [room("!a")]);
    const strip = fakeStrip();
    const unbind = bindSpaceBadges(strip);
    expect(strip.last()?.size).toBe(0);
    AppState.set("roomListCache", [room("!a", { unread: 1 })]);
    expect(strip.last()?.get(S)).toEqual({ unread: true, mentions: 0 });
    unbind();
  });

  it("drops the open room's contribution as soon as it is opened", () => {
    AppState.set("spaceRoomIds", ["!a"]);
    AppState.set("spaceMembers", { [S]: ["!a"] });
    AppState.set("roomListCache", [room("!a", { unread: 1 })]);
    const strip = fakeStrip();
    const unbind = bindSpaceBadges(strip);
    expect(strip.last()?.has(S)).toBe(true);
    AppState.set("currentRoomId", "!a");
    expect(strip.last()?.has(S)).toBe(false);
    unbind();
  });

  it("stops updating after unbind", () => {
    const strip = fakeStrip();
    const unbind = bindSpaceBadges(strip);
    const before = strip.calls.length;
    unbind();
    AppState.set("roomListCache", [room("!z", { unread: 1 })]);
    expect(strip.calls.length).toBe(before);
  });
});
