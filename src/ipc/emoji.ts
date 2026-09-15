// Emoji and sticker IPC calls

import { invoke } from "./invoke.js";
import type { EmojiPack, EmojiEntry } from "./types.js";
import type { MessageTarget } from "./media.js";

export type { EmojiPack, EmojiEntry };

/**
 * Get all emoji packs visible to the user.
 * Pass roomId to also include that room's emoji packs.
 * Matches the Rust `get_emoji_packs` command.
 */
export async function getEmojiPacks(roomId?: string): Promise<EmojiPack[]> {
  return invoke<EmojiPack[]>("get_emoji_packs", { roomId });
}

/**
 * Get sticker packs visible to the user.
 * Pass roomId to also include that room's sticker packs.
 * Matches the Rust `get_sticker_packs` command.
 */
export async function getStickerPacks(roomId?: string): Promise<EmojiPack[]> {
  return invoke<EmojiPack[]>("get_sticker_packs", { roomId });
}

/**
 * Convenience: get only user-scoped emoji packs (no roomId).
 */
export async function getUserEmoji(): Promise<EmojiPack[]> {
  return getEmojiPacks();
}

/**
 * Convenience: get emoji packs for a specific room (includes user packs).
 */
export async function getRoomEmoji(roomId: string): Promise<EmojiPack[]> {
  return getEmojiPacks(roomId);
}

/**
 * Send a sticker event to a room.
 * Matches the Rust `send_sticker` command.
 */
export async function sendSticker(
  roomId: string,
  shortcode: string,
  url: string,
  body: string | null,
  packId: string,
  packName: string | null,
  target: MessageTarget = {},
): Promise<string> {
  return invoke<string>("send_sticker", {
    roomId,
    shortcode,
    url,
    body,
    packId,
    packName,
    replyToEventId: target.replyToEventId ?? null,
    threadRootEventId: target.threadRootEventId ?? null,
  });
}
