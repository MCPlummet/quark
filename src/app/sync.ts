// Sync event handler — listens for backend-pushed events via Tauri event system

import { AppState } from "./state.js";
import type { AppComponents } from "../ui/App.js";
import type { TimelineEvent, RoomInfo } from "../ipc/types.js";
import { refreshRooms, selectRoom, resolveDisplayName, consumeOwnSentEvent, applyIncomingReaction, resolveInlineEmojiForTimeline, handleIncomingVerificationRequest, downloadSyncMessageImage, resolveSenderAvatarUrl, ensureSenderAvatarDownloaded, applyIncomingRedaction, stripReplyFallback, isInContextView, reloadCurrentRoomTimeline, refreshPinnedMessagesIfOpen, appendRoomTimelineCache, bumpRoomActivity, homeViewHandleMessage, homeViewHandlePresence } from "./actions.js";
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

// ── Message helpers ───────────────────────────────────────────────────────────

function timelineEventToMessage(e: TimelineEvent) {
  const msgType = (() => {
    if (e.msg_type === "m.image") return "image" as const;
    if (e.msg_type === "m.sticker") return "sticker" as const;
    if (e.msg_type === "m.video") return "video" as const;
    if (e.msg_type === "m.file") return "file" as const;
    return "text" as const;
  })();

  // Build reply preview from the current timeline state
  let replyTo: import("../ui/Timeline.js").ReplyPreviewData | undefined;
  if (e.in_reply_to) {
    const allEvents = AppState.get("currentTimeline");
    const parent = allEvents.find((ev) => ev.event_id === e.in_reply_to);
    if (parent) {
      // If the parent is itself a reply, strip its quoted fallback so the
      // preview shows the parent's own words, not its grandparent's.
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

  // Strip Matrix reply fallback so the quoted original doesn't render twice
  const { body: displayBody, htmlBody: displayHtml } = e.in_reply_to
    ? stripReplyFallback(e.body, e.formatted_body ?? undefined)
    : { body: e.body, htmlBody: e.formatted_body ?? undefined };

  return {
    id: e.event_id,
    senderId: e.sender,
    senderName: resolveDisplayName(e.sender),
    senderAvatarUrl: resolveSenderAvatarUrl(e.sender),
    timestamp: new Date(e.timestamp).toISOString(),
    body: displayBody,
    htmlBody: displayHtml,
    type: msgType,
    mediaUrl: e.media_url ?? undefined,
    mediaAlt: e.body,
    mediaMimeType: e.media_mimetype ?? undefined,
    // MSC2530 caption. Without this a captioned image painted bare in the live
    // tail (sends have no local echo, so they arrive through here) and only
    // showed its caption after a reload, which maps events via context.ts.
    caption: e.caption ?? undefined,
    mediaEncryptionInfo: e.media_encryption_info ?? undefined,
    replyTo,
  };
}

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

      // Keep the per-room timeline cache warm for any room we've loaded this
      // session (not just the current one), so revisiting it paints the latest
      // messages instantly instead of a stale tail. No-op for uncached rooms.
      appendRoomTimelineCache(payload.room_id, payload.event);

      // Bump the room's recency so the pseudo-space views (Home/DMs/Groups)
      // re-sort as messages arrive — own echoes included, so sending also
      // floats the room to the top.
      bumpRoomActivity(payload.room_id, payload.event.timestamp);

      // Keep the Home canvas's bubbles live (no-op when it isn't showing).
      homeViewHandleMessage(payload.room_id, payload.event);

      const isCurrentRoomLive = payload.room_id === currentRoom && !isInContextView();
      // In context view we keep the room in focus but skip applying live-tail
      // events to the timeline — they'd render with a hidden gap before them.
      // They show up properly when the user paginates forward to the live tail.
      // The toast still fires below.
      const skipForContextView = payload.room_id === currentRoom && isInContextView();

      if (isCurrentRoomLive) {
        // Deduplicate: skip events already in the state cache (e.g. initial sync
        // replay of messages already loaded via getTimeline, or a second client
        // emitting the same event in dev hot-reload scenarios).
        const current = AppState.get("currentTimeline");
        const alreadyInState = current.some((e) => e.event_id === payload.event.event_id);
        if (!alreadyInState) {
          AppState.set("currentTimeline", [...current, payload.event]);
        }

        // Skip rendering if: (a) already in state (replay), (b) it's our own
        // echo (deduplication via _ownSentEventIds), or (c) it's already in the
        // DOM (race: echo arrived after confirmMessage but before add-to-set).
        const alreadyInDom = !!timeline.getMessageElementById(payload.event.event_id);
        if (!alreadyInState && !alreadyInDom && !consumeOwnSentEvent(payload.event.event_id)) {
          const openThreadId = AppState.get("threadRootEventId");

          if (payload.event.thread_root) {
            // Thread replies never appear in the main timeline. Route to the
            // thread panel if the matching thread is open, and always update
            // the reply count indicator on the thread root message.
            if (openThreadId !== null && payload.event.thread_root === openThreadId) {
              timeline.appendInlineReply({
                id: payload.event.event_id,
                senderName: resolveDisplayName(payload.event.sender),
                isOwn: false,
                timestamp: new Date(payload.event.timestamp).toISOString(),
                body: payload.event.body,
              });
            }
            timeline.incrementThreadReplyCount(payload.event.thread_root);
          } else if (payload.event.is_edit && payload.event.relates_to_event_id) {
            // Edit: update the original message body in place
            timeline.updateMessageBody(
              payload.event.relates_to_event_id,
              payload.event.body,
              payload.event.formatted_body ?? undefined,
            );
          } else {
            timeline.appendMessage(timelineEventToMessage(payload.event));
            downloadSyncMessageImage(payload.event, timeline);
            ensureSenderAvatarDownloaded(payload.event.sender, timeline);
            resolveInlineEmojiForTimeline(timeline);
          }
        }
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
      const roomName =
        AppState.get("roomListCache").find((r) => r.room_id === payload.room_id)
          ?.name ?? payload.room_id;
      handleIncomingMessage(
        payload.room_id,
        resolveDisplayName(payload.event.sender),
        payload.event.body,
        roomName
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
