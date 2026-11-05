// Invites dialog — every pending room invite, with accept / decline.
//
// Opened from the status line's invites button, `:invites`, or the palette.
// The list is pushed in from AppState (`setInvites`), so it follows invites
// that arrive, or are answered on another device, while it is open.
//
// Shares the room directory's look (`room-dir-dialog` classes): it is the same
// shape of thing — a list of rooms you are not in yet, each with a way in.

import { keymapManager } from "../vim/keybindings.js";
import type { InviteInfo } from "../ipc/types.js";
import { DialogBase } from "./DialogBase.js";

type InviteHandler = (roomId: string) => Promise<boolean>;

/** What a row is called: the room's name, or for a nameless DM its inviter. */
export function inviteTitle(invite: InviteInfo): string {
  if (invite.name) return invite.name;
  if (invite.is_direct && (invite.inviter_name || invite.inviter_id)) {
    return invite.inviter_name ?? invite.inviter_id ?? invite.room_id;
  }
  return invite.canonical_alias ?? invite.room_id;
}

/** The row's second line: who invited you, and the room's address. */
export function inviteMeta(invite: InviteInfo): string {
  const parts: string[] = [];
  const who = invite.inviter_name ?? invite.inviter_id;
  if (invite.is_direct) parts.push(who ? `direct message from ${who}` : "direct message");
  else if (who) parts.push(`invited by ${who}`);
  if (invite.inviter_name && invite.inviter_id) parts.push(invite.inviter_id);
  else if (invite.canonical_alias && invite.canonical_alias !== inviteTitle(invite)) {
    parts.push(invite.canonical_alias);
  }
  if (invite.is_encrypted) parts.push("encrypted");
  return parts.join(" · ");
}

export class InvitesDialog extends DialogBase {
  private _listEl: HTMLElement;
  private _invites: InviteInfo[] = [];
  private _focusIndex = 0;
  /** Rooms with an accept or decline in flight. */
  private _busy = new Set<string>();
  private _onAccept: InviteHandler | null = null;
  private _onDecline: InviteHandler | null = null;

  constructor() {
    super({ prefix: "room-dir-dialog", ariaLabel: "Invites" });
    this.root.classList.add("invites-dialog");

    this.buildHeader("── invites ──", "Close invites");

    this._listEl = document.createElement("div");
    this._listEl.className = "room-dir-dialog__list";
    this._listEl.setAttribute("role", "listbox");
    this._listEl.setAttribute("aria-label", "Pending invites");
    this.content.appendChild(this._listEl);

    const footer = document.createElement("div");
    footer.className = "room-dir-dialog__footer";
    footer.textContent = "j/k navigate · Enter accept · x decline · Esc close";
    footer.setAttribute("aria-hidden", "true");
    this.content.appendChild(footer);
  }

  onAccept(handler: InviteHandler): void {
    this._onAccept = handler;
  }

  onDecline(handler: InviteHandler): void {
    this._onDecline = handler;
  }

  show(): void {
    this._focusIndex = 0;
    this._render();
    this.reveal();
  }

  /** Replace the list, keeping the focused invite focused if it is still there. */
  setInvites(invites: InviteInfo[]): void {
    const focusedId = this._invites[this._focusIndex]?.room_id;
    this._invites = invites;
    const live = new Set(invites.map((i) => i.room_id));
    for (const id of this._busy) if (!live.has(id)) this._busy.delete(id);
    const kept = focusedId ? invites.findIndex((i) => i.room_id === focusedId) : -1;
    this._focusIndex = kept >= 0 ? kept : Math.min(this._focusIndex, Math.max(0, invites.length - 1));
    if (this.isVisible()) this._render();
  }

