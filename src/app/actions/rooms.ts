// Room & space navigation actions: selecting rooms/spaces, pagination,
// jumping to messages, joining rooms, DM resolution, and the room list refresh.

import { AppState } from "../state.js";
import { isMobile, closeDrawer } from "../mobile.js";

import {
  getRoomMembers,
  getRoomReceipts,
  getTimeline,
  getSpaceChildren,
  getUserSpaces,
  getRooms,
  joinRoom as ipcJoinRoom,
  leaveRoom as ipcLeaveRoom,
  createRoom,
  markRoomRead,
  getEventContext,
  paginateForward,
  openRoomTimeline,
  loadOlderTimeline,
  downloadMedia,
} from "../../ipc/index.js";

import { getPseudoSpace, sortByRecency } from "../pseudo_spaces.js";
import { clearRoomNotificationsIpc } from "../../ipc/notifications.js";
import { enterHomeView, exitHomeView } from "./home.js";

import type { RoomMember, TimelineEvent, EventContextPage } from "../../ipc/types.js";
import type { AppConfig } from "../../ipc/app_config.js";
import type { RoomSection } from "../../ui/RoomList.js";
import type { SpaceItem } from "../../ui/SpaceStrip.js";

import { showError, showSuccess } from "../../ui/NotificationToast.js";
import { askConfirm } from "../../ui/ConfirmDialog.js";

import {
  getComponents,
  paginationState,
  _memberDisplayName,
  _memberAvatarMxc,
  _avatarDataUrl,
  _roomAvatarDataUrl,
  _dmRoomByUser,
  _dmUserByRoom,
  _lastRoomBySpace,
  _mediaToBlobUrl,
  roomInfoToEntry,
  roomMemberToEntry,
  _applyEdits,
  _buildThreadRootCounts,
  timelineEventToMessage,
  _downloadReactionEmoji,
  _downloadMessageImages,
  _downloadInlineEmoji,
  _downloadMemberAvatars,
  ensureSenderAvatarDownloaded,
  isInContextView,
  setMediaCacheLimit,
} from "./context.js";
import { closeThread } from "./threads.js";
import { cancelReply, cancelEdit } from "./messages.js";
import { openRoomSettings } from "./dialogs.js";
import { openProfileForUser } from "./profile.js";

// ── Per-room timeline cache ─────────────────────────────────────────────────
// A `room.messages()` round-trip costs ~2s every open (homeserver latency), so
// re-opening a room you've already viewed this session would otherwise re-stare
// at a skeleton for 2s. We keep the last-rendered tail per room and paint it
// instantly on revisit, then refresh from the server in the background and
// reconcile only if the head changed (no flicker on an unchanged room). Sync
// keeps already-cached rooms' tails warm so the paint isn't stale.
interface CachedRoomTimeline {
  events: TimelineEvent[];
  reachedStart: boolean;
  // Per-room member snapshot, kept so a cached revisit can repopulate the global
  // _memberDisplayName / _memberAvatarMxc maps *before* the instant paint —
  // otherwise senders flash their raw user ID until the member list re-fetches.
  memberNames?: Map<string, string>;   // userId → display name
  memberAvatars?: Map<string, string>; // userId → mxc:// URL
}
// Insertion order doubles as LRU recency: every open re-`set`s the room, moving
// it to newest; eviction drops the oldest (least-recently-opened) entries.
const _roomTimelineCache = new Map<string, CachedRoomTimeline>();
/** Max events retained per room (cap memory; the live tail is what matters). */
const ROOM_TIMELINE_CACHE_CAP = 200;
/** Events fetched for the first paint. Smaller = faster first-ever open. */
const ROOM_OPEN_LIMIT = 50;
/** Max rooms whose tail is kept cached (LRU). Configurable via [cache].timeline_rooms. */
let _roomCacheMaxRooms = 30;

/** Update the cached-room limit (from config) and evict down to it immediately. */
export function setRoomCacheLimit(rooms: number): void {
  _roomCacheMaxRooms = Math.max(1, rooms);
  _evictRoomCache();
}

/** Push the `[cache]` config values into the live in-memory caches (the room
 *  timeline cache here + the message-image cache in context). Called at startup
 *  and after the user changes the limits in Settings. */
export function applyCacheConfig(config: AppConfig): void {
  setRoomCacheLimit(config.cache.timeline_rooms);
  setMediaCacheLimit(config.cache.image_memory_mb);
}

/** Store/refresh a room's cached tail (marks it most-recently-used) + evict. */
function _putRoomTimeline(roomId: string, events: TimelineEvent[], reachedStart: boolean): void {
  const prev = _roomTimelineCache.get(roomId); // carry the member snapshot forward
  _roomTimelineCache.delete(roomId); // re-insert so it lands as newest
  _roomTimelineCache.set(roomId, {
    events: events.slice(-ROOM_TIMELINE_CACHE_CAP),
    reachedStart,
    memberNames: prev?.memberNames,
    memberAvatars: prev?.memberAvatars,
  });
  _evictRoomCache();
}

/** Store/refresh a room's member display-name + avatar snapshot on its cache
 *  entry (no-op if the room isn't cached). Keeps the snapshot used by the
 *  instant paint current with the latest member fetch. */
function _putRoomMembers(roomId: string, members: RoomMember[]): void {
  const entry = _roomTimelineCache.get(roomId);
  if (!entry) return;
  const names = new Map<string, string>();
  const avatars = new Map<string, string>();
  for (const m of members) {
    if (m.display_name) names.set(m.user_id, m.display_name);
    if (m.avatar_url) avatars.set(m.user_id, m.avatar_url);
  }
  entry.memberNames = names;
  entry.memberAvatars = avatars;
}

function _evictRoomCache(): void {
  while (_roomTimelineCache.size > _roomCacheMaxRooms) {
    const oldest = _roomTimelineCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    _roomTimelineCache.delete(oldest);
  }
}

/** True if two event lists share the same newest event and length — i.e. the
 *  background refresh found nothing new, so a re-render would just flicker. */
function _sameTimelineHead(a: TimelineEvent[], b: TimelineEvent[]): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  return a[a.length - 1].event_id === b[b.length - 1].event_id;
}

/** Append a live event to a room's cached tail (only for rooms already cached,
 *  i.e. visited this session). Keeps revisits instant *and* current. Called
 *  from the sync message handler for every room. */
