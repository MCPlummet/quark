// Room dialog — a thin host over the room tab registry.
//
// Replaces RoomInfoDialog and RoomSettingsDialog, which captured overlapping
// room state with the split drawn in the wrong place (#92): both stated name,
// topic, members, encryption and directness, while only one of them could
// change any of it, and mute and leave existed on the info dialog alone — so
// with the desktop room header hidden on mobile, neither was reachable by
// touch.
//
// Structurally identical to SettingsDialog, deliberately: same chrome, same
// controls, same stylesheet, same mobile list/detail split. The only additions
// are that `show()` takes the tab to land on — `:info` and `:roomsettings` are
// now two doors into one room — and that the room is resolved once, up front,
// and handed to every tab. The old RoomSettingsDialog re-read
// AppState.currentRoomId inside each builder and could act on a room other
// than the one whose header it was showing.

import { isMobile } from "../app/mobile.js";
import { AppState } from "../app/state.js";
import { DialogBase } from "./DialogBase.js";
import { makeControls } from "./settings/controls.js";
import type { SettingsControls } from "./settings/controls.js";
import type { RoomTab } from "./room/types.js";
import { ROOM_TABS, visibleRoomTabs } from "./room/registry.js";

const TITLE = "── room ──";
const DETAIL_CLASS = "settings-dialog__panel--detail";

export class RoomDialog extends DialogBase {
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

  constructor() {
    // Shares the settings-dialog styling; see the note above.
    super({ prefix: "settings-dialog", ariaLabel: "Room" });
    this._panelEl = this.content;

    this.buildHeader(TITLE, "Close room dialog");
    this._backBtn = document.createElement("button");
    this._backBtn.type = "button";
    this._backBtn.className = "settings-dialog__back";
    this._backBtn.textContent = "[‹ back]";
    this._backBtn.setAttribute("aria-label", "Back to room sections");
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
   * Open the dialog for the current room.
   *
   * `tabId` is which door was used: `:info` lands on Info, `:roomsettings` on
   * Settings. On mobile the tab list is shown first regardless, matching
   * SettingsDialog — a phone screen has no room for a rail beside content.
   */
  show(tabId?: string): void {
    this._mobile = isMobile();
    this._roomId = AppState.get("currentRoomId");
    this._tabs = visibleRoomTabs(ROOM_TABS, this._mobile);
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
   * pane, rather than by each tab builder repeating the check — which is what
   * the old dialog did, in three places, with three copies of the string.
   */
  private _renderNoRoom(): void {
    this._contentEl.innerHTML = "";
    const msg = document.createElement("div");
    msg.className = "settings-dialog__row";
    msg.textContent = "No room selected.";
    this._contentEl.appendChild(msg);
    if (this._mobile) this._enterDetail(TITLE);
  }

  private _switchTab(id: string): void {
    this._activeId = id;

    for (const [key, el] of this._tabEls) {
      const active = key === id;
      el.classList.toggle("settings-dialog__tab--active", active);
      el.setAttribute("aria-selected", String(active));
    }

    // A fresh pane per build, not an emptied shared one — Info, Members and
    // Permissions all await IPC, and see replaceContentPane for what that costs.
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
    });

    if (this._mobile) this._enterDetail(tab.label);
  }

  /** Mobile: show the tab list (the first of the two screens). Inert on desktop. */
  private _showList(): void {
    this._panelEl.classList.remove(DETAIL_CLASS);
    if (this.titleEl) this.titleEl.textContent = TITLE;
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

    if (e.key === "Tab") {
      e.preventDefault();
      const idx = this._tabs.findIndex((t) => t.id === this._activeId);
      this._switchTab(this._tabs[(idx + 1) % this._tabs.length].id);
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
