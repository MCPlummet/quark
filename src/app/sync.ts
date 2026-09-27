// Sync event handler — listens for backend-pushed events via Tauri event system

import { AppState } from "./state.js";
import type { AppComponents } from "../ui/App.js";
import type { TimelineEvent, RoomInfo } from "../ipc/types.js";
import { refreshRooms, selectRoom, resolveDisplayName, applyIncomingReaction, handleIncomingVerificationRequest, ensureSenderAvatarDownloaded, applyIncomingRedaction, isInContextView, reloadCurrentRoomTimeline, refreshPinnedMessagesIfOpen, homeViewHandlePresence, recordLiveEvent, renderLiveEvent } from "./actions.js";
import { showToast } from "../ui/NotificationToast.js";
import { handleIncomingMessage } from "./notifications.js";

// ── Tauri event types ─────────────────────────────────────────────────────────

interface SyncNewMessagePayload {
  room_id: string;
  event: TimelineEvent;
}

interface SyncRoomListChangedPayload {
  rooms: RoomInfo[];
}

interface SyncTypingPayload {
  room_id: string;
  user_ids: string[];
}

interface SyncPresencePayload {
  user_id: string;
  presence: "online" | "unavailable" | "offline";
  status_msg: string | null;
}

interface SyncReactionPayload {
  room_id: string;
  target_event_id: string;
  sender: string;
  key: string;
  reaction_event_id: string;
}

interface SyncVerificationRequestPayload {
  user_id: string;
  device_id: string;
  flow_id: string;
}

interface SyncRedactionPayload {
  room_id: string;
  redacted_event_id: string;
}

interface SyncReadReceiptPayload {
  room_id: string;
  event_id: string;
  user_id: string;
  ts: number | null;
}

interface RoomKeysReceivedPayload {
  room_ids: string[];
}

/**
 * Server-authoritative unread counts for one room.
 *
 * Field names match `RoomInfo`'s deliberately, so folding this into the cached
 * room entry needs no per-field mapping — the #59 swap came back once already
 * because two adjacent counters were remapped by hand.
 */
interface SyncRoomUnreadCountPayload {
  room_id: string;
  unread_count: number;
  notification_count: number;
}

// ── Tauri event listener shim ─────────────────────────────────────────────────

type UnlistenFn = () => void;

/**
 * Attempt to import @tauri-apps/api/event and call listen().
 * Falls back gracefully if running outside Tauri (e.g. browser dev mode).
 */
async function tauriListen<T>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<T>(event, (e) => handler(e.payload));
  } catch {
    // Not running in Tauri or event not available — no-op unlisten
    return () => {};
  }
}

// ── Message mapping ───────────────────────────────────────────────────────────
//
// There is deliberately no event→MessageData mapper here. The live tail maps
// events with the SAME `timelineEventToMessage` the room-load path uses (see
// actions/context.ts); a private near-copy in this file is what made captions
// (#41), image dimensions, video thumbnails and own-sender styling appear only
// after a room reload.

// ── Public API ────────────────────────────────────────────────────────────────

let _unlisteners: UnlistenFn[] = [];

// Room keys arrive in bursts (e.g. the flush right after a session is verified,
// or a key-backup restore). Each burst can newly decrypt room names / last
// messages / avatars across many rooms, so the room LIST needs re-fetching — not
// just the open room's timeline. Debounce so one refresh runs after the burst
// settles instead of one per key event.
let _roomListRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function _scheduleRoomListRefresh(): void {
  if (_roomListRefreshTimer) clearTimeout(_roomListRefreshTimer);
  _roomListRefreshTimer = setTimeout(() => {
    _roomListRefreshTimer = null;
    void refreshRooms();
  }, 800);
}

/**
 * Start listening for sync events from the Tauri backend.
 * Returns a cleanup function.
 */
