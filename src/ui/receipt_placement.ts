/**
 * Read-receipt placement: which message each reader's avatar sits on.
 *
 * Pure data, no DOM. `Timeline` syncs this index with its message buffer and
 * asks where each reader goes. Matching the answer against the clusters already
 * on screen is the Timeline's job (see `_reconcileReceipts`).
 *
 * Everything is decided by position in the buffer, not by timestamp, because
 * the buffer's timestamps are not monotonic. An optimistic local echo carries
 * the client's clock, and a federated event can arrive with an older
 * `origin_server_ts` than messages already shown. The rules:
 *
 * 1. A reader's *explicit* position is the event their receipt names, when that
 *    event is in the buffer. Receipts often name events that are not (reactions,
 *    edits, redactions, thread replies). Those fall back to the message with the
 *    latest timestamp at or before the receipt's own time. That lookup goes
 *    through a timestamp-sorted index, so one skewed clock can't throw off where
 *    every other reader lands.
 * 2. Sending implies reading. Homeservers don't send an `m.receipt` along with
 *    a message, so a reader whose newest own message comes after their explicit
 *    position moves to it.
 * 3. If that later target isn't rendered (windowing culled it), the avatar falls
 *    back to the explicit position instead of disappearing. The reader has read
 *    at least that far, so it is still true.
 */

/** The fields placement reads. `MessageData` satisfies it. */
export interface PlacedMessage {
  readonly id: string;
  readonly senderId?: string;
  readonly timestamp: string;
}

/** A reader's explicit receipt: the event it names, and the receipt's own time
 *  (ms) when known. */
export interface ReceiptPosition {
  readonly eventId: string;
  readonly ts: number | null;
}

/** One avatar in a cluster. `ts` is the receipt time shown in the hover card. */
export interface Reader {
  readonly userId: string;
  readonly ts: number | null;
}

/** A cluster's content as a string: who is in it, in display order, and the
 *  time each read at (the hover card shows it). Two clusters with the same
 *  signature render the same. */
export function readersSignature(readers: readonly Reader[]): string {
  return readers.map((r) => `${r.userId}\u0000${r.ts ?? ""}`).join("\u0001");
}

interface TimeEntry {
  readonly ts: number;
  /** Position in the buffer. */
  readonly idx: number;
}

/** First index in `arr` whose timestamp is after `ts` (arr sorted by ts). */
function upperBound(arr: readonly TimeEntry[], ts: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].ts <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class ReceiptIndex {
  /** Event IDs in buffer order as of the last sync. `sync` compares the buffer
   *  against this to tell a tail append (cheap, incremental) from any other
   *  change (rebuild). */
  private _ids: string[] = [];
  /** Event ID → buffer position. */
  private _pos = new Map<string, number>();
  /** Sender → buffer position of their newest message. */
  private _newestOwn = new Map<string, number>();
  /** Buffer positions sorted by (timestamp, position). Sorted here, not taken
   *  from buffer order. Messages without a parseable timestamp are left out. */
  private _byTime: TimeEntry[] = [];
  /** Parsed timestamps by message object. A rebuild (after a prepend, removal or
   *  rename) only parses the messages it hasn't seen before. */
  private _parsed = new WeakMap<PlacedMessage, number>();

  /** Bring the index up to date with `msgs`, the whole buffer. If `msgs` only
   *  grew at the end since the last sync (the live tail, forward pagination),
   *  only the new messages are indexed. Anything else rebuilds the index:
   *  a prepend, a removal, or a renamed ID (`confirmMessage`). No caller has to
   *  say what changed, so none can say it wrong. */
  sync(msgs: readonly PlacedMessage[]): void {
    if (!this._isPrefixOf(msgs)) {
      this._ids = [];
      this._pos.clear();
      this._newestOwn.clear();
      this._byTime = [];
      for (let i = 0; i < msgs.length; i++) this._add(msgs[i], i, false);
      this._byTime.sort((a, b) => a.ts - b.ts || a.idx - b.idx);
      return;
    }
    for (let i = this._ids.length; i < msgs.length; i++) this._add(msgs[i], i, true);
  }

  /** Buffer position where `userId`'s avatar belongs, or -1 for nowhere.
   *  `isRendered` says whether a buffer position is currently in the DOM. */
  resolve(userId: string, pos: ReceiptPosition, isRendered: (idx: number) => boolean): number {
    const explicit =
      this._pos.get(pos.eventId) ?? (pos.ts != null ? this._latestAtOrBefore(pos.ts) : -1);
    const advanced = Math.max(explicit, this._newestOwn.get(userId) ?? -1);
    if (advanced >= 0 && isRendered(advanced)) return advanced;
    if (explicit >= 0 && explicit !== advanced && isRendered(explicit)) return explicit;
    return -1;
  }

  /** Resolve every reader, grouped by buffer position. Each group is ordered
   *  most recent receipt first, so a cluster's visible avatars are its latest
   *  readers. */
  place(
    receipts: ReadonlyMap<string, ReceiptPosition>,
    isRendered: (idx: number) => boolean,
  ): Map<number, Reader[]> {
    const out = new Map<number, Reader[]>();
    for (const [userId, pos] of receipts) {
      const idx = this.resolve(userId, pos, isRendered);
      if (idx < 0) continue;
      const reader = { userId, ts: pos.ts };
      const list = out.get(idx);
      if (list) list.push(reader);
      else out.set(idx, [reader]);
    }
    for (const list of out.values()) list.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    return out;
  }

  private _isPrefixOf(msgs: readonly PlacedMessage[]): boolean {
    const ids = this._ids;
    if (ids.length > msgs.length) return false;
    for (let i = 0; i < ids.length; i++) if (msgs[i].id !== ids[i]) return false;
    return true;
  }

  private _add(m: PlacedMessage, idx: number, keepSorted: boolean): void {
    this._ids.push(m.id);
    this._pos.set(m.id, idx);
    // Positions only grow, so the last write is the sender's newest message.
    if (m.senderId) this._newestOwn.set(m.senderId, idx);

    let ts = this._parsed.get(m);
    if (ts === undefined) {
      ts = Date.parse(m.timestamp);
      this._parsed.set(m, ts);
    }
    if (Number.isNaN(ts)) return;
    const entry = { ts, idx };
    const arr = this._byTime;
    if (!keepSorted || arr.length === 0 || arr[arr.length - 1].ts <= ts) {
      arr.push(entry);
    } else {
      // Arrived out of time order. This entry's position is past every existing
      // one, so it goes after any entries with the same timestamp.
      arr.splice(upperBound(arr, ts), 0, entry);
    }
  }

  /** Buffer position of the message with the latest timestamp at or before
   *  `ts` (on a tie, the later position), or -1 if every message is newer. */
  private _latestAtOrBefore(ts: number): number {
    const i = upperBound(this._byTime, ts) - 1;
    return i >= 0 ? this._byTime[i].idx : -1;
  }
}
