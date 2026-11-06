// Typing notices (`m.typing`), both directions.
//
// Receiving: the server's `m.typing` lists everyone typing in a room and is
// pushed only when that list changes. So the latest list is kept for every
// room, not just the open one: a room opened while someone is mid-sentence has
// no new update coming to say so. A room's list is dropped once the room
// leaves the room list — no more updates will arrive to correct it. (The
// backend leaves the reader out of every list.)
//
// Sending: the compose box announces typing for the open room. This side owns
// the schedule: an announcement goes out on the first keystroke, lasts 4 s on
// the server, and is renewed every 3 s while keystrokes continue, so it never
// lapses mid-sentence; the keystrokes in between cost nothing. It also owns
// ordering: commands run concurrently on the backend, so a "stopped" sent
// right after a "started" could reach the server first and leave the user
// typing for 4 s after their message went out. Requests therefore go one at a
// time, and changes made while one is in flight collapse into one follow-up.

import { AppState } from "./state.js";
import { resolveDisplayName } from "./actions/context.js";
import { modeManager, Mode } from "../vim/mode.js";
import { setTyping } from "../ipc/index.js";

// ── Receiving ────────────────────────────────────────────────────────────────

const _typingByRoom = new Map<string, readonly string[]>();
/** The indicator `setupTypingIndicator` bound, if any. */
let _indicator: HTMLElement | null = null;

/** Record a room's `m.typing` list, as pushed by the server. */
export function recordTyping(roomId: string, userIds: readonly string[]): void {
  if (userIds.length > 0) _typingByRoom.set(roomId, [...userIds]);
  else _typingByRoom.delete(roomId);
  if (roomId === AppState.get("currentRoomId")) refreshTypingIndicator();
}

/** Forget every room's typing list (logout / re-login). */
export function clearTypingState(): void {
  _typingByRoom.clear();
  refreshTypingIndicator();
}

/** The indicator's text for a room's typing list, or null when it is empty. */
export function typingLabel(
  userIds: readonly string[],
  nameOf: (userId: string) => string,
): string | null {
  const names = userIds.map(nameOf);
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length <= 3) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are typing…`;
  }
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others are typing…`;
}

/** Paint `el` with the open room's typing. */
export function renderTypingIndicator(
  el: HTMLElement,
  nameOf: (userId: string) => string = resolveDisplayName,
): void {
  const roomId = AppState.get("currentRoomId");
  const userIds = roomId ? (_typingByRoom.get(roomId) ?? []) : [];
  const label = typingLabel(userIds, nameOf);
  const textEl = el.querySelector(".typing-indicator__text");
  if (textEl) textEl.textContent = label ?? "";
  el.classList.toggle("typing-indicator--active", label !== null);
}

/** Repaint the bound indicator. The open room's own changes repaint it by
 *  themselves; call this when the names it shows may have changed. */
export function refreshTypingIndicator(): void {
  if (_indicator) renderTypingIndicator(_indicator);
}

/**
 * Keep `el` showing the open room's typing: repainted whenever the open room
 * changes (including to none) or its list does, and with the lists of rooms
 * that leave the room list forgotten. Returns a teardown.
 */
export function setupTypingIndicator(el: HTMLElement): () => void {
  _indicator = el;
  const offRoom = AppState.on("currentRoomId", () => refreshTypingIndicator());
  const offRooms = AppState.on("roomListCache", (_key, rooms, prev) => {
    if (_typingByRoom.size === 0) return;
    // Only a room seen leaving counts: typing can arrive for a room before it
    // first appears in the list (a fresh join, or startup).
    const kept = new Set(rooms.map((r) => r.room_id));
    let dropped = false;
    for (const r of prev) {
      if (!kept.has(r.room_id)) dropped = _typingByRoom.delete(r.room_id) || dropped;
    }
    if (dropped) refreshTypingIndicator();
  });
  refreshTypingIndicator();
  return () => {
    offRoom();
    offRooms();
    if (_indicator === el) _indicator = null;
  };
}

// ── Sending ──────────────────────────────────────────────────────────────────

