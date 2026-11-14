// Profile edit dialog — lets the current user change their display name,
// presence status, and avatar (via the shared pickAndUploadAvatar pipeline,
// passed in as a callback so this stays a pure UI component).

import { keymapManager } from "../vim/keybindings.js";
import { DialogBase } from "./DialogBase.js";
import { ColorField } from "./ColorField.js";

/** Why the color row is disabled, when the homeserver says it can't be set. */
const COLOR_UNSUPPORTED = "Your homeserver doesn't support custom profile fields.";

export interface ProfileEditInitial {
  /** Read-only display of the user's MXID for context. */
  userId: string;
  /** Current display name; null when unset. */
  displayName: string | null;
  /** Current status (presence status_msg); null when unset. */
  statusMessage: string | null;
  /** Published color (`tel.quark.usercolor`); null when unset. */
  userColor: string | null;
  /** Whether the homeserver lets it be set; null when it doesn't say. */
  userColorSettable: boolean | null;
}

export interface ProfileEditSubmit {
  /** Trimmed display name; an empty string clears it. */
  displayName: string;
  /** Trimmed status message; an empty string clears it. */
  statusMessage: string;
  /** True if the display name was changed from initial. */
  displayNameChanged: boolean;
  /** True if the status message was changed from initial. */
  statusChanged: boolean;
  /** The chosen color (normalized), or null to clear it. */
  userColor: string | null;
  /** True if the color was changed from initial. */
  userColorChanged: boolean;
}

export class ProfileEditDialog extends DialogBase {
  private _userIdEl: HTMLElement;
  private _displayNameInput: HTMLInputElement;
  private _statusInput: HTMLInputElement;
  private _colorField: ColorField;
  private _saveBtn: HTMLButtonElement;
  private _avatarBtn: HTMLButtonElement;
  private _statusEl: HTMLElement;
  private _onSubmit: ((data: ProfileEditSubmit) => Promise<void> | void) | null = null;
  private _onChangeAvatar: (() => void) | null = null;
  private _initial: ProfileEditInitial | null = null;

