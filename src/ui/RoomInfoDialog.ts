// Room Info dialog — shows details of the current room

import { AppState } from "../app/state.js";
import { muteRoom, unmuteRoom, getConfig } from "../app/notifications.js";
import type { RoomInfo } from "../ipc/types.js";
import { DialogBase } from "./DialogBase.js";

export class RoomInfoDialog extends DialogBase {
  constructor() {
    super({ prefix: "room-info-dialog", ariaLabel: "Room info", panel: false });
  }

  async show(): Promise<void> {
    const state = AppState.snapshot;
    const roomId = state.currentRoomId;

    this.root.innerHTML = "";

    if (!roomId) {
      this._buildError("No room selected.");
      this.reveal();
      return;
    }

    const room: RoomInfo | undefined = state.roomListCache.find((r) => r.room_id === roomId);

    // Header
    const header = document.createElement("div");
    header.className = "room-info-dialog__header";
    const titleEl = document.createElement("span");
    titleEl.className = "room-info-dialog__title";
    titleEl.textContent = "── room info ──";
    header.appendChild(titleEl);
    header.appendChild(this.makeCloseButton("Close"));
    this.root.appendChild(header);

    // Info body
    const body = document.createElement("div");
    body.className = "room-info-dialog__body";

    const addRow = (label: string, value: string, muted = false): void => {
      const row = document.createElement("div");
      row.className = "room-info-dialog__row";
      const lbl = document.createElement("span");
      lbl.className = "room-info-dialog__label";
      lbl.textContent = label;
      const val = document.createElement("span");
      val.className = "room-info-dialog__value" + (muted ? " room-info-dialog__value--muted" : "");
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
    };

    addRow("name", room?.name ?? "(unknown)");
    addRow("topic", room?.topic ?? "(none)");
    addRow("members", String(room?.member_count ?? "?"));
    addRow("encrypted", room?.is_encrypted ? "yes" : "no");
    addRow("direct", room?.is_direct ? "yes" : "no");
    addRow("room id", roomId, true);

    this.root.appendChild(body);

    // Actions
    const actions = document.createElement("div");
    actions.className = "room-info-dialog__actions";

    // Mute toggle. The push rule *is* the mute (DESIGN.md → Push
    // notifications), so the button must reflect the ruleset the backend
    // reports on RoomInfo — a mute set from another client shows up there and
    // never in the local list. `mute_rooms` stays as the offline fallback: it
    // is all we have when the room isn't in the cache yet (cold start, or a
    // room the store hasn't synced), where "did we try to mute this here" is
    // the best available answer.
    let isMuted: boolean;
    if (room?.muted !== undefined) {
      isMuted = room.muted;
    } else {
      const config = await getConfig().catch(() => null);
      isMuted = config?.mute_rooms.includes(roomId) ?? false;
    }

    const muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.className = "room-info-dialog__btn" + (isMuted ? " room-info-dialog__btn--muted" : "");
    muteBtn.textContent = isMuted ? "[unmute]" : "[mute]";
    muteBtn.addEventListener("click", async () => {
      try {
        if (isMuted) {
          await unmuteRoom(roomId);
        } else {
          await muteRoom(roomId);
        }
        // Patch the cached RoomInfo so reopening the dialog before the next
        // room-list refresh doesn't show the state we just changed away from.
        AppState.set(
          "roomListCache",
          AppState.get("roomListCache").map((r) =>
            r.room_id === roomId ? { ...r, muted: !isMuted } : r
          )
        );
        this.hide();
      } catch {
        muteBtn.textContent = "[error]";
      }
    });
    actions.appendChild(muteBtn);

    // Settings button — open room settings
    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "room-info-dialog__btn";
    settingsBtn.textContent = "[settings]";
    settingsBtn.addEventListener("click", () => {
      this.hide();
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action: "open-room-settings" } }));
    });
    actions.appendChild(settingsBtn);

    // Raw button — open debug viewer for this room
    const rawBtn = document.createElement("button");
    rawBtn.type = "button";
    rawBtn.className = "room-info-dialog__btn";
    rawBtn.textContent = "[raw]";
    rawBtn.addEventListener("click", () => {
      this.hide();
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action: "open-debug" } }));
    });
    actions.appendChild(rawBtn);

    // Leave button — fires the leave-room action via custom event
    const leaveBtn = document.createElement("button");
    leaveBtn.type = "button";
    leaveBtn.className = "room-info-dialog__btn room-info-dialog__btn--danger";
    leaveBtn.textContent = "[leave room]";
    leaveBtn.addEventListener("click", () => {
      this.hide();
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action: "leave-room-confirm" } }));
    });
    actions.appendChild(leaveBtn);

    // Close button
    const closeBtnAction = document.createElement("button");
    closeBtnAction.type = "button";
    closeBtnAction.className = "room-info-dialog__btn";
    closeBtnAction.textContent = "[close]";
    closeBtnAction.addEventListener("click", () => this.hide());
    actions.appendChild(closeBtnAction);

    this.root.appendChild(actions);

    // Hint
    const hint = document.createElement("div");
    hint.className = "room-info-dialog__hint";
    hint.textContent = "Esc: close";
    this.root.appendChild(hint);

    this.reveal();
  }

  private _buildError(msg: string): void {
    const err = document.createElement("div");
    err.style.padding = "16px";
    err.textContent = msg;
    this.root.appendChild(err);
  }
}
