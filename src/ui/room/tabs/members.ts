// Room dialog → Members tab.
//
// Invite, kick and ban existed only as `:` commands, which on mobile — where
// vim is force-disabled — meant they did not exist at all. This is their
// pointer and touch surface.
//
// Moderation rows are offered against the account's own power level rather than
// unconditionally: showing a [kick] button that the homeserver will refuse is
// worse than not showing it, because the user cannot tell a permission problem
// from a bug. The thresholds come from the room's power-levels event, the same
// source the Permissions tab edits.

import type { RoomTab, RoomTabContext } from "../types.js";
import type { RoomMember } from "../../../ipc/types.js";
import { getRoomMembers, inviteUser, kickUser, banUser } from "../../../ipc/rooms.js";
import { getPowerLevels } from "../../../ipc/room_settings.js";
import { AppState } from "../../../app/state.js";
import { showError, showSuccess } from "../../NotificationToast.js";

/** The account's effective power level in this room. */
export function ownPowerLevel(
  ownUserId: string | null,
  users: Record<string, number>,
  usersDefault: number,
): number {
  if (!ownUserId) return usersDefault;
  return users[ownUserId] ?? usersDefault;
}

/**
 * Whether the account may act on a member at `targetLevel`.
 *
 * Matrix requires strictly greater power to kick or ban someone, and you can
 * never act on yourself this way — so a room where everyone sits at the default
 * correctly offers nothing.
 */
export function canModerate(
  ownLevel: number,
  threshold: number,
  targetLevel: number,
  isSelf: boolean,
): boolean {
  if (isSelf) return false;
  return ownLevel >= threshold && ownLevel > targetLevel;
}

function memberLabel(member: RoomMember): string {
  return member.display_name ? `${member.display_name} (${member.user_id})` : member.user_id;
}

async function buildMemberRows(
  ctx: RoomTabContext,
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = "";

  const loading = document.createElement("div");
  loading.className = "settings-dialog__row";
  loading.textContent = "Loading members…";
  container.appendChild(loading);

  let members: RoomMember[];
  let ownLevel: number;
  let kickThreshold: number;
  let banThreshold: number;
  let levels: Record<string, number>;
  let usersDefault: number;

  try {
    const [fetched, pl] = await Promise.all([
      getRoomMembers(ctx.roomId),
      getPowerLevels(ctx.roomId),
    ]);
    members = fetched;
    levels = pl.users;
    usersDefault = pl.users_default;
    ownLevel = ownPowerLevel(AppState.get("ownUserId"), pl.users, pl.users_default);
    kickThreshold = pl.kick;
    banThreshold = pl.ban;
  } catch (err) {
    loading.textContent =
      `Failed to load members: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  loading.remove();

  const ownUserId = AppState.get("ownUserId");

  for (const member of members) {
    const row = document.createElement("div");
    row.className = "settings-dialog__row room-settings-dialog__user-row";

    const label = document.createElement("span");
    label.className = "settings-dialog__label room-settings-dialog__user-id";
    label.textContent = memberLabel(member);
    row.appendChild(label);

    const targetLevel = levels[member.user_id] ?? usersDefault;
    const isSelf = member.user_id === ownUserId;

    const addAction = (
      text: string,
      threshold: number,
      danger: boolean,
      run: () => Promise<void>,
      confirmWord: string,
    ): void => {
      if (!canModerate(ownLevel, threshold, targetLevel, isSelf)) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-dialog__btn" + (danger ? " settings-dialog__btn--danger" : "");
      btn.textContent = text;
      btn.setAttribute("aria-label", `${confirmWord} ${member.user_id}`);
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await run();
          showSuccess(`${confirmWord} ${member.user_id}`);
          void buildMemberRows(ctx, container);
        } catch (err) {
          showError(
            `Failed to ${confirmWord.toLowerCase()}: ${err instanceof Error ? err.message : String(err)}`,
          );
          btn.disabled = false;
        }
      });
      row.appendChild(btn);
    };

    addAction("[kick]", kickThreshold, false,
      () => kickUser(ctx.roomId, member.user_id), "Kicked");
    addAction("[ban]", banThreshold, true,
      () => banUser(ctx.roomId, member.user_id), "Banned");

    container.appendChild(row);
  }
}

export const membersTab: RoomTab = {
  id: "members",
  label: "Members",
  async build(ctx) {
    const { content, controls } = ctx;

    // ── Invite ───────────────────────────────────────────────────────────
    content.appendChild(controls.sectionTitle("Invite"));

    const inviteRow = document.createElement("div");
    inviteRow.className = "settings-dialog__row";

    const inviteInput = document.createElement("input");
    inviteInput.type = "text";
    inviteInput.className = "settings-dialog__text-input";
    inviteInput.placeholder = "@user:server.org";
    inviteInput.setAttribute("aria-label", "User ID to invite");
    inviteInput.style.width = "220px";

    const inviteBtn = document.createElement("button");
    inviteBtn.type = "button";
    inviteBtn.className = "settings-dialog__btn";
    inviteBtn.textContent = "[invite]";

    const doInvite = async (): Promise<void> => {
      const userId = inviteInput.value.trim();
      if (!userId) return;
      inviteBtn.disabled = true;
      try {
        await inviteUser(ctx.roomId, userId);
        showSuccess(`Invited ${userId}`);
        inviteInput.value = "";
      } catch (err) {
        showError(`Failed to invite: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        inviteBtn.disabled = false;
      }
    };

    inviteBtn.addEventListener("click", () => void doInvite());
    inviteInput.addEventListener("keydown", (e) => {
      // The dialog's own handler would otherwise take Enter as "activate tab".
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        void doInvite();
      }
    });

    inviteRow.append(inviteInput, inviteBtn);
    content.appendChild(inviteRow);

    // ── Roster ───────────────────────────────────────────────────────────
    content.appendChild(controls.sectionTitle("Members"));
    const roster = document.createElement("div");
    content.appendChild(roster);
    await buildMemberRows(ctx, roster);
  },
};
