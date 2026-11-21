// A tabbed dialog about one room — the host the room dialog and space settings
// share (#12).
//
// It was RoomDialog's body. Space settings kept its own copy of the same idea
// with its two tabs hard-coded in a switch, so adding a third (Emoji) meant a
// third case in each of its three switchyards. A space is a room: the same
// `RoomTab` contract, controls and stylesheet serve both, and each dialog is
// now its title, its tab registry and how it picks the room.
//
// Structurally identical to SettingsDialog, deliberately: same chrome, same
// controls, same stylesheet, same mobile list/detail split. The room is
// resolved once, up front, and handed to every tab, so a tab cannot act on a
// room other than the one whose header it shows.

import { isMobile } from "../../app/mobile.js";
import { AppState } from "../../app/state.js";
import { DialogBase } from "../DialogBase.js";
import { makeControls } from "../settings/controls.js";
import type { SettingsControls } from "../settings/controls.js";
import type { RoomTab } from "./types.js";

const DETAIL_CLASS = "settings-dialog__panel--detail";

export interface RoomTabsDialogOpts {
  /** Header text, e.g. "── room ──". */
  title: string;
  ariaLabel: string;
  closeLabel: string;
  backLabel: string;
  tabs: RoomTab[];
  /** Handed to tabs for wording. */
  subject: "room" | "space";
  /** Shown when there is no room to describe. */
  noRoomText: string;
}

export abstract class RoomTabsDialog extends DialogBase {
  private readonly _opts: RoomTabsDialogOpts;
  private _panelEl: HTMLElement;
  private _bodyEl: HTMLElement;
  private _contentEl!: HTMLElement;
  private _backBtn: HTMLButtonElement;
  private readonly _controls: SettingsControls = makeControls();
  private _tabs: RoomTab[] = [];
  private _mobile = false;
  private _activeId = "";
  private _roomId: string | null = null;
  private _tabEls: Map<string, HTMLElement> = new Map();

  protected constructor(opts: RoomTabsDialogOpts) {
    // Shares the settings-dialog styling; see the note above.
    super({ prefix: "settings-dialog", ariaLabel: opts.ariaLabel });
    this._opts = opts;
    this._panelEl = this.content;

    this.buildHeader(opts.title, opts.closeLabel);
    this._backBtn = document.createElement("button");
    this._backBtn.type = "button";
    this._backBtn.className = "settings-dialog__back";
    this._backBtn.textContent = "[‹ back]";
    this._backBtn.setAttribute("aria-label", opts.backLabel);
    this._backBtn.tabIndex = -1;
    this._backBtn.addEventListener("click", () => this._showList());
    this.header?.insertBefore(this._backBtn, this.header.firstChild);

    this._bodyEl = document.createElement("div");
    this._bodyEl.className = "settings-dialog__body";
    this._panelEl.appendChild(this._bodyEl);

    const footer = document.createElement("div");
    footer.className = "settings-dialog__footer";
    footer.setAttribute("aria-hidden", "true");
    footer.textContent = "Tab switch section · Esc close";
    this._panelEl.appendChild(footer);
  }

