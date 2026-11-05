// The status line — the foot of the space strip and room list (desktop), or of
// the room-list drawer (mobile). Two rows:
//
//   (A•) Cyrillus                  [⇩ 2] [⌕] [⚙]
//        set status…
//
// Top: who you are — your avatar and name (opens your profile; the avatar's
// dot is the connection state) — and the app-level controls: pending invites,
// search, settings. Below: your presence status (click, or `S`, to edit),
// with the whole width to itself rather than squeezed between the buttons.
//
// Those controls used to be stacked vertically at the bottom of the space
// strip, under the spaces, where a long space list pushed them off screen and
// a short one left them floating in the middle of nothing. Gathering them into
// the status line keeps the strip for spaces alone and gives the invites
// button somewhere visible to live.

import { inviteIcon, searchIcon, settingsIcon } from "./icons.js";

export class StatusBar {
  private _el: HTMLElement;
  private _profileBtn: HTMLButtonElement;
  private _avatarEl: HTMLElement;
  private _nameEl: HTMLElement;
  private _connDot: HTMLElement;
  private _statusEl: HTMLElement;
  private _statusInput: HTMLInputElement | null = null;
  private _invitesBtn: HTMLButtonElement;
  private _invitesCount: HTMLElement;
  private _connected = false;
  private _ownAvatarUrl: string | null = null;
  private _ownInitial = "?";
  private _onSetStatus: ((msg: string) => void) | null = null;
  private _onProfile: (() => void) | null = null;
  private _onInvites: (() => void) | null = null;
  private _onSearch: (() => void) | null = null;
  private _onSettings: (() => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "status-bar";
    this._el.setAttribute("role", "toolbar");
    this._el.setAttribute("aria-label", "Status line");

    const main = document.createElement("div");
    main.className = "status-bar__main";
    this._el.appendChild(main);
    const line = document.createElement("div");
    line.className = "status-bar__line";
    this._el.appendChild(line);

    // ── You (top left): avatar + name ────────────────────────────────────────
    this._profileBtn = this._makeButton("status-bar__profile", "Your profile", "Profile (P)", () =>
      this._onProfile?.(),
    );
    this._avatarEl = document.createElement("span");
    this._avatarEl.className = "status-bar__avatar";
    this._connDot = document.createElement("span");
    this._connDot.className = "status-bar__conn-dot";
    this._connDot.setAttribute("aria-hidden", "true");
    this._nameEl = document.createElement("span");
    this._nameEl.className = "status-bar__name";
    this._profileBtn.append(this._avatarEl, this._nameEl);
    main.appendChild(this._profileBtn);

    // ── App controls (top right) ─────────────────────────────────────────────
    this._invitesBtn = this._makeButton("status-bar__btn status-bar__invites", "Invites", "Invites (:invites)", () =>
      this._onInvites?.(),
    );
    this._invitesBtn.appendChild(inviteIcon());
    this._invitesCount = document.createElement("span");
    this._invitesCount.className = "status-bar__count";
    this._invitesBtn.appendChild(this._invitesCount);
    main.appendChild(this._invitesBtn);

    const searchBtn = this._makeButton(
      "status-bar__btn status-bar__search",
      "Search rooms and commands",
      "Search rooms and commands (Ctrl+K)",
      () => this._onSearch?.(),
    );
    searchBtn.appendChild(searchIcon());
    main.appendChild(searchBtn);

    const settingsBtn = this._makeButton("status-bar__btn status-bar__settings", "Settings", "Settings (?)", () =>
      this._onSettings?.(),
    );
    settingsBtn.appendChild(settingsIcon());
    main.appendChild(settingsBtn);

    // ── Presence status (second row) ─────────────────────────────────────────
    this._statusEl = document.createElement("span");
    this._statusEl.className = "status-bar__status";
    this._statusEl.setAttribute("role", "button");
    this._statusEl.setAttribute("tabindex", "0");
    this._statusEl.setAttribute("aria-label", "Presence status — click or press S to edit");
    this._statusEl.title = "Click or press S to set status";
    this._statusEl.addEventListener("click", () => this.beginEdit());
    this._statusEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.beginEdit();
      }
    });
    line.appendChild(this._statusEl);
    this.setStatusMessage("");
    this.setInviteCount(0);
    this.setOwnName("");

    this._renderProfile();
    this.setConnected(false);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getElement(): HTMLElement {
    return this._el;
  }

  onProfileClick(handler: () => void): void {
    this._onProfile = handler;
  }

  onInvitesClick(handler: () => void): void {
    this._onInvites = handler;
  }

  onSearchClick(handler: () => void): void {
    this._onSearch = handler;
  }

  onSettingsClick(handler: () => void): void {
    this._onSettings = handler;
  }

  /**
   * Show your avatar on the profile button. Pass `null` for a coloured initial
   * derived from `initial` (typically your display name or MXID localpart).
   */
  setOwnProfile(initial: string, avatarUrl: string | null): void {
    this._ownAvatarUrl = avatarUrl;
    this._ownInitial = initial && initial[0] ? initial[0].toUpperCase() : "?";
    this._renderProfile();
  }

  /** Your display name, beside the avatar. */
  setOwnName(name: string): void {
    this._nameEl.textContent = name;
    this._nameEl.title = name;
  }

  /** The connection state, drawn as the dot on your avatar. */
  setConnected(connected: boolean): void {
    this._connected = connected;
    this._connDot.classList.toggle("status-bar__conn-dot--online", connected);
    this._connDot.classList.toggle("status-bar__conn-dot--offline", !connected);
    this._el.classList.toggle("status-bar--offline", !connected);
    const state = connected ? "connected" : "offline";
    this._profileBtn.setAttribute("aria-label", `Your profile (${state})`);
    this._profileBtn.title = `Profile (P) — ${state}`;
  }

  isConnected(): boolean {
    return this._connected;
  }

  /** How many invites are waiting. Zero dims the button rather than hiding it. */
  setInviteCount(count: number): void {
    this._invitesCount.textContent = count > 0 ? String(count) : "";
    this._invitesBtn.classList.toggle("status-bar__invites--pending", count > 0);
    const label = count === 1 ? "1 pending invite" : count > 1 ? `${count} pending invites` : "No pending invites";
    this._invitesBtn.setAttribute("aria-label", `Invites — ${label}`);
    this._invitesBtn.title = `${label} (:invites)`;
  }

  /** Display a presence status message. Pass empty string to show the placeholder. */
  setStatusMessage(msg: string): void {
    if (this._statusInput) return; // don't clobber mid-edit
    this._statusEl.textContent = msg || "set status…";
    this._statusEl.classList.toggle("status-bar__status--placeholder", !msg);
  }

  /** Return the currently-displayed status message, or empty string if unset. */
  getStatusMessage(): string {
    if (this._statusInput) return this._statusInput.value;
    if (this._statusEl.classList.contains("status-bar__status--placeholder")) return "";
    return this._statusEl.textContent ?? "";
  }

  /** Register a callback invoked when the user commits a new status message. */
  onSetStatus(cb: (msg: string) => void): void {
    this._onSetStatus = cb;
  }

  /** Enter inline editing mode for the status message. */
  beginEdit(): void {
    if (this._statusInput) return; // already editing

    const current = this._statusEl.textContent ?? "";
    const placeholder = this._statusEl.classList.contains("status-bar__status--placeholder");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "status-bar__status-input";
    input.value = placeholder ? "" : current;
    input.placeholder = "set status…";
    input.maxLength = 255;
    input.setAttribute("aria-label", "Presence status message");

    this._statusInput = input;
    this._statusEl.replaceWith(input);
    input.focus();
    input.select();

    // Removing a focused input fires `blur` on some engines, mid-removal — and
    // blur cancels. Without a guard, Enter's commit ran the cancel inside its
    // own replaceWith, then threw on the second one before saving anything.
    let finished = false;
    const finish = (): boolean => {
      if (finished) return false;
      finished = true;
      this._statusInput = null;
      input.replaceWith(this._statusEl);
      return true;
    };

    const commit = () => {
      const val = input.value.trim();
      if (!finish()) return;
      this.setStatusMessage(val);
      this._onSetStatus?.(val);
    };

    const cancel = () => {
      finish();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape" || (e.key === "[" && e.ctrlKey)) { e.preventDefault(); cancel(); }
      e.stopPropagation(); // prevent vim mode from intercepting
    });
    input.addEventListener("blur", cancel);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _makeButton(className: string, ariaLabel: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.setAttribute("aria-label", ariaLabel);
    btn.title = title;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private _renderProfile(): void {
    this._avatarEl.textContent = "";
    this._avatarEl.classList.toggle("status-bar__avatar--fallback", !this._ownAvatarUrl);
    if (this._ownAvatarUrl) {
      const img = document.createElement("img");
      img.className = "status-bar__profile-img";
      img.src = this._ownAvatarUrl;
      img.alt = "";
      // A data URL the renderer refuses to decode falls back to the initial
      // rather than leaving an empty box.
      img.addEventListener("error", () => this.setOwnProfile(this._ownInitial, null));
      this._avatarEl.appendChild(img);
    } else {
      const initial = document.createElement("span");
      initial.className = "status-bar__profile-initial";
      initial.textContent = this._ownInitial;
      this._avatarEl.appendChild(initial);
    }
    this._avatarEl.appendChild(this._connDot);
  }
}
