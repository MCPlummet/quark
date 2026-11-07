// Reaction actions: sending reactions, applying incoming reactions, and the
// reaction-chip event handler. The picker a reaction is chosen in is the emoji
// picker, opened by openReactionPicker in ./emoji_picker.ts.

import { AppState } from "../state.js";

import { sendReaction as ipcSendReaction } from "../../ipc/index.js";

import { showError } from "../../ui/NotificationToast.js";

import {
  getComponents,
  _seenReactionEventIds,
  _resolveReactionImage,
} from "./context.js";

/**
 * Send a reaction to an event. Optimistically updates the reaction bar so the
 * user gets immediate feedback before the server round-trip completes.
 */
export async function sendReaction(eventId: string, key: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  // Optimistic UI update ─────────────────────────────────────────────────────
  const { timeline } = getComponents();
  const events = AppState.get("currentTimeline");
  const targetEvent = events.find((e) => e.event_id === eventId);

  if (targetEvent) {
    const current = targetEvent.reactions ?? [];
    const existing = current.find((r) => r.key === key);

    let updated: typeof current;
    if (existing?.own) {
      // Toggle off — remove this user's reaction
      updated = current
        .map((r) => r.key === key ? { ...r, count: r.count - 1, own: false, own_event_id: null } : r)
        .filter((r) => r.count > 0);
    } else if (existing) {
      // Increment existing group
      updated = current.map((r) => r.key === key ? { ...r, count: r.count + 1, own: true } : r);
    } else {
      // Brand new reaction
      updated = [...current, { key, count: 1, senders: [], own: true, own_event_id: null }];
    }

    AppState.set(
      "currentTimeline",
      events.map((e) => (e.event_id === eventId ? { ...e, reactions: updated } : e))
    );

    const groups = updated.map((r) => ({ key: r.key, count: r.count, own: r.own, imageUrl: _resolveReactionImage(r.key) }));
    timeline.updateMessageReactions(eventId, groups);
    // …and in the thread panel, if the message is one of its rows.
    getComponents().threadView?.updateMessageReactions(eventId, groups);
  }

  try {
    const reactionEventId = await ipcSendReaction(roomId, eventId, key);
    // Pre-register so the sync echo of our own reaction is not double-counted.
    _seenReactionEventIds.add(reactionEventId);
  } catch (err) {
    showError(`Failed to react: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Apply an incoming reaction from another user (received via sync event).
 * Deduplicates by reaction_event_id so own-reaction echoes are not double-counted.
 */
export function applyIncomingReaction(
  targetEventId: string,
  _sender: string,
  key: string,
  reactionEventId: string,
): void {
  if (_seenReactionEventIds.has(reactionEventId)) return;
  _seenReactionEventIds.add(reactionEventId);

  const { timeline } = getComponents();
  const events = AppState.get("currentTimeline");
  const targetEvent = events.find((e) => e.event_id === targetEventId);
  if (!targetEvent) return;

  const current = targetEvent.reactions ?? [];
  const existing = current.find((r) => r.key === key);
  let updated: typeof current;
  if (existing) {
    updated = current.map((r) => r.key === key ? { ...r, count: r.count + 1 } : r);
  } else {
    updated = [...current, { key, count: 1, senders: [], own: false, own_event_id: null }];
  }

  AppState.set(
    "currentTimeline",
    events.map((e) => (e.event_id === targetEventId ? { ...e, reactions: updated } : e))
  );

  const groups = updated.map((r) => ({ key: r.key, count: r.count, own: r.own, imageUrl: _resolveReactionImage(r.key) }));
  timeline.updateMessageReactions(targetEventId, groups);
  getComponents().threadView?.updateMessageReactions(targetEventId, groups);
}

/**
 * Wire the global chip-react event (bubbles up from reaction chips in the timeline).
 * Must be called once after components are set.
 */
export function setupReactionChipHandler(): void {
  document.addEventListener("quark:chip-react" as keyof DocumentEventMap, (e: Event) => {
    const customEv = e as CustomEvent<{ key: string }>;
    const target = e.target as HTMLElement | null;
    const msgEl = target?.closest<HTMLElement>("[data-message-id]");
    if (msgEl?.dataset.messageId) {
      void sendReaction(msgEl.dataset.messageId, customEv.detail.key);
    }
  });
}
