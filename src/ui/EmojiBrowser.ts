// The emoji-browsing panel: search field, category bar, grid and keyboard
// navigation. The emoji picker embeds exactly one, whichever context opened it
// — the compose box or a reaction — so there is no second implementation for
// the two to drift apart in. What it lists and finds comes from emoji_catalog;
// this file only draws it and moves through it. Its keys route through
// picker_panel, as the sticker tab's do.

import { SelectionList, type DirectionalAction } from "./PickerBase.js";
import { sectionedGridMove } from "./grid_nav.js";
import { routePanelKey, type PanelKeys, type PickerPanel } from "./picker_panel.js";
import {
  buildSections,
  browseEntries,
  customPacksSignature,
  queryTokens,
  searchEmoji,
  type CustomEmojiPack,
  type EmojiSection,
  type PickerEmoji,
} from "./emoji_catalog.js";

/** Columns assumed when the grid has no layout to read (tests, hidden). */
const FALLBACK_COLUMNS = 7;

export interface EmojiBrowserCallbacks {
  /** An emoji was chosen (click, tap, Enter, Space). */
  onPick(entry: PickerEmoji): void;
  /** Free text was submitted — only offered while a text action is set. */
  onText(text: string): void;
  /** The user asked to close (Escape, or the keymap's `close`). */
  onClose(): void;
}

/** Where the focused cell is, in terms that survive a re-render. */
interface FocusedEntry {
  id: string;
  /** The browse section it sits in; null in search results, where ids are unique. */
  sectionId: string | null;
}

/** One rendered grid: its cells in DOM order and its custom images by source. */
interface RenderedGrid {
  cells: HTMLElement[];
  images: Map<string, HTMLImageElement[]>;
}

const emptyGrid = (): RenderedGrid => ({ cells: [], images: new Map() });

