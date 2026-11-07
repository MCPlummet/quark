// Opening the emoji picker, from either of its two contexts.
//
// The compose box and reactions open the same EmojiPicker instance, fed from
// the same custom-emoji loader. Their contexts below are the whole of what
// differs between them, and emoji_picker.test.ts holds them to it:
//
//   - what a pick does: insert at the caret vs send an `m.annotation`;
//   - the sticker and GIF tabs: compose only;
//   - free text: reactions only (a reaction key may be any string);
//   - placement: beside the message vs docked above the compose bar.

import { AppState } from "../state.js";
import type { EmojiPicker, EmojiPickerContext } from "../../ui/EmojiPicker.js";
import { composeInsertion, reactionKey } from "../../ui/emoji_catalog.js";
import { getComponents } from "./context.js";
import { loadCustomEmoji } from "./custom_emoji.js";
import { loadStickersIntoPicker, openGifPicker, sendPickedSticker } from "./gif.js";
import { sendReaction } from "./reactions.js";

/** Bumped per opening, so a slow load for an earlier room cannot land late. */
let _feed = 0;

/**
 * Give the picker the current room's custom emoji: the cached packs before it
 * opens, so they never pop in on a repeat open, then the fresh ones.
 */
function feedCustomEmoji(picker: EmojiPicker): void {
  const feed = ++_feed;
  void loadCustomEmoji(AppState.get("currentRoomId"), {
    onPacks: (packs) => {
      if (feed === _feed) picker.setCustomPacks(packs);
    },
    onImage: (url, imageUrl) => picker.setCustomImage(url, imageUrl),
  });
}

/** The compose box's context: inserts at the caret; offers stickers and GIFs. */
export function composeContext(initialTab: "emoji" | "sticker" = "emoji"): EmojiPickerContext {
  const { input } = getComponents();
  return {
    label: "Emoji picker",
    onEmoji: (entry) => {
      input.insertText(composeInsertion(entry));
      input.focus();
    },
    media: {
      initialTab,
      onStickerTab: () => void loadStickersIntoPicker(),
      onSticker: (sticker) => void sendPickedSticker(sticker),
      onGif: () => openGifPicker(),
    },
  };
}

/** A reaction's context: reacts to `eventId`; free text allowed; by the message. */
export function reactionContext(eventId: string): EmojiPickerContext {
  const { timeline, threadView } = getComponents();
  // A message of the open thread is anchored to its row in the panel, which
  // covers the room. The root is in both: anchored to the room's row, hidden
  // behind the panel's header, the picker opened away from either.
  const anchor =
    (threadView?.hasMessage(eventId) ? threadView.getMessageEl(eventId) : null) ??
    timeline.getMessageElementById(eventId) ??
    null;
  return {
    label: "Add reaction",
    anchor,
    onEmoji: (entry) => void sendReaction(eventId, reactionKey(entry)),
    text: { label: "react with", onText: (text) => void sendReaction(eventId, text) },
  };
}

/** Open the emoji picker for the compose box (Ctrl-e, `:emoji`, its button). */
export function openEmojiPicker(initialTab: "emoji" | "sticker" = "emoji"): void {
  const { emojiPicker } = getComponents();
  feedCustomEmoji(emojiPicker);
  emojiPicker.open(composeContext(initialTab));
}

/** Open the emoji picker on its sticker tab (`:stickers`). */
export function openStickerPicker(): void {
  openEmojiPicker("sticker");
}

/** Open the emoji picker to react to a message (`e`, the React action). */
export function openReactionPicker(eventId: string): void {
  const { emojiPicker } = getComponents();
  feedCustomEmoji(emojiPicker);
  emojiPicker.open(reactionContext(eventId));
}
