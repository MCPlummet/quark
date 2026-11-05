// The emoji picker overlay — the only one. The compose box and reactions both
// open this, each with an EmojiPickerContext saying what differs between them:
// what a pick does, whether the sticker and GIF tabs are offered, whether free
// text is accepted, and where the panel sits. Everything about browsing emoji
// lives in the one EmojiBrowser it embeds.

import { PickerBase, SelectionList } from "./PickerBase.js";
import { EmojiBrowser } from "./EmojiBrowser.js";
import type { CustomEmojiPack, PickerEmoji } from "./emoji_catalog.js";
import { isMobile, viewportPan } from "../app/mobile.js";

export type PickerTab = "emoji" | "sticker" | "gif";

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

/** The sticker and GIF tabs — the compose box's, not a reaction's. */
export interface EmojiPickerMedia {
  /** Tab to open on. Default "emoji". */
  initialTab?: "emoji" | "sticker";
  /** The sticker tab was shown; load the room's stickers into it. */
  onStickerTab(): void;
  /** A sticker was picked. */
  onSticker(sticker: StickerEntry): void;
  /** The GIF tab was chosen; the GIF search is its own overlay. */
  onGif(): void;
}

/**
 * Everything one opening of the picker may differ in. This is the whole list
 * on purpose: emoji_picker.test.ts pins it, so a context-specific behaviour
 * has to be argued into this interface rather than grown in a second picker.
 */
export interface EmojiPickerContext {
  /** Accessible name of the overlay ("Add reaction", "Emoji picker"). */
  label: string;
  /** What picking an emoji does. The picker has already closed. */
  onEmoji(entry: PickerEmoji): void;
  /**
   * Free text: a query nothing matches (Enter), or any query (Shift-Enter).
   * Only reactions accept it — a reaction key may be any string, while the
   * compose box has its own text field. `label` completes "Enter to …".
   */
  text?: { label: string; onText(text: string): void };
  /** The sticker and GIF tabs, when offered. */
  media?: EmojiPickerMedia;
  /**
   * Desktop placement: beside this element (the message being reacted to).
   * Without one the panel docks above the compose bar. On mobile it is always
   * a bottom sheet.
   */
  anchor?: HTMLElement | null;
}

const STICKER_COLS = 4;
/** Gap between an anchor and the panel, and the panel and the window edge. */
const ANCHOR_GAP = 6;
const EDGE_GAP = 8;

/** Keyboard-, pointer- and touch-driven emoji / sticker / GIF picker overlay. */
export class EmojiPicker extends PickerBase {
  private _context: EmojiPickerContext | null = null;
  private _currentTab: PickerTab = "emoji";

  private _tabBarEl: HTMLElement;
  private _browser: EmojiBrowser;

  // ── Sticker tab (compose only) ─────────────────────────────────────────────
  private _stickerSectionEl: HTMLElement;
  private _stickerSearchEl: HTMLInputElement;
  private _stickerGridEl: HTMLElement;
  private _stickerList: SelectionList;
  private _stickerAllEntries: StickerEntry[] = [];
  private _stickerFilteredEntries: StickerEntry[] = [];

  constructor() {
    super({
      className: "emoji-picker",
      ariaLabel: "Emoji picker",
      focusable: true,
    });

    // ── Tab bar ──────────────────────────────────────────────────────────
    this._tabBarEl = document.createElement("div");
    this._tabBarEl.className = "emoji-picker__tabs";
    this._tabBarEl.setAttribute("role", "tablist");
    this._el.appendChild(this._tabBarEl);

    const tabs: Array<{ id: PickerTab; label: string }> = [
      { id: "emoji", label: "Emoji" },
      { id: "sticker", label: "Stickers" },
      { id: "gif", label: "GIF" },
    ];
    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.className = "emoji-picker__tab";
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      btn.setAttribute("role", "tab");
      btn.setAttribute("type", "button");
      btn.setAttribute("tabindex", "-1");
      btn.addEventListener("click", () => this._showTab(tab.id));
      this._tabBarEl.appendChild(btn);
    }

    // ── Emoji tab: the shared browser ────────────────────────────────────
    this._browser = new EmojiBrowser({
      onPick: (entry) => this._finish((ctx) => ctx.onEmoji(entry)),
      onText: (text) => this._finish((ctx) => ctx.text?.onText(text)),
      onClose: () => this.hide(),
    });
    this._el.appendChild(this._browser.getElement());

    // ── Sticker tab ──────────────────────────────────────────────────────
    this._stickerSectionEl = document.createElement("div");
    this._stickerSectionEl.className = "emoji-picker__section";
    this._stickerSectionEl.style.display = "none";
    this._el.appendChild(this._stickerSectionEl);

