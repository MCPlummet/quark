// Application state manager — single source of truth for Quark's runtime state

import type { RoomInfo, TimelineEvent } from "../ipc/types.js";
import type { UpdateInfo } from "../ipc/index.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ActivePanel = "roomlist" | "timeline" | "spaces" | "members" | "home";

/**
 * Text-selection submode — orthogonal to vim Normal/Visual modes.
 * - `"message"`: caret has been placed inside a timeline message body for
 *   selecting and copying text from it.
 * - `"compose"`: the compose box is focused for caret-driven editing while in
 *   Normal/Visual rather than Insert mode (e.g. for pasting at the cursor).
 */
export type TextSelectMode = null | "message" | "compose";

export interface AppStateSnapshot {
  loggedIn: boolean;
  /** Matrix user ID of the locally logged-in user (e.g. @alice:matrix.org). */
  ownUserId: string | null;
  /** Display name of the locally logged-in user. */
  ownDisplayName: string | null;
  currentRoomId: string | null;
  currentSpaceId: string | null;
  activePanel: ActivePanel;
  roomListCache: RoomInfo[];
  /** Room IDs that belong to at least one space (used to filter home view). */
  spaceRoomIds: string[];
  currentTimeline: TimelineEvent[];
  replyToEventId: string | null;
  /** Event ID of the message currently being edited inline, or null. */
  editingEventId: string | null;
  threadRootEventId: string | null;
  memberListVisible: boolean;
  /** True while the Home view (floating DM canvas) replaces the room list +
   *  timeline. Drives layout classes and panel focus traversal. */
  homeViewActive: boolean;
  /** When false, vim modal editing is disabled — the app stays in Insert mode. */
  vimMode: boolean;
  /** When false, other users' read-receipt avatars are not rendered in the timeline. */
  showReadReceipts: boolean;
  /** Active text-selection target, or null if not in text-select mode. */
  textSelectMode: TextSelectMode;
  /** Metadata for an available update, or null when none/up to date. */
  updateAvailable: UpdateInfo | null;
}

export type StateChangeKey = keyof AppStateSnapshot;
export type StateChangeListener<K extends StateChangeKey = StateChangeKey> = (
  key: K,
  value: AppStateSnapshot[K],
  prev: AppStateSnapshot[K]
) => void;

// ── Panel nav callback registry ──────────────────────────────────────────────

interface PanelNavCallbacks {
  navDown: () => void;
  navUp: () => void;
  jumpTop?: () => void;
  jumpBottom?: () => void;
  /** Activate the currently focused item (Enter/o). No-op if absent. */
  select?: () => void;
  /** Called when focus moves TO this panel. Optional — no-op if absent. */
  focusActive?: () => void;
  /** Clear selection / cancel reply / close thread for this panel. No-op if absent. */
  close?: () => void;
}

// ── AppState class ───────────────────────────────────────────────────────────

class AppStateManager {
  /** Left-to-right panel order for focus traversal. */
  private static readonly PANEL_ORDER: readonly ActivePanel[] = [
    "spaces", "roomlist", "timeline", "members",
  ];

  private _state: AppStateSnapshot = {
    loggedIn: false,
    ownUserId: null,
    ownDisplayName: null,
    currentRoomId: null,
    currentSpaceId: null,
    activePanel: "roomlist",
    roomListCache: [],
    spaceRoomIds: [],
    currentTimeline: [],
    replyToEventId: null,
    editingEventId: null,
    threadRootEventId: null,
    memberListVisible: false,
    homeViewActive: false,
    vimMode: true,
    showReadReceipts: true,
    textSelectMode: null,
    updateAvailable: null,
  };

  private _listeners: Map<string, Set<StateChangeListener>> = new Map();
  private _anyListeners: Set<StateChangeListener> = new Set();
  private _panelNavCallbacks: Map<ActivePanel, PanelNavCallbacks> = new Map();
  /** Cached presence status messages keyed by user ID. */
  private _userStatusCache: Map<string, string | null> = new Map();
  /** Cached presence state keyed by user ID ("online" | "unavailable" | "offline"). */
  private _userPresenceCache: Map<string, string> = new Map();

