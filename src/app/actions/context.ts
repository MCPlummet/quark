// Shared context for the action modules.
//
// `actions.ts` was historically a single god-module: a flat bag of exported
// action functions plus the module-level state and helpers they all shared.
// When that file was split into domain-scoped modules under `actions/`, the
// shared bits had to live in exactly ONE place so every domain module reads
// and writes the same state. That place is this file.
//
// Note on mutable scalars: ES module bindings are read-only for importers, so
// a plain exported `let` cannot be reassigned from another module. The
// pagination flags and a couple of picker flags are therefore stored on a
// single mutable `paginationState` / accessor object (or via getter/setter
// functions) so cross-module writes are visible everywhere. Shared `const`
// collections (Maps/Sets) are exported directly because they are only ever
// mutated in place, never reassigned.

import { AppState } from "../state.js";
import { registerAnimatedUrl } from "../animated_urls.js";
import { markdownToHtml } from "../markdown.js";
import { BUILTIN_EMOJI } from "../../data/unicode-emoji.js";

import {
  getThumbnail,
  downloadMedia,
  getPresenceStatus as ipcGetPresenceStatus,
} from "../../ipc/index.js";

import type { AppComponents } from "../../ui/App.js";
import type { RoomInfo, TimelineEvent, RoomMember } from "../../ipc/types.js";
import type { RoomEntry } from "../../ui/RoomList.js";
import type { MessageData, ReplyPreviewData } from "../../ui/Timeline.js";
import type { MemberEntry } from "../../ui/MemberList.js";

// ── Constants ────────────────────────────────────────────────────────────────
export const THUMBNAIL_SIZE = 64;

// ── Module-level components reference ────────────────────────────────────────

let _components: AppComponents | null = null;

export function setComponents(components: AppComponents): void {
  _components = components;
  // Give the timeline the resolvers it needs to render real avatars/display
  // names on read-receipt chips without importing the app layer (keeps the
  // UI → app dependency one-directional). Optional-chained so partial test
  // mocks of `timeline` don't need to stub it.
  components.timeline?.setReceiptResolvers?.({
    avatarUrl: resolveSenderAvatarUrl,
    displayName: resolveDisplayName,
  });
}

export function getComponents(): AppComponents {
  if (!_components) throw new Error("Actions: components not set");
  return _components;
}

// ── Own-sent event deduplication ─────────────────────────────────────────────

/**
 * Event IDs of messages sent by this client that are awaiting their sync echo.
 * The sync handler checks this set and skips appending the echo to avoid
 * showing a duplicate alongside the already-visible optimistic message.
 */
export const _ownSentEventIds = new Set<string>();

/**
 * Consume an event ID from the own-sent set.
 * Returns true (and removes the ID) if this event was sent by us,
 * false otherwise.
 */
export function consumeOwnSentEvent(eventId: string): boolean {
  return _ownSentEventIds.delete(eventId);
}

// ── Pagination state ──────────────────────────────────────────────────────────

/**
 * Mutable pagination state shared between the timeline-navigation actions
 * (selectRoom / jumpToMessage / jumpToLatest and the load-more handlers).
 * Held on a single object so reassignments are visible across modules.
 */
export const paginationState = {
  /** Pagination token for loading older messages in context view; null at the
   *  start of history. Unused by the live timeline (cache-backed) path, which
   *  tracks `reachedStart` instead. */
  prevBatch: null as string | null,
  /** Pagination token for loading newer messages; only set when in context view. */
  nextBatch: null as string | null,
  /** Live (cache-backed) path: true once back-pagination has reached the start
   *  of the room's history. Replaces the `prevBatch === null` signal there. */
  reachedStart: false,
  /** True when the timeline is showing a context window around a jumped-to message, not the live end. */
  inContextView: false,
  /** Event ID the context window is centered on (the jumped-to message). Set
   *  when entering context view; used to re-fetch the same window when room
   *  keys arrive so undecryptable events in it can re-decrypt. Null when live. */
  contextFocusEventId: null as string | null,
  /** Prevents concurrent backward "load more" fetches. */
  paginationLoading: false,
  /** Prevents concurrent forward "load more" fetches. */
  paginationLoadingForward: false,
};

/** True when the timeline is showing a window in the middle of history rather
 *  than at the live tail. Used by the sync handler to suppress appending new
 *  live messages while the user is reading older context — the user would
 *  otherwise see incorrectly-ordered messages between the context window and
 *  the live tail. The skipped messages will arrive when the user paginates
 *  forward to them or clicks "jump to latest". */
