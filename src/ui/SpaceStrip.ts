// Space selector strip — narrow vertical column of space icons

import { isAnimatedUrl } from "../app/animated_urls.js";
import { PSEUDO_SPACES, isPseudoSpace } from "../app/pseudo_spaces.js";
import { attachLongPress } from "../app/long_press.js";
import { plusIcon } from "./icons.js";
import { formatMentionCount, type SpaceBadge } from "../app/space_badges.js";

export interface SpaceItem {
  id: string;
  /** Display label (first letter of name used as fallback icon) */
  name: string;
  /** Optional avatar URL */
  avatarUrl?: string;
}

export class SpaceStrip {
  private _el: HTMLElement;
  private _items: SpaceItem[] = [];
  /**
   * Resolved space avatars, keyed by space ID.
   *
   * `_render()` rebuilds the strip from scratch (`innerHTML = ""`), and it has
   * more than one trigger (every room refresh calls `setSpaces()`, and the own
   * profile used to live here too and re-render on its avatar landing). Those
   * raced at startup, so without somewhere durable to keep them, an
   * already-resolved space icon was destroyed by whichever render came last —
   * and nothing re-fetched it, because the download loop lives in
   * `refreshRooms()`, which only fetches avatars it hasn't resolved yet.
   *
   * Keeping the resolved data URLs here makes `_render()` idempotent: every
   * render path restores what has already been downloaded.
   */
  private _resolvedAvatars = new Map<string, string>();
  /** Unread/mention state per space ID (#148); absent = nothing to show. */
  private _badges = new Map<string, SpaceBadge>();
  private _activeId: string | null = null;
  private _onSelect: ((id: string) => void) | null = null;
  private _onContextMenu: ((spaceId: string, x: number, y: number) => void) | null = null;
  private _onCreateSpace: (() => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "space-strip";
    this._el.setAttribute("role", "listbox");
    this._el.setAttribute("aria-label", "Spaces");

    // Touch path to the space context menu (#99). Container-level, since items
    // are rebuilt on every render. Pseudo-spaces (Home, DMs) have no menu, and
    // carry no data-space-id-backed entry here for the same reason the
    // right-click handler skips them.
    attachLongPress(this._el, {
      resolve: (target) => {
        const item = target.closest<HTMLElement>(".space-strip__item");
        const id = item?.dataset.spaceId;
        return id && !isPseudoSpace(id) ? id : null;
      },
      onLongPress: (spaceId, x, y) => this._onContextMenu?.(spaceId, x, y),
    });

  }

  getElement(): HTMLElement {
    return this._el;
  }

  onSelect(handler: (id: string) => void): void {
    this._onSelect = handler;
  }

  /** Wire the `+` at the end of the space list (create a space). */
  onCreateSpaceClick(handler: () => void): void {
    this._onCreateSpace = handler;
  }

  onContextMenu(handler: (spaceId: string, x: number, y: number) => void): void {
    this._onContextMenu = handler;
  }

  setSpaces(items: SpaceItem[]): void {
    this._items = items;
    // Drop avatars for spaces that are gone, so the map can't grow without
    // bound across a long-running session.
    const live = new Set(items.map((i) => i.id));
    for (const id of this._resolvedAvatars.keys()) {
      if (!live.has(id)) this._resolvedAvatars.delete(id);
    }
    this._render();
  }

  /**
   * Replace every space's badge. Spaces missing from `badges` show none.
   * Kept on the strip, like resolved avatars, so a re-render restores them.
   */
  setBadges(badges: Map<string, SpaceBadge>): void {
    this._badges = new Map(badges);
    for (const el of this._el.querySelectorAll<HTMLElement>(".space-strip__item")) {
      this._applyBadge(el);
    }
  }

  /** Space IDs whose avatar has already been downloaded and cached. */
  hasResolvedAvatar(spaceId: string): boolean {
    return this._resolvedAvatars.has(spaceId);
  }

  setActiveSpace(id: string): void {
    this._activeId = id;
    this._updateActive();
  }

  focusActive(): void {
    const active = this._el.querySelector<HTMLElement>(".space-strip__item--active");
    const first = this._el.querySelector<HTMLElement>(".space-strip__item");
    (active ?? first)?.focus();
  }

  navDown(): void {
    const items = Array.from(this._el.querySelectorAll<HTMLElement>(".space-strip__item"));
    const focused = document.activeElement as HTMLElement;
    const idx = items.indexOf(focused);
    const next = items[idx + 1] ?? items[0];
    next?.focus();
  }

  navUp(): void {
    const items = Array.from(this._el.querySelectorAll<HTMLElement>(".space-strip__item"));
    const focused = document.activeElement as HTMLElement;
    const idx = items.indexOf(focused);
    const prev = idx <= 0 ? items[items.length - 1] : items[idx - 1];
    prev?.focus();
  }

  selectFocused(): void {
    const focused = document.activeElement as HTMLElement;
    const id = focused?.dataset.spaceId;
    if (id) this._selectId(id);
  }

  navFirst(): void {
    this._el.querySelector<HTMLElement>(".space-strip__item")?.focus();
  }

  navLast(): void {
    const items = this._el.querySelectorAll<HTMLElement>(".space-strip__item");
    items[items.length - 1]?.focus();
  }

