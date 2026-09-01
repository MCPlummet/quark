import { describe, it, expect } from "vitest";
import { getPseudoSpace, isPseudoSpace, sortByRecency } from "./pseudo_spaces.js";
import type { RoomInfo } from "../ipc/types.js";

const room = (over: Partial<RoomInfo>): RoomInfo => ({
  room_id: over.room_id ?? "!r:server",
  name: over.name ?? null,
  topic: null,
  avatar_url: null,
  unread_count: over.unread_count ?? 0,
  notification_count: over.notification_count ?? 0,
  is_direct: over.is_direct ?? false,
  is_encrypted: false,
  member_count: over.member_count ?? 5,
  last_activity_ts: over.last_activity_ts ?? null,
});

describe("pseudo_spaces", () => {
  describe("isPseudoSpace", () => {
    it("recognises the built-in pseudo-space ids", () => {
      expect(isPseudoSpace("__home__")).toBe(true);
      expect(isPseudoSpace("__dms__")).toBe(true);
      expect(isPseudoSpace("__groups__")).toBe(true);
    });

    it("rejects real space ids", () => {
      expect(isPseudoSpace("!realspace:server")).toBe(false);
      expect(isPseudoSpace("")).toBe(false);
    });
  });

  describe("__dms__ filter — whatever the user marked m.direct", () => {
    const filter = getPseudoSpace("__dms__")!.filter;
    const empty = new Set<string>();

    it("includes 1:1 direct rooms (member_count == 2)", () => {
      expect(filter(room({ is_direct: true, member_count: 2 }), empty)).toBe(true);
    });

    it("includes solo direct rooms (member_count == 1, partner has left)", () => {
      expect(filter(room({ is_direct: true, member_count: 1 }), empty)).toBe(true);
    });

    // Bridged DMs carry a relay bot beside the two humans, and :converttodm
    // lets the user declare a room a DM outright. m.direct is the user's own
    // statement, so member count does not get a veto.
    it("includes direct rooms with more than two members", () => {
      expect(filter(room({ is_direct: true, member_count: 5 }), empty)).toBe(true);
      expect(filter(room({ is_direct: true, member_count: 42 }), empty)).toBe(true);
    });

    it("excludes regular rooms", () => {
      expect(filter(room({ is_direct: false, member_count: 2 }), empty)).toBe(false);
    });
  });

  describe("__groups__ filter — unspaced rooms not marked m.direct", () => {
    const filter = getPseudoSpace("__groups__")!.filter;

    it("includes regular rooms not in any space", () => {
      expect(filter(room({ is_direct: false, member_count: 10 }), new Set())).toBe(true);
    });

    it("excludes direct rooms regardless of size — they belong in the mailbox", () => {
      expect(filter(room({ is_direct: true, member_count: 5 }), new Set())).toBe(false);
    });

    it("excludes 1:1 DMs", () => {
      expect(filter(room({ is_direct: true, member_count: 2 }), new Set())).toBe(false);
    });

    it("excludes rooms that belong to a space", () => {
      const r = room({ room_id: "!a:s", is_direct: false, member_count: 10 });
      expect(filter(r, new Set(["!a:s"]))).toBe(false);
    });
  });

  describe("__home__ filter — all unspaced rooms plus DMs", () => {
    const filter = getPseudoSpace("__home__")!.filter;

    it("includes DMs even if they belong to a space", () => {
      const r = room({ room_id: "!a:s", is_direct: true, member_count: 2 });
      expect(filter(r, new Set(["!a:s"]))).toBe(true);
    });

    it("includes regular rooms not in any space", () => {
      expect(filter(room({ room_id: "!a:s" }), new Set())).toBe(true);
    });

    it("excludes regular rooms that belong to a space", () => {
      const r = room({ room_id: "!a:s", is_direct: false });
      expect(filter(r, new Set(["!a:s"]))).toBe(false);
    });
  });

  describe("sortByRecency", () => {
    it("orders by last_activity_ts descending", () => {
      const a = room({ room_id: "a", last_activity_ts: 100 });
      const b = room({ room_id: "b", last_activity_ts: 300 });
      const c = room({ room_id: "c", last_activity_ts: 200 });
      expect(sortByRecency([a, b, c]).map((r) => r.room_id)).toEqual(["b", "c", "a"]);
    });

    it("falls back to unread score, then name, when timestamps tie", () => {
      const a = room({ room_id: "a", name: "Zebra", last_activity_ts: 0, notification_count: 1 });
      const b = room({ room_id: "b", name: "Aardvark", last_activity_ts: 0, notification_count: 1 });
      const c = room({ room_id: "c", name: "Cat", last_activity_ts: 0, notification_count: 0 });
      expect(sortByRecency([a, b, c]).map((r) => r.room_id)).toEqual(["b", "a", "c"]);
    });

    it("does not mutate the input array", () => {
      const input = [room({ room_id: "a", last_activity_ts: 1 }), room({ room_id: "b", last_activity_ts: 2 })];
      const copy = [...input];
      sortByRecency(input);
      expect(input).toEqual(copy);
    });
  });
});