  /**
   * Open on `roomId`, landing on `tabId` when it is one of the visible tabs
   * (else the first). On mobile the tab list is shown first regardless,
   * matching SettingsDialog — a phone screen has no room for a rail beside
   * content.
   */
  protected open(roomId: string | null, tabId?: string): void {
    this._mobile = isMobile();
    this._roomId = roomId;
    // Filtered here rather than through registry.ts: this base must not import
    // the tabs, which reach the app layer and import the dialogs back.
    this._tabs = this._opts.tabs.filter((t) => !(t.mobileHidden && this._mobile));
    this._activeId = tabId && this._tabs.some((t) => t.id === tabId) ? tabId : this._tabs[0].id;

    this._buildRail();
    this._showList();
    this.reveal();

    if (!this._roomId) {
      this._renderNoRoom();
      return;
    }
    if (!this._mobile) this._switchTab(this._activeId);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** (Re)build the tab rail + content area for the current viewport. */
  private _buildRail(): void {
    this._bodyEl.innerHTML = "";
    this._tabEls.clear();

    const tabs = document.createElement("div");
    tabs.className = "settings-dialog__tabs";
    tabs.setAttribute("role", "tablist");
    for (const tab of this._tabs) {
      this._tabEls.set(tab.id, this._makeTab(tab.label, tab.id, tabs));
    }
    this._bodyEl.appendChild(tabs);

    this._contentEl = document.createElement("div");
    this._contentEl.className = "settings-dialog__content";
    this._bodyEl.appendChild(this._contentEl);
  }

  private _makeTab(label: string, id: string, parent: HTMLElement): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__tab";
    btn.textContent = label;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => this._switchTab(id));
    parent.appendChild(btn);
    return btn;
  }

  /**
   * Nothing is open, so there is no room to describe. Said once, in the content
   * pane, rather than by each tab builder repeating the check.
   */
  private _renderNoRoom(): void {
    this._contentEl.innerHTML = "";
    const msg = document.createElement("div");
    msg.className = "settings-dialog__row";
    msg.textContent = this._opts.noRoomText;
    this._contentEl.appendChild(msg);
    if (this._mobile) this._enterDetail(this._opts.title);
  }

  private _switchTab(id: string): void {
    this._activeId = id;

    for (const [key, el] of this._tabEls) {
      const active = key === id;
      el.classList.toggle("settings-dialog__tab--active", active);
      el.setAttribute("aria-selected", String(active));
    }

    // A fresh pane per build, not an emptied shared one — tabs await IPC, and
    // see replaceContentPane for what that costs.
    this._contentEl = this.replaceContentPane(this._contentEl);

    const tab = this._tabs.find((t) => t.id === id);
    if (!tab) return;
    if (!this._roomId) {
      this._renderNoRoom();
      return;
    }

    const roomId = this._roomId;
    void tab.build({
      content: this._contentEl,
      controls: this._controls,
      roomId,
      room: AppState.get("roomListCache").find((r) => r.room_id === roomId),
      isMobile: this._mobile,
      close: () => this.hide(),
      dispatch: (a) =>
        document.dispatchEvent(new CustomEvent("quark:action", { detail: { action: a } })),
      refresh: () => this._switchTab(id),
      subject: this._opts.subject,
    });

    if (this._mobile) this._enterDetail(tab.label);
  }

  /** Mobile: show the tab list (the first of the two screens). Inert on desktop. */
  private _showList(): void {
    this._panelEl.classList.remove(DETAIL_CLASS);
    if (this.titleEl) this.titleEl.textContent = this._opts.title;
  }

  /** Mobile: show a single tab's content, with the back button and tab name. */
  private _enterDetail(label: string): void {
    this._panelEl.classList.add(DETAIL_CLASS);
    if (this.titleEl) this.titleEl.textContent = label;
  }

  // ── Keyboard handler ────────────────────────────────────────────────────────

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    // Mobile: Escape backs out of a tab to the list before closing the dialog.
    if (this._mobile && this.isEscape(e) && this._panelEl.classList.contains(DETAIL_CLASS)) {
      e.preventDefault();
      this._showList();
      return;
    }

    // Tab moves to the next section, Shift+Tab back to the previous one. Space
    // settings once left Shift+Tab to the browser; on this shared host it had
    // become a second "next" (as it still was in Settings).
    if (e.key === "Tab") {
      e.preventDefault();
      const n = this._tabs.length;
      const idx = this._tabs.findIndex((t) => t.id === this._activeId);
      this._switchTab(this._tabs[(idx + (e.shiftKey ? n - 1 : 1)) % n].id);
      return;
    }

    if (e.ctrlKey && e.key === "[") {
      e.preventDefault();
      this.hide();
      return;
    }

    this.routeKey(e);
  }
}
