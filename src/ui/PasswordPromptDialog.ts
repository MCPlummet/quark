// Reusable password prompt dialog.
//
// Usage:
//   const dialog = new PasswordPromptDialog();
//   document.body.appendChild(dialog.getElement());
//   const password = await dialog.prompt({ title: "Re-enter password" });
//   if (password === null) { /* user cancelled */ }

import { DialogBase } from "./DialogBase.js";

export interface PasswordPromptOpts {
  title: string;
  /** Optional message shown below the title. */
  message?: string;
}

export class PasswordPromptDialog extends DialogBase {
  private _resolve: ((v: string | null) => void) | null = null;
  private _settled = false;

  /** The password input — kept as a field for focusTarget() access. */
  private _inputEl: HTMLInputElement | null = null;

  constructor() {
    super({ prefix: "password-prompt-dialog", ariaLabel: "Password" });
  }

  /**
   * Show the dialog and return a Promise that resolves to the entered string on
   * submit, or `null` if the user cancels (cancel button, Esc, backdrop).
   */
  prompt(opts: PasswordPromptOpts): Promise<string | null> {
    // Settle any pending promise from a previous call before overwriting _resolve.
    if (this._resolve && !this._settled) this._settle(null);
    this._settled = false;
    this._rebuild(opts);

    const p = new Promise<string | null>((res) => {
      this._resolve = res;
    });
    this.reveal();
    return p;
  }

  private _rebuild(opts: PasswordPromptOpts): void {
    this.content.innerHTML = "";
    this.header = null;
    this.titleEl = null;
    this._inputEl = null;

    this.buildHeader(opts.title);

    const body = document.createElement("div");
    body.className = "password-prompt-dialog__body";

    if (opts.message) {
      const msg = document.createElement("p");
      msg.className = "password-prompt-dialog__message";
      msg.textContent = opts.message;
      body.appendChild(msg);
    }

    const input = document.createElement("input");
    input.type = "password";
    input.className = "password-prompt-dialog__input";
    input.value = "";
    // Enter in the input submits.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this._settle(input.value);
      }
    });
    body.appendChild(input);
    this._inputEl = input;

    const actions = document.createElement("div");
    actions.className = "password-prompt-dialog__actions";

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.dataset.act = "submit";
    submitBtn.textContent = "Submit";
    submitBtn.addEventListener("click", () => this._settle(input.value));
    actions.appendChild(submitBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.dataset.act = "cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this._settle(null));
    actions.appendChild(cancelBtn);

    body.appendChild(actions);
    this.content.appendChild(body);
  }

  private _settle(value: string | null): void {
    if (this._settled) return;
    this._settled = true;
    this._resolve?.(value);
    this.hide();
  }

  protected override onHide(): void {
    // Dismissed without an explicit choice (Esc, backdrop click, close button).
    if (!this._settled) {
      this._settled = true;
      this._resolve?.(null);
    }
  }

  protected override focusTarget(): HTMLElement {
    return this._inputEl ?? this.content;
  }
}