/** How often an announcement is renewed while typing continues. */
export const RESEND_MS = 3000;
/** How long an announcement lasts on the server: the backend sends each with
 *  this timeout (`TYPING_TIMEOUT` in `src-tauri/src/matrix/rooms.rs`). */
export const LIFETIME_MS = 4000;

export type TypingSender = (roomId: string, typing: boolean) => Promise<unknown>;

export class TypingNotifier {
  /** The room the server has been (or is being) told this user is typing in. */
  private _room: string | null = null;
  /** When the latest announcement for `_room` was queued, on `_now`'s clock;
   *  -Infinity while nothing is announced. Queued rather than sent: it errs
   *  towards renewing early, which is harmless. */
  private _announcedAt = -Infinity;
  /** Latest wanted state per room, oldest first, not yet handed to `send`. */
  private _pending = new Map<string, boolean>();
  private _draining: Promise<void> | null = null;

  constructor(
    private readonly _send: TypingSender,
    private readonly _now: () => number = () => performance.now(),
  ) {}

  /** The compose text for `roomId` changed by the user's hand. */
  input(roomId: string, text: string): void {
    if (text.trim() === "") {
      this.stop();
      return;
    }
    if (this._room !== roomId) this.stop();
    const now = this._now();
    if (now - this._announcedAt < RESEND_MS) return;
    this._room = roomId;
    this._announcedAt = now;
    this._enqueue(roomId, true);
  }

  /** The user is no longer typing: withdraw the announcement, if any. */
  stop(): void {
    if (this._room === null) return;
    // One that has lapsed on the server needs no withdrawing.
    if (this._now() - this._announcedAt < LIFETIME_MS) this._enqueue(this._room, false);
    this._room = null;
    this._announcedAt = -Infinity;
  }

  /** Resolves once every queued request has been sent. */
  idle(): Promise<void> {
    return this._draining ?? Promise.resolve();
  }

  private _enqueue(roomId: string, typing: boolean): void {
    // Re-insert so the room moves to the back: a stop for the room being left
    // stays ahead of the start for the room being entered.
    this._pending.delete(roomId);
    this._pending.set(roomId, typing);
    this._draining ??= this._drain();
  }

  private async _drain(): Promise<void> {
    for (;;) {
      const next = this._pending.entries().next();
      if (next.done) break;
      const [roomId, typing] = next.value;
      this._pending.delete(roomId);
      try {
        await this._send(roomId, typing);
      } catch {
        // Best-effort: a lost notice lapses on the server within seconds.
      }
    }
    this._draining = null;
  }
}

/** The app's notifier, sending through IPC. (`setTyping` is looked up per call,
 *  not at import, so modules that merely import this one need not mock it.) */
export const typingNotifier = new TypingNotifier((roomId, typing) => setTyping(roomId, typing));

/** The part of the compose box this wiring needs. */
export interface TypingInputSource {
  onInput(handler: (value: string) => void): void;
}

/**
 * Announce typing from the compose box. Only Insert-mode edits count — the
 * box also takes Command-mode text — and not while editing a sent message,
 * which brings nothing new, nor once the user has opted out. Leaving Insert
 * mode or the room, starting an edit, or opting out withdraws the
 * announcement. Returns a teardown for the mode and state listeners (the
 * input listener lives as long as the box).
 */
export function setupTypingNotices(
  input: TypingInputSource,
  notifier: TypingNotifier = typingNotifier,
): () => void {
  let live = true;
  input.onInput((value) => {
    if (!live || modeManager.current !== Mode.Insert) return;
    if (AppState.get("editingEventId") !== null || !AppState.get("sendTypingNotices")) return;
    const roomId = AppState.get("currentRoomId");
    if (roomId) notifier.input(roomId, value);
  });
  const offMode = modeManager.on((_from, to) => {
    if (to !== Mode.Insert) notifier.stop();
  });
  const offRoom = AppState.on("currentRoomId", () => notifier.stop());
  const offEdit = AppState.on("editingEventId", (_key, id) => {
    if (id !== null) notifier.stop();
  });
  const offOptOut = AppState.on("sendTypingNotices", (_key, on) => {
    if (!on) notifier.stop();
  });
  return () => {
    live = false;
    offMode();
    offRoom();
    offEdit();
    offOptOut();
  };
}