  // ── Read ──────────────────────────────────────────────────────────────────

  get snapshot(): Readonly<AppStateSnapshot> {
    return this._state;
  }

  get<K extends StateChangeKey>(key: K): AppStateSnapshot[K] {
    return this._state[key];
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  set<K extends StateChangeKey>(key: K, value: AppStateSnapshot[K]): void {
    const prev = this._state[key];
    if (prev === value) return;
    this._state = { ...this._state, [key]: value };
    this._emit(key, value, prev);
  }

  patch(partial: Partial<AppStateSnapshot>): void {
    for (const [k, v] of Object.entries(partial) as Array<[StateChangeKey, AppStateSnapshot[StateChangeKey]]>) {
      this.set(k, v);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  /** Listen for changes to a specific key */
  on<K extends StateChangeKey>(key: K, listener: StateChangeListener<K>): () => void {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key)!.add(listener as StateChangeListener);
    return () => this._listeners.get(key)?.delete(listener as StateChangeListener);
  }

  /** Listen for any state change */
  onAny(listener: StateChangeListener): () => void {
    this._anyListeners.add(listener);
    return () => this._anyListeners.delete(listener);
  }

  // ── Panel nav ─────────────────────────────────────────────────────────────

  /** Register navigation callbacks for a panel. Called once during setup. */
  registerPanelNav(panel: ActivePanel, callbacks: PanelNavCallbacks): void {
    this._panelNavCallbacks.set(panel, callbacks);
  }

  navDown(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.navDown();
  }

  navUp(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.navUp();
  }

  jumpTop(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.jumpTop?.();
  }

  jumpBottom(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.jumpBottom?.();
  }

  select(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.select?.();
  }

  close(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.close?.();
  }

  // ── User status cache ─────────────────────────────────────────────────────

  cacheUserStatus(userId: string, statusMsg: string | null): void {
    this._userStatusCache.set(userId, statusMsg);
  }

  getUserStatus(userId: string): string | null {
    return this._userStatusCache.get(userId) ?? null;
  }

  cacheUserPresence(userId: string, presence: string): void {
    this._userPresenceCache.set(userId, presence);
  }

  getUserPresence(userId: string): string | null {
    return this._userPresenceCache.get(userId) ?? null;
  }

  /** Programmatically move focus to a specific panel, calling its focusActive callback. */
  focusPanel(panel: ActivePanel): void {
    this.set("activePanel", panel);
    this._panelNavCallbacks.get(panel)?.focusActive?.();
  }

  /** Current left-to-right focus order: the Home view replaces the room
   *  list/timeline/members columns entirely while active. */
  private _panelOrder(): readonly ActivePanel[] {
    if (this._state.homeViewActive) return ["spaces", "home"];
    return AppStateManager.PANEL_ORDER.filter(
      (p) => p !== "members" || this._state.memberListVisible
    );
  }

  moveFocusLeft(): void {
    const order = this._panelOrder();
    const idx = order.indexOf(this._state.activePanel);
    if (idx > 0) {
      const next = order[idx - 1];
      this.set("activePanel", next);
      this._panelNavCallbacks.get(next)?.focusActive?.();
    }
  }

  moveFocusRight(): void {
    const order = this._panelOrder();
    const idx = order.indexOf(this._state.activePanel);
    if (idx >= 0 && idx < order.length - 1) {
      const next = order[idx + 1];
      this.set("activePanel", next);
      this._panelNavCallbacks.get(next)?.focusActive?.();
    }
  }

  private _emit<K extends StateChangeKey>(key: K, value: AppStateSnapshot[K], prev: AppStateSnapshot[K]): void {
    const keyListeners = this._listeners.get(key);
    if (keyListeners) {
      for (const listener of keyListeners) {
        listener(key, value, prev);
      }
    }
    for (const listener of this._anyListeners) {
      listener(key, value, prev);
    }
  }
}

// Singleton export
export const AppState = new AppStateManager();
