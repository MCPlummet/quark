// Non-modal "update available" banner. Follows the StatusBar pattern: a plain
// class that owns a root element, exposes getElement() for mounting, and
// imperative show/hide/progress methods. Not a DialogBase overlay.

import type { UpdateInfo } from "../ipc/index.js";

export class UpdateBanner {
  private _el: HTMLElement;
  private _text: HTMLElement;
  private _progress: HTMLElement;
  private _installBtn: HTMLButtonElement;
  private _dismissBtn: HTMLButtonElement;
  private _version: string | null = null;
  private _received = 0;
  private _onInstall: (() => void) | null = null;
  private _onDismiss: ((version: string) => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "update-banner";
    this._el.setAttribute("role", "status");
    this._el.setAttribute("aria-live", "polite");
    this._el.setAttribute("aria-label", "Software update");

    this._text = document.createElement("span");
    this._text.className = "update-banner__text";
    this._el.appendChild(this._text);

    this._progress = document.createElement("span");
    this._progress.className = "update-banner__progress";
    this._progress.setAttribute("aria-hidden", "true");
    this._el.appendChild(this._progress);

    this._installBtn = document.createElement("button");
    this._installBtn.className = "update-banner__install";
    this._installBtn.type = "button";
    this._installBtn.textContent = "Install & restart";
    this._installBtn.addEventListener("click", () => this._onInstall?.());
    this._el.appendChild(this._installBtn);

    this._dismissBtn = document.createElement("button");
    this._dismissBtn.className = "update-banner__dismiss";
    this._dismissBtn.type = "button";
    this._dismissBtn.setAttribute("aria-label", "Dismiss update notice");
    this._dismissBtn.textContent = "Later";
    this._dismissBtn.addEventListener("click", () => {
      const v = this._version;
      this.hide();
      if (v) this._onDismiss?.(v);
    });
    this._el.appendChild(this._dismissBtn);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  /** Register the "Install & restart" handler. */
  onInstall(cb: () => void): void {
    this._onInstall = cb;
  }

  /** Register the "Later" handler (receives the dismissed version). */
  onDismiss(cb: (version: string) => void): void {
    this._onDismiss = cb;
  }

  /** Reveal the banner for an available update. */
  show(info: UpdateInfo): void {
    this._version = info.version;
    this._received = 0;
    this._text.textContent = `Update available — v${info.version}`;
    this._progress.textContent = "";
    this._installBtn.disabled = false;
    this._el.classList.add("update-banner--visible");
  }

  hide(): void {
    this._el.classList.remove("update-banner--visible");
  }

  /**
   * Reflect download progress. `chunkLength` is the size of the chunk just
   * received; it's accumulated into a running total so the percentage climbs
   * 0→100. A `null`/0 total shows an indeterminate state.
   */
  setProgress(chunkLength: number, total: number | null): void {
    this._installBtn.disabled = true;
    this._received += chunkLength;
    if (total && total > 0) {
      const pct = Math.min(100, Math.round((this._received / total) * 100));
      this._progress.textContent = `Downloading… ${pct}%`;
    } else {
      this._progress.textContent = "Downloading…";
    }
  }

  /**
   * Restore the offer state after a failed download so the user can retry:
   * clears the progress text and re-enables the install button. The banner
   * stays visible (the update is still available).
   */
  resetAfterError(): void {
    this._received = 0;
    this._progress.textContent = "";
    this._installBtn.disabled = false;
  }
}
