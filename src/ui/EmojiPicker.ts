// The emoji picker overlay — the only one. The compose box and reactions both
// open this, each with an EmojiPickerContext saying what differs between them:
// what a pick does, whether the sticker and GIF tabs are offered, whether free
// text is accepted, and where the panel sits. Everything about browsing emoji
// lives in the one EmojiBrowser it embeds.
//
// The picker is a host for tabs. Each tab is a PickerPanel (picker_panel.ts)
// that routes its own keys through the one shared router; the host only shows
// a panel, focuses it, and owns the plain Tab that moves between them.

import { PickerBase } from "./PickerBase.js";
import { EmojiBrowser } from "./EmojiBrowser.js";
import { StickerBrowser, type StickerEntry } from "./StickerBrowser.js";
import type { PickerPanel } from "./picker_panel.js";
import type { CustomEmojiPack, PickerEmoji } from "./emoji_catalog.js";
import { isMobile, viewportPan } from "../app/mobile.js";

export type { StickerEntry } from "./StickerBrowser.js";

export type PickerTab = "emoji" | "sticker" | "gif";

/** The tabs that are panels; GIF hands over to its own overlay. */
type PanelTab = Exclude<PickerTab, "gif">;

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

/** Gap between an anchor and the panel, and the panel and the window edge. */
const ANCHOR_GAP = 6;
const EDGE_GAP = 8;

/** Keyboard-, pointer- and touch-driven emoji / sticker / GIF picker overlay. */
export class EmojiPicker extends PickerBase {
  private _context: EmojiPickerContext | null = null;
  private _currentTab: PanelTab = "emoji";

  private _tabBarEl: HTMLElement;
  private _browser: EmojiBrowser;
  private _stickers: StickerBrowser;
  private _panels: Record<PanelTab, PickerPanel>;

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

    // ── Sticker tab (compose only) ───────────────────────────────────────
    this._stickers = new StickerBrowser({
      onPick: (sticker) => this._finish((ctx) => ctx.media?.onSticker(sticker)),
      onClose: () => this.hide(),
      focusFallback: () => this._el.focus(),
    });

    this._panels = { emoji: this._browser, sticker: this._stickers };
    for (const panel of Object.values(this._panels)) this._el.appendChild(panel.getElement());
    this._stickers.getElement().style.display = "none";

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

    this.reveal();
    // Once shown, so the emoji grid's scroll position takes.
    for (const panel of Object.values(this._panels)) panel.reset();
    this._place(context.anchor ?? null);
    this._showTab(context.media?.initialTab ?? "emoji");
  }

  hide(): void {
    this.conceal(); // hides + deregisters modal + keymapManager.resetSequence()
    this._context = null;
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
    this._stickers.setStickers(stickers);
  }

  updateStickerThumbnail(id: string, thumbnailUrl: string): void {
    this._stickers.updateThumbnail(id, thumbnailUrl);
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
    for (const [id, panel] of Object.entries(this._panels)) {
      panel.getElement().style.display = id === tab ? "" : "none";
    }
    if (tab === "sticker") media?.onStickerTab();

    // The emoji tab opens on its search field in every context, so typing
    // finds an emoji at once — but not on mobile, where focusing a text field
    // raises the soft keyboard over half the sheet; the field is a tap away.
    // A tab with nothing to focus leaves focus on the picker, so its keys work.
    const textField = tab === "emoji";
    if ((textField && isMobile()) || !this._panels[tab].focusInitial()) this._el.focus();
  }

  private _nextTab(): void {
    const order: PickerTab[] = ["emoji", "sticker", "gif"];
    this._showTab(order[(order.indexOf(this._currentTab) + 1) % order.length]);
  }

  private _handleKeydown(e: KeyboardEvent): void {
    // The picker owns every key while open; the global handler must not see
    // j/k and move the timeline underneath it.
    e.stopPropagation();

    const panel = this._panels[this._currentTab];
    if (panel.handleKeydown(e)) return;
    // A panel leaves a plain Tab from its grid to us.
    if (e.key === "Tab") {
      e.preventDefault();
      if (this._context?.media) this._nextTab();
      else panel.focusSearch();
    }
  }
}