  protected override focusTarget(): HTMLElement {
    return this._listEl;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _render(): void {
    this._listEl.innerHTML = "";
    this._listEl.tabIndex = -1;

    if (this._invites.length === 0) {
      const empty = document.createElement("div");
      empty.className = "room-dir-dialog__status";
      empty.textContent = "No pending invites.";
      this._listEl.appendChild(empty);
      return;
    }

    this._invites.forEach((invite, index) => this._listEl.appendChild(this._makeItem(invite, index)));
    this._updateFocus();
  }

  private _makeItem(invite: InviteInfo, index: number): HTMLElement {
    const busy = this._busy.has(invite.room_id);
    const item = document.createElement("div");
    item.className = "room-dir-dialog__item invites-dialog__item";
    item.setAttribute("role", "option");
    item.dataset.index = String(index);
    item.dataset.roomId = invite.room_id;
    item.classList.toggle("invites-dialog__item--busy", busy);

    const nameEl = document.createElement("span");
    nameEl.className = "room-dir-dialog__name";
    nameEl.textContent = inviteTitle(invite);
    if (invite.is_space || invite.is_direct) {
      const tag = document.createElement("span");
      tag.className = "invites-dialog__tag";
      tag.textContent = invite.is_space ? "space" : "dm";
      nameEl.appendChild(tag);
    }
    item.appendChild(nameEl);

    const meta = inviteMeta(invite);
    if (meta) {
      const metaEl = document.createElement("div");
      metaEl.className = "room-dir-dialog__meta";
      metaEl.textContent = meta;
      item.appendChild(metaEl);
    }

    if (invite.topic) {
      const topicEl = document.createElement("div");
      topicEl.className = "room-dir-dialog__topic";
      topicEl.textContent = invite.topic;
      item.appendChild(topicEl);
    }

    const actions = document.createElement("div");
    actions.className = "invites-dialog__actions";
    const accept = this._makeAction(busy ? "[…]" : "[accept]", "invites-dialog__accept", `Accept invite to ${inviteTitle(invite)}`, () => void this._accept(index));
    const decline = this._makeAction("[decline]", "invites-dialog__decline", `Decline invite to ${inviteTitle(invite)}`, () => void this._decline(index));
    accept.disabled = busy;
    decline.disabled = busy;
    actions.append(accept, decline);
    item.appendChild(actions);

    item.addEventListener("click", () => {
      this._focusIndex = index;
      this._updateFocus();
    });
    return item;
  }

  private _makeAction(label: string, cls: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `invites-dialog__btn ${cls}`;
    btn.textContent = label;
    btn.setAttribute("aria-label", ariaLabel);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private _updateFocus(): void {
    const items = this._listEl.querySelectorAll<HTMLElement>(".invites-dialog__item");
    items.forEach((el, i) => {
      const focused = i === this._focusIndex;
      el.classList.toggle("room-dir-dialog__item--focused", focused);
      el.setAttribute("aria-selected", String(focused));
      if (focused) el.scrollIntoView?.({ block: "nearest" });
    });
  }

  private _moveFocus(delta: number): void {
    if (this._invites.length === 0) return;
    this._focusIndex = Math.max(0, Math.min(this._focusIndex + delta, this._invites.length - 1));
    this._updateFocus();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private async _accept(index: number): Promise<void> {
    const invite = this._invites[index];
    if (!invite || this._busy.has(invite.room_id) || !this._onAccept) return;
    this._setBusy(invite.room_id, true);
    const ok = await this._onAccept(invite.room_id);
    if (ok) {
      // Accepting takes you there; the dialog has done its job.
      this.hide();
    } else {
      this._setBusy(invite.room_id, false);
    }
  }

  private async _decline(index: number): Promise<void> {
    const invite = this._invites[index];
    if (!invite || this._busy.has(invite.room_id) || !this._onDecline) return;
    this._setBusy(invite.room_id, true);
    const ok = await this._onDecline(invite.room_id);
    // On success the row goes when AppState's list drops it (setInvites).
    if (!ok) this._setBusy(invite.room_id, false);
  }

  private _setBusy(roomId: string, busy: boolean): void {
    if (busy) this._busy.add(roomId);
    else this._busy.delete(roomId);
    if (this.isVisible()) this._render();
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (this.isEscape(e)) {
      e.preventDefault();
      this.hide();
      return;
    }
    // A focused [accept]/[decline] button handles its own Enter/Space.
    if ((e.target as HTMLElement | null)?.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this._moveFocus(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        this._moveFocus(-1);
        return;
      case "Enter":
        e.preventDefault();
        void this._accept(this._focusIndex);
        return;
      case "x":
      case "Delete":
        e.preventDefault();
        void this._decline(this._focusIndex);
        return;
    }

    const result = keymapManager.resolveKey(e.key, "picker");
    if (result.kind === "action") {
      switch (result.action) {
        case "close":
          e.preventDefault();
          this.hide();
          return;
        case "nav-down":
          e.preventDefault();
          this._moveFocus(1);
          return;
        case "nav-up":
          e.preventDefault();
          this._moveFocus(-1);
          return;
        case "jump-top":
          e.preventDefault();
          this._focusIndex = 0;
          this._updateFocus();
          return;
        case "jump-bottom":
          e.preventDefault();
          this._focusIndex = Math.max(0, this._invites.length - 1);
          this._updateFocus();
          return;
      }
    } else if (result.kind === "partial") {
      e.preventDefault();
    }
  }
}