/** Append `value` to the list `map` holds under `key`. */
function addTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export class EmojiBrowser implements PickerPanel {
  private readonly _el: HTMLElement;
  private readonly _searchEl: HTMLInputElement;
  private readonly _catsEl: HTMLElement;
  private readonly _browseEl: HTMLElement;
  private readonly _resultsEl: HTMLElement;
  private readonly _emptyEl: HTMLElement;
  private readonly _hintEl: HTMLElement;
  private readonly _list: SelectionList;
  private readonly _keys: PanelKeys;
  private readonly _cb: EmojiBrowserCallbacks;

  private _sections: EmojiSection[] = [];
  private _packsSignature = customPacksSignature([]);
  /** Custom entries by image source, so a resolved thumbnail touches only its own. */
  private _entriesByUrl = new Map<string, PickerEmoji[]>();
  /** The browse grid's entries, in DOM order (common emoji appear twice). */
  private _browse: PickerEmoji[] = [];
  private _browseGrid: RenderedGrid = emptyGrid();
  private _results: PickerEmoji[] = [];
  private _resultsGrid: RenderedGrid = emptyGrid();
  /** Custom pack category buttons by their icon's image source. */
  private _categoryIcons = new Map<string, HTMLElement[]>();
  private _searching = false;
  private _rendered = false;
  /** Verb phrase for submitting free text ("react with"), or null when not accepted. */
  private _textAction: string | null = null;
  private _activeSectionId: string | null = null;

  constructor(callbacks: EmojiBrowserCallbacks) {
    this._cb = callbacks;
    this._setSections(buildSections([]));

    this._el = document.createElement("div");
    this._el.className = "emoji-picker__section emoji-picker__emoji";

    const searchRow = document.createElement("div");
    searchRow.className = "emoji-picker__search-row";
    const prompt = document.createElement("span");
    prompt.className = "emoji-picker__prompt";
    prompt.textContent = ":>";
    prompt.setAttribute("aria-hidden", "true");
    searchRow.appendChild(prompt);
    this._searchEl = document.createElement("input");
    this._searchEl.type = "text";
    this._searchEl.className = "emoji-picker__search";
    this._searchEl.placeholder = "Search emoji…";
    this._searchEl.setAttribute("aria-label", "Search emoji");
    this._searchEl.setAttribute("autocomplete", "off");
    this._searchEl.setAttribute("spellcheck", "false");
    this._searchEl.addEventListener("input", () => this._applyQuery());
    searchRow.appendChild(this._searchEl);
    this._el.appendChild(searchRow);

    this._catsEl = document.createElement("div");
    this._catsEl.className = "emoji-picker__categories";
    this._catsEl.setAttribute("aria-label", "Emoji categories");
    // A category button does what `[`/`]` do: the section's first emoji takes
    // focus, so the next key — Enter, Tab, an arrow — acts from there and not
    // from wherever the grid's focus index was left.
    this._catsEl.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLElement>(".emoji-picker__category-btn");
      if (btn?.dataset.sectionId) this.jumpToSection(btn.dataset.sectionId);
    });
    this._el.appendChild(this._catsEl);

    this._browseEl = this._makeGrid("Emoji");
    this._browseEl.addEventListener("scroll", () => this._syncActiveSectionToScroll());
    this._resultsEl = this._makeGrid("Matching emoji");
    this._resultsEl.style.display = "none";

    this._emptyEl = document.createElement("div");
    this._emptyEl.className = "emoji-picker__empty";
    this._emptyEl.style.display = "none";
    this._el.appendChild(this._emptyEl);

    this._hintEl = document.createElement("div");
    this._hintEl.className = "emoji-picker__hint";
    this._el.appendChild(this._hintEl);
    this._renderHint();

    // While the search field has focus, mark the result Enter will pick; the
    // grid's own focus ring takes over once focus moves into it.
    this._el.addEventListener("focusin", () => this._markDefault());

    // Every grid key goes through `keymapManager.resolveKey(key, "picker")`
    // here, so a user's quarkrc rebindings apply; the browse view's sections
    // make up/down a row computation rather than a fixed column jump.
    this._list = new SelectionList({
      columns: FALLBACK_COLUMNS,
      highlight: { kind: "tabindex" },
      getItems: () => this._cells(),
      onSelect: (i) => this._pick(i),
      move: (from, action) => sectionedGridMove(this._sectionSizes(), this._columns(), from, action),
      onEdge: (action: DirectionalAction) => {
        if (action === "nav-up") this.focusSearch();
      },
      onAction: (action) => this._onAction(action),
    });

    this._keys = {
      searchEl: this._searchEl,
      list: this._list,
      cells: () => this._cells(),
      pick: (i) => this._pick(i),
      close: () => this._cb.onClose(),
      focusSearch: () => this.focusSearch(),
      focusGrid: (i) => this.focusGrid(i),
      searchEnter: (e) => this._searchEnter(e),
    };
  }

  getElement(): HTMLElement {
    return this._el;
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  /**
   * Replace the custom packs. A reload that brings back the same packs only
   * patches in any newly resolved images instead of rebuilding the grid.
   */
  setCustomPacks(packs: readonly CustomEmojiPack[]): void {
    const signature = customPacksSignature(packs);
    if (signature === this._packsSignature) {
      const images = new Map<string, string>();
      for (const pack of packs) {
        for (const e of pack.emojis) if (e.imageUrl) images.set(e.url, e.imageUrl);
      }
      this._applyImages(images);
      return;
    }
    this._packsSignature = signature;
    this._setSections(buildSections(packs));
    if (!this._rendered) return;
    // Read before the re-render takes the focused cell out of the document.
    const focused = this._focusedEntry();
    this._renderBrowse();
    this._applyQuery();
    if (focused) this.focusGrid(this._indexOf(focused));
  }

  /** A custom emoji's thumbnail resolved: show it wherever that emoji is drawn. */
  setCustomImage(url: string, imageUrl: string): void {
    this._applyImages(new Map([[url, imageUrl]]));
  }

  /**
   * Fill in resolved images (source url → displayable url). Each lookup is by
   * source, so a pack's hundreds of thumbnails arriving one by one cost one
   * entry and one cell each, not a walk of every emoji and image per arrival.
   */
  private _applyImages(images: ReadonlyMap<string, string>): void {
    for (const [url, image] of images) {
      for (const e of this._entriesByUrl.get(url) ?? []) e.imageUrl = image;
      for (const grid of [this._browseGrid, this._resultsGrid]) {
        for (const img of grid.images.get(url) ?? []) {
          if (img.getAttribute("src") === image) continue;
          img.src = image;
          img.hidden = false;
          img.closest(".emoji-picker__cell")?.classList.remove("emoji-picker__cell--pending");
        }
      }
      for (const btn of this._categoryIcons.get(url) ?? []) this._setCategoryIcon(btn, btn.title, image);
    }
  }

  private _setSections(sections: EmojiSection[]): void {
    this._sections = sections;
    this._entriesByUrl = new Map();
    for (const section of sections) {
      for (const e of section.entries) if (e.url !== undefined) addTo(this._entriesByUrl, e.url, e);
    }
  }

  /**
   * Whether a query can be submitted as text, and the verb phrase that says
   * what doing so means ("react with"). Null: it cannot (the compose box).
   */
  setTextAction(label: string | null): void {
    this._textAction = label;
    this._renderHint();
    this._renderEmpty();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Back to a fresh state for an open: no query, scrolled to the top. */
  reset(): void {
    if (!this._rendered) this._renderBrowse();
    this._searchEl.value = "";
    this._applyQuery();
    this._browseEl.scrollTop = 0;
    this._setActiveSection(this._sections.find((s) => s.entries.length > 0)?.id ?? null);
  }

  /** The emoji tab opens on its search field, so typing finds an emoji at once. */
  focusInitial(): boolean {
    this.focusSearch();
    return true;
  }

  focusSearch(): void {
    this._searchEl.focus();
    this._markDefault();
  }

  /** Focus a cell of the visible grid. False when there is none to focus. */
  focusGrid(index = 0): boolean {
    if (this._cells().length === 0) return false;
    this._list.setFocus(index);
    return true;
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  handleKeydown(e: KeyboardEvent): boolean {
    return routePanelKey(e, this._keys);
  }

  /** Enter picks the first result; Shift-Enter, or Enter with none, sends text where allowed. */
  private _searchEnter(e: KeyboardEvent): void {
    const text = this._searchEl.value.trim();
    if (e.shiftKey) {
      if (this._textAction !== null && text) this._cb.onText(text);
      return;
    }
    if (!this._searching) return;
    const best = this._results[0];
    if (best) this._cb.onPick(best);
    else if (this._textAction !== null && text) this._cb.onText(text);
  }

  private _pick(index: number): void {
    const entry = this.visibleEntries()[index];
    if (entry) this._cb.onPick(entry);
  }

  private _onAction(action: string): boolean {
    switch (action) {
      case "close":
        this._cb.onClose();
        return true;
      case "picker-search":
        this.focusSearch();
        return true;
      case "picker-prev-section":
        this._cycleSection(-1);
        return true;
      case "picker-next-section":
        this._cycleSection(1);
        return true;
      default:
        return false;
    }
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  /**
   * Show a section: clears any search, scrolls its header to the top, marks
   * its category, and focuses its first emoji.
   */
  jumpToSection(id: string): void {
    if (this._searching) {
      this._searchEl.value = "";
      this._applyQuery();
    }
    const header = this._headerFor(id);
    if (!header) return;
    this._list.setFocus(this._sectionStart(id));
    this._browseEl.scrollTop = header.offsetTop;
    this._setActiveSection(id);
  }

  private _cycleSection(dir: -1 | 1): void {
    const ids = this._sections.filter((s) => s.entries.length > 0).map((s) => s.id);
    if (ids.length === 0) return;
    const current = this._searching ? this._activeSectionId : this._sectionOf(this._list.focusIndex);
    const at = Math.max(0, ids.indexOf(current ?? ids[0]));
    this.jumpToSection(ids[(at + dir + ids.length) % ids.length]);
  }

  private _sectionSizes(): number[] {
    if (this._searching) return [this._results.length];
    return this._sections.map((s) => s.entries.length).filter((n) => n > 0);
  }

  private _sectionStart(id: string): number {
    let start = 0;
    for (const s of this._sections) {
      if (s.id === id) return start;
      start += s.entries.length;
    }
    return 0;
  }

  private _sectionOf(index: number): string | null {
    let start = 0;
    for (const s of this._sections) {
      if (index < start + s.entries.length) return s.id;
      start += s.entries.length;
    }
    return null;
  }

  private _headerFor(id: string): HTMLElement | null {
    for (const h of this._browseEl.querySelectorAll<HTMLElement>(".emoji-picker__section-header")) {
      if (h.dataset.sectionId === id) return h;
    }
    return null;
  }

  /** Scroll-spy: the category whose header was last scrolled past is active. */
  private _syncActiveSectionToScroll(): void {
    if (this._searching) return;
    const top = this._browseEl.scrollTop + 4;
    let active: string | null = null;
    for (const h of this._browseEl.querySelectorAll<HTMLElement>(".emoji-picker__section-header")) {
      if (h.offsetTop > top) break;
      active = h.dataset.sectionId ?? null;
    }
    if (active) this._setActiveSection(active);
  }

  private _setActiveSection(id: string | null): void {
    this._activeSectionId = id;
    for (const btn of this._catsEl.querySelectorAll<HTMLElement>(".emoji-picker__category-btn")) {
      btn.classList.toggle("emoji-picker__category-btn--active", btn.dataset.sectionId === id);
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────

  private _applyQuery(): void {
    const query = this._searchEl.value;
    this._searching = queryTokens(query).length > 0;
    if (this._searching) {
      this._results = searchEmoji(this._sections, query);
      this._resultsGrid = this._fillGrid(this._resultsEl, this._results);
    } else {
      this._results = [];
      this._resultsGrid = emptyGrid();
      this._resultsEl.replaceChildren();
    }
    this._browseEl.style.display = this._searching ? "none" : "";
    this._resultsEl.style.display = this._searching && this._results.length > 0 ? "" : "none";
    this._renderEmpty();
    this._list.resetIndex();
    this._markDefault();
  }

  /** The no-match line, which names the text action when there is one. */
  private _renderEmpty(): void {
    const empty = this._searching && this._results.length === 0;
    this._emptyEl.style.display = empty ? "" : "none";
    this._emptyEl.textContent = !empty
      ? ""
      : this._textAction !== null
        ? `No emoji match · Enter to ${this._textAction} “${this._searchEl.value.trim()}”`
        : "No emoji match";
  }

  /** While searching from the field, mark the first result (what Enter picks). */
  private _markDefault(): void {
    const marking = this._searching && document.activeElement === this._searchEl;
    this._resultsGrid.cells.forEach((cell, i) =>
      cell.classList.toggle("emoji-picker__cell--default", marking && i === 0),
    );
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /** What the visible grid shows, index-aligned with its cells. */
  visibleEntries(): readonly PickerEmoji[] {
    return this._searching ? this._results : this._browse;
  }

  /** The sections currently listed (common, custom packs, built-ins). */
  sections(): readonly EmojiSection[] {
    return this._sections;
  }

  private _makeGrid(label: string): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "emoji-picker__grid";
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", label);
    grid.addEventListener("click", (e) => {
      const cell = (e.target as Element).closest<HTMLElement>(".emoji-picker__cell");
      if (!cell) return;
      const entries = grid === this._resultsEl ? this._results : this._browse;
      const entry = entries[Number(cell.dataset.index)];
      if (entry) this._cb.onPick(entry);
    });
    this._el.appendChild(grid);
    return grid;
  }

  /** The visible grid's cells, kept from its render rather than queried per key. */
  private _cells(): HTMLElement[] {
    return this._searching ? this._resultsGrid.cells : this._browseGrid.cells;
  }

  /** The grid's real column count, read from its resolved track list. */
  private _columns(): number {
    const grid = this._searching ? this._resultsEl : this._browseEl;
    const tracks = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/);
    const n = tracks.filter((t) => /^[\d.]+px$/.test(t)).length;
    return n > 0 ? n : FALLBACK_COLUMNS;
  }

  private _focusedEntry(): FocusedEntry | null {
    const i = this._cells().indexOf(document.activeElement as HTMLElement);
    const entry = i >= 0 ? this.visibleEntries()[i] : undefined;
    if (!entry) return null;
    return { id: entry.id, sectionId: this._searching ? null : this._sectionOf(i) };
  }

  /**
   * Where a focused entry is now. In the browse view it is looked for in the
   * section it was in: the common emoji are listed twice under one id, and a
   * first match would move focus from 😂 in Smileys up to its copy in Common.
   */
  private _indexOf(focused: FocusedEntry): number {
    if (focused.sectionId !== null && !this._searching) {
      let start = 0;
      for (const s of this._sections) {
        if (s.id === focused.sectionId) {
          const j = s.entries.findIndex((e) => e.id === focused.id);
          if (j >= 0) return start + j;
          break;
        }
        start += s.entries.length;
      }
    }
    return Math.max(0, this.visibleEntries().findIndex((e) => e.id === focused.id));
  }

  private _renderBrowse(): void {
    this._rendered = true;
    this._browse = browseEntries(this._sections);
    const grid = emptyGrid();
    const frag = document.createDocumentFragment();
    let index = 0;
    for (const section of this._sections) {
      if (section.entries.length === 0) continue;
      const header = document.createElement("div");
      header.className = "emoji-picker__section-header";
      header.dataset.sectionId = section.id;
      header.textContent = section.name;
      frag.appendChild(header);
      for (const entry of section.entries) frag.appendChild(this._cell(entry, index++, grid));
    }
    this._browseEl.replaceChildren(frag);
    this._browseGrid = grid;
    this._list.resetIndex();
    this._renderCategories();
  }

  private _fillGrid(el: HTMLElement, entries: readonly PickerEmoji[]): RenderedGrid {
    const grid = emptyGrid();
    const frag = document.createDocumentFragment();
    entries.forEach((entry, i) => frag.appendChild(this._cell(entry, i, grid)));
    el.replaceChildren(frag);
    return grid;
  }

  /** One cell, recorded in `grid` (and its image by source, for a custom emoji). */
  private _cell(entry: PickerEmoji, index: number, grid: RenderedGrid): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "emoji-picker__cell";
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("tabindex", "-1");
    cell.setAttribute("aria-label", entry.shortcode);
    cell.title = `:${entry.shortcode}:`;
    cell.dataset.index = String(index);
    cell.dataset.emojiId = entry.id;
    if (entry.glyph) {
      cell.textContent = entry.glyph;
    } else {
      const img = document.createElement("img");
      img.className = "emoji-picker__img";
      img.alt = `:${entry.shortcode}:`;
      img.dataset.url = entry.url ?? "";
      img.loading = "lazy";
      if (entry.imageUrl) {
        img.src = entry.imageUrl;
      } else {
        img.hidden = true;
        cell.classList.add("emoji-picker__cell--pending");
      }
      cell.appendChild(img);
      if (entry.url !== undefined) addTo(grid.images, entry.url, img);
    }
    grid.cells.push(cell);
    return cell;
  }

  private _renderCategories(): void {
    this._categoryIcons = new Map();
    const frag = document.createDocumentFragment();
    for (const section of this._sections) {
      if (section.entries.length === 0) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-picker__category-btn";
      btn.dataset.sectionId = section.id;
      btn.title = section.name;
      btn.setAttribute("tabindex", "-1");
      if (section.iconUrl) {
        btn.dataset.iconUrl = section.iconUrl;
        addTo(this._categoryIcons, section.iconUrl, btn);
      }
      const iconImage = section.iconUrl ? section.entries[0]?.imageUrl : undefined;
      this._setCategoryIcon(btn, section.name, iconImage, section.icon);
      frag.appendChild(btn);
    }
    this._catsEl.replaceChildren(frag);
    this._setActiveSection(this._activeSectionId);
  }

  private _setCategoryIcon(btn: HTMLElement, name: string, imageUrl?: string, glyph?: string): void {
    if (imageUrl) {
      const img = document.createElement("img");
      img.className = "emoji-picker__category-img";
      img.src = imageUrl;
      img.alt = name;
      btn.replaceChildren(img);
    } else if (glyph !== undefined) {
      btn.textContent = glyph;
    }
  }

  private _renderHint(): void {
    const items = ["Enter pick", "Tab grid", "[ ] category", "Esc close"];
    if (this._textAction !== null) items.splice(1, 0, `Shift-Enter ${this._textAction} text`);
    // Non-breaking within an item, so a narrow panel wraps between items only.
    this._hintEl.textContent = items.map((i) => i.replace(/ /g, " ")).join(" · ");
  }
}
