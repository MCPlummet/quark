// Profile dialog — shows the current user's own profile

import { isAnimatedUrl } from "../app/animated_urls.js";
import { DialogBase } from "./DialogBase.js";
import { ColorField } from "./ColorField.js";

/** Another user's color, for the local-override row (#45). */
export interface ProfileColorData {
  /** What they published: a color, `null` for none, `undefined` if unknown. */
  published: string | null | undefined;
  /** This device's override, if any. */
  local: string | null;
  /** Set (or, with `null`, clear) the override. */
  onSetLocal: (hex: string | null) => Promise<void>;
}

export interface ProfileData {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Presence status message, if known. */
  statusMessage?: string | null;
  /** If provided, a [message] button is shown that calls this when clicked. */
  onMessage?: () => void;
  /** If provided, an [edit profile] button is shown — typically only set
   *  when the profile being shown is the current user's. */
  onEdit?: () => void;
  /** If provided, a local color override row is shown (other users only). */
  color?: ProfileColorData;
}

/**
 * Modal overlay showing the current user's profile.
 * Opened via :profile command or P keybind; closed with Escape.
 */
export class ProfileDialog extends DialogBase {
  private _avatarEl: HTMLElement;
  private _displayNameEl: HTMLElement;
  private _userIdEl: HTMLElement;
  private _homeserverEl: HTMLElement;
  private _statusMsgEl: HTMLElement;
  private _statusMsgRow: HTMLElement;
  private _copyBtn: HTMLButtonElement;
  private _dmBtn: HTMLButtonElement;
  private _editBtn: HTMLButtonElement;
  private _actionsEl: HTMLElement;
  private _colorRow: HTMLElement;
  private _publishedColorEl: HTMLElement;
  private _colorField: ColorField;
  private _onSetLocal: ((hex: string | null) => Promise<void>) | null = null;

  constructor() {
    // Profile dialog's root is the box itself, and historically did NOT reset
    // the key sequence on hide.
    super({
      prefix: "profile-dialog",
      ariaLabel: "Your profile",
      panel: false,
      resetSequenceOnHide: false,
    });

    // ── Header ────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "profile-dialog__header";

    const title = document.createElement("span");
    title.className = "profile-dialog__title";
    title.textContent = "── profile ──";
    header.appendChild(title);

    header.appendChild(this.makeCloseButton("Close profile"));
    this.root.appendChild(header);

    // ── Avatar ────────────────────────────────────────────────────────────
    this._avatarEl = document.createElement("div");
    this._avatarEl.className = "profile-dialog__avatar";
    this.root.appendChild(this._avatarEl);

    // ── Info rows ─────────────────────────────────────────────────────────
    const info = document.createElement("div");
    info.className = "profile-dialog__info";

    const nameRow = document.createElement("div");
    nameRow.className = "profile-dialog__row";
    const nameLabel = document.createElement("span");
    nameLabel.className = "profile-dialog__label";
    nameLabel.textContent = "display name";
    this._displayNameEl = document.createElement("span");
    this._displayNameEl.className = "profile-dialog__value";
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(this._displayNameEl);
    info.appendChild(nameRow);

    const idRow = document.createElement("div");
    idRow.className = "profile-dialog__row";
    const idLabel = document.createElement("span");
    idLabel.className = "profile-dialog__label";
    idLabel.textContent = "user id";
    this._userIdEl = document.createElement("span");
    this._userIdEl.className = "profile-dialog__value profile-dialog__value--muted";
    this._copyBtn = document.createElement("button");
    this._copyBtn.type = "button";
    this._copyBtn.className = "profile-dialog__copy-btn";
    this._copyBtn.textContent = "[copy]";
    this._copyBtn.setAttribute("aria-label", "Copy user ID");
    this._copyBtn.setAttribute("tabindex", "-1");
    this._copyBtn.addEventListener("click", () => {
      const userId = this._userIdEl.textContent ?? "";
      navigator.clipboard.writeText(userId).then(() => {
        this._copyBtn.textContent = "[copied!]";
        setTimeout(() => {
          this._copyBtn.textContent = "[copy]";
        }, 1500);
      });
    });
    idRow.appendChild(idLabel);
    idRow.appendChild(this._userIdEl);
    idRow.appendChild(this._copyBtn);
    info.appendChild(idRow);

    const hsRow = document.createElement("div");
    hsRow.className = "profile-dialog__row";
    const hsLabel = document.createElement("span");
    hsLabel.className = "profile-dialog__label";
    hsLabel.textContent = "homeserver";
    this._homeserverEl = document.createElement("span");
    this._homeserverEl.className = "profile-dialog__value profile-dialog__value--muted";
    hsRow.appendChild(hsLabel);
    hsRow.appendChild(this._homeserverEl);
    info.appendChild(hsRow);

    this._statusMsgRow = document.createElement("div");
    this._statusMsgRow.className = "profile-dialog__row";
    const statusLabel = document.createElement("span");
    statusLabel.className = "profile-dialog__label";
    statusLabel.textContent = "status";
    this._statusMsgEl = document.createElement("span");
    this._statusMsgEl.className = "profile-dialog__value profile-dialog__value--status";
    this._statusMsgRow.appendChild(statusLabel);
    this._statusMsgRow.appendChild(this._statusMsgEl);
    this._statusMsgRow.style.display = "none";
    info.appendChild(this._statusMsgRow);

    // Local color override (#45): this device only, beats what they publish.
    // Applies as soon as a color is committed — the dialog has no [save].
    this._colorRow = document.createElement("div");
    this._colorRow.className = "profile-dialog__row profile-dialog__color-row";
    const colorLabel = document.createElement("span");
    colorLabel.className = "profile-dialog__label";
    colorLabel.textContent = "local color";
    const colorBody = document.createElement("div");
    colorBody.className = "profile-dialog__value";
    this._publishedColorEl = document.createElement("div");
    this._publishedColorEl.className = "profile-dialog__published-color";
    this._colorField = new ColorField({
      previewText: "",
      onCommit: (hex) => void this._onSetLocal?.(hex),
    });
    colorBody.appendChild(this._publishedColorEl);
    colorBody.appendChild(this._colorField.getElement());
    this._colorRow.appendChild(colorLabel);
    this._colorRow.appendChild(colorBody);
    this._colorRow.style.display = "none";
    info.appendChild(this._colorRow);

    this.root.appendChild(info);

    // ── Actions ───────────────────────────────────────────────────────────
    this._actionsEl = document.createElement("div");
    this._actionsEl.className = "profile-dialog__actions";

    this._dmBtn = document.createElement("button");
    this._dmBtn.type = "button";
    this._dmBtn.className = "profile-dialog__dm-btn";
    this._dmBtn.textContent = "[message]";
    this._dmBtn.setAttribute("aria-label", "Open direct message");
    this._dmBtn.setAttribute("tabindex", "-1");
    this._actionsEl.appendChild(this._dmBtn);

    // [edit profile] — only shown when caller provides `onEdit`, typically
    // for the user's own profile. Reusing the same actions row keeps the
    // dialog's geometry stable whether it's a self-view or other-view.
    this._editBtn = document.createElement("button");
    this._editBtn.type = "button";
    this._editBtn.className = "profile-dialog__dm-btn";
    this._editBtn.textContent = "[edit profile]";
    this._editBtn.setAttribute("aria-label", "Edit profile");
    this._editBtn.setAttribute("tabindex", "-1");
    this._actionsEl.appendChild(this._editBtn);

    this._actionsEl.style.display = "none";
    this.root.appendChild(this._actionsEl);

    // ── Hint ──────────────────────────────────────────────────────────────
    const hint = document.createElement("div");
    hint.className = "profile-dialog__hint";
    hint.textContent = "Esc: close";
    this.root.appendChild(hint);
  }

