// Typing notices (`m.typing`), both directions.
//
// Receiving: the server's `m.typing` lists everyone typing in a room — the
// reader included — and is pushed only when that list changes. So the latest
// list is kept for every room, not just the open one: a room opened while
// someone is mid-sentence has no new update coming to say so. The reader is
// dropped at render time.
//
// Sending: the compose box announces typing for the open room. matrix-sdk's
// `Room::typing_notice` decides when a request actually goes out (a fresh
// announcement at most every 3 s, each lasting 4 s on the server), and is
// meant to be called on every keystroke — calling it less often lets the
// announcement lapse mid-sentence. What this side adds is ordering: commands
// run concurrently on the backend, so a "stopped" sent right after a
// "started" could reach the server first and leave the user typing for 4 s
// after their message went out. Requests therefore go one at a time, and
// keystrokes made while one is in flight collapse into a single follow-up.

import { AppState } from "./state.js";
import { resolveDisplayName } from "./actions/context.js";
import { modeManager, Mode } from "../vim/mode.js";
import { setTyping } from "../ipc/index.js";

// ── Receiving ────────────────────────────────────────────────────────────────

const _typingByRoom = new Map<string, readonly string[]>();

/** Record a room's `m.typing` list, as pushed by the server. */
export function recordTyping(roomId: string, userIds: readonly string[]): void {
  if (userIds.length > 0) _typingByRoom.set(roomId, [...userIds]);
  else _typingByRoom.delete(roomId);
}

/** Forget every room's typing list (logout / re-login). */
export function clearTypingState(): void {
  _typingByRoom.clear();
}

/**
 * The indicator's text for a room's typing list, or null when nobody but the
 * reader is typing.
 */
export function typingLabel(
  userIds: readonly string[],
  ownUserId: string | null,
  nameOf: (userId: string) => string,
): string | null {
  const names = userIds.filter((id) => id !== ownUserId).map(nameOf);
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length <= 3) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are typing…`;
  }
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others are typing…`;
}

/** Paint the indicator for the open room. */
export function renderTypingIndicator(
  el: HTMLElement,
  nameOf: (userId: string) => string = resolveDisplayName,
): void {
  const roomId = AppState.get("currentRoomId");
  const userIds = roomId ? (_typingByRoom.get(roomId) ?? []) : [];
  const label = typingLabel(userIds, AppState.get("ownUserId"), nameOf);
  const textEl = el.querySelector(".typing-indicator__text");
  if (textEl) textEl.textContent = label ?? "";
  el.classList.toggle("typing-indicator--active", label !== null);
}

// ── Sending ──────────────────────────────────────────────────────────────────

export type TypingSender = (roomId: string, typing: boolean) => Promise<unknown>;

export class TypingNotifier {
  /** The room the server has been (or is being) told this user is typing in. */
  private _room: string | null = null;
  /** Latest wanted state per room, oldest first, not yet handed to `send`. */
  private _pending = new Map<string, boolean>();
  private _draining: Promise<void> | null = null;

  constructor(private readonly _send: TypingSender) {}

  /** The compose text for `roomId` changed by the user's hand. */
  input(roomId: string, text: string): void {
    if (text.trim() === "") {
      this.stop();
      return;
    }
    if (this._room !== null && this._room !== roomId) this.stop();
    this._room = roomId;
    this._enqueue(roomId, true);
  }

  /** The user is no longer typing: withdraw the announcement, if any. */
  stop(): void {
    if (this._room === null) return;
    this._enqueue(this._room, false);
    this._room = null;
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
 * box also takes Command-mode text — and leaving Insert mode or the room
 * withdraws the announcement. Returns a teardown for the mode and room
 * listeners (the input listener lives as long as the box).
 */
export function setupTypingNotices(
  input: TypingInputSource,
  notifier: TypingNotifier = typingNotifier,
): () => void {
  let live = true;
  input.onInput((value) => {
    if (!live || modeManager.current !== Mode.Insert) return;
    const roomId = AppState.get("currentRoomId");
    if (roomId) notifier.input(roomId, value);
  });
  const offMode = modeManager.on((_from, to) => {
    if (to !== Mode.Insert) notifier.stop();
  });
  const offRoom = AppState.on("currentRoomId", () => notifier.stop());
  return () => {
    live = false;
    offMode();
    offRoom();
  };
}