export function appendRoomTimelineCache(roomId: string, event: TimelineEvent): void {
  const entry = _roomTimelineCache.get(roomId);
  if (!entry) return;
  if (entry.events.some((e) => e.event_id === event.event_id)) return;
  entry.events.push(event);
  if (entry.events.length > ROOM_TIMELINE_CACHE_CAP) {
    entry.events.splice(0, entry.events.length - ROOM_TIMELINE_CACHE_CAP);
  }
}

/** Unsent compose text per room, restored when the room is reopened (#34). */
export const _composeDrafts = new Map<string, string>();

/**
 * Stash the outgoing room's compose text and restore the incoming room's
 * draft. An in-progress edit is cancelled rather than saved — its text is
 * another room's message body, not a draft. Rooms whose box was emptied lose
 * their stored draft so reopening them shows a clean box. (#34)
 */
export function swapComposeDraft(prevRoom: string | null, nextRoom: string): void {
  const { input } = getComponents();
  cancelEdit(); // no-op unless an edit is in progress
  if (prevRoom) {
    const text = input.getValue();
    if (text) _composeDrafts.set(prevRoom, text);
    else _composeDrafts.delete(prevRoom);
  }
  input.setValue(_composeDrafts.get(nextRoom) ?? "");
}

/**
 * Select a room: fetch timeline, update header, mark read.
 */
