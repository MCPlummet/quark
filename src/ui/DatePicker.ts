// A small, self-contained date picker: a trigger button that opens a themed
// calendar popover.
//
// Why custom rather than `<input type="date">`: on WebKitGTK (Tauri's webview)
// the native date popup is an uncontrollable modal grab — it sits above the
// page, swallows clicks, ignores `blur()`, and only the toolkit's own Escape
// dismisses it. This component is plain DOM we fully control: it opens/closes on
// our terms, themes via CSS variables, and behaves identically across engines.
//
// The popover is mounted on <body> with `position: fixed` (positioned from the
// trigger's rect) so an `overflow: hidden` ancestor can't clip it.

import { mountOverlay } from "./overlay.js";
import { viewportPan } from "../app/mobile.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export interface DatePickerOptions {
  /** Trigger label shown when no date is selected. Default: "Pick a date…". */
  placeholder?: string;
  /** aria-label for the trigger button. */
  ariaLabel?: string;
}

export class DatePicker {
  private _trigger: HTMLButtonElement;
  private _popover: HTMLElement;
  private _placeholder: string;

  /** Selected date as `YYYY-MM-DD`, or null. */
  private _value: string | null = null;
  /** Currently displayed month. */
  private _viewYear = new Date().getFullYear();
  private _viewMonth = new Date().getMonth();
  private _open = false;
  private _outsideHandler: ((e: MouseEvent) => void) | null = null;
  private _onChange: ((value: string | null) => void) | null = null;

  constructor(opts: DatePickerOptions = {}) {
    this._placeholder = opts.placeholder ?? "Pick a date…";

    this._trigger = document.createElement("button");
    this._trigger.type = "button";
    this._trigger.className = "date-picker__trigger";
    if (opts.ariaLabel) this._trigger.setAttribute("aria-label", opts.ariaLabel);
    this._trigger.addEventListener("click", () => this.toggle());
    // Behave like a control inside modal containers: keep our keys to ourselves
    // (so a parent's keymap doesn't fire) but let Escape bubble (e.g. to close a
    // surrounding dialog).
    this._trigger.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") e.stopPropagation();
    });

    this._popover = document.createElement("div");
    this._popover.className = "date-picker__calendar";
    this._popover.style.display = "none";
    mountOverlay(this._popover);

    this._updateTrigger();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** The trigger button — place this in the DOM. (The popover self-mounts.) */
  getElement(): HTMLButtonElement {
    return this._trigger;
  }

  /** Register a callback fired when the selected date changes. */
  onChange(handler: (value: string | null) => void): void {
    this._onChange = handler;
  }

  /** The selected date as `YYYY-MM-DD`, or null. */
  getValue(): string | null {
    return this._value;
  }

  /** Set the selected date (`YYYY-MM-DD` or null) without firing `onChange`. */
  setValue(value: string | null): void {
    this._value = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    this._updateTrigger();
  }

  open(): void {
    if (this._value) {
      const [y, m] = this._value.split("-").map(Number);
      this._viewYear = y;
      this._viewMonth = m - 1;
    }
    this._open = true;
    this._popover.style.display = "";
    this._render();
    this._position();
    this._outsideHandler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!this._popover.contains(t) && t !== this._trigger) this.close();
    };
    // Defer registration so the opening click doesn't immediately dismiss it.
    setTimeout(() => {
      if (this._outsideHandler) document.addEventListener("mousedown", this._outsideHandler, true);
    }, 0);
  }

  close(): void {
    this._open = false;
    this._popover.style.display = "none";
    if (this._outsideHandler) {
      document.removeEventListener("mousedown", this._outsideHandler, true);
      this._outsideHandler = null;
    }
  }

  toggle(): void {
    if (this._open) this.close();
    else this.open();
  }

  /** Remove the body-mounted popover and detach listeners. */
  destroy(): void {
    this.close();
    this._popover.remove();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _updateTrigger(): void {
    this._trigger.textContent = this._value ?? this._placeholder;
    this._trigger.classList.toggle("date-picker__trigger--set", !!this._value);
  }

  /** Position the (fixed) popover under the trigger, flipping above / nudging
   *  left if it would run off the viewport. */
  private _position(): void {
    const r = this._trigger.getBoundingClientRect();
    const popH = this._popover.offsetHeight;
    const popW = this._popover.offsetWidth;
    const margin = 8;
    let top = r.bottom + 2;
    if (top + popH > window.innerHeight - margin) {
      top = Math.max(margin, r.top - popH - 2);
    }
    let left = r.left;
    if (left + popW > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - popW);
    }
    // The flip/clamp math above is all layout-viewport space, like the rect it
    // starts from; the popover is in the overlay layer, which is offset by the
    // viewport pan (#33). Convert once, here.
    this._popover.style.top = `${Math.round(top - viewportPan())}px`;
    this._popover.style.left = `${Math.round(left)}px`;
  }

  private _render(): void {
    this._popover.innerHTML = "";

    // Header: « year · ‹ month · title · month › · year »
    const header = document.createElement("div");
    header.className = "date-picker__header";
    const mkNav = (label: string, title: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "date-picker__nav";
      b.textContent = label;
      b.title = title;
      b.tabIndex = -1;
      b.addEventListener("click", () => { fn(); this._render(); });
      return b;
    };
    header.appendChild(mkNav("«", "Previous year", () => { this._viewYear--; }));
    header.appendChild(mkNav("‹", "Previous month", () => this._stepMonth(-1)));
    const title = document.createElement("span");
    title.className = "date-picker__title";
    title.textContent = `${MONTHS[this._viewMonth]} ${this._viewYear}`;
    header.appendChild(title);
    header.appendChild(mkNav("›", "Next month", () => this._stepMonth(1)));
    header.appendChild(mkNav("»", "Next year", () => { this._viewYear++; }));
    this._popover.appendChild(header);

    // Grid: weekday headers + day cells.
    const grid = document.createElement("div");
    grid.className = "date-picker__grid";
    for (const wd of WEEKDAYS) {
      const h = document.createElement("span");
      h.className = "date-picker__weekday";
      h.textContent = wd;
      grid.appendChild(h);
    }
    const firstWeekday = new Date(this._viewYear, this._viewMonth, 1).getDay();
    const daysInMonth = new Date(this._viewYear, this._viewMonth + 1, 0).getDate();
    for (let i = 0; i < firstWeekday; i++) {
      grid.appendChild(document.createElement("span")); // leading blank
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${this._viewYear}-${String(this._viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "date-picker__day";
      cell.textContent = String(day);
      cell.tabIndex = -1;
      if (iso === this._value) cell.classList.add("date-picker__day--selected");
      cell.addEventListener("click", () => this._select(iso));
      grid.appendChild(cell);
    }
    this._popover.appendChild(grid);
  }

  /** Advance the displayed month by `delta`, rolling the year over. */
  private _stepMonth(delta: number): void {
    this._viewMonth += delta;
    if (this._viewMonth < 0) { this._viewMonth = 11; this._viewYear--; }
    else if (this._viewMonth > 11) { this._viewMonth = 0; this._viewYear++; }
  }

  private _select(iso: string): void {
    this._value = iso;
    this._updateTrigger();
    this.close();
    this._onChange?.(iso);
  }
}
