// Create-room dialog — a new room or space, optionally inside a space.
//
//   kind      (•) room  ( ) space
//   name      [general            ]
//   topic     [                   ]
//   address   #[general]:example.org
//   in space  [Work            ▾]
//   access    [members of Work ▾]
//   [x] end-to-end encryption
//   invite    [@alice:example.org  ]
//                         [cancel] [create]
//
// The defaults are the safe ones: private, encrypted, and — when a space is
// open — in that space and joinable by its members, which is what "add a room
// to this space" means to most people. Shares the settings dialogs' form rows.

import { DialogBase } from "./DialogBase.js";

export type CreateKind = "room" | "space";
export type CreateAccess = "private" | "space" | "public";

export interface CreateRoomRequest {
  kind: CreateKind;
  name: string;
  topic: string;
  /** Localpart only; empty for none. */
  alias: string;
  access: CreateAccess;
  parentSpaceId: string | null;
  encrypted: boolean;
  invite: string[];
}

export interface CreateRoomShowOptions {
  kind?: CreateKind;
  name?: string;
  /** Preselected parent space; null for none. */
  parentSpaceId?: string | null;
  /** Spaces the new room can be created in. */
  spaces: Array<{ id: string; name: string }>;
  /** The account's server name, shown after the address field. */
  serverName: string;
}

const USER_ID = /^@[^:\s]+:[^\s]+$/;

/** Split an invite field into user IDs, reporting any entry that isn't one. */
export function parseInviteList(text: string): { ids: string[]; invalid: string[] } {
  const parts = text.split(/[\s,]+/).map((p) => p.trim()).filter(Boolean);
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (USER_ID.test(p)) {
      if (!ids.includes(p)) ids.push(p);
    } else {
      invalid.push(p);
    }
  }
  return { ids, invalid };
}