  show(data: ProfileData): void {
    this._displayNameEl.textContent = data.displayName ?? "(not set)";
    this._userIdEl.textContent = data.userId;
    const colonIdx = data.userId.indexOf(":");
    this._homeserverEl.textContent = colonIdx !== -1 ? data.userId.slice(colonIdx + 1) : data.userId;

    if (data.statusMessage) {
      this._statusMsgEl.textContent = data.statusMessage;
      this._statusMsgRow.style.display = "";
    } else {
      this._statusMsgRow.style.display = "none";
    }

    // Wire up DM button — replace existing listener by cloning the node.
    if (data.onMessage) {
      const handler = data.onMessage;
      const newBtn = this._dmBtn.cloneNode(true) as HTMLButtonElement;
      this._dmBtn.replaceWith(newBtn);
      this._dmBtn = newBtn;
      this._dmBtn.style.display = "";
      this._dmBtn.addEventListener("click", () => {
        this.hide();
        handler();
      });
    } else {
      this._dmBtn.style.display = "none";
    }

    // Wire up edit button. Same clone trick to drop the previous handler.
    if (data.onEdit) {
      const handler = data.onEdit;
      const newEdit = this._editBtn.cloneNode(true) as HTMLButtonElement;
      this._editBtn.replaceWith(newEdit);
      this._editBtn = newEdit;
      this._editBtn.style.display = "";
      this._editBtn.addEventListener("click", () => {
        this.hide();
        handler();
      });
    } else {
      this._editBtn.style.display = "none";
    }

    if (data.color) {
      const { published, local, onSetLocal } = data.color;
      this._onSetLocal = onSetLocal;
      this._publishedColorEl.textContent =
        `their color: ${published === undefined ? "unknown" : published ?? "none"}`;
      this._colorField.value = local;
      this._colorField.setPreviewText(data.displayName ?? data.userId);
      this._colorRow.style.display = "";
    } else {
      this._onSetLocal = null;
      this._colorRow.style.display = "none";
    }

    // Show the action row if either button is in use.
    this._actionsEl.style.display = data.onMessage || data.onEdit ? "" : "none";

    if (data.avatarUrl) {
      this._avatarEl.innerHTML = "";
      const img = document.createElement("img");
      img.src = data.avatarUrl;
      img.alt = data.displayName ?? data.userId;
      img.className = "profile-dialog__avatar-img";
      if (isAnimatedUrl(data.avatarUrl)) img.dataset.gif = "1";
      this._avatarEl.appendChild(img);
    } else {
      // Fallback: colored initial square
      const initial = (data.displayName ?? data.userId)[data.displayName ? 0 : 1]?.toUpperCase() ?? "?";
      this._avatarEl.textContent = initial;
      this._avatarEl.className = "profile-dialog__avatar profile-dialog__avatar--fallback";
    }

    this.reveal();
  }

  // While typing a color, keys are text, not dialog shortcuts — only Escape
  // still closes.
  protected override handleKeydown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) {
      e.stopPropagation();
      if (this.isEscape(e)) {
        e.preventDefault();
        this.hide();
      }
      return;
    }
    super.handleKeydown(e);
  }
}