export function isInContextView(): boolean {
  return paginationState.inContextView;
}

// ── Member caches ─────────────────────────────────────────────────────────────

/** userId → display name, populated when room members are fetched */
export const _memberDisplayName = new Map<string, string>();
/** userId → mxc:// URL, populated when room members are fetched */
export const _memberAvatarMxc = new Map<string, string>();
/** mxc:// URL → blob: URL, populated as thumbnails are downloaded */
export const _avatarDataUrl = new Map<string, string>();
/**
 * LRU cache of decoded message images/stickers (mxc:// → blob: URL), so
 * revisiting a room shows already-fetched media instantly instead of
 * re-downloading + decoding (~1s round-trip) on every open. Bounded by a byte
 * budget (configurable; default 150 MB): once exceeded, the least-recently-used
 * blobs are evicted and their object URLs revoked to actually free memory.
 *
 * Note: an evicted image that's still off-screen in the *current* room would
 * show broken until the room is re-opened (re-open re-downloads on a cache
 * miss). The default budget is high enough that this is rare; switching rooms
 * always self-heals because the open path re-fetches misses.
 */
class MediaBlobCache {
  private map = new Map<string, { url: string; size: number }>();
  private totalBytes = 0;
  private maxBytes = 150 * 1024 * 1024;

  /** Set the byte budget (MB). Evicts immediately if now over. */
  setMaxMb(mb: number): void {
    this.maxBytes = Math.max(0, mb) * 1024 * 1024;
    this._evict();
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Get the blob URL, marking it most-recently-used. */
  get(key: string): string | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry); // re-insert → newest in iteration order
    return entry.url;
  }

  /** Insert/replace a blob URL with its decoded byte size; evicts as needed. */
  set(key: string, url: string, size: number): void {
    const existing = this.map.get(key);
    if (existing) {
      this.totalBytes -= existing.size;
      if (existing.url !== url) URL.revokeObjectURL(existing.url);
      this.map.delete(key);
    }
    this.map.set(key, { url, size });
    this.totalBytes += size;
    this._evict();
  }

  private _evict(): void {
    // Keep at least one entry so a single oversized image still displays.
    while (this.totalBytes > this.maxBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const entry = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.totalBytes -= entry.size;
      URL.revokeObjectURL(entry.url);
    }
  }
}
export const _messageMediaCache = new MediaBlobCache();

/** Apply the configured in-memory image cache budget (MB). */
export function setMediaCacheLimit(mb: number): void {
  _messageMediaCache.setMaxMb(mb);
}
/** roomId → resolved blob: URL for the room avatar */
export const _roomAvatarDataUrl = new Map<string, string>();
/** userId → known DM room ID, populated when a DM room is entered */
export const _dmRoomByUser = new Map<string, string>();
/** roomId → DM partner userId, reverse of _dmRoomByUser */
export const _dmUserByRoom = new Map<string, string>();
/** spaceId → the room last opened while that space was active, so switching
 *  away and back restores the space's own chat instead of leaving a foreign
 *  room in the timeline (#11). Session-only — not persisted across restarts. */
export const _lastRoomBySpace = new Map<string, string>();

// ── Emoji / reaction caches ────────────────────────────────────────────────────

/** Cache: mxc:// URL → data: URL for custom emoji rendered in reaction chips */
export const _emojiImageCache = new Map<string, string>();

/** Seen reaction event IDs — prevents double-counting sync echoes of own reactions. */
export const _seenReactionEventIds = new Set<string>();

/**
 * Map of shortcode → mxc:// URL for all loaded custom emoji.
 * Used to build formatted bodies with data-mx-emoticon when sending messages.
 * Populated when emoji packs are loaded; never replaced with data: URLs.
 */
export const _shortcodeToMxc = new Map<string, string>();

// ── Shared low-level helpers ───────────────────────────────────────────────────

/**
 * Convert a downloaded media blob to a Blob URL.
 * Blob URLs avoid synchronous base64 decoding when assigned to img.src,
 * which can take ~5ms per image in WebKitGTK.
 */
export function _mediaToBlobUrl(mimeType: string, base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  if (mimeType === "image/gif" || mimeType === "image/webp") {
    registerAnimatedUrl(url);
  }
  return url;
}

/** Resolve a user ID to its display name, falling back to the raw ID. */
export function resolveDisplayName(userId: string): string {
  return _memberDisplayName.get(userId) ?? userId;
}