export async function selectRoom(
  roomId: string,
  opts: { keepPanelFocus?: boolean } = {},
): Promise<void> {
  const { roomList, roomHeader, timeline, memberList, statusBar, typingIndicator } = getComponents();
  const prevRoom = AppState.get("currentRoomId");

  // Opening any room dismisses the Home canvas — selectRoom is reachable
  // while it's up via the quick-nav palette and notification taps.
  exitHomeView();

  AppState.set("currentRoomId", roomId);
  // Swap compose drafts before anything else touches the box, so the outgoing
  // room's text is stashed and the incoming room's draft appears at once (#34).
  if (prevRoom !== roomId) swapComposeDraft(prevRoom, roomId);
  // Remember this room as the active space's chat so switching away and back
  // restores it instead of leaving a foreign room in the timeline (#11).
  const activeSpace = AppState.get("currentSpaceId");
  if (activeSpace) _lastRoomBySpace.set(activeSpace, roomId);
  // Skip the focus shift when a space switch is loading this room into the
  // timeline in the background — focus must stay on the room list there. (#11)
  if (!opts.keepPanelFocus) AppState.set("activePanel", "timeline");
  // On mobile, picking a room dismisses the room-list drawer — including when the
  // tapped room is already the active one. AppState.set skips no-op changes, so the
  // currentRoomId listener in App.ts that normally closes the drawer won't fire for
  // a re-tap of the current room; closing here covers that case. (#49)
  if (isMobile()) closeDrawer();
  if (AppState.get("threadRootEventId")) closeThread();
  // Clear per-room display name cache so stale names from the previous room
  // don't appear in reply previews before the new room's member list loads.
  _memberDisplayName.clear();
  paginationState.prevBatch = null;
  paginationState.nextBatch = null;
  paginationState.reachedStart = false;
  paginationState.inContextView = false;
  paginationState.contextFocusEventId = null;
  paginationState.paginationLoading = false;
  paginationState.paginationLoadingForward = false;
  // Drop the previous room's read receipts so they can't bleed onto the new
  // room (incl. the instant cache paint below). Re-seeded after the fetch.
  timeline.setReadReceipts([]);
  roomList.setActiveRoom(roomId);

  // Show skeleton immediately before the async IPC fetch so the timeline doesn't
  // appear blank while waiting for message data — but skip it when we can paint
  // instantly from the per-room cache below (revisit), to avoid a skeleton flash.
  if (!_roomTimelineCache.has(roomId)) timeline.showSkeleton();

  // Clear typing indicator when switching rooms
  const typingTextEl = typingIndicator.querySelector(".typing-indicator__text");
  if (typingTextEl) typingTextEl.textContent = "";
  typingIndicator.classList.remove("typing-indicator--active");

  // Clear unread badge optimistically in local cache, then send read receipt.
  // Use updateRoomBadge (not setRooms) so the current space filter is preserved.
  const cached = AppState.get("roomListCache");
  if (cached.some((r) => r.room_id === roomId && (r.unread_count > 0 || r.notification_count > 0))) {
    AppState.set(
      "roomListCache",
      cached.map((r) =>
        r.room_id === roomId ? { ...r, unread_count: 0, notification_count: 0 } : r
      )
    );
    roomList.updateRoomBadge(roomId, 0, 0);
  }
  void markRoomRead(roomId).catch(() => {/* non-fatal: badge already cleared locally */});
  // Dismiss this room's OS notifications immediately; the read-receipt echo
  // from markRoomRead covers other devices, this covers the local one.
  void clearRoomNotificationsIpc(roomId).catch(() => {/* non-fatal */});

  // Find room info in cache (re-read after potential update above)
  const updatedCache = AppState.get("roomListCache");
  const roomInfo = updatedCache.find((r) => r.room_id === roomId);
  const roomName = roomInfo?.name ?? roomId;

  // Pass a cached room avatar URL if one has already been resolved
  const cachedRoomAvatar = roomInfo?.room_id
    ? _roomAvatarDataUrl.get(roomInfo.room_id)
    : undefined;

  // Default: clicking the room avatar opens room settings (DM rooms override below)
  roomHeader.setAvatarClickHandler(() => void openRoomSettings(), "Room settings (:roomsettings)");
  roomHeader.setRoom(
    roomName,
    roomInfo?.topic ?? undefined,
    roomInfo?.member_count,
    roomInfo?.is_encrypted,
    cachedRoomAvatar
  );
  // The mobile top bar mirrors the room avatar — tap opens settings.
  getComponents().mobileTopBar.setRoom(roomName, cachedRoomAvatar);
  // Resolve the room avatar in the background if not already cached
  if (roomInfo?.avatar_url && roomInfo.room_id && !_roomAvatarDataUrl.has(roomInfo.room_id)) {
    const mxcUrl = roomInfo.avatar_url;
    const targetRoomId = roomInfo.room_id;
    void downloadMedia(mxcUrl).then((dl) => {
      const blobUrl = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
      _roomAvatarDataUrl.set(targetRoomId, blobUrl);
      // Only update the header if the user is still looking at this room
      if (AppState.get("currentRoomId") === targetRoomId) {
        getComponents().roomHeader.setAvatarUrl(blobUrl);
        getComponents().mobileTopBar.setRoom(roomName, blobUrl);
      }
    }).catch(() => { /* non-fatal: fallback letter stays */ });
  }

  // Renders an event list into the timeline (thread replies excluded; edits
  // applied). Shared by the instant cache paint and the authoritative refresh.
  const renderEvents = (events: TimelineEvent[]) => {
    const threadRootCounts = _buildThreadRootCounts(events);
    const mainEvents = _applyEdits(events).filter((e) => !e.thread_root);
    const messages = mainEvents.map((e) => timelineEventToMessage(e, events, threadRootCounts));
    timeline.setMessages(messages);
  };
  const registerScrollCallbacks = () => {
    // The top callback fires only when the in-memory buffer is exhausted; the
    // bottom callback fires only while in context view (forward fetches).
    timeline.onScrollToTop(() => void loadMoreMessages());
    timeline.onScrollToBottom(() => void loadMoreMessagesForward());
  };

  // Instant paint from the per-room cache (revisit) — no waiting on the network.
  const cachedTimeline = _roomTimelineCache.get(roomId);
  if (cachedTimeline) {
    // Restore this room's member snapshot into the (just-cleared) global maps so
    // the instant paint resolves real display names/avatars instead of raw IDs.
    if (cachedTimeline.memberNames) {
      for (const [id, name] of cachedTimeline.memberNames) _memberDisplayName.set(id, name);
    }
    if (cachedTimeline.memberAvatars) {
      for (const [id, mxc] of cachedTimeline.memberAvatars) _memberAvatarMxc.set(id, mxc);
    }
    paginationState.reachedStart = cachedTimeline.reachedStart;
    // Copy, don't alias: the live sync handler mutates the cache entry's events
    // array in place (appendRoomTimelineCache → push). If currentTimeline were the
    // same array object, that push would land in currentTimeline *before* the
    // handler's dedup check reads it, so a message arriving in the brief window
    // between this instant paint and the authoritative fetch would be seen as
    // "already in state" and silently dropped from the render (only reappearing on
    // re-entry). A distinct array keeps the dedup accurate.
    AppState.set("currentTimeline", [...cachedTimeline.events]);
    renderEvents(cachedTimeline.events);
    registerScrollCallbacks();
    // Start media/emoji loads from the cached events *now* (not after the
    // background fetch ~2s later). Cached media applies synchronously; the rest
    // streams in. Without this, revisited rooms showed text instantly but images
    // lagged a second behind.
    _downloadMessageImages(cachedTimeline.events, timeline);
    void _downloadReactionEmoji(cachedTimeline.events, timeline);
    _downloadInlineEmoji(timeline);
  }

  try {
    // Authoritative fetch — runs even when we painted from cache, to reconcile
    // anything that changed while we were away. Members come in parallel; we
    // don't block the render on them (cached display names are used).
    const timelinePromise = openRoomTimeline(roomId, ROOM_OPEN_LIMIT);
    const membersPromise = getRoomMembers(roomId).catch(() => [] as RoomMember[]);
    // Seed read receipts (other members' last-read positions) in parallel.
    // Skipped entirely when the display setting is off.
    const receiptsPromise = AppState.get("showReadReceipts")
      ? getRoomReceipts(roomId).catch(() => [])
      : Promise.resolve([]);

    const page = await timelinePromise;
    const { events, reached_start } = page;
    paginationState.reachedStart = reached_start;

    AppState.set("currentTimeline", events);
    _putRoomTimeline(roomId, events, reached_start);

    // Re-render only if the fresh fetch differs from what we painted (or we had
    // nothing cached) — an unchanged revisit keeps its scroll position, no flash.
    if (!cachedTimeline || !_sameTimelineHead(cachedTimeline.events, events)) {
      // Pass unread count so the timeline can insert a "── new messages ──" separator
      if (roomInfo && roomInfo.unread_count > 0) {
        timeline.setUnreadCount(roomInfo.unread_count);
      }
      renderEvents(events);
    }
    if (!cachedTimeline) {
      // Register pagination callbacks (re-registers on each room change).
      registerScrollCallbacks();
    }

    // Kick off media/emoji downloads now — these depend only on the timeline
    // events (already fetched) and the rendered DOM, not on member data. Starting
    // them here lets images load in parallel with the member round-trip below
    // instead of waiting for it.
    _downloadMessageImages(events, timeline);
    void _downloadReactionEmoji(events, timeline);
    _downloadInlineEmoji(timeline);

    // Members arrive asynchronously — update display names and avatars when ready
    const members = await membersPromise;
    for (const m of members) {
      if (m.display_name) _memberDisplayName.set(m.user_id, m.display_name);
      if (m.avatar_url) _memberAvatarMxc.set(m.user_id, m.avatar_url);
    }
    // Refresh this room's snapshot so the next cached revisit paints correct names.
    _putRoomMembers(roomId, members);

    // Update display names in place now that member data is available.
    // Avoids a full DOM rebuild — use targeted text swaps instead of setMessages.
    if (AppState.get("currentRoomId") === roomId) {
      // Accurate member count now available — update header in-place
      roomHeader.setMemberCount(members.length);
      for (const m of members) {
        if (m.display_name) {
          timeline.updateSenderName(m.user_id, m.display_name);
        }
      }

      // Populate the member list sidebar
      memberList.setMembers(members.map(roomMemberToEntry));

      // For DMs with no room avatar, use the other party's profile picture
      if (roomInfo?.is_direct && !roomInfo.avatar_url) {
        const ownUserId = AppState.get("ownUserId");
        const dmPartner = members.find((m) => m.user_id !== ownUserId);
        if (dmPartner) {
          const dmPartnerId = dmPartner.user_id;
          _dmRoomByUser.set(dmPartnerId, roomId);
          _dmUserByRoom.set(roomId, dmPartnerId);
          roomHeader.setAvatarClickHandler(() => void openProfileForUser(dmPartnerId));
          if (dmPartner.avatar_url) {
            const mxc = dmPartner.avatar_url;
            if (_roomAvatarDataUrl.has(roomId)) {
              roomHeader.setAvatarUrl(_roomAvatarDataUrl.get(roomId)!);
            } else {
              void downloadMedia(mxc).then((dl) => {
                const blobUrl = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
                _roomAvatarDataUrl.set(roomId, blobUrl);
                if (AppState.get("currentRoomId") === roomId) {
                  roomHeader.setAvatarUrl(blobUrl);
                }
              }).catch(() => { /* non-fatal */ });
            }
          }
        }
      }

      // Download uncached avatar thumbnails in the background. This depends on
      // member data, so it stays here; the media/emoji downloads were already
      // started above in parallel with the member fetch.
      _downloadMemberAvatars(members, timeline);

      // Seed read-receipt avatars now that member avatars/names are populated, so
      // the chips resolve to real images/names on first paint. Decoration only
      // touches messages currently in the rendered window; off-window receipts
      // reappear when the user scrolls back over them.
      const receipts = await receiptsPromise;
      if (AppState.get("currentRoomId") === roomId && AppState.get("showReadReceipts")) {
        timeline.setReadReceipts(receipts.map((r) => ({ userId: r.user_id, eventId: r.event_id, ts: r.ts })));
        for (const r of receipts) ensureSenderAvatarDownloaded(r.user_id, timeline);
      }
    }
  } catch (err) {
    showError(`Failed to load timeline: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Cancel any active reply if we changed rooms
  if (prevRoom !== roomId) {
    cancelReply();
  }
}

/**
 * Apply the current `showReadReceipts` setting to the open room. Called when the
 * Settings toggle changes at runtime: clears the avatars when turned off, or
 * fetches and seeds them when turned on (the next room open would otherwise be
 * the first chance for the change to take effect).
 */
export async function applyReadReceiptVisibility(): Promise<void> {
  const { timeline } = getComponents();
  if (!AppState.get("showReadReceipts")) {
    timeline.setReadReceipts([]);
    return;
  }
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;
  try {
    const receipts = await getRoomReceipts(roomId);
    // Guard against a room switch or a re-toggle while the fetch was in flight.
    if (AppState.get("currentRoomId") !== roomId || !AppState.get("showReadReceipts")) return;
    timeline.setReadReceipts(receipts.map((r) => ({ userId: r.user_id, eventId: r.event_id, ts: r.ts })));
    for (const r of receipts) ensureSenderAvatarDownloaded(r.user_id, timeline);
  } catch { /* non-fatal */ }
}

/**
 * Load the next page of older messages for the current room and prepend them.
 * Called automatically when the user scrolls to the top of the timeline.
 *
 * If a fetched page contains no displayable messages (e.g. all reactions/state
 * events were filtered out) but history remains, we keep fetching until we
 * either find displayable messages or exhaust the history. This prevents the
 * loading spinner from disappearing with no result while `_scrollTopFired`
 * blocks re-triggering.
 */
async function loadMoreMessages(): Promise<void> {
  if (paginationState.paginationLoading) return;
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  // Two backward paths: context view (a window around a jumped-to message) uses
  // the raw `getTimeline`/`prevBatch` token path; the live timeline uses the
  // cache-backed `loadOlderTimeline`/`reachedStart` path. They're mutually
  // exclusive — `inContextView` is fixed for the duration of this load.
  const inCtx = paginationState.inContextView;
  if (inCtx) {
    if (!paginationState.prevBatch) return;
  } else if (paginationState.reachedStart) {
    return;
  }

  const { timeline } = getComponents();
  paginationState.paginationLoading = true;
  timeline.showLoadingMore();

  // True once the relevant path has reached the start of history.
  const atStart = () => (inCtx ? !paginationState.prevBatch : paginationState.reachedStart);

  try {
    // Loop to skip over pages whose events are all non-displayable (reactions,
    // state events, etc. that get filtered by the Rust backend). Cap iterations
    // to avoid a runaway loop on pathological room histories.
    const MAX_EMPTY_PAGES = 10;
    let emptyPages = 0;

    while (roomId === AppState.get("currentRoomId")) {
      if (atStart()) break;

      let events;
      if (inCtx) {
        const page = await getTimeline(roomId, { limit: 50, before: paginationState.prevBatch! });
        paginationState.prevBatch = page.prev_batch;
        events = page.events;
      } else {
        const page = await loadOlderTimeline(roomId, 300);
        paginationState.reachedStart = page.reached_start;
        events = page.events;
      }

      if (events.length === 0) {
        emptyPages++;
        if (atStart() || emptyPages >= MAX_EMPTY_PAGES) break;
        // History remains but page was all filtered events — keep going
        continue;
      }

      const existingEvents = AppState.get("currentTimeline");
      AppState.set("currentTimeline", [...events, ...existingEvents]);

      const threadRootCounts = _buildThreadRootCounts(events);
      const mainEvents = _applyEdits(events).filter((e) => !e.thread_root);
      const messages = mainEvents.map((e) => timelineEventToMessage(e, events, threadRootCounts));
      timeline.prependMessages(messages);

      _downloadMessageImages(events, timeline);
      _downloadInlineEmoji(timeline);
      void _downloadReactionEmoji(events, timeline);
      // Download avatars for senders not yet cached (e.g., older messages
      // from users whose avatars weren't in the initial timeline page).
      const seenSenders = new Set<string>();
      for (const e of events) {
        if (!seenSenders.has(e.sender)) {
          seenSenders.add(e.sender);
          ensureSenderAvatarDownloaded(e.sender, timeline);
        }
      }
      break;
    }
  } catch (err) {
    showError(`Failed to load more messages: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    paginationState.paginationLoading = false;
    timeline.hideLoadingMore();
  }
}

/**
 * Load the next page of newer messages for the current room and append them.
 * Only meaningful in context view (when the timeline is showing a window in
 * the middle of history rather than the live tail). When the forward fetch
 * returns no `next_batch`, the live tail has been reached and we exit context
 * view so subsequent sync messages append normally.
 */
async function loadMoreMessagesForward(): Promise<void> {
  if (paginationState.paginationLoadingForward || !paginationState.inContextView || !paginationState.nextBatch) return;
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  const { timeline } = getComponents();
  paginationState.paginationLoadingForward = true;
  timeline.showLoadingMore();

  try {
    const MAX_EMPTY_PAGES = 10;
    let emptyPages = 0;

    while (paginationState.nextBatch && roomId === AppState.get("currentRoomId")) {
      const page = await paginateForward(roomId, paginationState.nextBatch, 50);
      paginationState.nextBatch = page.next_batch;

      if (page.events.length === 0) {
        emptyPages++;
        if (!paginationState.nextBatch || emptyPages >= MAX_EMPTY_PAGES) break;
        continue;
      }

      const existingEvents = AppState.get("currentTimeline");
      AppState.set("currentTimeline", [...existingEvents, ...page.events]);

      const threadRootCounts = _buildThreadRootCounts(page.events);
      const mainEvents = _applyEdits(page.events).filter((e) => !e.thread_root);
      const messages = mainEvents.map((e) => timelineEventToMessage(e, page.events, threadRootCounts));
      timeline.appendMessages(messages);

      _downloadMessageImages(page.events, timeline);
      _downloadInlineEmoji(timeline);
      void _downloadReactionEmoji(page.events, timeline);
      const seenSenders = new Set<string>();
      for (const e of page.events) {
        if (!seenSenders.has(e.sender)) {
          seenSenders.add(e.sender);
          ensureSenderAvatarDownloaded(e.sender, timeline);
        }
      }
      break;
    }

    // Reaching `next_batch === null` means the live tail has been reached.
    // Drop out of context view so future sync messages append at the bottom.
    if (paginationState.nextBatch === null) {
      paginationState.inContextView = false;
      timeline.setContextView(false);
    }
  } catch (err) {
    showError(`Failed to load more messages: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    paginationState.paginationLoadingForward = false;
    timeline.hideLoadingMore();
  }
}

/**
 * Jump to a specific message by event ID.
 * If already rendered, scrolls to it. Otherwise fetches surrounding context from
 * the server and rebuilds the timeline centered on the target message.
 */
export async function jumpToMessage(eventId: string): Promise<void> {
  const { timeline } = getComponents();
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  // Fast path — message is already rendered
  if (timeline.scrollToMessage(eventId)) return;

  // Fetch context around the target event and rebuild the timeline
  try {
    const ctx = await getEventContext(roomId, eventId, 25);
    paginationState.contextFocusEventId = eventId;
    _renderContextPage(ctx, eventId, { scrollToFocus: true });
  } catch (err) {
    showError(`Failed to load message: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Render an event-context page into the timeline and set the matching
 * pagination state. Shared by `jumpToMessage` (initial jump) and
 * `reloadCurrentRoomTimeline` (re-fetch when keys arrive).
 *
 * - `scrollToFocus`: scroll to the focused event after render (initial jump).
 *   When false, scroll position is preserved (silent refresh in place).
 */
function _renderContextPage(
  ctx: EventContextPage,
  focusEventId: string,
  opts: { scrollToFocus: boolean },
): void {
  const { timeline } = getComponents();

  paginationState.prevBatch = ctx.prev_batch;
  paginationState.nextBatch = ctx.next_batch;
  paginationState.inContextView = ctx.next_batch !== null;

  AppState.set("currentTimeline", ctx.events);
  const threadRootCounts = _buildThreadRootCounts(ctx.events);
  const mainEvents = _applyEdits(ctx.events).filter((e) => !e.thread_root);
  const messages = mainEvents.map((e) => timelineEventToMessage(e, ctx.events, threadRootCounts));
  if (opts.scrollToFocus) {
    // skipAutoScroll prevents setMessages from scheduling _scrollToBottom calls
    // that would override the scrollToMessage that follows.
    timeline.setMessages(messages, { skipAutoScroll: true });
    requestAnimationFrame(() => {
      timeline.scrollToMessage(focusEventId);
    });
  } else {
    timeline.setMessages(messages, { preserveScroll: true });
  }
  timeline.setContextView(paginationState.inContextView);

  _downloadMessageImages(ctx.events, timeline);
  _downloadInlineEmoji(timeline);
  void _downloadReactionEmoji(ctx.events, timeline);
  const seenSenders = new Set<string>();
  for (const e of ctx.events) {
    if (!seenSenders.has(e.sender)) {
      seenSenders.add(e.sender);
      ensureSenderAvatarDownloaded(e.sender, timeline);
    }
  }

  // A context window is only ~25 events; if it doesn't fill the viewport there
  // is nothing to scroll, so the edge-triggered pagination can never fire and
  // the user is stuck. Proactively page outward until the viewport overflows.
  void _fillContextViewport();
}

/**
 * Paginate the context window outward (newer, then older) until the rendered
 * content overflows the viewport with a comfortable buffer, or history is
 * exhausted in both directions. Breaks the "can't scroll, so nothing loads,
 * so can't scroll" deadlock after a jump. Idempotent and self-guarding: the
 * underlying load functions no-op when already loading or at a boundary.
 */
async function _fillContextViewport(): Promise<void> {
  const { timeline } = getComponents();
  const roomId = AppState.get("currentRoomId");
  // One viewport of extra scroll room above + below the focus is plenty, and
  // the eager prefetch margins take over from there as the user scrolls.
  const targetExtra = () => timeline.viewportHeight();
  const MAX_FILL_PASSES = 8;

  for (let pass = 0; pass < MAX_FILL_PASSES; pass++) {
    if (roomId !== AppState.get("currentRoomId")) return;
    if (timeline.hasScrollableOverflow(targetExtra())) return;

    const before = AppState.get("currentTimeline").length;
    // Forward first so a jump near the live tail becomes scrollable downward,
    // then backward for older history. Each call loads roughly one page.
    await loadMoreMessagesForward();
    if (timeline.hasScrollableOverflow(targetExtra())) return;
    await loadMoreMessages();

    // Neither direction grew the buffer → history exhausted both ways.
    if (AppState.get("currentTimeline").length === before) return;
  }
}

/**
 * Jump back to the live end of the timeline (latest messages).
 * Called when the user presses the "jump to latest" button or G in context view.
 */
export async function jumpToLatest(): Promise<void> {
  const { timeline } = getComponents();
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  if (!paginationState.inContextView) {
    // Not in context view — just scroll to the bottom of what's loaded
    timeline.selectLast();
    return;
  }

  try {
    // Leaving context view → return to the live timeline.
    const page = await openRoomTimeline(roomId, ROOM_OPEN_LIMIT);
    paginationState.prevBatch = null;
    paginationState.nextBatch = null;
    paginationState.reachedStart = page.reached_start;
    paginationState.inContextView = false;
    paginationState.contextFocusEventId = null;

    AppState.set("currentTimeline", page.events);
    _putRoomTimeline(roomId, page.events, page.reached_start);
    const threadRootCounts = _buildThreadRootCounts(page.events);
    const mainEvents = _applyEdits(page.events).filter((e) => !e.thread_root);
    const messages = mainEvents.map((e) => timelineEventToMessage(e, page.events, threadRootCounts));
    timeline.setMessages(messages);
    timeline.setContextView(false);
    timeline.selectLast();

    _downloadMessageImages(page.events, timeline);
    _downloadInlineEmoji(timeline);
    void _downloadReactionEmoji(page.events, timeline);
  } catch (err) {
    showError(`Failed to load latest messages: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Re-load the current room's timeline and re-render in place (preserving
 * scroll). Called when new room keys arrive (post-verification / key-backup
 * restore) so stale "🔒 unable to decrypt" placeholders refresh to plaintext —
 * the backend re-decrypts with the now-available keys on (re-)fetch.
 *
 * In context view the window was fetched via `room.event_with_context()` using
 * only the keys available at jump time; if that was before keys arrived, every
 * event is stuck on the UTD placeholder. So re-fetch the same context window
 * (centered on `contextFocusEventId`) and re-render preserving scroll, rather
 * than reloading the live tail (which would yank the user out of the window).
 *
 * Guarded on the currently-rendered timeline actually containing an
 * undecryptable event: room keys arrive frequently in a busy E2EE room, and an
 * unconditional rebuild on every receipt would repeatedly reset the user's
 * scroll position (and discard in-context pagination) — felt as the scroll
 * "locking up". A reload only changes anything when something is still UTD.
 */
export async function reloadCurrentRoomTimeline(): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  // Nothing undecryptable on screen → a rebuild would be pure churn. Skip it.
  const currentEvents = AppState.get("currentTimeline");
  if (!currentEvents.some((e) => e.msg_type === "m.room.encrypted")) return;

  if (isInContextView()) {
    const focusEventId = paginationState.contextFocusEventId;
    if (!focusEventId) return;
    let ctx;
    try {
      ctx = await getEventContext(roomId, focusEventId, 25);
    } catch {
      return; // non-fatal: leave the current render in place
    }
    if (roomId !== AppState.get("currentRoomId")) return;
    _renderContextPage(ctx, focusEventId, { scrollToFocus: false });
    return;
  }

  const { timeline } = getComponents();
  let page;
  try {
    page = await openRoomTimeline(roomId, ROOM_OPEN_LIMIT);
  } catch {
    return; // non-fatal: leave the current render in place
  }
  // A room switch may have happened during the await.
  if (roomId !== AppState.get("currentRoomId")) return;

  const { events, reached_start } = page;
  paginationState.reachedStart = reached_start;
  AppState.set("currentTimeline", events);
  _putRoomTimeline(roomId, events, reached_start);

  const threadRootCounts = _buildThreadRootCounts(events);
  const mainEvents = _applyEdits(events).filter((e) => !e.thread_root);
  const messages = mainEvents.map((e) => timelineEventToMessage(e, events, threadRootCounts));
  timeline.setMessages(messages, { preserveScroll: true });

  _downloadMessageImages(events, timeline);
  _downloadInlineEmoji(timeline);
  void _downloadReactionEmoji(events, timeline);
}

/**
 * Decide which room a space switch should load into the timeline. Restores the
 * space's remembered last-active chat when it's still listed; otherwise opens
 * the first room, or null for an empty space. (#11)
 */
export function pickSpaceTargetRoom(
  orderedRoomIds: string[],
  rememberedRoomId: string | undefined
): string | null {
  if (rememberedRoomId && orderedRoomIds.includes(rememberedRoomId)) {
    return rememberedRoomId;
  }
  return orderedRoomIds[0] ?? null;
}

/**
 * Select a space: fetch children, filter room list, and load the space's chat.
 *
 * Pass `skipRoomRestore` when the caller will open a specific room itself
 * (e.g. tapping a DM in the Home canvas), so we don't redundantly load — and
 * mark read — a different room first. (#11)
 */
export async function selectSpace(
  spaceId: string,
  opts: { skipRoomRestore?: boolean } = {},
): Promise<void> {
  const { spaceStrip, roomList } = getComponents();
  AppState.set("currentSpaceId", spaceId);
  spaceStrip.setActiveSpace(spaceId);

  // Home is the floating-DM canvas on desktop; every other selection (and
  // Home on mobile, where the drawer flow stays) renders the room list.
  if (spaceId === "__home__" && !isMobile()) {
    await enterHomeView();
    return;
  }
  exitHomeView();

  // Room IDs shown for this space, in display order — used to restore the
  // space's last-active chat (or open its first room) into the timeline (#11).
  let orderedIds: string[] = [];

  const pseudo = getPseudoSpace(spaceId);
  if (pseudo) {
    const allRooms = AppState.get("roomListCache");
    const spaceRoomIds = new Set(AppState.get("spaceRoomIds"));
    const filtered = sortByRecency(allRooms.filter((r) => pseudo.filter(r, spaceRoomIds)));
    roomList.setRooms(filtered.map(roomInfoToEntry));
    orderedIds = filtered.map((r) => r.room_id);
  } else {
    try {
      const children = await getSpaceChildren(spaceId);
      // The backend already sorts by m.space.child order field (then alphabetically).
      const cache = AppState.get("roomListCache");
      const cacheById = new Map(cache.map((r) => [r.room_id, r]));

      // Check if there are any subspaces — if so, render as categories
      const subspaces = children.filter((c) => c.is_space);
      const topRooms = children.filter((c) => !c.is_space);

      if (subspaces.length > 0) {
        // Build sections: top-level rooms first (unlabeled), then each subspace as a category
        const sections: RoomSection[] = [];

        // Top-level rooms (not in any subspace) — unlabeled section
        const topEntries = topRooms.flatMap((c) => {
          const r = cacheById.get(c.room_id);
          return r ? [roomInfoToEntry(r)] : [];
        });
        if (topEntries.length > 0) {
          sections.push({ label: "", rooms: topEntries });
        }

        // Each subspace becomes a labeled category
        await Promise.all(subspaces.map(async (sub) => {
          try {
            const subChildren = await getSpaceChildren(sub.room_id);
            const subRooms = subChildren
              .filter((c) => !c.is_space)
              .flatMap((c) => {
                const r = cacheById.get(c.room_id);
                return r ? [roomInfoToEntry(r)] : [];
              });
            sections.push({ label: sub.name ?? sub.room_id, rooms: subRooms, spaceId: sub.room_id });
          } catch {
            // Skip subspace on error
          }
        }));

        roomList.setSections(sections);
        orderedIds = sections.flatMap((s) => s.rooms.map((e) => e.id));
      } else {
        const ordered = topRooms.flatMap((c) => {
          const r = cacheById.get(c.room_id);
          return r ? [roomInfoToEntry(r)] : [];
        });
        roomList.setRooms(ordered);
        orderedIds = ordered.map((e) => e.id);
      }
    } catch (err) {
      showError(`Failed to load space: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  // Selecting a space is a "browse rooms" action: focus the room list, then load
  // the space's own chat into the timeline WITHOUT stealing that focus, so it
  // never lingers on a room from the space we just left. (#11)
  //
  // Desktop only: on mobile the space strip and room list share one drawer with
  // a tap-and-go flow (selecting a *room* closes the drawer), so auto-opening a
  // room here would slam the drawer shut mid-browse. Mobile keeps tap-and-go.
  AppState.focusPanel("roomlist");
  if (!opts.skipRoomRestore && !isMobile()) {
    await restoreSpaceRoom(spaceId, orderedIds);
  }
}

/**
 * After a space switch, load that space's remembered chat (or its first room)
 * into the timeline, or clear the timeline when the space has no rooms. (#11)
 */
async function restoreSpaceRoom(spaceId: string, orderedRoomIds: string[]): Promise<void> {
  const target = pickSpaceTargetRoom(orderedRoomIds, _lastRoomBySpace.get(spaceId));
  if (!target) {
    clearActiveRoom();
    return;
  }
  // Already showing the target (e.g. re-selecting the current space) — nothing to do.
  if (target !== AppState.get("currentRoomId")) {
    await selectRoom(target, { keepPanelFocus: true });
  }
}

/**
 * Reset the timeline (and header) to a no-room state so a previously open room
 * can't linger after it's no longer reachable (e.g. an empty space). (#11)
 */
function clearActiveRoom(): void {
  if (AppState.get("currentRoomId") === null) return;
  AppState.set("currentRoomId", null);
  AppState.set("currentTimeline", []);
  const { timeline, roomHeader } = getComponents();
  timeline.setMessages([]);
  roomHeader.setRoom(""); // blank default state — same as the header's initial render
}

/**
 * Navigate to an existing DM room with `userId`, or create one if none exists.
 */
export async function openOrCreateDm(userId: string): Promise<void> {
  // Fast path: use cached room ID from a previously visited DM
  const cachedRoomId = _dmRoomByUser.get(userId);
  if (cachedRoomId) {
    await selectRoom(cachedRoomId);
    return;
  }

  // Scan the cached room list for a known DM with this user
  const rooms = AppState.get("roomListCache");
  const ownUserId = AppState.get("ownUserId");
  for (const room of rooms) {
    if (!room.is_direct || room.member_count !== 2) continue;
    // Fetch members to verify — only for small DM rooms
    try {
      const members = await getRoomMembers(room.room_id);
      if (members.some((m) => m.user_id === userId) &&
          members.some((m) => m.user_id === ownUserId)) {
        _dmRoomByUser.set(userId, room.room_id);
        _dmUserByRoom.set(room.room_id, userId);
        await selectRoom(room.room_id);
        return;
      }
    } catch { /* skip on error */ }
  }

  // No existing DM found — create one
  try {
    const roomId = await createRoom({
      name: null,
      topic: null,
      alias: null,
      is_public: false,
      is_direct: true,
      invite: [userId],
      enable_encryption: true,
    });
    _dmRoomByUser.set(userId, roomId);
    _dmUserByRoom.set(roomId, userId);
    await refreshRooms();
    await selectRoom(roomId);
  } catch (err) {
    showError(`Failed to open DM: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Join a room by ID or alias, refresh the room list, and navigate to it.
 * Convenience wrapper for use in UI components.
 */
export async function joinRoom(roomIdOrAlias: string): Promise<void> {
  const roomId = await ipcJoinRoom(roomIdOrAlias);
  showSuccess(`Joined ${roomId}`);
  await refreshRooms();
  await selectRoom(roomId);
}

/**
 * Leave a room with user feedback: on success clear the active room and
 * refresh the room list; on failure surface an error toast. Shared by the
 * `:leave` command and the Room Info leave flow.
 */
export async function leaveRoomWithFeedback(roomId: string): Promise<void> {
  try {
    await ipcLeaveRoom(roomId);
    showSuccess("Left room");
    AppState.set("currentRoomId", null);
    await refreshRooms();
  } catch (err) {
    showError(`Failed to leave: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Confirm-then-leave flow for the current room (Room Info's [leave room]
 * button, `leave-room-confirm` action).
 */
export async function confirmAndLeaveRoom(): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) {
    showError("No room to leave");
    return;
  }
  const confirmed = await askConfirm({
    title: "Leave room?",
    message: "You will no longer receive messages from this room. Rejoining an invite-only room requires a new invite.",
    confirmLabel: "Leave",
    danger: true,
  });
  if (!confirmed) return;
  await leaveRoomWithFeedback(roomId);
}

/**
 * Optimistically reflect a room name/topic edit (from Room settings) in the
 * local cache — and, when it's the current room, the header — so the change is
 * visible immediately instead of waiting for the next sync round-trip. The
 * authoritative value still arrives via `refreshRooms()` on the next
 * `quark://sync/rooms` event.
 */
export function applyLocalRoomMeta(
  roomId: string,
  meta: { name?: string; topic?: string },
): void {
  const cache = AppState.get("roomListCache");
  const updated = cache.map((r) =>
    r.room_id === roomId
      ? {
          ...r,
          ...(meta.name !== undefined ? { name: meta.name } : {}),
          ...(meta.topic !== undefined ? { topic: meta.topic } : {}),
        }
      : r,
  );
  AppState.set("roomListCache", updated);

  if (roomId === AppState.get("currentRoomId")) {
    const entry = updated.find((r) => r.room_id === roomId);
    if (entry) {
      // setRoom leaves member count / encryption / avatar untouched when those
      // args are omitted.
      getComponents().roomHeader.setRoom(entry.name ?? roomId, entry.topic ?? undefined);
    }
  }
}

// ── Live recency re-sort ─────────────────────────────────────────────────────

let _resortTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Bump a room's last-activity timestamp in the local cache from a live sync
 * event, and schedule a re-sort of the visible view when it's a pseudo-space
 * (Home / DMs / Groups — the recency-sorted views). Real spaces keep their
 * fixed m.space.child order and are never re-sorted. Debounced so a burst of
 * messages coalesces into one re-render.
 */
export function bumpRoomActivity(roomId: string, ts: number): void {
  const cache = AppState.get("roomListCache");
  const entry = cache.find((r) => r.room_id === roomId);
  if (!entry) return;
  if (ts <= (entry.last_activity_ts ?? 0)) return;

  AppState.set(
    "roomListCache",
    cache.map((r) => (r.room_id === roomId ? { ...r, last_activity_ts: ts } : r)),
  );

  if (!getPseudoSpace(AppState.get("currentSpaceId") ?? "__home__")) return;
  if (_resortTimer) clearTimeout(_resortTimer);
  _resortTimer = setTimeout(() => {
    _resortTimer = null;
    resortPseudoSpaceView();
  }, 250);
}

/**
 * Re-apply the current pseudo-space filter + recency sort to the visible room
 * list, preserving scroll position and keyboard focus (focus is only restored
 * when it was already inside the list, so it's never stolen from the compose
 * box or timeline).
 */
export function resortPseudoSpaceView(): void {
  const { roomList } = getComponents();
  // The Home canvas hides the room list and runs its own live updates.
  if (AppState.get("homeViewActive")) return;
  const pseudo = getPseudoSpace(AppState.get("currentSpaceId") ?? "__home__");
  if (!pseudo) return;

  const spaceRoomIds = new Set(AppState.get("spaceRoomIds"));
  const filtered = sortByRecency(
    AppState.get("roomListCache").filter((r) => pseudo.filter(r, spaceRoomIds)),
  );

  const focusedId = roomList.getFocusedRoomId();
  const scrollEl = roomList.getScrollElement();
  const scrollTop = scrollEl.scrollTop;
  roomList.setRooms(filtered.map(roomInfoToEntry));
  scrollEl.scrollTop = scrollTop;
  if (focusedId) roomList.focusRoom(focusedId);
}

/**
 * Refresh the room list from the backend.
 */
export async function refreshRooms(): Promise<void> {
  const { roomList, spaceStrip } = getComponents();

  try {
    const [rooms, userSpaces] = await Promise.all([
      getRooms(),
      getUserSpaces().catch(() => [] as Awaited<ReturnType<typeof getUserSpaces>>),
    ]);
    AppState.set("roomListCache", rooms);

    // Build the set of rooms/subspaces that belong to any space, and collect
    // subspace IDs so they can be excluded from the sidebar strip.
    const spaceRoomIdSet = new Set<string>();
    const subspaceIdSet = new Set<string>();
    await Promise.all(
      userSpaces.map(async (space) => {
        try {
          const children = await getSpaceChildren(space.room_id);
          for (const c of children) {
            // Add all children (rooms and subspaces) so they're hidden from the home list
            spaceRoomIdSet.add(c.room_id);
            if (c.is_space) subspaceIdSet.add(c.room_id);
          }
        } catch {
          // Non-critical — worst case the home view shows extra rooms
        }
      })
    );
    AppState.set("spaceRoomIds", [...spaceRoomIdSet]);

    // Populate space strip — exclude subspaces (they appear nested inside their parent space)
    const topLevelSpaces = userSpaces.filter((s) => !subspaceIdSet.has(s.room_id));
    const spaceItems: SpaceItem[] = topLevelSpaces.map((s) => ({
      id: s.room_id,
      name: s.name ?? s.room_id,
    }));
    spaceStrip.setSpaces(spaceItems);

    // Resolve space avatar mxc:// URLs in the background
    for (const s of topLevelSpaces) {
      if (s.avatar_url?.startsWith("mxc://")) {
        const mxcUrl = s.avatar_url;
        const roomId = s.room_id;
        // Use full media (not thumbnail) so animated GIF/WEBP space avatars are preserved.
        downloadMedia(mxcUrl)
          .then((dl) => {
            const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
            spaceStrip.updateSpaceAvatar(roomId, dataUrl);
          })
          .catch(() => { /* non-critical */ });
      }
    }

    // Refresh the current pseudo-space view with fresh data. Real spaces are
    // refreshed by their own getSpaceChildren flow when re-selected. The Home
    // canvas owns its own refresh, so leave the (hidden) room list alone.
    const spaceId = AppState.get("currentSpaceId");
    const pseudo = getPseudoSpace(spaceId ?? "__home__");
    if (pseudo && !AppState.get("homeViewActive")) {
      const spaceRoomIdsSet = new Set(AppState.get("spaceRoomIds"));
      const filtered = sortByRecency(rooms.filter((r) => pseudo.filter(r, spaceRoomIdsSet)));
      roomList.setRooms(filtered.map(roomInfoToEntry));
    }
  } catch (err) {
    showError(`Failed to load rooms: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Refresh the member list for the current room (e.g. after a sync event).
 */
export async function loadRoomMembers(roomId: string): Promise<void> {
  const { memberList, timeline } = getComponents();
  try {
    const members = await getRoomMembers(roomId);
    for (const m of members) {
      if (m.display_name) _memberDisplayName.set(m.user_id, m.display_name);
      if (m.avatar_url) _memberAvatarMxc.set(m.user_id, m.avatar_url);
    }
    _putRoomMembers(roomId, members);
    memberList.setMembers(members.map(roomMemberToEntry));
    _downloadMemberAvatars(members, timeline);
  } catch {
    // Non-critical — member list may just stay empty
  }
}