  /** Swap in a resolved avatar data URL for a space item. */
  updateSpaceAvatar(spaceId: string, dataUrl: string): void {
    // Remembered first, and unconditionally: the element may not be in the DOM
    // at this instant (a render can land between the download starting and
    // finishing), and the next `_render()` has to be able to restore it.
    this._resolvedAvatars.set(spaceId, dataUrl);

    const item = this._el.querySelector<HTMLElement>(`[data-space-id="${CSS.escape(spaceId)}"]`);
    if (!item) return;
    const existing = item.querySelector("img");
    if (existing) {
      existing.src = dataUrl;
      if (isAnimatedUrl(dataUrl)) existing.dataset.gif = "1";
    } else {
      // The letter is kept on the item rather than read back from its text,
      // which would include the badge's count.
      const label = item.dataset.glyph ?? "";
      item.textContent = "";
      item.appendChild(this._createIcon(dataUrl, label));
      this._applyBadge(item);
    }
  }

  /**
   * Build the `<img>` for a resolved space avatar.
   *
   * `onerror` restores the letter fallback: the image replaces the initial, so
   * a data URL the renderer refuses to decode would otherwise leave an empty
   * box with nothing in it at all.
   */
  private _createIcon(dataUrl: string, fallbackLabel: string): HTMLImageElement {
    const img = document.createElement("img");
    img.className = "space-strip__icon";
    img.src = dataUrl;
    img.alt = "";
    if (isAnimatedUrl(dataUrl)) img.dataset.gif = "1";
    img.addEventListener("error", () => {
      const parent = img.parentElement;
      if (!parent) return;
      img.remove();
      parent.textContent = fallbackLabel;
      this._applyBadge(parent);
    });
    return img;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _render(): void {
    this._el.innerHTML = "";

    const topPseudos = PSEUDO_SPACES.filter((p) => p.position === "top");
    const bottomPseudos = PSEUDO_SPACES.filter((p) => p.position === "bottom");

    for (const ps of topPseudos) {
      this._el.appendChild(this._createItem({ id: ps.id, name: ps.label }, ps.icon));
    }

    // The spaces, and the `+` that makes a new one, as one group between rules.
    this._el.appendChild(this._createDivider());
    for (const item of this._items) {
      this._el.appendChild(this._createItem(item));
    }
    this._el.appendChild(this._createAddButton());
    this._el.appendChild(this._createDivider());

    for (const ps of bottomPseudos) {
      this._el.appendChild(this._createItem({ id: ps.id, name: ps.label }, ps.icon));
    }

    // Profile, settings and search used to be stacked here, at the foot of the
    // strip; they are in the status line now (StatusBar.ts).

    this._updateActive();
  }

  private _createItem(item: SpaceItem, overrideLabel?: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "space-strip__item";
    el.setAttribute("role", "option");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", item.name);
    el.dataset.spaceId = item.id;
    el.dataset.label = item.name;

    const label = overrideLabel ?? item.name.charAt(0).toUpperCase();
    el.dataset.glyph = label;
    // An avatar resolved by an earlier download survives this rebuild; without
    // it, any render triggered after the download would drop the icon for good.
    const resolved = this._resolvedAvatars.get(item.id) ?? item.avatarUrl;
    if (resolved) {
      el.appendChild(this._createIcon(resolved, label));
    } else {
      el.textContent = label;
    }
    this._applyBadge(el);

    el.addEventListener("click", () => this._selectId(item.id));
    if (!isPseudoSpace(item.id)) {
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this._onContextMenu?.(item.id, e.clientX, e.clientY);
      });
    }
    el.addEventListener("focus", () => {
      // Dispatch a focusspace event so keyboard.ts can update activePanel
      this._el.dispatchEvent(new CustomEvent("quark:space-focused", { bubbles: true }));
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._selectId(item.id);
      }
    });

    return el;
  }

  /**
   * Draw (or clear) an item's badge and fold its state into the accessible
   * name. A mention count replaces the unread dot, as on a room-list row.
   */
  private _applyBadge(el: HTMLElement): void {
    el.querySelector(".space-strip__badge")?.remove();
    const name = el.dataset.label ?? "";
    const badge = el.dataset.spaceId ? this._badges.get(el.dataset.spaceId) : undefined;
    if (!badge || (!badge.unread && badge.mentions <= 0)) {
      el.setAttribute("aria-label", name);
      return;
    }
    const dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    if (badge.mentions > 0) {
      dot.className = "space-strip__badge space-strip__badge--mention";
      dot.textContent = formatMentionCount(badge.mentions);
      const noun = badge.mentions === 1 ? "mention" : "mentions";
      el.setAttribute("aria-label", `${name}, ${badge.mentions} ${noun}`);
    } else {
      dot.className = "space-strip__badge space-strip__badge--unread";
      dot.textContent = "●";
      el.setAttribute("aria-label", `${name}, unread`);
    }
    el.appendChild(dot);
  }

  private _createAddButton(): HTMLElement {
    const btn = document.createElement("div");
    btn.className = "space-strip__add";
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "0");
    btn.setAttribute("aria-label", "Create a space");
    btn.title = "Create a space (:createspace)";
    btn.appendChild(plusIcon());
    btn.addEventListener("click", () => this._onCreateSpace?.());
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._onCreateSpace?.();
      }
    });
    return btn;
  }

  private _createDivider(): HTMLElement {
    const divider = document.createElement("div");
    divider.className = "space-strip__divider";
    divider.setAttribute("role", "separator");
    return divider;
  }

  private _selectId(id: string): void {
    this._activeId = id;
    this._updateActive();
    this._onSelect?.(id);
  }

  private _updateActive(): void {
    for (const el of this._el.querySelectorAll<HTMLElement>(".space-strip__item")) {
      const isActive = el.dataset.spaceId === this._activeId;
      el.classList.toggle("space-strip__item--active", isActive);
      el.setAttribute("aria-selected", String(isActive));
    }
  }

  // Navigation (j/k/arrows) is handled by the global keymap via AppState.navDown/navUp.
  // Enter/Space activation is handled by individual item listeners in _createItem.
}
