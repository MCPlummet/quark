// Home view actions: entering/leaving the floating-DM canvas, data loading,
// avatar resolution, and live updates from the sync stream.

import { AppState } from "../state.js";
import { isMobile, onMobileChange } from "../mobile.js";

import {
  getHomeData,
  getOwnProfile,
  downloadMedia,
  setPresenceStatus,
  getAppConfig,
  DEFAULT_APP_CONFIG,
} from "../../ipc/index.js";
import type { HomeDmInfo, TimelineEvent } from "../../ipc/types.js";

import { showError } from "../../ui/NotificationToast.js";
import type { HomeFloater } from "../../ui/HomeView.js";

import {
  getComponents,
  _avatarDataUrl,
  _mediaToBlobUrl,
  resolveUserStatus,
} from "./context.js";
import { selectRoom, selectSpace } from "./rooms.js";
import { pickAndUploadAvatar } from "./profile.js";


let _handlersWired = false;
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function isHomeViewActive(): boolean {
  return AppState.get("homeViewActive");
}

/** Map a HomeDmInfo to the floater's display strings. */
export function dmToFloater(dm: HomeDmInfo, ownUserId: string | null): HomeFloater {
  const rawPresence = dm.dm_user_id ? AppState.getUserPresence(dm.dm_user_id) : null;
  const presence =
    rawPresence === "online" || rawPresence === "unavailable" ? rawPresence : "offline";
  return {
    roomId: dm.room_id,
    name: dm.name ?? dm.dm_user_id ?? dm.room_id,
    dmUserId: dm.dm_user_id,
    avatarUrl: dm.avatar_url ? (_avatarDataUrl.get(dm.avatar_url) ?? null) : null,
    presence,
    snippet: previewSnippet(
      {
        body: dm.last_body,
        msgType: dm.last_msg_type,
        isUtd: dm.last_is_utd,
        sender: dm.last_sender,
      },
      ownUserId,
    ),
    statusMessage: dm.dm_user_id ? AppState.getUserStatus(dm.dm_user_id) : null,
    lastTs: dm.last_activity_ts,
    unreadCount: dm.unread_count,
  };
}

/** Render a one-line bubble preview from message metadata. */
export function previewSnippet(
  last: { body: string | null; msgType: string | null; isUtd: boolean; sender: string | null },
  ownUserId: string | null,
): string {
  const prefix = last.sender && ownUserId && last.sender === ownUserId ? "you: " : "";
  if (last.isUtd) return `${prefix}🔒 encrypted`;
  switch (last.msgType) {
    case "m.image":
      return `${prefix}📷 image`;
    case "m.video":
      return `${prefix}🎞 video`;
    case "m.audio":
      return `${prefix}🔊 audio`;
    case "m.file":
      return `${prefix}📎 file`;
    case "m.sticker":
      return `${prefix}${last.body || "sticker"}`;
    default:
      return last.body ? `${prefix}${last.body}` : "";
  }
}

/**
 * Enter the Home view: swap the layout to the canvas, render immediately from
 * whatever is cached, then fill in previews/avatars as they resolve.
 */
export async function enterHomeView(): Promise<void> {
  const components = getComponents();
  const { homeView, mainLayout } = components;
  wireHomeViewOnce();

  AppState.set("homeViewActive", true);
  mainLayout.classList.add("quark-layout--home");

  const ownUserId = AppState.get("ownUserId");
  // Paint the profile card from state first; profile fetch fills the rest.
  homeView.show(
    {
      userId: ownUserId ?? "",
      displayName: AppState.get("ownDisplayName"),
      avatarUrl: null,
      statusMessage: ownUserId ? AppState.getUserStatus(ownUserId) : null,
    },
    [],
  );
  AppState.focusPanel("home");

  // Own profile (name/avatar/status) — non-blocking.
  void (async () => {
    try {
      const profile = await getOwnProfile();
      homeView.updateOwnProfile({
        userId: profile.user_id,
        displayName: profile.display_name,
      });
      const status = await resolveUserStatus(profile.user_id);
      if (status !== null) homeView.updateOwnProfile({ statusMessage: status });
      if (profile.avatar_url) {
        const url = await resolveAvatar(profile.avatar_url);
        if (url && AppState.get("homeViewActive")) {
          homeView.updateOwnProfile({ avatarUrl: url });
        }
      }
    } catch {
      /* non-critical — the card shows cached values */
    }
  })();

  await loadHomeFloaters();
}

/** Leave the Home view (no-op when not active). */
export function exitHomeView(): void {
  if (!AppState.get("homeViewActive")) return;
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
  AppState.set("homeViewActive", false);
  const { homeView, mainLayout } = getComponents();
  mainLayout.classList.remove("quark-layout--home");
  homeView.hide();
}

