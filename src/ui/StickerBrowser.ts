// The emoji picker's Stickers tab (compose box only): a search field over a
// grid of the room's sticker packs, one header per pack. Its keys route
// through picker_panel, as the emoji tab's do.

import { SelectionList } from "./PickerBase.js";
import { routePanelKey, type PanelKeys, type PickerPanel } from "./picker_panel.js";

export interface StickerEntry {
  id: string;
  /** Display name / shortcode */
  name: string;
  /** mxc:// URL of the sticker image */
  url: string;
  /** Optional thumbnail URL (lower res for the grid) */
  thumbnailUrl?: string;
  /** Pack this sticker belongs to */
  packName?: string;
}

export interface StickerBrowserCallbacks {
  onPick(sticker: StickerEntry): void;
  onClose(): void;
  /**
   * Somewhere to put focus when the grid had it and is left with no cell to
   * give it — the picker itself, so its keys keep working.
   */
  focusFallback(): void;
}

const STICKER_COLS = 4;

export class StickerBrowser implements PickerPanel {
  private readonly _el: HTMLElement;
  private readonly _searchEl: HTMLInputElement;
  private readonly _gridEl: HTMLElement;
  private readonly _list: SelectionList;
  private readonly _keys: PanelKeys;
  private readonly _cb: StickerBrowserCallbacks;
  private _all: StickerEntry[] = [];
  private _filtered: StickerEntry[] = [];
  private _cells: HTMLElement[] = [];

  constructor(callbacks: StickerBrowserCallbacks) {
    this._cb = callbacks;

    this._el = document.createElement("div");
    this._el.className = "emoji-picker__section";

    this._searchEl = document.createElement("input");
    this._searchEl.type = "text";
    this._searchEl.className = "sticker-picker__search";
    this._searchEl.placeholder = "Search stickers…";
    this._searchEl.setAttribute("aria-label", "Search stickers");
    this._searchEl.setAttribute("autocomplete", "off");
    this._searchEl.setAttribute("spellcheck", "false");
    this._searchEl.addEventListener("input", () => this._applyFilter());
    this._el.appendChild(this._searchEl);

    this._gridEl = document.createElement("div");
    this._gridEl.className = "sticker-picker__grid";
    this._gridEl.setAttribute("role", "grid");
    this._gridEl.setAttribute("aria-label", "Sticker grid");
    this._gridEl.addEventListener("click", (e) => {
      const cell = (e.target as Element).closest<HTMLElement>(".sticker-picker__cell");
      if (cell) this._pick(Number(cell.dataset.index));
    });
    this._el.appendChild(this._gridEl);

    this._list = new SelectionList({
      columns: STICKER_COLS,
      highlight: { kind: "tabindex" },
      getItems: () => this._cells,
      onSelect: (i) => this._pick(i),
      onAction: (action) => {
        if (action === "close") this._cb.onClose();
        else if (action === "picker-search") this.focusSearch();
        else return false;
        return true;
      },
    });

    this._keys = {
      searchEl: this._searchEl,
      list: this._list,
      cells: () => this._cells,
      pick: (i) => this._pick(i),
      close: () => this._cb.onClose(),
      focusSearch: () => this.focusSearch(),
      focusGrid: (i) => this.focusGrid(i),
      // Enter in the field sends the first sticker that matches.
      searchEnter: () => this._pick(0),
    };
  }

  getElement(): HTMLElement {
    return this._el;
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  /**
   * Replace the stickers. The tab shows whatever it last had while the room's
   * packs load, so the user may already be in the grid when these arrive: a
   * focused sticker keeps focus if it is still listed, and focus otherwise
   * moves to the first one rather than falling out of the picker with the
   * cell it was on.
   */
  setStickers(stickers: StickerEntry[]): void {
    const focusedIndex = this._cells.indexOf(document.activeElement as HTMLElement);
    const focusedId = focusedIndex >= 0 ? this._filtered[focusedIndex]?.id : undefined;
    this._all = stickers;
    this._applyFilter();
    if (focusedIndex < 0) return;
    const index = Math.max(0, this._filtered.findIndex((s) => s.id === focusedId));
    if (!this.focusGrid(index)) this._cb.focusFallback();
  }

  updateThumbnail(id: string, thumbnailUrl: string): void {
    const canonical = this._all.find((s) => s.id === id);
    if (canonical) canonical.thumbnailUrl = thumbnailUrl;
    const index = this._filtered.findIndex((s) => s.id === id);
    const img = index >= 0 ? this._cells[index]?.querySelector<HTMLImageElement>("img") : null;
    if (img) img.src = thumbnailUrl;
  }

  // ── PickerPanel ───────────────────────────────────────────────────────────

  reset(): void {
    this._searchEl.value = "";
    this._applyFilter();
  }

  /** The sticker tab opens on its grid. */
  focusInitial(): boolean {
    return this.focusGrid(0);
  }

  focusSearch(): void {
    this._searchEl.focus();
  }

  focusGrid(index = 0): boolean {
    if (this._cells.length === 0) return false;
    this._list.setFocus(index);
    return true;
  }

  handleKeydown(e: KeyboardEvent): boolean {
    return routePanelKey(e, this._keys);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _pick(index: number): void {
    const sticker = this._filtered[index];
    if (sticker) this._cb.onPick(sticker);
  }

  private _applyFilter(): void {
    const q = this._searchEl.value.toLowerCase().trim();
    this._filtered = q
      ? this._all.filter(
          (s) => s.name.toLowerCase().includes(q) || (s.packName?.toLowerCase().includes(q) ?? false),
        )
      : this._all;
    this._render();
    this._list.resetIndex();
  }

  private _render(): void {
    const frag = document.createDocumentFragment();
    const cells: HTMLElement[] = [];
    let lastPackName: string | undefined = undefined;

    this._filtered.forEach((sticker, i) => {
      // A pack header row whenever the pack changes
      const packName = sticker.packName ?? "";
      if (packName !== lastPackName) {
        lastPackName = packName;
        if (packName) {
          const header = document.createElement("div");
          header.className = "sticker-picker__pack-header";
          header.textContent = packName;
          frag.appendChild(header);
        }
      }

      const cell = document.createElement("button");
      cell.className = "sticker-picker__cell";
      cell.type = "button";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("tabindex", "-1");
      cell.setAttribute("aria-label", sticker.name);
      cell.title = sticker.name;
      cell.dataset.index = String(i);

      const img = document.createElement("img");
      img.src = sticker.thumbnailUrl ?? sticker.url;
      img.alt = sticker.name;
      img.className = "sticker-picker__img";
      img.loading = "lazy";
      cell.appendChild(img);

      cells.push(cell);
      frag.appendChild(cell);
    });
    this._gridEl.replaceChildren(frag);
    this._cells = cells;
  }
}
