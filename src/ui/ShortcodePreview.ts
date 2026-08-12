// Inline emoji autocomplete popup — appears when user types :shortcode in insert mode

import { guardViewportPan } from "../app/mobile.js";

export interface ShortcodeEntry {
  /** Unicode glyph or :shortcode: identifier */
  key: string;
  /** Shortcode without colons, e.g. "partyblob" */
  shortcode: string;
  /** mxc:// or HTTP URL for custom emoji image (undefined for Unicode emoji) */
  imageUrl?: string;
}

type ShortcodeSelectCallback = (entry: ShortcodeEntry) => void;

/**
 * Popup list that appears above the input bar as the user types a :shortcode:.
 * Position is managed by the caller via `setAnchor()`.
 */
export class ShortcodePreview {
  private _el: HTMLElement;
  private _listEl: HTMLElement;
  private _emptyEl: HTMLElement;

  private _entries: ShortcodeEntry[] = [];
  private _activeIndex = 0;
  private _visible = false;

  private _onSelect: ShortcodeSelectCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "shortcode-preview";
    this._el.setAttribute("role", "listbox");
    this._el.setAttribute("aria-label", "Emoji autocomplete");
    this._el.style.display = "none";

    this._listEl = document.createElement("ul");
    this._listEl.className = "shortcode-preview__list";
    this._listEl.setAttribute("role", "presentation");
    this._el.appendChild(this._listEl);

    this._emptyEl = document.createElement("div");
    this._emptyEl.className = "shortcode-preview__empty";
    this._emptyEl.textContent = "No matches";
    this._emptyEl.style.display = "none";
    this._el.appendChild(this._emptyEl);

    // The popover sits in .content-area, outside the compose wrap, so the
    // composer's guard never sees its drags (#33). It is its own scroll
    // container: let a drag through only while there is list to scroll —
    // a two-item list has nothing to give the gesture, and would hand it to
    // the viewport pan instead.
    guardViewportPan(this._el, () => this._el.scrollHeight > this._el.clientHeight);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  onSelect(cb: ShortcodeSelectCallback): void {
    this._onSelect = cb;
  }

  /**
   * Position the popup relative to a given {left, bottom} coordinate
   * (typically the cursor position inside the input bar).
   */
  setAnchor(left: number, bottomFromViewport: number): void {
    this._el.style.left = `${left}px`;
    this._el.style.bottom = `${window.innerHeight - bottomFromViewport}px`;
  }

  show(entries: ShortcodeEntry[]): void {
    this._entries = entries;
    this._activeIndex = 0;
    this._render();

    const hasEntries = entries.length > 0;
    this._el.style.display = hasEntries ? "" : "none";
    this._emptyEl.style.display = hasEntries ? "none" : "";
    this._visible = hasEntries;
  }

  hide(): void {
    this._el.style.display = "none";
    this._visible = false;
  }

  isVisible(): boolean {
    return this._visible;
  }

  /**
   * Handle keyboard events forwarded from the input bar.
   * Returns true if the event was consumed.
   */
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
        if (entry) {
          this._onSelect?.(entry);
          this.hide();
        }
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

  // ── Private ────────────────────────────────────────────────────────────

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

      // Glyph or image
      if (entry.imageUrl) {
        const img = document.createElement("img");
        img.src = entry.imageUrl;
        img.alt = entry.shortcode;
        img.className = "shortcode-preview__emoji-img";
        img.width = 20;
        img.height = 20;
        item.appendChild(img);
      } else {
        const glyph = document.createElement("span");
        glyph.className = "shortcode-preview__emoji-glyph";
        glyph.textContent = entry.key;
        glyph.setAttribute("aria-hidden", "true");
        item.appendChild(glyph);
      }

      // Shortcode label
      const label = document.createElement("span");
      label.className = "shortcode-preview__label";
      label.textContent = `:${entry.shortcode}:`;
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
 * Simple fuzzy-match helper: returns true if every character of `query`
 * appears in `target` in order (case-insensitive).
 */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Filter and rank a list of ShortcodeEntry objects against a query string.
 * Prefix matches rank above fuzzy matches.
 */
export function filterShortcodes(
  entries: ShortcodeEntry[],
  query: string,
  maxResults = 8
): ShortcodeEntry[] {
  if (!query) return entries.slice(0, maxResults);

  const q = query.toLowerCase();
  const prefixMatches: ShortcodeEntry[] = [];
  const fuzzyMatches: ShortcodeEntry[] = [];

  for (const entry of entries) {
    const sc = entry.shortcode.toLowerCase();
    if (sc.startsWith(q)) {
      prefixMatches.push(entry);
    } else if (fuzzyMatch(q, sc)) {
      fuzzyMatches.push(entry);
    }
  }

  return [...prefixMatches, ...fuzzyMatches].slice(0, maxResults);
}
