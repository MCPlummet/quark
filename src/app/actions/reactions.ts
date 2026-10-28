// Reaction actions: sending reactions, applying incoming reactions, the quick
// reaction picker, and the reaction-chip event handler.

import { AppState } from "../state.js";

import {
  sendReaction as ipcSendReaction,
  getEmojiPacks,
  getThumbnail,
} from "../../ipc/index.js";

import type { CustomEmojiEntry } from "../../ui/QuickReactPicker.js";

import { showError } from "../../ui/NotificationToast.js";

import {
  getComponents,
  _seenReactionEventIds,
  _emojiImageCache,
  _shortcodeToMxc,
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
 * Show the quick reaction picker anchored to the currently selected message.
 */
export function openQuickReactPicker(eventId: string): void {
  const { timeline, threadView, quickReactPicker } = getComponents();
  // A row of the open thread panel is not in the timeline's list.
  const anchor = timeline.getMessageElementById(eventId) ?? threadView?.getMessageEl(eventId) ?? null;
  quickReactPicker.show(eventId, anchor);

  // Load custom emoji for current room and inject into the picker.
  // For custom emoji reactions, the reaction key must be the mxc:// URL (MSC2545).
  const roomId = AppState.get("currentRoomId");
  getEmojiPacks(roomId ?? undefined)
    .then((packs) => {
      // Build entries with mutable refs so async thumbnail resolutions can
      // update each entry in place. Calling setCustomEmoji always filters the
      // shared `custom` array, so every previously-resolved entry stays visible.
      const custom: CustomEmojiEntry[] = [];
      const pushResolved = () => {
        if (quickReactPicker.isVisible()) {
          quickReactPicker.setCustomEmoji(custom.filter((c) => c.imageUrl));
        }
      };
      for (const pack of packs) {
        for (const entry of pack.emojis) {
          if (!entry.usage.includes("emoticon")) continue;
          const mxc = entry.url;
          // Populate shortcode→mxc map so sendMessage() can build data-mx-emoticon.
          if (mxc.startsWith("mxc://")) {
            _shortcodeToMxc.set(entry.shortcode, mxc);
          }
          // Use the mxc:// URL as the reaction key (MSC2545 custom emoji reactions).
          const cached = _emojiImageCache.get(mxc);
          if (cached) {
            custom.push({ key: mxc, shortcode: entry.shortcode, imageUrl: cached });
          } else if (mxc.startsWith("mxc://")) {
            // Placeholder ref — mutated in place when thumbnail resolves so that
            // every concurrent resolution sees a consistent `custom` snapshot.
            const ref: CustomEmojiEntry = { key: mxc, shortcode: entry.shortcode, imageUrl: "" };
            custom.push(ref);
            getThumbnail(mxc, 32, 32).then((dl) => {
              const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
              _emojiImageCache.set(mxc, dataUrl);
              ref.imageUrl = dataUrl;
              pushResolved();
            }).catch(() => { /* non-critical */ });
          } else {
            custom.push({ key: mxc, shortcode: entry.shortcode, imageUrl: mxc });
          }
        }
      }
      pushResolved();
    })
    .catch(() => { /* non-critical */ });
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
