// Reusable confirmation dialog.
//
// Usage:
//   const dialog = new ConfirmDialog();
//   document.body.appendChild(dialog.getElement());
//   const confirmed = await dialog.confirm({ title: "Delete room?", message: "This cannot be undone.", danger: true });

import { DialogBase } from "./DialogBase.js";

export interface ConfirmOpts {
  title: string;
  message: string;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** When true the confirm button gets the "danger" class. */
  danger?: boolean;
}

export class ConfirmDialog extends DialogBase {
  private _resolve: ((v: boolean) => void) | null = null;
  private _settled = false;

  constructor() {
    super({ prefix: "confirm-dialog", ariaLabel: "Confirm" });
  }

  /**
   * Show the dialog with the given options and return a Promise that resolves to
   * `true` if the user confirms, or `false` if they cancel (via the cancel
   * button, Esc, or the backdrop).
   */
  confirm(opts: ConfirmOpts): Promise<boolean> {
    // Settle any pending promise from a previous call before overwriting _resolve.
    if (this._resolve && !this._settled) this._settle(false);
    this._settled = false;
    this._rebuild(opts);

    const p = new Promise<boolean>((res) => {
      this._resolve = res;
    });
    this.reveal();
    return p;
  }

  private _rebuild(opts: ConfirmOpts): void {
    // Clear everything and rebuild header fresh for the new title.
    this.content.innerHTML = "";
    this.header = null;
    this.titleEl = null;

    this.buildHeader(opts.title);

    const body = document.createElement("div");
    body.className = "confirm-dialog__body";

    const msg = document.createElement("p");
    msg.className = "confirm-dialog__message";
    msg.textContent = opts.message;
    body.appendChild(msg);

    const actions = document.createElement("div");
    actions.className = "confirm-dialog__actions";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.dataset.act = "confirm";
    confirmBtn.textContent = opts.confirmLabel ?? "Confirm";
    if (opts.danger) confirmBtn.classList.add("danger");
    confirmBtn.addEventListener("click", () => this._settle(true));
    actions.appendChild(confirmBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.dataset.act = "cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this._settle(false));
    actions.appendChild(cancelBtn);

    body.appendChild(actions);
    this.content.appendChild(body);
  }

  private _settle(value: boolean): void {
    if (this._settled) return;
    this._settled = true;
    this._resolve?.(value);
    this.hide();
  }

  protected override onHide(): void {
    // Dismissed without an explicit choice (Esc, backdrop click, close button).
    if (!this._settled) {
      this._settled = true;
      this._resolve?.(false);
    }
  }

  protected override focusTarget(): HTMLElement {
    const btn = this.content.querySelector<HTMLButtonElement>("[data-act='confirm']");
    return btn ?? this.content;
  }
}
