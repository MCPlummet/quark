// The one loader for a room's custom (MSC2545) emoji.
//
// The compose picker, the reaction picker and `:shortcode` autocomplete each
// used to read the packs themselves: three copies of the `emoticon` filter and
// of the `_shortcodeToMxc` bookkeeping, thumbnails fetched at 64px by one, 32px
// by the others and cached by only two of them, and keys that disagreed (the
// compose picker keyed custom emoji by `:shortcode:`, the reaction picker by
// mxc URL). They now all read the packs from here, in the same form.

import { getEmojiPacks } from "../../ipc/index.js";
import type { EmojiPack } from "../../ipc/types.js";
import type { CustomEmojiPack } from "../../ui/emoji_catalog.js";
import {
  _emojiImageCache,
  _resetEmojiThumbnailsInFlight,
  _shortcodeToMxc,
  resolveEmojiThumbnail,
} from "./context.js";

export interface CustomEmojiListener {
  /**
   * The room's packs: called at once with what is cached (possibly nothing),
   * then again with the fresh list. Each call hands over new objects.
   */
  onPacks(packs: CustomEmojiPack[]): void;
  /** A thumbnail resolved: `url` is the emoji's source, `imageUrl` displayable. */
  onImage?(url: string, imageUrl: string): void;
}

/** Packs by room ID ("" for no room: the account's own packs). */
const _packCache = new Map<string, CustomEmojiPack[]>();

/** A displayable URL for a custom emoji's source, if one is known yet. */
export function customEmojiImage(url: string): string | undefined {
  if (!url.startsWith("mxc://")) return url;
  return _emojiImageCache.get(url);
}

/** A copy of `packs` with every image that has resolved filled in. */
function withImages(packs: readonly CustomEmojiPack[]): CustomEmojiPack[] {
  return packs.map((p) => ({
    ...p,
    emojis: p.emojis.map((e) => ({ ...e, imageUrl: customEmojiImage(e.url) })),
  }));
}

/** Reduce IPC packs to their emoticon entries, and record shortcode → mxc. */
function toCustomPacks(raw: readonly EmojiPack[]): CustomEmojiPack[] {
  const packs: CustomEmojiPack[] = [];
  for (const pack of raw) {
    const emojis = pack.emojis
      .filter((e) => e.usage.includes("emoticon"))
      .map((e) => ({ shortcode: e.shortcode, url: e.url, body: e.body }));
    // Record the mxc for each shortcode so the outgoing formatter can turn a
    // typed or inserted `:shortcode:` into <img data-mx-emoticon>.
    for (const e of emojis) {
      if (e.url.startsWith("mxc://")) _shortcodeToMxc.set(e.shortcode, e.url);
    }
    if (emojis.length > 0) {
      packs.push({ id: pack.pack_id, name: pack.display_name ?? pack.pack_id, emojis });
    }
  }
  return packs;
}

/** The packs last loaded for a room, with resolved images, or none. */
export function cachedCustomEmoji(roomId: string | null): CustomEmojiPack[] {
  return withImages(_packCache.get(roomId ?? "") ?? []);
}

/**
 * Load a room's custom emoji packs. The listener hears the cached packs at
 * once and the fresh ones when they arrive; thumbnails not yet in the image
 * cache are fetched and reported one by one. Resolves to the fresh packs (the
 * cached ones if the load failed).
 */
export async function loadCustomEmoji(
  roomId: string | null,
  listener: CustomEmojiListener,
): Promise<CustomEmojiPack[]> {
  const key = roomId ?? "";
  listener.onPacks(cachedCustomEmoji(roomId));
  let packs: CustomEmojiPack[];
  try {
    packs = toCustomPacks(await getEmojiPacks(roomId ?? undefined));
  } catch {
    return _packCache.get(key) ?? [];
  }
  _packCache.set(key, packs);
  listener.onPacks(withImages(packs));
  for (const pack of packs) {
    for (const e of pack.emojis) {
      if (!e.url.startsWith("mxc://") || _emojiImageCache.has(e.url)) continue;
      void resolveEmojiThumbnail(e.url).then((imageUrl) => {
        if (imageUrl) listener.onImage?.(e.url, imageUrl);
      });
    }
  }
  return packs;
}

/** Test seam: forget cached packs. */
export function _resetCustomEmojiCache(): void {
  _packCache.clear();
  _resetEmojiThumbnailsInFlight();
}
