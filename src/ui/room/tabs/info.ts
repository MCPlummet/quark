// Room dialog → Info tab.
//
// What RoomInfoDialog was, minus the parts that duplicated room settings. The
// two dialogs both stated name, topic, members, encryption and directness; the
// facts live here and the controls that change them live on the Settings tab,
// which is the division the old pair never made (#92).
//
// Mute lives here rather than in Settings because it is a per-account
// preference about a room, not a property of the room — and because it is the
// one row on this tab a user reaches for repeatedly.

import type { RoomTab, RoomTabContext } from "../types.js";
import { getConfig } from "../../../app/notifications.js";
import { setRoomMuted } from "../../../app/actions/rooms.js";

/**
 * Whether the room is muted.
 *
 * The push rule *is* the mute (DESIGN.md → Push notifications), so the answer
 * must come from the ruleset the backend reports on RoomInfo — a mute set from
 * another client shows up there and never in the local list. `mute_rooms` is
 * the offline fallback: it is all we have before the room has synced, where
 * "did we try to mute this here" is the best available answer.
 */
async function resolveMuted(ctx: RoomTabContext): Promise<boolean> {
  if (ctx.room?.muted !== undefined) return ctx.room.muted;
  const config = await getConfig().catch(() => null);
  return config?.mute_rooms.includes(ctx.roomId) ?? false;
}

export const infoTab: RoomTab = {
  id: "info",
  label: "Info",
  async build(ctx) {
    const { content, controls, room, roomId } = ctx;

    content.appendChild(controls.sectionTitle("Room"));
    content.appendChild(controls.readRow("name", room?.name ?? "(unknown)"));
    content.appendChild(controls.readRow("topic", room?.topic ?? "(none)"));
    content.appendChild(controls.readRow("members", String(room?.member_count ?? "?")));
    content.appendChild(controls.readRow("encrypted", room?.is_encrypted ? "yes" : "no"));
    content.appendChild(controls.readRow("direct", room?.is_direct ? "yes" : "no"));
    content.appendChild(controls.readRow("room id", roomId));

    // ── Notifications ────────────────────────────────────────────────────
    content.appendChild(controls.sectionTitle("Notifications"));

    let muted = await resolveMuted(ctx);

    const muteRow = document.createElement("div");
    muteRow.className = "settings-dialog__row";
    const muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.className = "settings-dialog__btn";

    const renderMute = (): void => {
      muteBtn.textContent = muted ? "[unmute room]" : "[mute room]";
      muteBtn.classList.toggle("settings-dialog__btn--muted", muted);
    };
    renderMute();

    muteBtn.addEventListener("click", async () => {
      muteBtn.disabled = true;
      try {
        // setRoomMuted patches the cached RoomInfo and repaints the room-list
        // row, and does neither unless the account's ruleset actually changed —
        // it resolves on a refused rule write too, and patching regardless
        // reported a mute the server never got until the next get_rooms flipped
        // it back (#82). It returns the state now in effect, so the button
        // follows the server rather than the click.
        muted = await setRoomMuted(roomId, !muted);
        renderMute();
      } catch {
        muteBtn.textContent = "[error]";
        setTimeout(renderMute, 2000);
      } finally {
        muteBtn.disabled = false;
      }
    });

    muteRow.appendChild(muteBtn);
    content.appendChild(muteRow);

    // ── Actions ──────────────────────────────────────────────────────────
    content.appendChild(controls.sectionTitle("Actions"));

    const actions = document.createElement("div");
    actions.className = "settings-dialog__actions";

    actions.appendChild(
      controls.dispatchButton("[ view raw state ]", "View raw room state", () => {
        ctx.close();
        ctx.dispatch("open-debug");
      }),
    );

    const leave = controls.dispatchButton("[ leave room ]", "Leave this room", () => {
      ctx.close();
      ctx.dispatch("leave-room-confirm");
    });
    leave.querySelector("button")?.classList.add("settings-dialog__btn--danger");
    actions.appendChild(leave);

    content.appendChild(actions);
  },
};
