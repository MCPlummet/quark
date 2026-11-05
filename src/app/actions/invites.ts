// Pending room invites: keeping the list current, telling the user when a new
// one arrives, and accepting or declining one.
//
// The list lives in AppState (`invites`) and is refreshed alongside the room
// list — every `quark://sync/rooms` signal re-reads both — so the status-line
// count and an open invites dialog follow invites accepted or declined on
// another device too.

import { AppState } from "../state.js";
import {
  getInvites,
  acceptInvite as ipcAcceptInvite,
  declineInvite as ipcDeclineInvite,
} from "../../ipc/index.js";
import type { InviteInfo } from "../../ipc/types.js";
import { showToast, showError, showSuccess } from "../../ui/NotificationToast.js";
import { inviteTitle } from "../../ui/InvitesDialog.js";
import { getComponents } from "./context.js";
import { refreshRooms, selectRoom, selectSpace } from "./rooms.js";

/**
 * Invite IDs already known, or null before the first load — which is never
 * announced, so starting the app doesn't toast every invite still pending.
 */
let _known: Set<string> | null = null;

/**
 * Invites answered here in the last few seconds. A refresh that read the list
 * before the answer reached the server would otherwise put the row back until
 * the next sync.
 */
const _answered = new Map<string, number>();
const ANSWERED_TTL_MS = 15_000;

function stillPending(invite: InviteInfo, now: number): boolean {
  const until = _answered.get(invite.room_id);
  if (until === undefined) return true;
  if (until > now) return false;
  _answered.delete(invite.room_id);
  return true;
}

/** The one-line announcement for invites that just arrived. */
export function newInvitesMessage(fresh: InviteInfo[]): string | null {
  if (fresh.length === 0) return null;
  if (fresh.length > 1) return `${fresh.length} new invites`;
  const inv = fresh[0];
  const who = inv.inviter_name ?? inv.inviter_id;
  if (inv.is_direct) return who ? `${who} wants to chat` : "New direct message invite";
  const what = inv.is_space ? `the space ${inviteTitle(inv)}` : inviteTitle(inv);
  return who ? `${who} invited you to ${what}` : `Invited to ${what}`;
}

/**
 * Re-read pending invites into AppState, announcing any that are new. Never
 * throws: a failed read keeps the last known list.
 */
export async function refreshInvites(): Promise<void> {
  let invites: InviteInfo[];
  try {
    invites = await getInvites();
  } catch (err) {
    console.warn("Failed to load invites:", err);
    return;
  }
  const now = Date.now();
  invites = invites.filter((i) => stillPending(i, now));
  const fresh = _known ? invites.filter((i) => !_known!.has(i.room_id)) : [];
  _known = new Set(invites.map((i) => i.room_id));
  AppState.set("invites", invites);

  const message = newInvitesMessage(fresh);
  if (message) showToast(`✉ ${message}`, "info", 6000, { group: "invites" });
}


function dropInvite(roomId: string): void {
  _answered.set(roomId, Date.now() + ANSWERED_TTL_MS);
  _known?.delete(roomId);
  AppState.set("invites", AppState.get("invites").filter((i) => i.room_id !== roomId));
}

/** Open the invites dialog. */
export function openInvites(): void {
  getComponents().invitesDialog.show();
}

/**
 * Accept an invite and go to it — the room, or for a space, the space.
 * Resolves to whether it was accepted.
 */
export async function acceptInvite(roomId: string): Promise<boolean> {
  const invite = AppState.get("invites").find((i) => i.room_id === roomId);
  const label = invite ? inviteTitle(invite) : roomId;
  let joined: string;
  try {
    joined = await ipcAcceptInvite(roomId);
  } catch (err) {
    showError(`Failed to accept invite: ${err instanceof Error ? err.message : String(err)}`);
    // The invite may be gone server-side (rescinded, or answered elsewhere).
    void refreshInvites();
    return false;
  }
  dropInvite(roomId);
  showSuccess(`Joined ${label}`);
  await refreshRooms();
  if (invite?.is_space) await selectSpace(joined);
  else await selectRoom(joined);
  return true;
}

/** Decline an invite. Resolves to whether it was declined. */
export async function declineInvite(roomId: string): Promise<boolean> {
  const invite = AppState.get("invites").find((i) => i.room_id === roomId);
  try {
    await ipcDeclineInvite(roomId);
  } catch (err) {
    showError(`Failed to decline invite: ${err instanceof Error ? err.message : String(err)}`);
    void refreshInvites();
    return false;
  }
  dropInvite(roomId);
  showSuccess(`Declined ${invite ? inviteTitle(invite) : "invite"}`);
  return true;
}