/** The address localpart typed as `dev`, `#dev` or `#dev:server`. */
export function aliasLocalpart(text: string): string {
  const t = text.trim().replace(/^#/, "");
  const colon = t.indexOf(":");
  return colon >= 0 ? t.slice(0, colon) : t;
}

/** Suggest an address from a room name: lowercase, dashes for spaces. */
export function suggestAlias(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._=\-/]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export class CreateRoomDialog extends DialogBase {
  private _body: HTMLElement;
  private _errorEl: HTMLElement;
  private _createBtn: HTMLButtonElement;
  private _onCreate: ((req: CreateRoomRequest) => Promise<boolean>) | null = null;
  private _busy = false;

  // Form state
  private _kind: CreateKind = "room";
  private _spaces: Array<{ id: string; name: string }> = [];
  private _serverName = "";
  private _nameInput!: HTMLInputElement;
  private _topicInput!: HTMLInputElement;
  private _aliasInput!: HTMLInputElement;
  private _aliasTouched = false;
  private _parentSelect!: HTMLSelectElement;
  private _accessSelect!: HTMLSelectElement;
  private _encryptRow!: HTMLElement;
  private _encryptBox!: HTMLInputElement;
  private _encryptTouched = false;
  private _inviteInput!: HTMLInputElement;

  constructor() {
    super({ prefix: "settings-dialog", ariaLabel: "Create a room" });
    this.root.classList.add("create-room-dialog");
    this.buildHeader("── new room ──", "Close");

    this._body = document.createElement("div");
    this._body.className = "settings-dialog__content create-room-dialog__body";
    this.content.appendChild(this._body);

    this._errorEl = document.createElement("div");
    this._errorEl.className = "create-room-dialog__error";
    this._errorEl.setAttribute("role", "alert");
    this.content.appendChild(this._errorEl);

    const actions = document.createElement("div");
    actions.className = "settings-dialog__actions create-room-dialog__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "settings-dialog__btn";
    cancel.textContent = "[cancel]";
    cancel.addEventListener("click", () => this.hide());
    this._createBtn = document.createElement("button");
    this._createBtn.type = "button";
    this._createBtn.className = "settings-dialog__btn create-room-dialog__create";
    this._createBtn.textContent = "[create]";
    this._createBtn.addEventListener("click", () => void this._submit());
    actions.append(cancel, this._createBtn);
    this.content.appendChild(actions);
  }

  /** Called with the filled-in form; resolve true when the room was created. */
  onCreate(handler: (req: CreateRoomRequest) => Promise<boolean>): void {
    this._onCreate = handler;
  }

  show(opts: CreateRoomShowOptions): void {
    this._kind = opts.kind ?? "room";
    this._spaces = opts.spaces;
    this._serverName = opts.serverName;
    this._aliasTouched = false;
    this._encryptTouched = false;
    this._busy = false;
    this._setError("");
    this._build(opts.name ?? "", opts.parentSpaceId ?? null);
    this.reveal();
  }

  protected override focusTarget(): HTMLElement {
    return this._nameInput;
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  private _build(name: string, parentSpaceId: string | null): void {
    this._body.innerHTML = "";
    this._updateTitle();

    // Kind
    const kindRow = document.createElement("div");
    kindRow.className = "settings-dialog__row";
    const kindLabel = document.createElement("span");
    kindLabel.className = "settings-dialog__label";
    kindLabel.textContent = "kind";
    kindRow.appendChild(kindLabel);
    const kindGroup = document.createElement("div");
    kindGroup.className = "create-room-dialog__kinds";
    kindGroup.setAttribute("role", "radiogroup");
    kindGroup.setAttribute("aria-label", "Kind");
    for (const kind of ["room", "space"] as const) {
      const label = document.createElement("label");
      label.className = "settings-dialog__checkbox-label";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "create-room-kind";
      radio.value = kind;
      radio.checked = this._kind === kind;
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        this._kind = kind;
        this._updateTitle();
        this._syncDependentFields();
      });
      label.append(radio, ` ${kind}`);
      kindGroup.appendChild(label);
    }
    kindRow.appendChild(kindGroup);
    this._body.appendChild(kindRow);

    // Name / topic
    const nameRow = this.makeTextRow("name", name, "required", () => this._syncAlias());
    this._nameInput = nameRow.input;
    this._nameInput.setAttribute("aria-label", "Name");
    this._nameInput.required = true;
    this._body.appendChild(nameRow.row);

    const topicRow = this.makeTextRow("topic", "", "optional", () => {});
    this._topicInput = topicRow.input;
    this._topicInput.setAttribute("aria-label", "Topic");
    this._body.appendChild(topicRow.row);

    // Address
    const aliasRow = document.createElement("div");
    aliasRow.className = "settings-dialog__row";
    const aliasLabel = document.createElement("span");
    aliasLabel.className = "settings-dialog__label";
    aliasLabel.textContent = "address";
    const aliasWrap = document.createElement("span");
    aliasWrap.className = "create-room-dialog__alias";
    const hash = document.createElement("span");
    hash.className = "create-room-dialog__affix";
    hash.textContent = "#";
    this._aliasInput = document.createElement("input");
    this._aliasInput.type = "text";
    this._aliasInput.className = "settings-dialog__text-input create-room-dialog__alias-input";
    this._aliasInput.placeholder = "optional";
    this._aliasInput.setAttribute("aria-label", "Address");
    this._aliasInput.addEventListener("input", () => {
      this._aliasTouched = this._aliasInput.value.trim() !== "";
    });
    const server = document.createElement("span");
    server.className = "create-room-dialog__affix";
    server.textContent = this._serverName ? `:${this._serverName}` : "";
    aliasWrap.append(hash, this._aliasInput, server);
    aliasRow.append(aliasLabel, aliasWrap);
    this._body.appendChild(aliasRow);

    // Parent space
    const parentRow = document.createElement("div");
    parentRow.className = "settings-dialog__row";
    const parentLabel = document.createElement("span");
    parentLabel.className = "settings-dialog__label";
    parentLabel.textContent = "in space";
    this._parentSelect = document.createElement("select");
    this._parentSelect.className = "settings-dialog__select";
    this._parentSelect.setAttribute("aria-label", "Create in space");
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— none —";
    this._parentSelect.appendChild(none);
    for (const space of this._spaces) {
      const opt = document.createElement("option");
      opt.value = space.id;
      opt.textContent = space.name;
      this._parentSelect.appendChild(opt);
    }
    this._parentSelect.value = parentSpaceId && this._spaces.some((s) => s.id === parentSpaceId) ? parentSpaceId : "";
    this._parentSelect.addEventListener("change", () => this._syncDependentFields());
    parentRow.append(parentLabel, this._parentSelect);
    this._body.appendChild(parentRow);

    // Access
    const accessRow = document.createElement("div");
    accessRow.className = "settings-dialog__row";
    const accessLabel = document.createElement("span");
    accessLabel.className = "settings-dialog__label";
    accessLabel.textContent = "access";
    this._accessSelect = document.createElement("select");
    this._accessSelect.className = "settings-dialog__select";
    this._accessSelect.setAttribute("aria-label", "Who can join");
    this._accessSelect.addEventListener("change", () => this._syncEncryptionDefault());
    accessRow.append(accessLabel, this._accessSelect);
    this._body.appendChild(accessRow);

    // Encryption
    this._encryptRow = this.makeCheckbox("end-to-end encryption", true, () => {
      this._encryptTouched = true;
    });
    this._encryptBox = this._encryptRow.querySelector("input")!;
    this._body.appendChild(this._encryptRow);

    // Invites
    const inviteRow = this.makeTextRow("invite", "", "@user:server, …", () => {});
    this._inviteInput = inviteRow.input;
    this._inviteInput.setAttribute("aria-label", "Invite users");
    this._body.appendChild(inviteRow.row);

    // Enter in any text field submits; keys typed into fields stay there.
    for (const input of [this._nameInput, this._topicInput, this._aliasInput, this._inviteInput]) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void this._submit();
        }
      });
    }

    this._syncDependentFields(parentSpaceId ? "space" : "private");
  }

  private _updateTitle(): void {
    if (this.titleEl) this.titleEl.textContent = this._kind === "space" ? "── new space ──" : "── new room ──";
    this.root.setAttribute("aria-label", this._kind === "space" ? "Create a space" : "Create a room");
    this._createBtn.textContent = this._kind === "space" ? "[create space]" : "[create room]";
  }

  /** Access options depend on whether there's a parent; encryption on kind. */
  private _syncDependentFields(preferred?: CreateAccess): void {
    const parentId = this._parentSelect.value;
    const parentName = this._spaces.find((s) => s.id === parentId)?.name;
    const previous = (preferred ?? this._accessSelect.value) as CreateAccess;

    const options: Array<[CreateAccess, string]> = [["private", "private — invite only"]];
    if (parentId) options.push(["space", `members of ${parentName ?? "the space"}`]);
    options.push(["public", "public — anyone can join"]);

    this._accessSelect.innerHTML = "";
    for (const [value, label] of options) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      this._accessSelect.appendChild(opt);
    }
    this._accessSelect.value = options.some(([v]) => v === previous) ? previous : "private";

    // A space holds no messages, so there is nothing to encrypt.
    this._encryptRow.style.display = this._kind === "space" ? "none" : "";
    this._syncEncryptionDefault();
  }

  /** Public rooms default to unencrypted, private ones to encrypted — until the user chooses. */
  private _syncEncryptionDefault(): void {
    if (this._encryptTouched) return;
    this._encryptBox.checked = this._accessSelect.value !== "public";
  }

  /** Suggest an address from the name, as a placeholder only. */
  private _syncAlias(): void {
    if (this._aliasTouched) return;
    this._aliasInput.placeholder = suggestAlias(this._nameInput.value) || "optional";
  }

  private _setError(msg: string): void {
    this._errorEl.textContent = msg;
    this._errorEl.style.display = msg ? "" : "none";
  }

  private async _submit(): Promise<void> {
    if (this._busy || !this._onCreate) return;
    const name = this._nameInput.value.trim();
    if (!name) {
      this._setError("A name is required.");
      this._nameInput.focus();
      return;
    }
    const { ids, invalid } = parseInviteList(this._inviteInput.value);
    if (invalid.length > 0) {
      this._setError(`Not a user ID: ${invalid.join(", ")} — use @user:server`);
      this._inviteInput.focus();
      return;
    }
    const access = this._accessSelect.value as CreateAccess;
    // A public room with no address can only be joined by its room ID, so it
    // takes the suggested one; a private room needs none.
    const alias = aliasLocalpart(this._aliasInput.value) || (access === "public" ? suggestAlias(name) : "");
    if (/[\s#:]/.test(alias)) {
      this._setError("An address can't contain spaces, # or :");
      this._aliasInput.focus();
      return;
    }

    const req: CreateRoomRequest = {
      kind: this._kind,
      name,
      topic: this._topicInput.value.trim(),
      alias,
      access,
      parentSpaceId: this._parentSelect.value || null,
      encrypted: this._kind === "room" && this._encryptBox.checked,
      invite: ids,
    };

    this._setError("");
    this._busy = true;
    this._createBtn.disabled = true;
    const label = this._createBtn.textContent;
    this._createBtn.textContent = "[creating…]";
    let ok = false;
    try {
      ok = await this._onCreate(req);
    } catch (err) {
      this._setError(err instanceof Error ? err.message : String(err));
    }
    this._busy = false;
    this._createBtn.disabled = false;
    this._createBtn.textContent = label;
    if (ok) this.hide();
  }

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (this.isEscape(e)) {
      e.preventDefault();
      this.hide();
      return;
    }
    // Typing goes to the form; only Escape is the dialog's.
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "BUTTON") return;
    this.routeKey(e);
  }
}
