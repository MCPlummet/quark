// Inline @mention autocomplete popup — appears when user types @name in insert mode

import { isAnimatedUrl } from "../app/animated_urls.js";
import { guardViewportPan } from "../app/mobile.js";

export interface MentionEntry {
  userId: string;
  displayName: string;
  avatarUrl?: string;
}

type MentionSelectCallback = (entry: MentionEntry) => void;

/**
 * Popup list that appears above the input bar as the user types @name.
 * Reuses the same visual style as the shortcode preview.
 */
export class MentionPreview {
  private _el: HTMLElement;
  private _listEl: HTMLElement;
  private _entries: MentionEntry[] = [];
  private _activeIndex = 0;
  private _visible = false;
  private _onSelect: MentionSelectCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "shortcode-preview mention-preview";
    this._el.setAttribute("role", "listbox");
    this._el.setAttribute("aria-label", "Mention autocomplete");
    this._el.style.display = "none";

    this._listEl = document.createElement("ul");
    this._listEl.className = "shortcode-preview__list";
    this._listEl.setAttribute("role", "presentation");
    this._el.appendChild(this._listEl);

    // Same reasoning as ShortcodePreview: outside the compose wrap, its own
    // scroll container, so drags only pass through when there is list to scroll.
    guardViewportPan(this._el, () => this._el.scrollHeight > this._el.clientHeight);
  }

  getElement(): HTMLElement { return this._el; }

  onSelect(cb: MentionSelectCallback): void { this._onSelect = cb; }

  setAnchor(left: number, bottomFromViewport: number): void {
    this._el.style.left = `${left}px`;
    this._el.style.bottom = `${window.innerHeight - bottomFromViewport}px`;
  }

  show(entries: MentionEntry[]): void {
    this._entries = entries;
    this._activeIndex = 0;
    this._render();
    this._el.style.display = entries.length > 0 ? "" : "none";
    this._visible = entries.length > 0;
  }

  hide(): void {
    this._el.style.display = "none";
    this._visible = false;
  }

  isVisible(): boolean { return this._visible; }

  handleKeydown(e: KeyboardEvent): boolean {
    if (!this._visible) return false;
    // Ctrl+[ is the vim equivalent of Escape — dismiss the autocomplete.
    if (e.ctrlKey && e.key === "[") {
      e.preventDefault();
      this.hide();
      return true;
    }
    switch (e.key) {
      case "ArrowDown":
      case "Tab":
        e.preventDefault();
        this._moveActive(1);
        return true;
      case "ArrowUp":
        e.preventDefault();
        this._moveActive(-1);
        return true;
      case "Enter": {
        e.preventDefault();
        const entry = this._entries[this._activeIndex];
        if (entry) { this._onSelect?.(entry); this.hide(); }
        return true;
      }
      case "Escape":
        e.preventDefault();
        this.hide();
        return true;
      default:
        return false;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _render(): void {
    this._listEl.innerHTML = "";
    for (let i = 0; i < this._entries.length; i++) {
      const entry = this._entries[i];
      const item = document.createElement("li");
      item.className =
        "shortcode-preview__item" +
        (i === this._activeIndex ? " shortcode-preview__item--active" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === this._activeIndex));
      item.dataset.index = String(i);

      // Avatar
      if (entry.avatarUrl) {
        const img = document.createElement("img");
        img.src = entry.avatarUrl;
        img.alt = "";
        img.className = "shortcode-preview__emoji-img";
        img.width = 20;
        img.height = 20;
        if (isAnimatedUrl(entry.avatarUrl)) img.dataset.gif = "1";
        item.appendChild(img);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "shortcode-preview__emoji-glyph";
        fallback.textContent = (entry.displayName[0] ?? "?").toUpperCase();
        fallback.setAttribute("aria-hidden", "true");
        item.appendChild(fallback);
      }

      // Display name + user ID
      const label = document.createElement("span");
      label.className = "shortcode-preview__label";
      const nameEl = document.createElement("strong");
      nameEl.textContent = entry.displayName;
      label.appendChild(nameEl);
      const idEl = document.createElement("span");
      idEl.className = "mention-preview__user-id";
      idEl.textContent = ` ${entry.userId}`;
      label.appendChild(idEl);
      item.appendChild(label);

      item.addEventListener("click", () => {
        this._onSelect?.(entry);
        this.hide();
      });
      this._listEl.appendChild(item);
    }
  }

  private _moveActive(delta: number): void {
    const count = this._entries.length;
    if (count === 0) return;
    this._activeIndex = (this._activeIndex + delta + count) % count;
    this._updateActive();
  }

  private _updateActive(): void {
    const items = this._listEl.querySelectorAll<HTMLElement>(".shortcode-preview__item");
    for (let i = 0; i < items.length; i++) {
      const isActive = i === this._activeIndex;
      items[i].classList.toggle("shortcode-preview__item--active", isActive);
      items[i].setAttribute("aria-selected", String(isActive));
    }
    items[this._activeIndex]?.scrollIntoView({ block: "nearest" });
  }
}

/**
 * Filter room members by display name or user ID prefix/fuzzy match.
 */
export function filterMembers(
  entries: MentionEntry[],
  query: string,
  maxResults = 8,
): MentionEntry[] {
  if (!query) return entries.slice(0, maxResults);
  const q = query.toLowerCase();
  const prefix: MentionEntry[] = [];
  const fuzzy: MentionEntry[] = [];
  for (const e of entries) {
    const name = e.displayName.toLowerCase();
    const id = e.userId.toLowerCase().replace(/^@/, "");
    if (name.startsWith(q) || id.startsWith(q)) {
      prefix.push(e);
    } else if (_fuzzy(q, name) || _fuzzy(q, id)) {
      fuzzy.push(e);
    }
  }
  return [...prefix, ...fuzzy].slice(0, maxResults);
}

function _fuzzy(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}