/**
 * Strip the Matrix reply fallback content from a message body.
 * Per spec, reply messages include a quoted fallback for clients that don't
 * support m.in_reply_to — modern clients should remove it before displaying.
 *
 * - formatted_body: `<mx-reply><blockquote>…</blockquote></mx-reply>` prefix
 * - body: `> quoted line\n` block followed by a blank line
 */
export function stripReplyFallback(body: string, htmlBody?: string): { body: string; htmlBody?: string } {
  let strippedBody = body;
  let strippedHtml = htmlBody;

  // Strip > quoted fallback lines from plain body (everything up to first blank line)
  const blankLineIdx = body.indexOf("\n\n");
  if (blankLineIdx !== -1) {
    const prefix = body.slice(0, blankLineIdx);
    if (prefix.split("\n").every((line) => line.startsWith("> "))) {
      strippedBody = body.slice(blankLineIdx + 2);
    }
  }

  // Strip <mx-reply>...</mx-reply> from HTML body
  if (htmlBody) {
    strippedHtml = htmlBody.replace(/^<mx-reply>[\s\S]*?<\/mx-reply>/, "").trimStart();
  }

  return { body: strippedBody, htmlBody: strippedHtml };
}

/** Convert IPC RoomInfo → RoomList RoomEntry */
export function roomInfoToEntry(r: RoomInfo): RoomEntry {
  const dmUserId = r.is_direct ? (_dmUserByRoom.get(r.room_id) ?? undefined) : undefined;
  const rawPresence = dmUserId ? AppState.getUserPresence(dmUserId) : null;
  const presence = (rawPresence === "online" || rawPresence === "unavailable")
    ? rawPresence
    : (dmUserId ? "offline" as const : undefined);
  return {
    id: r.room_id,
    name: r.name ?? r.room_id,
    unreadCount: r.unread_count,
    mentionCount: r.notification_count,
    muted: false,
    dmUserId,
    presence,
  };
}

/**
 * Apply edit events to their originals and return only non-edit events.
 * For each m.replace event the latest edit (by timestamp) wins.
 * The returned array can be passed directly to timelineEventToMessage.
 */
export function _applyEdits(events: TimelineEvent[]): TimelineEvent[] {
  // Collect latest edit per original event ID
  const latestEdit = new Map<string, TimelineEvent>();
  for (const e of events) {
    if (e.is_edit && e.relates_to_event_id) {
      const existing = latestEdit.get(e.relates_to_event_id);
      if (!existing || e.timestamp > existing.timestamp) {
        latestEdit.set(e.relates_to_event_id, e);
      }
    }
  }
  if (latestEdit.size === 0) return events.filter((e) => !e.is_edit);

  return events
    .filter((e) => !e.is_edit)
    .map((e) => {
      const edit = latestEdit.get(e.event_id);
      if (!edit) return e;
      return { ...e, body: edit.body, formatted_body: edit.formatted_body, was_edited: true, original_body: e.body };
    });
}

