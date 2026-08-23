// GIF search overlay

import type { GifResult } from "../ipc/types.js";
import { PickerBase, SelectionList } from "./PickerBase.js";
export type { GifResult };

type GifSelectCallback = (gif: GifResult) => void;
type GifSearchCallback = (query: string) => void;
type GifLoadMoreCallback = () => void;

const GIF_COLS = 3;

/** GIF search popup with keyboard-navigable grid. */
export class GifPicker extends PickerBase {
  private _panelEl: HTMLElement;   // floating panel
  private _searchEl: HTMLInputElement;
  private _statusEl: HTMLElement;
  private _gridEl: HTMLElement;

  private _poweredByEl: HTMLElement;

  private _results: GifResult[] = [];
  private _list: SelectionList;

  private _onSelect: GifSelectCallback | null = null;
  private _onSearch: GifSearchCallback | null = null;
  private _onLoadMore: GifLoadMoreCallback | null = null;

  constructor() {
    super({
      className: "gif-picker",
      ariaLabel: "GIF search",
      displayValue: "flex",
    });

    // Close on backdrop click (outside panel)
    this._el.addEventListener("click", (e) => {
      if (e.target === this._el) this.hide();
    });

    // ── Panel ─────────────────────────────────────────────────────────────
    this._panelEl = document.createElement("div");
    this._panelEl.className = "gif-picker__panel";
    this._el.appendChild(this._panelEl);

    // ── Header ───────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "gif-picker__header";
    this._panelEl.appendChild(header);

    const title = document.createElement("span");
    title.className = "gif-picker__title";
    title.textContent = "GIF Search";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gif-picker__close-hint dialog-close-btn";
    closeBtn.textContent = "[× Esc]";
    closeBtn.setAttribute("aria-label", "Close GIF search");
    closeBtn.tabIndex = -1;
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);

    // ── Search input ─────────────────────────────────────────────────────
    const searchWrap = document.createElement("div");
    searchWrap.className = "gif-picker__search-wrap";
    this._panelEl.appendChild(searchWrap);

    const searchPrompt = document.createElement("span");
    searchPrompt.className = "gif-picker__search-prompt";
    searchPrompt.textContent = "/";
    searchPrompt.setAttribute("aria-hidden", "true");
    searchWrap.appendChild(searchPrompt);

    this._searchEl = document.createElement("input");
    this._searchEl.type = "text";
    this._searchEl.className = "gif-picker__search";
    this._searchEl.placeholder = "search GIFs…";
    this._searchEl.setAttribute("aria-label", "Search GIFs");
    this._searchEl.setAttribute("autocomplete", "off");
    this._searchEl.setAttribute("spellcheck", "false");
    searchWrap.appendChild(this._searchEl);

    this._poweredByEl = document.createElement("span");
    this._poweredByEl.className = "gif-picker__powered-by";
    this._poweredByEl.setAttribute("aria-hidden", "true");
    searchWrap.appendChild(this._poweredByEl);

    this._searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._onSearch?.(this._searchEl.value.trim());
      }
    });

    // ── Grid ─────────────────────────────────────────────────────────────
    this._gridEl = document.createElement("div");
    this._gridEl.className = "gif-picker__grid";
    this._gridEl.setAttribute("role", "grid");
    this._gridEl.setAttribute("aria-label", "GIF results");
    this._panelEl.appendChild(this._gridEl);

    // ── Status / hint bar ────────────────────────────────────────────────
    this._statusEl = document.createElement("div");
    this._statusEl.className = "gif-picker__status";
    this._statusEl.textContent = "Enter to search · j/k/h/l navigate · Tab more · Esc close";
    this._panelEl.appendChild(this._statusEl);

    // ── Navigation model ─────────────────────────────────────────────────
    this._list = new SelectionList({
      columns: GIF_COLS,
      highlight: { kind: "tabindex" },
      getItems: () =>
        Array.from(this._gridEl.querySelectorAll<HTMLElement>(".gif-picker__cell")),
      onSelect: (i) => this._selectIndex(i),
    });

    // ── Keyboard handling ────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  onSelect(cb: GifSelectCallback): void {
    this._onSelect = cb;
  }

  onSearch(cb: GifSearchCallback): void {
    this._onSearch = cb;
  }

  onLoadMore(cb: GifLoadMoreCallback): void {
    this._onLoadMore = cb;
  }

  show(): void {
    this.reveal();
    this._searchEl.focus();
  }

  setResults(results: GifResult[]): void {
    this._results = results;
    this._renderGrid();
    this._list.setFocus(0);
  }

  appendResults(results: GifResult[]): void {
    this._results = [...this._results, ...results];
    this._renderGrid();
    this._list.refresh();
  }

  setStatus(text: string): void {
    this._statusEl.textContent = text;
  }

  setProvider(provider: string): void {
    const label = provider === "giphy" ? "Giphy" : provider === "klipy" ? "Klipy" : provider;
    this._poweredByEl.textContent = label ? `Powered by ${label}` : "";
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _renderGrid(): void {
    this._gridEl.innerHTML = "";

    if (this._results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gif-picker__empty";
      empty.textContent = "No results";
      this._gridEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < this._results.length; i++) {
      const gif = this._results[i];
      const cell = document.createElement("button");
      cell.className = "gif-picker__cell";
      cell.type = "button";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("tabindex", i === this._list.focusIndex ? "0" : "-1");
      cell.setAttribute("aria-label", gif.title || `GIF ${i + 1}`);
      cell.title = gif.title;
      cell.dataset.index = String(i);

      const img = document.createElement("img");
      img.src = gif.preview_url;
      img.alt = gif.title;
      img.className = "gif-picker__thumbnail";
      img.loading = "lazy";
      cell.appendChild(img);

      const label = document.createElement("span");
      label.className = "gif-picker__cell-label";
      label.textContent = gif.title;
      cell.appendChild(label);

      cell.addEventListener("click", () => this._selectIndex(i));
      this._gridEl.appendChild(cell);
    }
  }

  private _selectIndex(index: number): void {
    const gif = this._results[index];
    if (gif) {
      this._onSelect?.(gif);
      this.hide();
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    // Allow normal typing in search box — only intercept Escape
    if (document.activeElement === this._searchEl) {
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        e.preventDefault();
        this.hide();
      }
      return;
    }

    // Escape, Tab, Enter, / are hardcoded (overlay-specific or not remappable)
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      this.hide();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      this._onLoadMore?.();
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      this._searchEl.focus();
      return;
    }

    // Navigation + select route through the keymap (honours rebindings).
    const { consumed, partial } = this._list.handleKey(e.key);
    if (consumed || partial) e.preventDefault();
  }
}
