// Sticker and GIF actions: the emoji picker's sticker tab (load, send) and the
// GIF search picker. Opening the emoji picker itself is in ./emoji_picker.ts.

import { AppState } from "../state.js";

import {
  getThumbnail,
  searchGifs,
  sendGif as ipcSendGif,
  getStickerPacks,
  sendSticker as ipcSendSticker,
} from "../../ipc/index.js";

import { getAppConfig } from "../../ipc/app_config.js";

import type { MessageData } from "../../ui/Timeline.js";
import type { StickerEntry } from "../../ui/EmojiPicker.js";

import { showError, showSuccess } from "../../ui/NotificationToast.js";

import {
  getComponents,
  _ownSentEventIds,
  _memberAvatarMxc,
  _avatarDataUrl,
  _emojiImageCache,
} from "./context.js";
import { consumeReply, promoteReplyTarget } from "./messages.js";
import { currentAttachmentTarget } from "./media.js";

// ── Stickers (the emoji picker's compose-only tab) ───────────────────────────

/**
 * Send a sticker picked from the emoji picker's sticker tab, into the open
 * thread when there is one, with an optimistic row in the main timeline.
 */
export async function sendPickedSticker(sticker: StickerEntry): Promise<void> {
  const target = currentAttachmentTarget();
  if (!target) {
    showError("No room selected");
    return;
  }
  const roomId = target.roomId;
  const sepIdx = sticker.id.lastIndexOf("::");
  const packId = sepIdx >= 0 ? sticker.id.slice(0, sepIdx) : sticker.id;
  const shortcode = sepIdx >= 0 ? sticker.id.slice(sepIdx + 2) : sticker.name;

  // With a thread open the sticker belongs in the panel, and the optimistic
  // row below can only be appended to the main timeline. Rather than build a
  // second optimistic surface, stand down and let the sync echo render it —
  // `sync.ts` already routes a thread-related event into the open panel with
  // its media. Suppressing that echo (as the optimistic path must) is what
  // would make the sticker vanish entirely.
  // Read through the shared attachment target rather than off AppState, so
  // a reply armed outside the open thread is dropped here the same way it is
  // for an image or a file — the relation a sticker sends is the same one.
  const { threadRootEventId, replyToEventId } = target;

  // Optimistic update — show the sticker immediately
  const { timeline } = getComponents();
  const ownUserId = AppState.get("ownUserId");
  const ownSenderName = AppState.get("ownDisplayName") ?? ownUserId ?? "me";
  const ownAvatarMxc = ownUserId ? _memberAvatarMxc.get(ownUserId) : undefined;
  const ownAvatarUrl = (ownAvatarMxc && _avatarDataUrl.get(ownAvatarMxc)) ?? undefined;
  const optimisticId = `optimistic-sticker-${Date.now()}`;
  const optimisticMsg: MessageData = {
    id: optimisticId,
    senderId: ownUserId ?? undefined,
    senderName: ownSenderName,
    senderAvatarUrl: ownAvatarUrl,
    isOwn: true,
    timestamp: new Date().toISOString(),
    body: sticker.name,
    type: "sticker",
    mediaUrl: sticker.url,
    mediaAlt: sticker.name,
  };
  if (!threadRootEventId) timeline.appendMessage(optimisticMsg);
  // Resolve the sticker image if it's an mxc:// URL
  if (!threadRootEventId && sticker.url.startsWith("mxc://")) {
    const cached = _emojiImageCache.get(sticker.url);
    if (cached) {
      timeline.updateMessageMedia(optimisticId, cached);
    } else {
      getThumbnail(sticker.url, 256, 256)
        .then((dl) => {
          const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
          _emojiImageCache.set(sticker.url, dataUrl);
          timeline.updateMessageMedia(optimisticId, dataUrl);
        })
        .catch(() => { /* non-critical */ });
    }
  }

  try {
    const eventId = await ipcSendSticker(
      roomId,
      shortcode,
      sticker.url,
      sticker.name,
      packId,
      sticker.packName ?? null,
      { replyToEventId, threadRootEventId },
    );
    if (replyToEventId) consumeReply(replyToEventId);
    // Promote optimistic message and suppress the sync echo — only when
    // there was one to promote.
    if (!threadRootEventId) {
      timeline.confirmMessage(optimisticId, eventId);
      promoteReplyTarget(optimisticId, eventId);
      _ownSentEventIds.add(eventId);
    }
  } catch (err) {
    showError(`Failed to send sticker: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Load the current room's sticker packs into the emoji picker's sticker tab. */
export async function loadStickersIntoPicker(): Promise<void> {
  const { emojiPicker } = getComponents();
  const roomId = AppState.get("currentRoomId");
  try {
    const packs = await getStickerPacks(roomId ?? undefined);
    const stickers: StickerEntry[] = [];
    for (const pack of packs) {
      for (const e of pack.emojis) {
        stickers.push({
          id: `${pack.pack_id}::${e.shortcode}`,
          name: e.body ?? e.shortcode,
          url: e.url,
          thumbnailUrl: e.url.startsWith("mxc://") ? undefined : e.url,
          packName: pack.display_name ?? pack.pack_id,
        });
      }
    }
    emojiPicker.setStickers(stickers);

    // Resolve mxc:// thumbnails asynchronously and patch cells as each arrives
    for (const sticker of stickers) {
      if (!sticker.url.startsWith("mxc://")) continue;
      const mxc = sticker.url;
      if (_emojiImageCache.has(mxc)) {
        emojiPicker.updateStickerThumbnail(sticker.id, _emojiImageCache.get(mxc)!);
        continue;
      }
      const capturedId = sticker.id;
      getThumbnail(mxc, 96, 96)
        .then((dl) => {
          const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
          _emojiImageCache.set(mxc, dataUrl);
          emojiPicker.updateStickerThumbnail(capturedId, dataUrl);
        })
        .catch(() => { /* non-critical */ });
    }
  } catch {
    emojiPicker.setStickers([]);
  }
}

// GIF picker search state (persisted across picker open/close within a session)
let _gifQuery = "";
let _gifResultCount = 0;

/**
 * Show the GIF search picker. Wires search/select/load-more callbacks on first call.
 */
export function openGifPicker(): void {
  const { gifPicker } = getComponents();

  gifPicker.onSearch(async (query) => {
    if (!query.trim()) return;
    _gifQuery = query.trim();
    _gifResultCount = 0;
    gifPicker.setStatus("Searching…");
    try {
      const config = await getAppConfig();
      const results = await searchGifs(
        _gifQuery,
        config.gif.provider,
        config.gif.api_key,
        20,
        config.gif.rating,
      );
      _gifResultCount = results.length;
      gifPicker.setResults(results);
      gifPicker.setStatus(
        results.length === 0
          ? "No results — try a different query"
          : "j/k/h/l: navigate · Tab: more · Enter: send · Esc: close",
      );
    } catch (err) {
      gifPicker.setStatus(
        `Search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  gifPicker.onLoadMore(async () => {
    if (!_gifQuery) return;
    gifPicker.setStatus("Loading more…");
    try {
      const config = await getAppConfig();
      // Re-fetch with a larger limit to append more results
      const more = await searchGifs(
        _gifQuery,
        config.gif.provider,
        config.gif.api_key,
        _gifResultCount + 20,
        config.gif.rating,
      );
      _gifResultCount = more.length;
      gifPicker.setResults(more);
      gifPicker.setStatus(
        `${more.length} results · Tab: more · Enter: send · Esc: close`,
      );
    } catch (err) {
      gifPicker.setStatus(
        `Failed to load more: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  gifPicker.onSelect(async (gif) => {
    const roomId = AppState.get("currentRoomId");
    if (!roomId) {
      showError("No room selected");
      return;
    }
    gifPicker.setStatus("Uploading GIF…");
    try {
      // Same routing as any other attachment: a GIF picked with a thread open
      // belongs in that thread, not the main timeline (#78). The GIF path has no
      // optimistic row, so the sync echo renders it wherever it belongs.
      const { replyToEventId, threadRootEventId } = currentAttachmentTarget() ?? {};
      await ipcSendGif(roomId, gif.url, gif.title, gif.width, gif.height, {
        replyToEventId,
        threadRootEventId,
      });
      // The GIF consumed the armed reply, so disarm it — otherwise the banner
      // stays up and the next typed message replies to the same event.
      if (replyToEventId) consumeReply(replyToEventId);
      showSuccess("GIF sent");
    } catch (err) {
      showError(
        `Failed to send GIF: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  gifPicker.show();

  // Set "Powered by" branding based on configured provider
  getAppConfig().then((config) => {
    gifPicker.setProvider(config.gif.provider);
  }).catch(() => {/* ignore */});
}