/** Build a map of thread root event IDs → reply count from a batch of events. */
export function _buildThreadRootCounts(events: TimelineEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.thread_root) {
      counts.set(e.thread_root, (counts.get(e.thread_root) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Return a cached data-URL for a reaction key that is an mxc:// URI,
 * or undefined for plain Unicode emoji.
 */
export function _resolveReactionImage(key: string): string | undefined {
  if (!key.startsWith("mxc://")) return undefined;
  return _emojiImageCache.get(key);
}

/** Convert IPC TimelineEvent → Timeline MessageData */
export function timelineEventToMessage(e: TimelineEvent, allEvents?: TimelineEvent[], threadRootCounts?: Map<string, number>): MessageData {
  const msgType = (() => {
    if (e.msg_type === "m.image") return "image" as const;
    if (e.msg_type === "m.sticker") return "sticker" as const;
    if (e.msg_type === "m.video") return "video" as const;
    if (e.msg_type === "m.file") return "file" as const;
    return "text" as const;
  })();

  let replyTo: ReplyPreviewData | undefined;
  if (e.in_reply_to && allEvents) {
    const parent = allEvents.find((ev) => ev.event_id === e.in_reply_to);
    if (parent) {
      // If the parent is itself a reply, its body starts with the quoted
      // fallback of *its* parent — strip it so the preview shows the parent's
      // own words, not its grandparent's.
      const parentBody = parent.in_reply_to
        ? stripReplyFallback(parent.body, parent.formatted_body ?? undefined).body
        : parent.body;
      replyTo = {
        eventId: parent.event_id,
        senderName: resolveDisplayName(parent.sender),
        body: parentBody.slice(0, 80),
      };
    }
  }

  // Resolve avatar: prefer cached data URL, then mock-injected URL (dev mode)
  const mxcUrl = _memberAvatarMxc.get(e.sender);
  const senderAvatarUrl =
    (mxcUrl && _avatarDataUrl.get(mxcUrl)) ??
    ((e as unknown as Record<string, unknown>)["_mock_avatar_url"] as string | undefined);

  const ownUserId = AppState.get("ownUserId");

  // Strip Matrix reply fallback content so the quoted original doesn't render twice
  const { body: displayBody, htmlBody: displayHtml } = e.in_reply_to
    ? stripReplyFallback(e.body, e.formatted_body ?? undefined)
    : { body: e.body, htmlBody: e.formatted_body ?? undefined };

  // Prefer an already-fetched blob URL so cached images paint instantly on a
  // revisit; otherwise pass the raw mxc:// and let _downloadMessageImages swap.
  const mediaUrl =
    (e.media_url ? _messageMediaCache.get(e.media_url) : undefined) ?? e.media_url ?? undefined;

  return {
    id: e.event_id,
    senderId: e.sender,
    senderName: resolveDisplayName(e.sender),
    senderAvatarUrl,
    isOwn: ownUserId ? e.sender === ownUserId : false,
    timestamp: new Date(e.timestamp).toISOString(),
    body: displayBody,
    htmlBody: displayHtml,
    type: msgType,
    mediaUrl,
    mediaMimeType: e.media_mimetype ?? undefined,
    mediaWidth: e.media_width ?? undefined,
    mediaHeight: e.media_height ?? undefined,
    caption: e.caption ?? undefined,
    mediaEncryptionInfo: e.media_encryption_info ?? undefined,
    mediaThumbnailUrl: e.media_thumbnail_url ?? undefined,
    mediaThumbnailEncryptionInfo: e.media_thumbnail_encryption_info ?? undefined,
    reactions: e.reactions?.map((r) => ({
      key: r.key,
      count: r.count,
      own: r.own,
      imageUrl: _resolveReactionImage(r.key),
    })),
    replyTo,
    isThreadRoot: threadRootCounts ? threadRootCounts.has(e.event_id) : undefined,
    threadReplyCount: threadRootCounts?.get(e.event_id),
    wasEdited: e.was_edited,
    originalBody: e.original_body,
  };
}

/** Convert IPC RoomMember → MemberList MemberEntry */
export function roomMemberToEntry(m: RoomMember): MemberEntry {
  // Use the already-resolved blob URL if available; mxc:// URLs can't be
  // loaded by the browser directly, so fall back to undefined (shows initial).
  const resolvedAvatar = m.avatar_url ? _avatarDataUrl.get(m.avatar_url) : undefined;
  // Prefer the live-cached presence state from sync events over the initial
  // member fetch (which always returns null from the backend).
  const cachedPresence = AppState.getUserPresence(m.user_id);
  const presence = (m.presence ?? cachedPresence ?? "offline") as "online" | "unavailable" | "offline";
  return {
    id: m.user_id,
    name: m.display_name ?? m.user_id,
    userId: m.user_id,
    powerLevel: m.power_level,
    presence,
    avatarUrl: resolvedAvatar,
  };
}

/**
 * Build the HTML `formatted_body` for a compose-box message: inline markdown
 * (bold/italic/underline/strikethrough/spoiler/code, see {@link markdownToHtml})
 * plus custom-emoji shortcodes resolved to `<img data-mx-emoticon>` tags
 * (MSC2545).
 *
 * Returns `undefined` if the body has no formatting and no resolvable custom
 * emoji, so the message is sent as plain text only.
 */
export function _buildFormattedBodyWithEmoji(body: string): string | undefined {
  return markdownToHtml(body, { resolveEmoji: (shortcode) => _shortcodeToMxc.get(shortcode) });
}

/** Lazily-built map of built-in Unicode emoji shortcode (and aliases) → glyph. */
let _shortcodeToGlyph: Map<string, string> | null = null;
function shortcodeToGlyph(): Map<string, string> {
  if (!_shortcodeToGlyph) {
    _shortcodeToGlyph = new Map();
    // BUILTIN_EMOJI carries the Unicode glyph in `key`; custom emoji never appear
    // in it. The primary shortcode is listed before its aliases, so a plain set
    // (first-wins not required — all entries for a shortcode map to one glyph).
    for (const e of BUILTIN_EMOJI) _shortcodeToGlyph.set(e.shortcode, e.key);
  }
  return _shortcodeToGlyph;
}

const SHORTCODE_RE = /:([a-zA-Z0-9_+-]+):/g;

/**
 * Replace built-in Unicode emoji shortcodes (e.g. `:smile:`) with their glyph.
 * Unknown shortcodes are left untouched. Custom (MSC2545) shortcodes take
 * precedence over a colliding built-in name — they're left in place here and
 * resolved separately into `<img data-mx-emoticon>` in the formatted body, so a
 * room's custom `:party:` wins over the Unicode 🎉.
 */
export function replaceUnicodeEmojiShortcodes(text: string): string {
  return text.replace(SHORTCODE_RE, (full, shortcode: string) => {
    if (_shortcodeToMxc.has(shortcode)) return full; // custom emoji wins
    return shortcodeToGlyph().get(shortcode) ?? full;
  });
}

/**
 * Prepare a compose-box string for sending: Unicode emoji shortcodes become
 * glyphs in the plain body, and the formatted body resolves custom-emoji
 * shortcodes to `<img data-mx-emoticon>` (plus inline markdown). `formattedBody`
 * is `undefined` when the result has no formatting and no custom emoji.
 */
export function prepareOutgoingBody(raw: string): { body: string; formattedBody: string | undefined } {
  const body = replaceUnicodeEmojiShortcodes(raw);
  return { body, formattedBody: _buildFormattedBodyWithEmoji(body) };
}

/**
 * Resolve a user's presence status — cached if known, otherwise fetched
 * actively from the homeserver. Sync-driven presence events arrive
 * opportunistically, so on cold start or for users who haven't recently
 * changed presence the cache may be empty; this fills that gap.
 */
export async function resolveUserStatus(userId: string): Promise<string | null> {
  const cached = AppState.getUserStatus(userId);
  if (cached !== null) return cached;
  try {
    const info = await ipcGetPresenceStatus(userId);
    const status = info.status_msg ?? null;
    AppState.cacheUserStatus(userId, status);
    if (info.presence) AppState.cacheUserPresence(userId, info.presence);
    return status;
  } catch {
    return null;
  }
}

// ── Shared media/avatar/emoji download helpers ─────────────────────────────────

/**
 * Scan all events for reactions whose key is an mxc:// custom emoji URL,
 * download each (using the shared media cache), and update the reaction chips
 * in the timeline once the image arrives.
 */
export async function _downloadReactionEmoji(
  events: TimelineEvent[],
  timeline: import("../../ui/Timeline.js").Timeline
): Promise<void> {
  // Gather unique mxc:// keys across all events
  const mxcKeys = new Set<string>();
  for (const e of events) {
    for (const r of e.reactions ?? []) {
      if (r.key.startsWith("mxc://") && !_emojiImageCache.has(r.key)) {
        mxcKeys.add(r.key);
      }
    }
  }

  for (const mxc of mxcKeys) {
    getThumbnail(mxc, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
      .then((dl) => {
        const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
        _emojiImageCache.set(mxc, dataUrl);

        // Update every message that has a reaction with this mxc key
        for (const e of events) {
          const reactions = e.reactions ?? [];
          if (!reactions.some((r) => r.key === mxc)) continue;
          timeline.updateMessageReactions(
            e.event_id,
            reactions.map((r) => ({
              key: r.key,
              count: r.count,
              own: r.own,
              imageUrl: _emojiImageCache.get(r.key),
            }))
          );
        }
      })
      .catch(() => { /* non-critical */ });
  }
}

/** Download mxc:// image/sticker content and swap in data URLs once ready.
 * Video and audio are intentionally excluded — they are loaded on demand
 * via the `quark:open-video` event to avoid crashing WebKit on systems
 * without GStreamer. */
export function _downloadMessageImages(events: TimelineEvent[], timeline: { updateMessageMedia(id: string, dataUrl: string): void }): void {
  for (const e of events) {
    if (!e.media_url || !e.media_url.startsWith("mxc://")) continue;
    // Skip video/audio — handled lazily on click
    if (e.msg_type === "m.video" || e.msg_type === "m.audio") continue;
    const eventId = e.event_id;
    const mxc = e.media_url;
    // Already fetched this session → apply the cached blob URL synchronously
    // (no IPC, no decode), so revisiting a room shows images immediately.
    const cached = _messageMediaCache.get(mxc);
    if (cached) {
      timeline.updateMessageMedia(eventId, cached);
      continue;
    }
    downloadMedia(mxc, e.media_encryption_info).then((dl) => {
      const url = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
      // Decoded byte size ≈ 3/4 of the base64 length (ignoring padding).
      const size = Math.floor((dl.data_base64.length * 3) / 4);
      _messageMediaCache.set(mxc, url, size);
      timeline.updateMessageMedia(eventId, url);
    }).catch((err) => {
      console.error(`[media] failed to download ${mxc}:`, err);
    });
  }
}

/** Download media for a single sync-pushed message and update the timeline. */
export function downloadSyncMessageImage(event: TimelineEvent, timeline: { updateMessageMedia(id: string, dataUrl: string): void }): void {
  _downloadMessageImages([event], timeline);
}

/** Return the cached avatar data URL for a sender, if already downloaded. */
export function resolveSenderAvatarUrl(senderId: string): string | undefined {
  const mxcUrl = _memberAvatarMxc.get(senderId);
  return mxcUrl ? _avatarDataUrl.get(mxcUrl) : undefined;
}

/**
 * Ensure a sender's avatar is downloaded and reflected in the timeline.
 * If the data URL is already cached, updates immediately; otherwise triggers
 * an async download. No-op if the sender has no known avatar mxc URL.
 */
export function ensureSenderAvatarDownloaded(senderId: string, timeline: import("../../ui/Timeline.js").Timeline): void {
  const mxcUrl = _memberAvatarMxc.get(senderId);
  if (!mxcUrl) return;
  if (_avatarDataUrl.has(mxcUrl)) {
    timeline.updateSenderAvatar(senderId, _avatarDataUrl.get(mxcUrl)!);
    timeline.updateReceiptAvatar(senderId, _avatarDataUrl.get(mxcUrl)!);
    return;
  }
  downloadMedia(mxcUrl).then((dl) => {
    const url = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
    _avatarDataUrl.set(mxcUrl, url);
    timeline.updateSenderAvatar(senderId, url);
    timeline.updateReceiptAvatar(senderId, url);
  }).catch(() => { /* non-critical */ });
}

/** Public alias used by sync.ts after appending a new message. */
export function resolveInlineEmojiForTimeline(timeline: import("../../ui/Timeline.js").Timeline): void {
  _downloadInlineEmoji(timeline);
}

/** Resolve mxc:// URLs for inline custom emoji (data-mx-emoticon imgs) in the timeline. */
export function _downloadInlineEmoji(timeline: import("../../ui/Timeline.js").Timeline): void {
  const urls = timeline.getPendingInlineEmojiUrls();
  for (const mxc of urls) {
    if (_emojiImageCache.has(mxc)) {
      timeline.resolveInlineEmoji(mxc, _emojiImageCache.get(mxc)!);
      continue;
    }
    getThumbnail(mxc, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
      .then((dl) => {
        const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
        _emojiImageCache.set(mxc, dataUrl);
        timeline.resolveInlineEmoji(mxc, dataUrl);
      })
      .catch(() => { /* non-critical */ });
  }
}

/** Download uncached avatars and update the timeline when each arrives.
 * Full media (not thumbnail) is used so that animated GIF/WEBP avatars
 * are not transcoded to static images by the homeserver thumbnail endpoint.
 */
export function _downloadMemberAvatars(members: RoomMember[], timeline: import("../../ui/Timeline.js").Timeline): void {
  const { memberList } = getComponents();
  for (const m of members) {
    if (!m.avatar_url) continue;
    const mxc = m.avatar_url;
    if (_avatarDataUrl.has(mxc)) {
      timeline.updateSenderAvatar(m.user_id, _avatarDataUrl.get(mxc)!);
      timeline.updateReceiptAvatar(m.user_id, _avatarDataUrl.get(mxc)!);
      memberList.updateMemberAvatar(m.user_id, _avatarDataUrl.get(mxc)!);
      continue;
    }
    downloadMedia(mxc).then((dl) => {
      const url = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
      _avatarDataUrl.set(mxc, url);
      timeline.updateSenderAvatar(m.user_id, url);
      timeline.updateReceiptAvatar(m.user_id, url);
      memberList.updateMemberAvatar(m.user_id, url);
    }).catch(() => { /* non-critical */ });
  }
}
