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

  /** Body section rebuilt on every confirm() call. */
  private _body: HTMLElement | null = null;

  constructor() {
    super({ prefix: "confirm-dialog", ariaLabel: "Confirm" });
  }

  /**
   * Show the dialog with the given options and return a Promise that resolves to
   * `true` if the user confirms, or `false` if they cancel (via the cancel
   * button, Esc, or the backdrop).
   */
  confirm(opts: ConfirmOpts): Promise<boolean> {
    this._rebuild(opts);
    this._settled = false;

    const p = new Promise<boolean>((res) => {
      this._resolve = res;
    });
    this.reveal();
    return p;
  }

  private _rebuild(opts: ConfirmOpts): void {
    // Remove previous body if any; keep header out of it (header is rebuilt too).
    if (this._body) this._body.remove();
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
    this._body = body;
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
