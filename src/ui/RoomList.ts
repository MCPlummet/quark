// Room list panel

import { attachResizeHandle } from "./ResizeHandle.js";
import { attachLongPress } from "../app/long_press.js";

export interface RoomEntry {
  id: string;
  name: string;
  unreadCount?: number;
  mentionCount?: number;
  muted?: boolean;
  /** For DM rooms: the partner's user ID (used to show presence indicator). */
  dmUserId?: string;
  /** Presence of the DM partner: "online" | "unavailable" | "offline". */
  presence?: "online" | "unavailable" | "offline";
}

export interface RoomSection {
  /** Section label (empty string = no label) */
  label: string;
  rooms: RoomEntry[];
  /** Space room ID for subspace section labels (enables right-click → space settings) */
  spaceId?: string;
}

export class RoomList {
  private _el: HTMLElement;
  private _headerEl: HTMLElement;
  private _scrollEl: HTMLElement;
  private _rooms: RoomEntry[] = [];
  private _sections: RoomSection[] | null = null;
  private _activeId: string | null = null;
  private _onSelect: ((id: string) => void) | null = null;
  private _onContextMenu: ((roomId: string, x: number, y: number) => void) | null = null;
  private _onSectionContextMenu: ((spaceId: string, x: number, y: number) => void) | null = null;
  private _directoryBtnEl: HTMLButtonElement;
  private _onDirectoryClick: (() => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "room-list";

    this._headerEl = document.createElement("div");
    this._headerEl.className = "room-list__header";

    const headerLabel = document.createElement("span");
    headerLabel.className = "room-list__header-label";
    headerLabel.textContent = "Rooms";
    this._headerEl.appendChild(headerLabel);

    // Joining a room was `:join` or `:directory` and nothing else — the
    // directory dialog had no affordance anywhere in the UI (#102).
    this._directoryBtnEl = document.createElement("button");
    this._directoryBtnEl.type = "button";
    this._directoryBtnEl.className = "room-list__header-btn";
    this._directoryBtnEl.textContent = "+";
    this._directoryBtnEl.title = "Browse the room directory (:directory)";
    this._directoryBtnEl.setAttribute("aria-label", "Browse the room directory");
    this._directoryBtnEl.addEventListener("click", () => this._onDirectoryClick?.());
    this._headerEl.appendChild(this._directoryBtnEl);

    this._el.appendChild(this._headerEl);

    this._scrollEl = document.createElement("div");
    this._scrollEl.className = "room-list__scroll";
    this._scrollEl.setAttribute("role", "listbox");
    this._scrollEl.setAttribute("aria-label", "Room list");
    this._el.appendChild(this._scrollEl);

    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));

    // Touch path to the same menus `contextmenu` gives a mouse. Attached to the
    // scroll container rather than to each row, which is rebuilt on every
    // render. Rooms and subspace section labels share the gesture and are told
    // apart by which one the press resolved to.
    attachLongPress(this._scrollEl, {
      resolve: (target) => {
        const label = target.closest<HTMLElement>(".room-list__section-label");
        if (label?.dataset.sectionSpaceId) return `section:${label.dataset.sectionSpaceId}`;
        const item = target.closest<HTMLElement>(".room-list__item");
        return item?.dataset.roomId ? `room:${item.dataset.roomId}` : null;
      },
      onLongPress: (id, x, y) => {
        const [kind, ...rest] = id.split(":");
        const value = rest.join(":");
        if (kind === "section") this._onSectionContextMenu?.(value, x, y);
        else this._onContextMenu?.(value, x, y);
      },
    });

    // Drag-to-resize handle at the right edge
    attachResizeHandle(this._el, "--room-list-width", "right", 120, 500);
  }

  /** Header element exposed so callers can wire mobile drawer-close behaviour. */
  getHeaderElement(): HTMLElement {
    return this._headerEl;
  }

  /** Wire the header's room-directory button. */
  onDirectoryClick(handler: () => void): void {
    this._onDirectoryClick = handler;
  }

  getElement(): HTMLElement {
    return this._el;
  }

  /** Scrollable list container — exposed so the mobile pull-down gesture can
   *  gate on scroll position (only pull-to-reveal when already at the top). */
  getScrollElement(): HTMLElement {
    return this._scrollEl;
  }

  onSelect(handler: (id: string) => void): void {
    this._onSelect = handler;
  }

  onContextMenu(handler: (roomId: string, x: number, y: number) => void): void {
    this._onContextMenu = handler;
  }

  onSectionContextMenu(handler: (spaceId: string, x: number, y: number) => void): void {
    this._onSectionContextMenu = handler;
  }

  setRooms(rooms: RoomEntry[]): void {
    this._rooms = rooms;
    this._sections = null;
    this._render();
  }

  /**
   * Render the room list as labeled sections (e.g. subspace categories).
   * Each section has a collapsible label and a list of rooms.
   */
  setSections(sections: RoomSection[]): void {
    this._sections = sections;
    this._rooms = sections.flatMap((s) => s.rooms);
    this._render();
  }

  setActiveRoom(id: string): void {
    this._activeId = id;
    this._updateActive();
  }

  /**
   * Update a single room's unread/mention badge without re-rendering the whole list.
   * Used to clear badges after marking a room as read without losing the current
   * space filter (which would happen if setRooms were called with the full cache).
   */
  updateRoomBadge(id: string, unreadCount: number, mentionCount: number): void {
    const idx = this._rooms.findIndex((r) => r.id === id);
    if (idx < 0) return;
    this._rooms[idx] = { ...this._rooms[idx], unreadCount, mentionCount };

    const el = this._scrollEl.querySelector<HTMLElement>(`[data-room-id="${CSS.escape(id)}"]`);
    if (!el) return;

    el.classList.toggle("room-list__item--unread", unreadCount > 0 && !this._rooms[idx].muted);
    el.querySelector(".room-list__item-badge")?.remove();

    if (mentionCount > 0) {
      const badge = document.createElement("span");
      badge.className = "room-list__item-badge";
      badge.textContent = String(mentionCount);
      badge.setAttribute("aria-label", `${mentionCount} mentions`);
      el.appendChild(badge);
    } else if (unreadCount > 0 && !this._rooms[idx].muted) {
      const badge = document.createElement("span");
      badge.className = "room-list__item-badge";
      badge.style.color = "var(--roomlist-unread)";
      badge.textContent = "●";
      badge.setAttribute("aria-label", `${unreadCount} unread`);
      el.appendChild(badge);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _render(): void {
    this._scrollEl.innerHTML = "";

    if (this._sections) {
      for (const section of this._sections) {
        if (section.label) {
          const label = document.createElement("div");
          label.className = "room-list__section-label";
          label.textContent = section.label;
          label.setAttribute("aria-hidden", "true");
          if (section.spaceId) {
            const spaceId = section.spaceId;
            label.style.cursor = "context-menu";
            // Recorded on the element so the container-level long press can
            // resolve it; labels are rebuilt on every render, so a per-label
            // gesture listener would accumulate.
            label.dataset.sectionSpaceId = spaceId;
            label.addEventListener("contextmenu", (e) => {
              e.preventDefault();
              this._onSectionContextMenu?.(spaceId, e.clientX, e.clientY);
            });
          }
          this._scrollEl.appendChild(label);
        }
        for (const room of section.rooms) {
          this._scrollEl.appendChild(this._createItem(room));
        }
      }
    } else {
      for (const room of this._rooms) {
        this._scrollEl.appendChild(this._createItem(room));
      }
    }

    this._updateActive();
  }

  /**
   * Repaint one room's muted styling in place.
   *
   * Mirrors updateRoomBadge, for the same reason: setRooms would rebuild from
   * the full cache and lose the current space filter. Muting also changes how
   * unread is drawn — a muted room shows neither the unread class nor the dot —
   * so the badge is re-decided here too rather than left describing the state
   * the room was in before it was silenced.
   */
  updateRoomMuted(id: string, muted: boolean): void {
    const idx = this._rooms.findIndex((r) => r.id === id);
    if (idx < 0) return;
    this._rooms[idx] = { ...this._rooms[idx], muted };

    const el = this._scrollEl.querySelector<HTMLElement>(`[data-room-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.classList.toggle("room-list__item--muted", muted);

    const entry = this._rooms[idx];
    this.updateRoomBadge(id, entry.unreadCount ?? 0, entry.mentionCount ?? 0);
  }

  private _createItem(room: RoomEntry): HTMLElement {
    const el = document.createElement("div");
    el.className = "room-list__item";
    el.setAttribute("role", "option");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", room.name);
    el.dataset.roomId = room.id;

    if (room.muted) {
      el.classList.add("room-list__item--muted");
    } else if (room.unreadCount && room.unreadCount > 0) {
      el.classList.add("room-list__item--unread");
    }

    if (room.dmUserId) {
      el.dataset.dmUserId = room.dmUserId;
    }

    if (room.dmUserId && room.presence) {
      const dot = document.createElement("span");
      dot.className = `room-list__presence room-list__presence--${room.presence}`;
      dot.setAttribute("aria-label", room.presence);
      el.appendChild(dot);
    }

    const nameEl = document.createElement("span");
    nameEl.className = "room-list__item-name";
    nameEl.textContent = room.name;
    el.appendChild(nameEl);

    if (room.mentionCount && room.mentionCount > 0) {
      const badge = document.createElement("span");
      badge.className = "room-list__item-badge";
      badge.textContent = String(room.mentionCount);
      badge.setAttribute("aria-label", `${room.mentionCount} mentions`);
      el.appendChild(badge);
    } else if (room.unreadCount && room.unreadCount > 0 && !room.muted) {
      const badge = document.createElement("span");
      badge.className = "room-list__item-badge";
      badge.style.color = "var(--roomlist-unread)";
      badge.textContent = "●";
      badge.setAttribute("aria-label", `${room.unreadCount} unread`);
      el.appendChild(badge);
    }

    el.addEventListener("click", () => this._selectId(room.id));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._selectId(room.id);
      }
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this._onContextMenu?.(room.id, e.clientX, e.clientY);
    });

    return el;
  }

  /**
   * Room ID of the item that currently holds DOM focus, or null when focus is
   * outside the list. Lets callers restore keyboard position across re-renders.
   */
  getFocusedRoomId(): string | null {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !this._scrollEl.contains(focused)) return null;
    return focused.closest<HTMLElement>(".room-list__item")?.dataset.roomId ?? null;
  }

  /** Focus the list item for `id`, if present (without scrolling it into view). */
  focusRoom(id: string): void {
    this._scrollEl
      .querySelector<HTMLElement>(`[data-room-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true });
  }

  /**
   * Update the presence indicator dot for all DM room entries whose partner
   * matches `userId`. Called live from presence sync events.
   */
  updatePresenceForUser(userId: string, presence: "online" | "unavailable" | "offline"): void {
    const items = this._scrollEl.querySelectorAll<HTMLElement>(
      `[data-dm-user-id="${CSS.escape(userId)}"]`
    );
    for (const item of items) {
      let dot = item.querySelector<HTMLElement>(".room-list__presence");
      if (!dot) {
        dot = document.createElement("span");
        item.prepend(dot);
      }
      dot.className = `room-list__presence room-list__presence--${presence}`;
      dot.setAttribute("aria-label", presence);
    }
  }

  private _selectId(id: string): void {
    this._activeId = id;
    this._updateActive();
    this._onSelect?.(id);
  }

  private _updateActive(): void {
    for (const el of this._scrollEl.querySelectorAll<HTMLElement>(".room-list__item")) {
      const isActive = el.dataset.roomId === this._activeId;
      el.classList.toggle("room-list__item--active", isActive);
      el.setAttribute("aria-selected", String(isActive));
    }
  }

  navDown(): void {
    const items = Array.from(
      this._scrollEl.querySelectorAll<HTMLElement>(".room-list__item")
    );
    const focused = document.activeElement as HTMLElement;
    const currentIndex = items.indexOf(focused);
    const next = items[currentIndex + 1] ?? items[0];
    next?.focus();
  }

  navUp(): void {
    const items = Array.from(
      this._scrollEl.querySelectorAll<HTMLElement>(".room-list__item")
    );
    const focused = document.activeElement as HTMLElement;
    const currentIndex = items.indexOf(focused);
    const prev = currentIndex <= 0 ? items[items.length - 1] : items[currentIndex - 1];
    prev?.focus();
  }

  selectFocused(): void {
    const focused = document.activeElement as HTMLElement;
    const id = focused?.dataset.roomId;
    if (id) this._selectId(id);
  }

  navFirst(): void {
    this._scrollEl.querySelector<HTMLElement>(".room-list__item")?.focus();
  }

  navLast(): void {
    const items = this._scrollEl.querySelectorAll<HTMLElement>(".room-list__item");
    items[items.length - 1]?.focus();
  }

  focusActive(): void {
    const active = this._scrollEl.querySelector<HTMLElement>(".room-list__item--active");
    const first = this._scrollEl.querySelector<HTMLElement>(".room-list__item");
    (active ?? first)?.focus();
  }

  private _handleKeydown(e: KeyboardEvent): void {
    const items = Array.from(
      this._scrollEl.querySelectorAll<HTMLElement>(".room-list__item")
    );
    const focused = document.activeElement as HTMLElement;
    const currentIndex = items.indexOf(focused);

    if (e.key === "Enter" && currentIndex >= 0) {
      e.preventDefault();
      const room = this._rooms[currentIndex];
      if (room) this._selectId(room.id);
    }
  }
}