export async function startSync(components: AppComponents): Promise<() => void> {
  const { timeline, roomList, statusBar, typingIndicator } = components;

  // Tear down any listeners from a previous startSync() before registering a new
  // set. Otherwise a second call (e.g. logout → login in the same session) would
  // orphan the old listeners — `_unlisteners` is overwritten below, losing their
  // unlisten handles — so every sync event would be handled twice (duplicate
  // toasts, duplicate renders), compounding on each re-login.
  stopSync();

  // ── quark://sync/message ──────────────────────────────────────────────────
  const unlistenMessage = await tauriListen<SyncNewMessagePayload>(
    "quark://sync/message",
    (payload) => {
      const currentRoom = AppState.get("currentRoomId");

      // Timeline cache, recency and the Home canvas — for every room, open or not.
      recordLiveEvent(payload.room_id, payload.event);

      const isCurrentRoomLive = payload.room_id === currentRoom && !isInContextView();
      // In context view we keep the room in focus but skip applying live-tail
      // events to the timeline — they'd render with a hidden gap before them.
      // They show up properly when the user paginates forward to the live tail.
      // The toast still fires below.
      const skipForContextView = payload.room_id === currentRoom && isInContextView();

      // Whether this event is actually being painted somewhere the user can
      // see it — which is not the same question as "is its room open". A thread
      // reply is deliberately never appended to the main timeline, so with the
      // thread panel closed it renders nowhere; suppressing its toast on the
      // strength of the room being open dropped it entirely.
      let isRendered = false;

      if (isCurrentRoomLive) {
        isRendered = renderLiveEvent(payload.event, timeline);
      } else if (!skipForContextView) {
        // Update unread count on room list item. Skip this for the current
        // room when we're in context view — the user is still focused on it,
        // and the badge would otherwise count messages they haven't acted on
        // because they're still scrolled into the past.
        const cached = AppState.get("roomListCache");
        const updated = cached.map((r) => {
          if (r.room_id === payload.room_id) {
            return { ...r, unread_count: r.unread_count + 1 };
          }
          return r;
        });
        AppState.set("roomListCache", updated);
        // Use updateRoomBadge instead of setRooms to preserve the current space filter.
        const updatedRoom = updated.find((r) => r.room_id === payload.room_id);
        if (updatedRoom) {
          roomList.updateRoomBadge(payload.room_id, updatedRoom.unread_count, updatedRoom.notification_count);
        }
      }

      // Trigger in-app toast when window is focused (OS notification is handled
      // by the Rust backend when the window is not focused).
      //
      // `isRendered` is passed rather than a bare "is this the open room": in
      // context view, and for a thread reply with the panel closed, the room is
      // open while this message is not drawn anywhere, so the toast is the only
      // signal it arrived (#89).
      const roomName =
        AppState.get("roomListCache").find((r) => r.room_id === payload.room_id)
          ?.name ?? payload.room_id;
      handleIncomingMessage({
        roomId: payload.room_id,
        senderId: payload.event.sender,
        senderName: resolveDisplayName(payload.event.sender),
        body: payload.event.body,
        roomName,
        isRendered,
      });
    }
  );

  // ── quark://sync/unread_count ─────────────────────────────────────────────
  //
  // The backend has emitted this for every synced message all along, and until
  // now nothing listened: the badge was drawn from a local `unread_count + 1`
  // guess that only ever went up, and from whatever `get_rooms` last returned.
  // Two consequences the server's own numbers fix — a mention arriving while
  // the app is open did not light the mention badge until the next room-list
  // refresh, and reading a room on another device did not clear this one's.
  const unlistenUnread = await tauriListen<SyncRoomUnreadCountPayload>(
    "quark://sync/unread_count",
    (payload) => {
      // The open room is exempt. Its badge is cleared locally on open and the
      // read receipt is sent only then, so the server's count for it climbs for
      // as long as the user sits reading — honouring it here would draw a badge
      // on the very room they are looking at. This mirrors the message handler,
      // which likewise never bumps the badge of the room in focus.
      if (payload.room_id === AppState.get("currentRoomId")) return;

      const cached = AppState.get("roomListCache");
      let changed = false;
      const updated = cached.map((r) => {
        if (r.room_id !== payload.room_id) return r;
        if (
          r.unread_count === payload.unread_count &&
          r.notification_count === payload.notification_count
        ) {
          return r;
        }
        changed = true;
        return {
          ...r,
          unread_count: payload.unread_count,
          notification_count: payload.notification_count,
        };
      });
      if (!changed) return;

      AppState.set("roomListCache", updated);
      // updateRoomBadge rather than setRooms, so the current space filter survives.
      roomList.updateRoomBadge(
        payload.room_id,
        payload.unread_count,
        payload.notification_count,
      );
    }
  );

  // ── quark://sync/rooms ────────────────────────────────────────────────────
  const unlistenRooms = await tauriListen<SyncRoomListChangedPayload>(
    "quark://sync/rooms",
    (_payload) => {
      void refreshRooms();
    }
  );

  // ── quark://sync/typing ───────────────────────────────────────────────────
  const unlistenTyping = await tauriListen<SyncTypingPayload>(
    "quark://sync/typing",
    (payload) => {
      const currentRoom = AppState.get("currentRoomId");
      if (payload.room_id !== currentRoom) return;

      const { typingIndicator } = components;
      const textEl = typingIndicator.querySelector(".typing-indicator__text");

      if (payload.user_ids.length > 0) {
        const names = payload.user_ids.join(", ");
        const label = payload.user_ids.length === 1
          ? `${names} is typing…`
          : `${names} are typing…`;
        if (textEl) textEl.textContent = label;
        typingIndicator.classList.add("typing-indicator--active");
      } else {
        if (textEl) textEl.textContent = "";
        typingIndicator.classList.remove("typing-indicator--active");
      }
    }
  );

  // ── quark://sync/presence ─────────────────────────────────────────────────
  const unlistenPresence = await tauriListen<SyncPresencePayload>(
    "quark://sync/presence",
    (payload) => {
      // Cache every presence payload — including the own user's — so the
      // profile-edit dialog can pre-fill the status field without an extra
      // round-trip. Previously only other users' status was cached, so
      // opening "edit profile" showed an empty status box even when one was
      // set.
      AppState.cacheUserStatus(payload.user_id, payload.status_msg ?? null);

      const ownUserId = AppState.get("ownUserId");
      if (payload.user_id === ownUserId) {
        // Own user's presence — also update the status bar chip.
        statusBar.setStatusMessage(payload.status_msg ?? "");
      } else {
        // Cache presence state and update the member list indicator live
        AppState.cacheUserPresence(payload.user_id, payload.presence);
        const validPresence = (payload.presence === "online" || payload.presence === "unavailable")
          ? payload.presence
          : "offline" as const;
        components.memberList.updateMemberPresence(payload.user_id, validPresence);
        components.roomList.updatePresenceForUser(payload.user_id, validPresence);
        homeViewHandlePresence(payload.user_id, validPresence, payload.status_msg ?? null);
      }
    }
  );

  // ── quark://sync/connected ────────────────────────────────────────────────
  const unlistenConnected = await tauriListen<boolean>(
    "quark://sync/connected",
    (connected) => {
      statusBar.setConnected(connected);
      if (connected) {
        // Refresh rooms after the first sync completes — on first login the
        // initial refreshRooms() fires before sync has populated joined_rooms().
        void refreshRooms();
      } else {
        showToast("Connection lost — reconnecting…", "error", 5000);
      }
    }
  );

  // ── quark://sync/reaction ─────────────────────────────────────────────────
  const unlistenReaction = await tauriListen<SyncReactionPayload>(
    "quark://sync/reaction",
    (payload) => {
      const currentRoom = AppState.get("currentRoomId");
      if (payload.room_id !== currentRoom) return;
      applyIncomingReaction(payload.target_event_id, payload.sender, payload.key, payload.reaction_event_id);
    }
  );

  // ── quark://sync/verification_request ────────────────────────────────────
  const unlistenVerification = await tauriListen<SyncVerificationRequestPayload>(
    "quark://sync/verification_request",
    (payload) => {
      handleIncomingVerificationRequest(
        payload.user_id,
        payload.device_id,
        payload.flow_id,
      );
    }
  );

  // ── quark://sync/redaction ────────────────────────────────────────────────
  const unlistenRedaction = await tauriListen<SyncRedactionPayload>(
    "quark://sync/redaction",
    (payload) => {
      const currentRoom = AppState.get("currentRoomId");
      if (payload.room_id !== currentRoom) return;
      applyIncomingRedaction(payload.redacted_event_id);
    }
  );

  // ── quark://sync/read_receipt ─────────────────────────────────────────────
  // Another user's read position changed. Move their receipt avatar to the new
  // message (the backend already filters out our own user and private receipts).
  const unlistenReadReceipt = await tauriListen<SyncReadReceiptPayload>(
    "quark://sync/read_receipt",
    (payload) => {
      if (payload.room_id !== AppState.get("currentRoomId")) return;
      if (!AppState.get("showReadReceipts")) return;
      if (payload.user_id === AppState.get("ownUserId")) return;
      timeline.setReadReceipt(payload.user_id, payload.event_id, payload.ts);
      // Download the user's avatar if we don't already have it cached, so the
      // chip resolves from its initial to a real avatar.
      ensureSenderAvatarDownloaded(payload.user_id, timeline);
    }
  );

  // ── quark://sync/room_keys ────────────────────────────────────────────────
  // New room keys arrived (e.g. after verification). If we're showing one of the
  // affected rooms, reload it so stale "unable to decrypt" events re-decrypt.
  const unlistenRoomKeys = await tauriListen<RoomKeysReceivedPayload>(
    "quark://sync/room_keys",
    (payload) => {
      // New keys can make room names / last-message previews decryptable across
      // the whole list (this is what makes a freshly-verified session "fix
      // itself" without a relaunch), so refresh the list, debounced.
      _scheduleRoomListRefresh();

      const currentRoom = AppState.get("currentRoomId");
      if (currentRoom && payload.room_ids.includes(currentRoom)) {
        void reloadCurrentRoomTimeline();
        // The pinned dialog, if open, holds its own (possibly UTD) snapshot —
        // refresh it too so newly-decryptable pins update in place.
        void refreshPinnedMessagesIfOpen();
      }
    }
  );

  _unlisteners = [
    unlistenMessage,
    unlistenUnread,
    unlistenRooms,
    unlistenTyping,
    unlistenPresence,
    unlistenConnected,
    unlistenReaction,
    unlistenVerification,
    unlistenRedaction,
    unlistenReadReceipt,
    unlistenRoomKeys,
  ];

  // Mark as online
  statusBar.setConnected(true);

  return stopSync;
}

/**
 * Stop all sync listeners.
 */
export function stopSync(): void {
  for (const unlisten of _unlisteners) {
    unlisten();
  }
  _unlisteners = [];
}