/** Fetch DM data and (re-)render the canvas; resolves avatars afterwards. */
async function loadHomeFloaters(): Promise<void> {
  const { homeView } = getComponents();
  const ownUserId = AppState.get("ownUserId");
  const limit = await getAppConfig()
    .then((cfg) => cfg.home.dm_limit)
    .catch(() => DEFAULT_APP_CONFIG.home.dm_limit);
  let dms: HomeDmInfo[];
  try {
    dms = await getHomeData(limit);
  } catch (err) {
    showError(`Failed to load home view: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!AppState.get("homeViewActive")) return;

  homeView.setFloaters(dms.map((dm) => dmToFloater(dm, ownUserId)));

  // Resolve missing avatars in the background; paint as they arrive.
  for (const dm of dms) {
    if (!dm.avatar_url || _avatarDataUrl.has(dm.avatar_url)) continue;
    const mxc = dm.avatar_url;
    const roomId = dm.room_id;
    void resolveAvatar(mxc).then((url) => {
      if (url && AppState.get("homeViewActive")) {
        homeView.updateFloaterAvatar(roomId, url);
      }
    });
  }

  // Status-message fallback: caught-up chats show the partner's status in
  // the bubble. Cached statuses were painted by dmToFloater; fetch the rest
  // in the background and patch bubbles as they resolve.
  for (const dm of dms) {
    const userId = dm.dm_user_id;
    if (!userId || dm.unread_count > 0) continue;
    if (AppState.getUserStatus(userId) !== null) continue;
    void resolveUserStatus(userId).then((status) => {
      if (status && AppState.get("homeViewActive")) {
        homeView.updateStatusMessage(userId, status);
      }
    });
  }
}

/** mxc → cached blob URL (shared `_avatarDataUrl` cache). */
async function resolveAvatar(mxcUrl: string): Promise<string | null> {
  const cached = _avatarDataUrl.get(mxcUrl);
  if (cached) return cached;
  try {
    const dl = await downloadMedia(mxcUrl);
    const url = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
    _avatarDataUrl.set(mxcUrl, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Live message while the Home view is showing: update the bubble in place
 * when the room is on the canvas; schedule a debounced reload otherwise (a
 * new room may have entered the top-N).
 */
export function homeViewHandleMessage(roomId: string, event: TimelineEvent): void {
  if (!AppState.get("homeViewActive")) return;
  const { homeView } = getComponents();
  if (homeView.floaterRoomIds().includes(roomId)) {
    if (!event.is_edit) {
      const ownUserId = AppState.get("ownUserId");
      const snippet = previewSnippet(
        {
          body: event.body,
          msgType: event.msg_type,
          isUtd: event.msg_type === "m.room.encrypted",
          sender: event.sender,
        },
        ownUserId,
      );
      const fromPartner = !!event.sender && event.sender !== ownUserId;
      homeView.updateBubble(roomId, snippet, event.timestamp, fromPartner);
    }
    return;
  }
  // Off-canvas room got a message — debounce a reload to re-rank the top-N.
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null;
    void loadHomeFloaters();
  }, 400);
}

/** Live presence (state + status message) while the Home view is showing. */
export function homeViewHandlePresence(
  userId: string,
  presence: "online" | "unavailable" | "offline",
  statusMsg: string | null,
): void {
  if (!AppState.get("homeViewActive")) return;
  const { homeView } = getComponents();
  homeView.updatePresence(userId, presence);
  homeView.updateStatusMessage(userId, statusMsg);
}

function wireHomeViewOnce(): void {
  if (_handlersWired) return;
  _handlersWired = true;
  const { homeView, statusBar } = getComponents();

  homeView.setHandlers({
    onOpenRoom: (roomId) => {
      // Land in the DMs list context (the natural "back" target), then open the
      // tapped room — skipRoomRestore so selectSpace doesn't open a different DM
      // first (which would mark it read before we land on the right one). (#11)
      exitHomeView();
      void selectSpace("__dms__", { skipRoomRestore: true }).then(() => selectRoom(roomId));
    },
    onSaveStatus: (status) => {
      void setPresenceStatus(status)
        .then(() => {
          statusBar.setStatusMessage(status);
          const ownUserId = AppState.get("ownUserId");
          if (ownUserId) AppState.cacheUserStatus(ownUserId, status || null);
        })
        .catch((err) =>
          showError(`Failed to set status: ${err instanceof Error ? err.message : String(err)}`),
        );
    },
    onChangeAvatar: () => {
      void pickAndUploadAvatar().then((url) => {
        if (url && AppState.get("homeViewActive")) {
          homeView.updateOwnProfile({ avatarUrl: url });
        }
      });
    },
  });

  // The Home canvas is desktop-only: rotating into mobile mode while it's
  // active falls back to the regular Home room list (the drawer flow).
  onMobileChange((mobile) => {
    if (mobile && AppState.get("homeViewActive")) {
      exitHomeView();
      void selectSpace("__home__");
    }
  });
}
