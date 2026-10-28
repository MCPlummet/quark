import { describe, it, expect, vi, afterEach } from "vitest";
import { ReceiptIndex, readersSignature, type PlacedMessage, type ReceiptPosition } from "./receipt_placement.js";

/** A message stamped `min` minutes past 12:00 UTC on 2024-01-01. */
const m = (id: string, sender: string, min: number): PlacedMessage => ({
  id,
  senderId: `@${sender}:x`,
  timestamp: new Date(Date.UTC(2024, 0, 1, 12, min)).toISOString(),
});
const at = (min: number, sec = 0): number => Date.UTC(2024, 0, 1, 12, min, sec);
const all = (): boolean => true;

/** Resolve one reader against a freshly synced index. */
function resolveOn(
  msgs: PlacedMessage[],
  userId: string,
  pos: ReceiptPosition,
  isRendered: (idx: number) => boolean = all,
): number {
  const index = new ReceiptIndex();
  index.sync(msgs);
  return index.resolve(userId, pos, isRendered);
}

describe("ReceiptIndex", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolve", () => {
    const buffer = [m("a", "alice", 0), m("b", "alice", 1), m("c", "alice", 2)];

    it("puts a reader on the event their receipt names", () => {
      // The receipt time would say c; the named event wins.
      expect(resolveOn(buffer, "@bob:x", { eventId: "a", ts: at(5) })).toBe(0);
    });

    it("falls back to the latest message at or before the receipt time for an event not in the buffer", () => {
      expect(resolveOn(buffer, "@bob:x", { eventId: "$reaction", ts: at(1, 30) })).toBe(1);
      expect(resolveOn(buffer, "@bob:x", { eventId: "$reaction", ts: at(1) })).toBe(1); // inclusive
    });

    it("places nobody when the event is unknown and every message is newer, or there is no time", () => {
      expect(resolveOn(buffer, "@bob:x", { eventId: "$old", ts: at(-10) })).toBe(-1);
      expect(resolveOn(buffer, "@bob:x", { eventId: "$old", ts: null })).toBe(-1);
    });

    it("advances a reader to their own newer message", () => {
      const msgs = [...buffer, m("d", "bob", 3), m("e", "alice", 4)];
      expect(resolveOn(msgs, "@bob:x", { eventId: "a", ts: at(0, 30) })).toBe(3);
    });

    it("does not pull a reader back to an older own message", () => {
      const msgs = [m("a", "bob", 0), ...buffer.slice(1)];
      expect(resolveOn(msgs, "@bob:x", { eventId: "c", ts: at(2, 30) })).toBe(2);
    });

    it("advances a reader with no usable receipt to their own message", () => {
      const msgs = [...buffer, m("d", "bob", 3)];
      expect(resolveOn(msgs, "@bob:x", { eventId: "$old", ts: null })).toBe(3);
    });

    it("falls back to the explicit receipt when the advanced target isn't rendered", () => {
      const msgs = [...buffer, m("d", "bob", 3)];
      const upToC = (idx: number): boolean => idx <= 2;
      expect(resolveOn(msgs, "@bob:x", { eventId: "b", ts: null }, upToC)).toBe(1);
    });

    it("places nobody when neither the advanced target nor the receipt is rendered", () => {
      const msgs = [...buffer, m("d", "bob", 3)];
      const onlyA = (idx: number): boolean => idx === 0;
      expect(resolveOn(msgs, "@bob:x", { eventId: "b", ts: null }, onlyA)).toBe(-1);
    });

    it("compares by buffer position, not timestamp, when advancing", () => {
      // Bob's message is last in the timeline but federated in with an early stamp.
      const msgs = [...buffer, { id: "d", senderId: "@bob:x", timestamp: "2024-01-01T09:00:00Z" }];
      expect(resolveOn(msgs, "@bob:x", { eventId: "b", ts: at(1, 30) })).toBe(3);
    });

    it("finds the latest-stamped message when the buffer is out of time order", () => {
      const msgs = [
        m("a", "alice", 0),
        m("b", "alice", 1),
        m("skewed", "alice", 60), // a local echo on a fast clock
        m("c", "alice", 3),
        m("d", "alice", 4),
        m("late", "alice", -60), // federated in late
      ];
      expect(resolveOn(msgs, "@bob:x", { eventId: "$r", ts: at(3, 30) })).toBe(3);
      expect(resolveOn(msgs, "@bob:x", { eventId: "$r", ts: at(90) })).toBe(2);
      expect(resolveOn(msgs, "@bob:x", { eventId: "$r", ts: at(-30) })).toBe(5);
    });

    it("prefers the later position between messages stamped the same time", () => {
      const msgs = [m("a", "alice", 0), m("b", "alice", 1), m("b2", "alice", 1)];
      expect(resolveOn(msgs, "@bob:x", { eventId: "$r", ts: at(1, 30) })).toBe(2);
    });

    it("skips messages with no parseable timestamp in the time fallback", () => {
      const msgs = [m("a", "alice", 0), { id: "x", senderId: "@alice:x", timestamp: "" }];
      expect(resolveOn(msgs, "@bob:x", { eventId: "$r", ts: at(5) })).toBe(0);
    });
  });

  describe("sync", () => {
    /** Every reader's placement, for comparing two indexes. */
    function placements(index: ReceiptIndex, receipts: Map<string, ReceiptPosition>): [number, string[]][] {
      return [...index.place(receipts, all)].map(([idx, rs]) => [idx, rs.map((r) => r.userId)]);
    }

    const receipts = new Map<string, ReceiptPosition>([
      ["@bob:x", { eventId: "$r1", ts: at(2, 30) }],
      ["@carol:x", { eventId: "b", ts: null }],
      ["@dave:x", { eventId: "$r2", ts: at(7, 30) }],
    ]);

    it("indexes tail appends, in or out of time order, the same as a rebuild", () => {
      const msgs = [m("a", "alice", 0), m("b", "alice", 1), m("c", "dave", 2)];
      const incremental = new ReceiptIndex();
      incremental.sync(msgs);
      msgs.push(m("d", "alice", 8), m("e", "carol", 3), m("f", "alice", 7), m("g", "bob", 9));
      incremental.sync(msgs);

      const fresh = new ReceiptIndex();
      fresh.sync(msgs);
      expect(placements(incremental, receipts)).toEqual(placements(fresh, receipts));
      // Dave's 12:07:30 receipt lands on f (12:07), not d (12:08) or g.
      expect(incremental.resolve("@dave:x", receipts.get("@dave:x")!, all)).toBe(5);
    });

    it("rebuilds when the buffer changes other than at the tail", () => {
      const index = new ReceiptIndex();
      const msgs = [m("a", "alice", 0), m("b", "bob", 1), m("c", "alice", 2)];
      index.sync(msgs);
      expect(index.resolve("@bob:x", { eventId: "a", ts: null }, all)).toBe(1);

      // Prepend: every position shifts.
      const prepended = [m("p", "alice", -5), ...msgs];
      index.sync(prepended);
      expect(index.resolve("@bob:x", { eventId: "a", ts: null }, all)).toBe(2);

      // Removal of Bob's only message: he falls back to his receipt.
      const removed = prepended.filter((x) => x.id !== "b");
      index.sync(removed);
      expect(index.resolve("@bob:x", { eventId: "a", ts: null }, all)).toBe(1);

      // Rename in place (confirmMessage): the new ID resolves, the old one doesn't.
      const renamed = removed.map((x) => (x.id === "c" ? { ...x, id: "$real" } : x));
      index.sync(renamed);
      expect(index.resolve("@carol:x", { eventId: "$real", ts: null }, all)).toBe(2);
      expect(index.resolve("@carol:x", { eventId: "c", ts: null }, all)).toBe(-1);
    });

    it("rebuilds when the same IDs come back as new objects with new timestamps", () => {
      // b was a local echo stamped by a client clock running fast; a reload
      // brings it back under the same ID with the server's time.
      const index = new ReceiptIndex();
      index.sync([m("a", "alice", 0), m("b", "bob", 20)]);
      const reaction = { eventId: "$reaction", ts: at(15) };
      expect(index.resolve("@carol:x", reaction, all)).toBe(0);

      index.sync([m("a", "alice", 0), m("b", "bob", 10)]);
      expect(index.resolve("@carol:x", reaction, all)).toBe(1);
    });

    it("parses only new messages' timestamps on a tail append", () => {
      const msgs = Array.from({ length: 500 }, (_, i) => m(`e${i}`, "alice", i));
      const index = new ReceiptIndex();
      index.sync(msgs);

      const parse = vi.spyOn(Date, "parse");
      msgs.push(m("new", "bob", 600));
      index.sync(msgs);
      expect(parse).toHaveBeenCalledTimes(1);

      // A rebuild after a prepend re-parses only the prepended message.
      parse.mockClear();
      index.sync([m("old", "alice", -1), ...msgs]);
      expect(parse).toHaveBeenCalledTimes(1);
    });
  });

  describe("place", () => {
    it("groups readers by position, most recent receipt first", () => {
      const index = new ReceiptIndex();
      index.sync([m("a", "alice", 0), m("b", "alice", 1)]);
      const placed = index.place(
        new Map<string, ReceiptPosition>([
          ["@bob:x", { eventId: "b", ts: at(1, 10) }],
          ["@carol:x", { eventId: "b", ts: at(1, 50) }],
          ["@dave:x", { eventId: "a", ts: at(0, 30) }],
          ["@erin:x", { eventId: "$gone", ts: null }],
        ]),
        all,
      );
      expect([...placed].map(([idx, rs]) => [idx, rs.map((r) => r.userId)])).toEqual([
        [1, ["@carol:x", "@bob:x"]],
        [0, ["@dave:x"]],
      ]);
    });
  });
});

describe("readersSignature", () => {
  it("changes with membership, order and receipt time", () => {
    const base = readersSignature([{ userId: "@a:x", ts: 1 }, { userId: "@b:x", ts: 2 }]);
    expect(readersSignature([{ userId: "@a:x", ts: 1 }, { userId: "@b:x", ts: 2 }])).toBe(base);
    expect(readersSignature([{ userId: "@b:x", ts: 2 }, { userId: "@a:x", ts: 1 }])).not.toBe(base);
    expect(readersSignature([{ userId: "@a:x", ts: 1 }])).not.toBe(base);
    expect(readersSignature([{ userId: "@a:x", ts: 1 }, { userId: "@b:x", ts: 3 }])).not.toBe(base);
  });
});