  constructor() {
    // Original did not reset the key sequence on hide; it cleared its
    // submit/initial state instead.
    super({ prefix: "profile-edit-dialog", ariaLabel: "Edit profile", resetSequenceOnHide: false });

    this.buildHeader("── edit profile ──", "Close");

    // User ID context line — read-only display so the user knows which
    // account they're editing if they're juggling multiple homeservers.
    const ctxRow = document.createElement("div");
    ctxRow.className = "profile-edit-dialog__row profile-edit-dialog__row--readonly";
    const ctxLabel = document.createElement("span");
    ctxLabel.className = "profile-edit-dialog__label";
    ctxLabel.textContent = "user";
    this._userIdEl = document.createElement("span");
    this._userIdEl.className = "profile-edit-dialog__value";
    ctxRow.appendChild(ctxLabel);
    ctxRow.appendChild(this._userIdEl);
    this.content.appendChild(ctxRow);

    // Display name input
    const nameRow = document.createElement("div");
    nameRow.className = "profile-edit-dialog__row";
    const nameLabel = document.createElement("label");
    nameLabel.className = "profile-edit-dialog__label";
    nameLabel.textContent = "display name";
    this._displayNameInput = document.createElement("input");
    this._displayNameInput.type = "text";
    this._displayNameInput.className = "profile-edit-dialog__input";
    this._displayNameInput.setAttribute("autocomplete", "off");
    this._displayNameInput.setAttribute("autocapitalize", "words");
    this._displayNameInput.setAttribute("spellcheck", "false");
    this._displayNameInput.maxLength = 256;
    nameLabel.appendChild(this._displayNameInput);
    nameRow.appendChild(nameLabel);
    this.content.appendChild(nameRow);

    // Status message input
    const statusRow = document.createElement("div");
    statusRow.className = "profile-edit-dialog__row";
    const statusLabel = document.createElement("label");
    statusLabel.className = "profile-edit-dialog__label";
    statusLabel.textContent = "status";
    this._statusInput = document.createElement("input");
    this._statusInput.type = "text";
    this._statusInput.className = "profile-edit-dialog__input";
    this._statusInput.setAttribute("autocomplete", "off");
    this._statusInput.setAttribute("spellcheck", "true");
    this._statusInput.placeholder = "What's up? (blank to clear)";
    this._statusInput.maxLength = 256;
    statusLabel.appendChild(this._statusInput);
    statusRow.appendChild(statusLabel);
    this.content.appendChild(statusRow);

    // Color (#45) — published as tel.quark.usercolor. Not a <label>: the field
    // holds several controls. Saved with the rest on [save].
    const colorRow = document.createElement("div");
    colorRow.className = "profile-edit-dialog__row";
    const colorLabel = document.createElement("div");
    colorLabel.className = "profile-edit-dialog__label";
    colorLabel.textContent = "color";
    this._colorField = new ColorField({ previewText: "" });
    colorLabel.appendChild(this._colorField.getElement());
    colorRow.appendChild(colorLabel);
    this.content.appendChild(colorRow);
    this._displayNameInput.addEventListener("input", () => this._syncColorPreview());

    // Avatar row — delegates to the shared picker/upload pipeline; hidden
    // when no handler was supplied.
    const avatarRow = document.createElement("div");
    avatarRow.className = "profile-edit-dialog__row";
    this._avatarBtn = document.createElement("button");
    this._avatarBtn.type = "button";
    this._avatarBtn.className = "profile-edit-dialog__btn";
    this._avatarBtn.textContent = "[change avatar]";
    this._avatarBtn.addEventListener("click", () => this._onChangeAvatar?.());
    avatarRow.appendChild(this._avatarBtn);
    this.content.appendChild(avatarRow);

    // Status / error line
    this._statusEl = document.createElement("div");
    this._statusEl.className = "profile-edit-dialog__status";
    this.content.appendChild(this._statusEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "profile-edit-dialog__footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "profile-edit-dialog__btn";
    cancelBtn.textContent = "[cancel]";
    cancelBtn.addEventListener("click", () => this.hide());
    footer.appendChild(cancelBtn);

    this._saveBtn = document.createElement("button");
    this._saveBtn.type = "button";
    this._saveBtn.className = "profile-edit-dialog__btn profile-edit-dialog__btn--primary";
    this._saveBtn.textContent = "[ save ]";
    this._saveBtn.addEventListener("click", () => void this._submit());
    footer.appendChild(this._saveBtn);

    this.content.appendChild(footer);
  }

  show(
    initial: ProfileEditInitial,
    onSubmit: (data: ProfileEditSubmit) => Promise<void> | void,
    onChangeAvatar?: () => void,
  ): void {
    this._initial = initial;
    this._onSubmit = onSubmit;
    this._onChangeAvatar = onChangeAvatar ?? null;
    this._avatarBtn.parentElement!.style.display = onChangeAvatar ? "" : "none";
    this._userIdEl.textContent = initial.userId;
    this._displayNameInput.value = initial.displayName ?? "";
    this._statusInput.value = initial.statusMessage ?? "";
    this._colorField.value = initial.userColor;
    this._colorField.setDisabled(initial.userColorSettable === false, COLOR_UNSUPPORTED);
    this._syncColorPreview();
    this._setStatus("", "neutral");
    this._setSaving(false);
    this.reveal();
  }

  // Focus the display-name field after layout settles.
  protected override focusTarget(): HTMLElement {
    requestAnimationFrame(() => this._displayNameInput.focus());
    return this.content;
  }

  protected override onHide(): void {
    this._initial = null;
    this._onSubmit = null;
    this._onChangeAvatar = null;
  }

  // Adds Enter-to-submit on top of the standard Escape close; only consumes
  // partial vim sequences while typing (does not route a close action).
  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (this.isEscape(e)) {
      e.preventDefault();
      this.hide();
      return;
    }
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
      // A focused button — a swatch, [ clear ], [ cancel ] — activates on
      // Enter by itself; submitting instead would skip what it does.
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      void this._submit();
      return;
    }
    // Block global vim shortcuts while typing in inputs.
    const result = keymapManager.resolveKey(e.key, "picker");
    if (result.kind === "partial") e.preventDefault();
  }

  private async _submit(): Promise<void> {
    if (!this._initial || !this._onSubmit) return;
    this._colorField.commitPending();
    if (this._colorField.hasInvalidInput) {
      this._setStatus("That isn't a color — use #rrggbb.", "error");
      return;
    }
    const displayName = this._displayNameInput.value.trim();
    const statusMessage = this._statusInput.value.trim();
    const displayNameChanged = displayName !== (this._initial.displayName ?? "");
    const statusChanged = statusMessage !== (this._initial.statusMessage ?? "");
    const userColor = this._colorField.value;
    const userColorChanged = userColor !== this._initial.userColor;

    if (!displayNameChanged && !statusChanged && !userColorChanged) {
      this._setStatus("Nothing changed.", "neutral");
      return;
    }

    this._setSaving(true);
    this._setStatus("Saving…", "neutral");
    try {
      await this._onSubmit({
        displayName, statusMessage, displayNameChanged, statusChanged, userColor, userColorChanged,
      });
      this._setStatus("Saved.", "success");
      // Briefly show success before dismissing, so the user gets feedback.
      setTimeout(() => this.hide(), 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._setStatus(`Failed: ${msg}`, "error");
      this._setSaving(false);
    }
  }

  /** The preview shows the name being typed, or the user ID when it's blank. */
  private _syncColorPreview(): void {
    this._colorField.setPreviewText(this._displayNameInput.value.trim() || this._initial?.userId || "");
  }

  private _setSaving(saving: boolean): void {
    this._saveBtn.disabled = saving;
    this._saveBtn.textContent = saving ? "[ saving… ]" : "[ save ]";
  }

  private _setStatus(text: string, kind: "neutral" | "success" | "error"): void {
    this._statusEl.textContent = text;
    this._statusEl.className = `profile-edit-dialog__status profile-edit-dialog__status--${kind}`;
  }
}
