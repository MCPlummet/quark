// Header bar for the main panel — room name, topic, member count, encryption

import { isAnimatedUrl } from "../app/animated_urls.js";
import { hashColor } from "./avatarColors.js";
import { searchIcon } from "./icons.js";

function _roomColor(name: string): string {
  return hashColor(name);
}

export interface RoomHeaderData {
  name: string;
  topic?: string;
  memberCount?: number;
  encrypted?: boolean;
  avatarUrl?: string;
}

export class RoomHeader {
  private _el: HTMLElement;
  private _avatarEl: HTMLElement;
  private _nameEl: HTMLElement;
  private _topicEl: HTMLElement;
  private _metaEl: HTMLElement;
  private _memberCountEl: HTMLElement;
  private _encEl: HTMLElement;
  private _avatarClickHandler: (() => void) | null = null;
  private _avatarTitle = "View profile";
  private _memberCountClickHandler: (() => void) | null = null;
  private _pinnedClickHandler: (() => void) | null = null;
  private _pinnedBtnEl: HTMLButtonElement;
  private _searchBtnEl: HTMLButtonElement;
  private _searchClickHandler: (() => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "room-header";
    this._el.setAttribute("role", "banner");
    this._el.setAttribute("aria-label", "Room header");

    // ── Avatar (far left) ────────────────────────────────────────────────────
    this._avatarEl = document.createElement("span");
    this._avatarEl.className = "room-header__avatar-fallback";
    this._avatarEl.setAttribute("aria-hidden", "true");
    this._el.appendChild(this._avatarEl);

    // ── Left section: room name + topic ──────────────────────────────────────
    const left = document.createElement("div");
    left.className = "room-header__left";

    this._nameEl = document.createElement("span");
    this._nameEl.className = "room-header__name";
    this._nameEl.setAttribute("aria-label", "Room name");
    this._nameEl.textContent = "—";
    left.appendChild(this._nameEl);

    const topicSep = document.createElement("span");
    topicSep.className = "room-header__sep";
    topicSep.setAttribute("aria-hidden", "true");
    topicSep.textContent = " · ";
    left.appendChild(topicSep);

    this._topicEl = document.createElement("span");
    this._topicEl.className = "room-header__topic";
    this._topicEl.setAttribute("aria-label", "Room topic");
    this._topicEl.textContent = "";
    left.appendChild(this._topicEl);

    this._el.appendChild(left);

    // ── Right section: search + pinned + member count + encryption ───────────
    this._metaEl = document.createElement("div");
    this._metaEl.className = "room-header__meta";

    // Search button — leftmost in meta section. Opens the search dialog
    // (handled via the delegated click listener below), mirroring the pinned
    // button pattern.
    this._searchBtnEl = document.createElement("button");
    this._searchBtnEl.type = "button";
    this._searchBtnEl.className = "room-header__search-btn";
    this._searchBtnEl.title = "Search messages (:search)";
    this._searchBtnEl.setAttribute("aria-label", "Search messages in room");
    this._searchBtnEl.append(searchIcon(), "search");
    this._metaEl.appendChild(this._searchBtnEl);

    const searchSep = document.createElement("span");
    searchSep.className = "room-header__sep";
    searchSep.setAttribute("aria-hidden", "true");
    searchSep.textContent = " │ ";
    this._metaEl.appendChild(searchSep);

    // Pinned messages button
    this._pinnedBtnEl = document.createElement("button");
    this._pinnedBtnEl.type = "button";
    this._pinnedBtnEl.className = "room-header__pinned-btn";
    this._pinnedBtnEl.title = "Pinned messages (:pinned)";
    this._pinnedBtnEl.setAttribute("aria-label", "View pinned messages");
    this._pinnedBtnEl.textContent = "📌 pinned";
    this._metaEl.appendChild(this._pinnedBtnEl);

    const pinnedSep = document.createElement("span");
    pinnedSep.className = "room-header__sep";
    pinnedSep.setAttribute("aria-hidden", "true");
    pinnedSep.textContent = " │ ";
    this._metaEl.appendChild(pinnedSep);

    this._memberCountEl = document.createElement("span");
    this._memberCountEl.className = "room-header__members";
    this._memberCountEl.setAttribute("aria-label", "Member count");
    this._metaEl.appendChild(this._memberCountEl);

    const metaSep = document.createElement("span");
    metaSep.className = "room-header__sep";
    metaSep.setAttribute("aria-hidden", "true");
    metaSep.textContent = " │ ";
    this._metaEl.appendChild(metaSep);

    this._encEl = document.createElement("span");
    this._encEl.className = "room-header__encryption";
    this._encEl.setAttribute("aria-label", "Encryption status");
    this._metaEl.appendChild(this._encEl);

    this._el.appendChild(this._metaEl);

    // Single delegated listener — fires for clicks on avatar or member count
    this._el.addEventListener("click", (e) => {
      if (this._avatarClickHandler &&
          (e.target === this._avatarEl || this._avatarEl.contains(e.target as Node))) {
        this._avatarClickHandler();
        return;
      }
      if (this._memberCountClickHandler &&
          (e.target === this._memberCountEl || this._memberCountEl.contains(e.target as Node))) {
        this._memberCountClickHandler();
        return;
      }
      if (this._pinnedClickHandler &&
          (e.target === this._pinnedBtnEl || this._pinnedBtnEl.contains(e.target as Node))) {
        this._pinnedClickHandler();
        return;
      }
      if (this._searchClickHandler &&
          (e.target === this._searchBtnEl || this._searchBtnEl.contains(e.target as Node))) {
        this._searchClickHandler();
      }
    });

    // Set a blank default state
    this._applyData({ name: "" });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getElement(): HTMLElement {
    return this._el;
  }

  /**
   * Update all header fields at once.
   * Pass undefined for fields that should not change.
   */
  setRoom(
    name: string,
    topic?: string,
    memberCount?: number,
    encrypted?: boolean,
    avatarUrl?: string
  ): void {
    this._applyData({ name, topic, memberCount, encrypted, avatarUrl });
  }

  /**
   * Register a callback to invoke when the room avatar is clicked.
   * Pass null to remove the handler (e.g. when switching to a non-DM room).
   */
  setAvatarClickHandler(handler: (() => void) | null, title = "View profile"): void {
    this._avatarClickHandler = handler;
    this._avatarTitle = title;
    this._updateAvatarCursor();
  }

  /**
   * Register a callback to invoke when the pinned messages button is clicked.
   */
  setPinnedClickHandler(handler: (() => void) | null): void {
    this._pinnedClickHandler = handler;
  }

  /**
   * Register a callback to invoke when the header search button is clicked
   * (opens the search dialog). Pass null to remove the handler.
   */
  setSearchHandler(handler: (() => void) | null): void {
    this._searchClickHandler = handler;
  }

  /**
   * Register a callback to invoke when the member count is clicked.
   * Typically used to toggle the member list sidebar.
   */
  setMemberCountClickHandler(handler: (() => void) | null): void {
    this._memberCountClickHandler = handler;
    this._memberCountEl.classList.toggle("room-header__members--clickable", handler !== null);
    this._memberCountEl.title = handler ? "Toggle member list" : "";
  }

  /** Update just the member count in-place (e.g. after the full member list loads). */
  setMemberCount(count: number): void {
    this._memberCountEl.textContent = `${count} member${count === 1 ? "" : "s"}`;
    this._memberCountEl.setAttribute("aria-label", `${count} member${count === 1 ? "" : "s"}`);
  }

  /**
   * Swap in a resolved avatar URL after an async download completes.
   * Replaces the fallback letter with the actual image without re-rendering
   * the whole header.
   */
  setAvatarUrl(url: string): void {
    const img = document.createElement("img");
    img.className = "room-header__avatar";
    img.src = url;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    if (isAnimatedUrl(url)) img.dataset.gif = "1";
    img.onerror = () => { /* keep existing element on load failure */ };
    this._avatarEl.replaceWith(img);
    this._avatarEl = img;
    this._updateAvatarCursor();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _updateAvatarCursor(): void {
    if (this._avatarClickHandler) {
      this._avatarEl.style.cursor = "pointer";
      this._avatarEl.title = this._avatarTitle;
    } else {
      this._avatarEl.style.cursor = "";
      this._avatarEl.title = "";
    }
  }

  private _applyData(data: RoomHeaderData): void {
    // Avatar
    const displayName = data.name || "—";
    const color = _roomColor(displayName);
    if (data.avatarUrl) {
      const img = document.createElement("img");
      img.className = "room-header__avatar";
      img.src = data.avatarUrl;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      if (isAnimatedUrl(data.avatarUrl)) img.dataset.gif = "1";
      img.onerror = () => {
        const fallback = this._buildFallback(displayName, color);
        img.replaceWith(fallback);
        this._avatarEl = fallback;
        this._updateAvatarCursor();
      };
      this._avatarEl.replaceWith(img);
      this._avatarEl = img;
      this._updateAvatarCursor();
    } else {
      // Always rebuild the fallback so the initial letter stays current
      const fallback = this._buildFallback(displayName, color);
      this._avatarEl.replaceWith(fallback);
      this._avatarEl = fallback;
      this._updateAvatarCursor();
    }

    // Name
    this._nameEl.textContent = displayName;

    // Topic
    if (data.topic) {
      this._topicEl.textContent = data.topic;
      this._topicEl.style.display = "";
      this._topicEl.previousElementSibling?.removeAttribute("hidden");
    } else {
      this._topicEl.textContent = "";
      this._topicEl.style.display = "none";
      this._topicEl.previousElementSibling?.setAttribute("hidden", "");
    }

    // Member count
    if (data.memberCount !== undefined) {
      this._memberCountEl.textContent = `${data.memberCount} member${data.memberCount === 1 ? "" : "s"}`;
      this._memberCountEl.setAttribute(
        "aria-label",
        `${data.memberCount} member${data.memberCount === 1 ? "" : "s"}`
      );
    } else {
      this._memberCountEl.textContent = "";
    }

    // Encryption
    const encrypted = data.encrypted ?? false;
    this._encEl.textContent = encrypted ? "🔒 encrypted" : "🔓 unencrypted";
    this._encEl.setAttribute(
      "aria-label",
      encrypted ? "End-to-end encrypted" : "Not encrypted"
    );
    this._encEl.classList.toggle("room-header__encryption--on", encrypted);
    this._encEl.classList.toggle("room-header__encryption--off", !encrypted);
  }

  private _buildFallback(name: string, color: string): HTMLElement {
    const initial = (name.startsWith("#") || name.startsWith("!"))
      ? (name[1] ?? name[0]).toUpperCase()
      : name[0]?.toUpperCase() ?? "?";
    const el = document.createElement("span");
    el.className = "room-header__avatar-fallback";
    el.textContent = initial === "—" ? "#" : initial;
    el.style.color = color;
    el.style.borderColor = color;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}