    this._stickerSearchEl = document.createElement("input");
    this._stickerSearchEl.type = "text";
    this._stickerSearchEl.className = "sticker-picker__search";
    this._stickerSearchEl.placeholder = "Search stickers…";
    this._stickerSearchEl.setAttribute("aria-label", "Search stickers");
    this._stickerSearchEl.setAttribute("autocomplete", "off");
    this._stickerSearchEl.setAttribute("spellcheck", "false");
    this._stickerSearchEl.addEventListener("input", () => this._applyStickerFilter());
    this._stickerSectionEl.appendChild(this._stickerSearchEl);

    this._stickerGridEl = document.createElement("div");
    this._stickerGridEl.className = "sticker-picker__grid";
    this._stickerGridEl.setAttribute("role", "grid");
    this._stickerGridEl.setAttribute("aria-label", "Sticker grid");
    this._stickerSectionEl.appendChild(this._stickerGridEl);

    this._stickerList = new SelectionList({
      columns: STICKER_COLS,
      highlight: { kind: "tabindex" },
      getItems: () =>
        Array.from(this._stickerGridEl.querySelectorAll<HTMLElement>(".sticker-picker__cell")),
      onSelect: (i) => this._selectSticker(i),
      onAction: (action) => {
        if (action === "close") this.hide();
        else if (action === "picker-search") this._stickerSearchEl.focus();
        else return false;
        return true;
      },
    });

    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
    this.registerOutsideClose();
  }

  // ── Opening ────────────────────────────────────────────────────────────────

  /** Open the picker for one context (see {@link EmojiPickerContext}). */
  open(context: EmojiPickerContext): void {
    this._context = context;
    this._el.setAttribute("aria-label", context.label);
    this._tabBarEl.style.display = context.media ? "" : "none";
    this._browser.setTextAction(context.text?.label ?? null);
    this._resetStickerSearch();

    this.reveal();
    this._browser.reset(); // once shown, so its scroll position takes
    this._place(context.anchor ?? null);
    this._showTab(context.media?.initialTab ?? "emoji");
  }

  hide(): void {
    this.conceal(); // hides + deregisters modal + keymapManager.resetSequence()
    this._context = null;
    this._resetStickerSearch();
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  /** The current room's custom emoji packs (both contexts list them alike). */
  setCustomPacks(packs: readonly CustomEmojiPack[]): void {
    this._browser.setCustomPacks(packs);
  }

  /** A custom emoji's thumbnail resolved. */
  setCustomImage(url: string, imageUrl: string): void {
    this._browser.setCustomImage(url, imageUrl);
  }

  /** The emoji panel, for tests and for callers that need its listing. */
  get browser(): EmojiBrowser {
    return this._browser;
  }

  setStickers(stickers: StickerEntry[]): void {
    this._stickerAllEntries = stickers;
    this._applyStickerFilter();
  }

  updateStickerThumbnail(id: string, thumbnailUrl: string): void {
    const canonical = this._stickerAllEntries.find((s) => s.id === id);
    if (canonical) canonical.thumbnailUrl = thumbnailUrl;
    const cells = this._stickerGridEl.querySelectorAll<HTMLElement>(".sticker-picker__cell");
    for (const cell of cells) {
      if (this._stickerFilteredEntries[Number(cell.dataset.index)]?.id === id) {
        const img = cell.querySelector<HTMLImageElement>("img");
        if (img) img.src = thumbnailUrl;
        break;
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** Close, then run the context's handler (it may open something else). */
  private _finish(run: (ctx: EmojiPickerContext) => void): void {
    const ctx = this._context;
    this.hide();
    if (ctx) run(ctx);
  }

  /**
   * Position the panel. Mobile: a bottom sheet, whatever the context — an
   * anchored popover there is a tiny window in a corner that a finger cannot
   * scroll. Desktop: beside the anchor, flipped above it when there is no
   * room below; with no anchor, docked above the compose bar by the stylesheet.
   */
  private _place(anchor: HTMLElement | null): void {
    const style = this._el.style;
    style.top = style.left = style.right = style.bottom = "";
    const sheet = isMobile();
    this._el.classList.toggle("emoji-picker--sheet", sheet);
    this._el.classList.toggle("emoji-picker--anchored", !sheet && anchor !== null);
    if (sheet || !anchor) return;

    // The overlay layer shares the shell's coordinate space; client rects
    // include the viewport pan, so take it off (see ui/overlay.ts).
    const pan = viewportPan();
    const rect = anchor.getBoundingClientRect();
    const width = this._el.offsetWidth;
    const height = this._el.offsetHeight;
    const left = Math.max(EDGE_GAP, Math.min(rect.left, window.innerWidth - width - EDGE_GAP));
    let top = rect.bottom - pan + ANCHOR_GAP;
    if (top + height > window.innerHeight - EDGE_GAP) {
      const above = rect.top - pan - ANCHOR_GAP - height;
      top = above >= EDGE_GAP ? above : Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
    }
    style.left = `${left}px`;
    style.top = `${top}px`;
    style.right = "auto";
    style.bottom = "auto";
  }

  private _showTab(tab: PickerTab): void {
    const media = this._context?.media;
    if (tab !== "emoji" && !media) tab = "emoji";
    if (tab === "gif") {
      // The GIF search is a separate overlay — hand over to it.
      this.hide();
      media?.onGif();
      return;
    }

    this._currentTab = tab;
    for (const btn of this._tabBarEl.querySelectorAll<HTMLElement>(".emoji-picker__tab")) {
      const isActive = btn.dataset.tab === tab;
      btn.setAttribute("aria-selected", String(isActive));
      btn.classList.toggle("emoji-picker__tab--active", isActive);
    }
    this._browser.getElement().style.display = tab === "emoji" ? "" : "none";
    this._stickerSectionEl.style.display = tab === "sticker" ? "" : "none";

    if (tab === "sticker") {
      media?.onStickerTab();
      if (!this._focusStickerCell(0)) this._el.focus();
      return;
    }
    // Opening focus is the same in every context: the search field, so typing
    // finds an emoji at once. Not on mobile, where focusing a text field raises
    // the soft keyboard over half the sheet; the field is a tap away.
    if (isMobile()) this._el.focus();
    else this._browser.focusSearch();
  }

  private _nextTab(): void {
    const order: PickerTab[] = ["emoji", "sticker", "gif"];
    this._showTab(order[(order.indexOf(this._currentTab) + 1) % order.length]);
  }

  private _handleKeydown(e: KeyboardEvent): void {
    // The picker owns every key while open; the global handler must not see
    // j/k and move the timeline underneath it.
    e.stopPropagation();

    if (this._currentTab === "sticker") {
      this._handleStickerKeydown(e);
      return;
    }
    if (this._browser.handleKeydown(e)) return;
    // The browser leaves a plain Tab from its grid to us.
    if (e.key === "Tab") {
      e.preventDefault();
      if (this._context?.media) this._nextTab();
      else this._browser.focusSearch();
    }
  }

  // ── Sticker tab ────────────────────────────────────────────────────────────

  private _resetStickerSearch(): void {
    this._stickerSearchEl.value = "";
    this._applyStickerFilter();
  }

  private _applyStickerFilter(): void {
    const q = this._stickerSearchEl.value.toLowerCase().trim();
    this._stickerFilteredEntries = q
      ? this._stickerAllEntries.filter(
          (s) => s.name.toLowerCase().includes(q) || (s.packName?.toLowerCase().includes(q) ?? false),
        )
      : this._stickerAllEntries;
    this._renderStickerGrid();
    this._stickerList.resetIndex();
  }

  private _renderStickerGrid(): void {
    const frag = document.createDocumentFragment();
    let lastPackName: string | undefined = undefined;

    this._stickerFilteredEntries.forEach((sticker, i) => {
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

      cell.addEventListener("click", () => this._selectSticker(i));
      frag.appendChild(cell);
    });
    this._stickerGridEl.replaceChildren(frag);
  }

  private _focusStickerCell(index: number): boolean {
    if (!this._stickerGridEl.querySelector(".sticker-picker__cell")) return false;
    this._stickerList.setFocus(index);
    return true;
  }

  private _selectSticker(index: number): void {
    const sticker = this._stickerFilteredEntries[index];
    if (sticker) this._finish((ctx) => ctx.media?.onSticker(sticker));
  }

  private _handleStickerKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      this.hide();
      return;
    }
    // The search field owns its typing, as the emoji tab's does.
    if (e.target === this._stickerSearchEl) {
      if (e.key === "Enter") {
        e.preventDefault();
        this._selectSticker(0);
      } else if (e.key === "Tab" || e.key === "ArrowDown") {
        e.preventDefault();
        if (!e.shiftKey) this._focusStickerCell(0);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) this._stickerSearchEl.focus();
      else this._nextTab();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // chords are not picker keys
    // Movement, select and `/` route through the keymap so user rebindings apply.
    const { consumed, partial } = this._stickerList.handleKey(e.key);
    if (consumed || partial) e.preventDefault();
  }
}
