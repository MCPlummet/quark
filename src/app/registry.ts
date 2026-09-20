// The action registry — one source of truth for what Quark can do.
//
// Before this module the same action was described in four places that drifted
// apart: KNOWN_COMMANDS (tab completion), the executeCommand switch (behaviour),
// HelpDialog's COMMANDS/BINDINGS tables (documentation), and the inline
// ContextMenuEntry literals in keyboard.ts (menus, with hardcoded `hint:`
// strings that lied as soon as the user remapped anything). `:room-settings`
// executed but never tab-completed; Help omitted fourteen implemented commands
// and advertised `:upload`, a stub.
//
// So the *metadata* lives here and the *behaviour* stays where it was. Every
// entry carries a stable `id`; consumers look an entry up and read whatever
// facet they need — command name and aliases, default binding, menu label and
// grouping, which surfaces the action is reachable from. Behaviour keeps living
// in dispatchAction (for the no-argument actions) and executeCommand (for the
// ones that parse arguments), both of which now switch on the registry's id
// rather than on raw user input, so an alias is resolved exactly once.
//
// This file is deliberately free of UI and action-layer imports: the parity
// test (#104) and the command palette (#98) both need to read the registry
// without dragging the DOM in behind it. The one runtime import is the keymap
// manager, which is itself dependency-free, and only for resolving a *live*
// binding — the whole point being that a menu hint reflects the user's quarkrc
// rather than what the default happened to be when the menu was written.

import { keymapManager, type KeyContext } from "../vim/keybindings.js";

// ── Facets ───────────────────────────────────────────────────────────────────

/**
 * What must be true for an action to be offered.
 *
 * Checked by {@link isAvailable} against a snapshot of app state, so the same
 * predicate filters the command palette, greys out a menu row, and decides
 * whether a `:` command can run at all — rather than each surface inventing its
 * own "is there a room selected?" test and disagreeing at the edges.
 */
export type Requirement =
  | "session"      // logged in
  | "room"         // a room is open
  | "space"        // a space is selected
  | "message"      // a timeline message is selected
  | "own-message"  // …and the account sent it (implies "message")
  | "desktop";     // not available in mobile mode

/** Context menus an action can appear in. */
export type MenuSurface =
  | "message"
  | "room"
  | "space"
  | "section"
  /**
   * The mobile top bar's ⋮ menu. Mobile hides the desktop room header, which
   * carried the only pointer affordance for search and pinned messages, so
   * this surface is where that chrome went (#99).
   */
  | "overflow";

/**
 * Non-menu places an action has a dedicated on-screen control. Declaring it
 * here is what lets the parity test (#104) tell "reachable by mouse" from
 * "reachable only if you know the keystroke".
 */
export type ChromeSurface =
  | "room-header"
  | "mobile-top-bar"
  | "compose"
  | "space-strip"
  | "status-bar"
  | "drawer"
  | "settings"
  | "timeline";

export interface BindingSpec {
  /** Key sequence in keymapManager's syntax, e.g. "gg" or "Ctrl-e". */
  sequence: string;
  context: KeyContext;
}

export interface CommandSpec {
  /** Canonical name, without the leading colon. */
  name: string;
  /** Accepted alternatives. Resolved to the canonical id before dispatch. */
  aliases?: readonly string[];
  /** Usage hint for help and the palette, e.g. "<room-id|alias>". */
  args?: string;
}

export interface MenuSpec {
  surface: MenuSurface;
  label: string;
  /**
   * Rows are sorted by (group, order) and a separator is drawn between groups,
   * which is how the menus keep their shape without a builder having to
   * interleave `{ separator: true }` literals by hand.
   */
  group: number;
  order: number;
  /** Rendered as destructive (leave, redact, …). */
  danger?: boolean;
}

export interface ActionEntry {
  /** Stable identifier. Matches the dispatchAction case where one exists. */
  id: string;
  /** One line, shown in help and the palette. */
  description: string;
  requires?: readonly Requirement[];
  command?: CommandSpec;
  bindings?: readonly BindingSpec[];
  menus?: readonly MenuSpec[];
  chrome?: readonly ChromeSurface[];
  /**
   * Whether the action is offered in the command palette. Defaults to true for
   * anything with a `command`; pure navigation (`nav-down`, `close`) opts out —
   * running "move selection down" from a palette makes no sense.
   */
  palette?: boolean;
  /** Mode label for the help dialog's MODE column. Derived when omitted. */
  mode?: string;
}

// ── The registry ─────────────────────────────────────────────────────────────

const ACTION_LITERALS = [
  // ── Modes ──────────────────────────────────────────────────────────────
  {
    id: "mode-insert",
    description: "Enter insert mode",
    bindings: [{ sequence: "i", context: "global" }],
    palette: false,
  },
  {
    id: "mode-command",
    description: "Open the command bar",
    bindings: [{ sequence: ":", context: "global" }],
    palette: false,
  },
  {
    id: "mode-visual",
    description: "Enter visual mode",
    bindings: [{ sequence: "v", context: "global" }],
    palette: false,
  },

  // ── Navigation ─────────────────────────────────────────────────────────
  {
    id: "nav-down",
    description: "Select next item",
    bindings: [
      { sequence: "j", context: "global" },
      { sequence: "ArrowDown", context: "global" },
    ],
    palette: false,
  },
  {
    id: "nav-up",
    description: "Select previous item",
    bindings: [
      { sequence: "k", context: "global" },
      { sequence: "ArrowUp", context: "global" },
    ],
    palette: false,
  },
  {
    id: "nav-left",
    description: "Move focus to the panel on the left",
    bindings: [
      { sequence: "h", context: "global" },
      { sequence: "ArrowLeft", context: "global" },
    ],
    palette: false,
  },
  {
    id: "nav-right",
    description: "Move focus to the panel on the right",
    bindings: [
      { sequence: "l", context: "global" },
      { sequence: "ArrowRight", context: "global" },
    ],
    palette: false,
  },
  {
    id: "jump-top",
    description: "Jump to the first item",
    bindings: [{ sequence: "gg", context: "global" }],
    palette: false,
  },
  {
    id: "jump-bottom",
    description: "Jump to the last item",
    bindings: [{ sequence: "G", context: "global" }],
    palette: false,
  },
  {
    id: "select",
    description: "Open the focused item",
    bindings: [
      { sequence: "Enter", context: "global" },
      { sequence: "o", context: "global" },
    ],
    palette: false,
  },
  {
    // `o` in the timeline drops a caret into the selected message instead of
    // running the generic select; other panels keep `o` as a select alias.
    id: "enter-text-select",
    description: "Select text within the message",
    requires: ["message"],
    bindings: [{ sequence: "o", context: "timeline" }],
    palette: false,
  },
  {
    id: "close",
    description: "Clear selection / close the active panel",
    bindings: [{ sequence: "Escape", context: "global" }],
    palette: false,
  },
  {
    // The palette itself — excluded from its own listing, and from the `:`
    // vocabulary, because reaching it already means you are in it.
    id: "open-command-palette",
    description: "Search rooms and commands",
    requires: ["session"],
    bindings: [{ sequence: "Ctrl-k", context: "global" }],
    chrome: ["drawer"],
    palette: false,
  },

  // ── Message actions ────────────────────────────────────────────────────
  {
    id: "reply",
    description: "Reply to the selected message",
    requires: ["message"],
    bindings: [{ sequence: "r", context: "global" }],
    menus: [{ surface: "message", label: "Reply", group: 1, order: 1 }],
    chrome: ["timeline"],
    palette: false,
  },
  {
    id: "react",
    description: "React to the selected message",
    requires: ["message"],
    bindings: [{ sequence: "e", context: "global" }],
    menus: [{ surface: "message", label: "React", group: 1, order: 2 }],
    chrome: ["timeline"],
    palette: false,
  },
  {
    id: "open-thread",
    description: "Open the selected message's thread",
    requires: ["message"],
    bindings: [{ sequence: "t", context: "global" }],
    menus: [{ surface: "message", label: "Thread", group: 1, order: 3 }],
    chrome: ["timeline"],
    palette: false,
  },
  {
    id: "copy-message",
    description: "Copy the selected message's text",
    requires: ["message"],
    bindings: [{ sequence: "y", context: "global" }],
    menus: [{ surface: "message", label: "Copy message text", group: 2, order: 1 }],
    palette: false,
  },
  {
    // Mobile only, and expressed by the caller withholding the handler off
    // mobile rather than by a requirement: on desktop you select text by
    // dragging, and the row would be noise.
    id: "select-message-text",
    description: "Select text within the message",
    requires: ["message"],
    menus: [{ surface: "message", label: "Select text", group: 2, order: 2 }],
    palette: false,
  },
  {
    id: "view-raw-event",
    description: "View the selected message's source event",
    requires: ["message"],
    menus: [{ surface: "message", label: "View raw event", group: 2, order: 3 }],
    palette: false,
  },
  {
    id: "edit",
    description: "Edit the selected message",
    requires: ["own-message"],
    bindings: [
      { sequence: "E", context: "global" },
      { sequence: "c", context: "global" },
    ],
    menus: [{ surface: "message", label: "Edit", group: 3, order: 1 }],
    palette: false,
  },
  {
    id: "redact",
    description: "Delete the selected message",
    requires: ["own-message"],
    bindings: [{ sequence: "dd", context: "global" }],
    menus: [{ surface: "message", label: "Delete", group: 3, order: 2, danger: true }],
    palette: false,
  },
  {
    id: "paste-to-input",
    description: "Paste into the compose box",
    bindings: [{ sequence: "p", context: "global" }],
    palette: false,
  },
  {
    id: "quote-selection",
    description: "Quote the selected text into the compose box",
    bindings: [{ sequence: ">", context: "global" }],
    palette: false,
  },

  // ── Compose box ────────────────────────────────────────────────────────
  {
    id: "open-emoji-picker",
    description: "Open the emoji / sticker picker",
    requires: ["room"],
    command: { name: "emoji" },
    bindings: [{ sequence: "Ctrl-e", context: "insert" }],
    chrome: ["compose"],
    palette: true,
  },
  {
    id: "open-gif-picker",
    description: "Open the GIF picker",
    requires: ["room"],
    command: { name: "gif" },
    bindings: [{ sequence: "Ctrl-g", context: "insert" }],
    chrome: ["compose"],
    palette: true,
  },
  {
    // openStickerPicker existed and was called from nowhere. DESIGN.md has
    // documented `:stickers` all along, so this is the caller it was missing
    // rather than dead code to delete.
    id: "open-sticker-picker",
    description: "Browse sticker packs",
    requires: ["room"],
    command: { name: "stickers" },
    chrome: ["compose"],
    palette: true,
  },
  {
    id: "format-bold",
    description: "Bold the selected text",
    requires: ["room"],
    bindings: [{ sequence: "Ctrl-b", context: "insert" }],
    palette: false,
  },
  {
    id: "format-italic",
    description: "Italicise the selected text",
    requires: ["room"],
    bindings: [{ sequence: "Ctrl-i", context: "insert" }],
    palette: false,
  },
  {
    id: "format-underline",
    description: "Underline the selected text",
    requires: ["room"],
    bindings: [{ sequence: "Ctrl-u", context: "insert" }],
    palette: false,
  },
  {
    id: "format-strikethrough",
    description: "Strike through the selected text",
    requires: ["room"],
    // Shift because there is no conventional bare chord for strikethrough.
    bindings: [{ sequence: "Ctrl-Shift-x", context: "insert" }],
    palette: false,
  },

  // ── Panels and dialogs ─────────────────────────────────────────────────
  {
    id: "toggle-members",
    description: "Toggle the member list",
    requires: ["room"],
    bindings: [{ sequence: "m", context: "global" }],
    chrome: ["room-header", "mobile-top-bar"],
    // No `:` form, but a real user action — opt into the palette, which
    // otherwise lists only entries that carry a command.
    palette: true,
    menus: [{ surface: "overflow", label: "Members", group: 2, order: 1 }],
  },
  {
    id: "open-profile",
    description: "Open your profile",
    requires: ["session"],
    command: { name: "profile" },
    bindings: [{ sequence: "P", context: "global" }],
    chrome: ["space-strip"],
  },
  {
    id: "open-settings",
    description: "Open settings",
    requires: ["session"],
    command: { name: "settings" },
    bindings: [{ sequence: "?", context: "global" }],
    chrome: ["space-strip"],
  },
  {
    id: "open-room-info",
    description: "Open room info",
    requires: ["room"],
    command: { name: "info" },
    bindings: [{ sequence: "I", context: "global" }],
    menus: [{ surface: "room", label: "Room info", group: 2, order: 2 }, { surface: "overflow", label: "Room info", group: 1, order: 3 }],
  },
  {
    id: "open-room-settings",
    description: "Open room settings",
    requires: ["room"],
    command: { name: "roomsettings", aliases: ["room-settings"] },
    menus: [{ surface: "room", label: "Room settings", group: 2, order: 1 }],
    chrome: ["room-header", "mobile-top-bar"],
  },
  {
    id: "open-space-settings",
    description: "Open space settings",
    requires: ["space"],
    command: { name: "spacesettings", aliases: ["space-settings"] },
    menus: [
      { surface: "space", label: "Space settings", group: 1, order: 1 },
      { surface: "section", label: "Space settings", group: 1, order: 1 },
    ],
  },
  {
    id: "open-pinned",
    description: "Show pinned messages",
    requires: ["room"],
    command: { name: "pinned" },
    chrome: ["room-header"],
    menus: [{ surface: "overflow", label: "Pinned messages", group: 1, order: 2 }],
  },
  {
    id: "open-search",
    description: "Search messages in this room",
    requires: ["room"],
    command: { name: "search", args: "[query]" },
    chrome: ["room-header"],
    menus: [{ surface: "overflow", label: "Search messages", group: 1, order: 1 }],
  },
  {
    id: "open-directory",
    description: "Browse the public room directory",
    requires: ["session"],
    command: { name: "directory" },
    chrome: ["drawer"],
  },
  {
    id: "open-debug",
    description: "Open the debug viewer for this room",
    requires: ["room"],
    command: { name: "debug", args: "[cache|$eventId]" },
  },
  {
    id: "help",
    description: "Show commands and keybindings",
    command: { name: "help" },
    menus: [{ surface: "overflow", label: "Keys and commands", group: 3, order: 1 }],
  },
  {
    id: "edit-status",
    description: "Set your presence status",
    requires: ["session"],
    bindings: [{ sequence: "S", context: "global" }],
    chrome: ["status-bar"],
    // No `:` form, but a real user action — opt into the palette, which
    // otherwise lists only entries that carry a command.
    palette: true,
  },

  // ── Rooms ──────────────────────────────────────────────────────────────
  {
    id: "join-room",
    description: "Join a room or space",
    requires: ["session"],
    command: { name: "join", args: "<room-id|alias>" },
  },
  {
    id: "open-room",
    description: "Open a room",
    menus: [{ surface: "room", label: "Open", group: 1, order: 1 }],
    palette: false,
  },
  {
    // Offered only when the room is unread — expressed by the caller passing a
    // handler conditionally, since `requires` describes app state rather than
    // the menu's target.
    id: "mark-room-read",
    description: "Mark a room as read",
    menus: [{ surface: "room", label: "Mark as read", group: 3, order: 1 }],
    palette: false,
  },
  {
    id: "leave-room",
    description: "Leave a room",
    requires: ["room"],
    command: { name: "leave", args: "[room-id]" },
  },
  {
    // The confirm-then-leave flow the room-info dialog fires; the bare
    // `:leave` command above skips straight to leaveRoomWithFeedback.
    id: "leave-room-confirm",
    description: "Leave this room",
    requires: ["room"],
    menus: [{ surface: "room", label: "Leave room", group: 4, order: 1, danger: true }],
    palette: false,
  },
  {
    // Mute and unmute are separate entries rather than one toggle so each can
    // carry its own `:` command and its own menu label. Only one is ever
    // applicable, which the menus express by the caller passing a handler for
    // just that one — the same mechanism "Mark as read" uses.
    id: "mute-room",
    description: "Silence notifications for this room",
    requires: ["room"],
    command: { name: "mute", args: "[room-id]" },
    menus: [
      { surface: "room", label: "Mute", group: 3, order: 2 },
      { surface: "overflow", label: "Mute room", group: 2, order: 2 },
    ],
    chrome: ["settings"],
  },
  {
    id: "unmute-room",
    description: "Restore notifications for this room",
    requires: ["room"],
    command: { name: "unmute", args: "[room-id]" },
    menus: [
      { surface: "room", label: "Unmute", group: 3, order: 2 },
      { surface: "overflow", label: "Unmute room", group: 2, order: 2 },
    ],
    chrome: ["settings"],
  },
  {
    id: "open-dm",
    description: "Open or start a direct message",
    requires: ["session"],
    command: { name: "msg", args: "<user-id>" },
  },
  {
    id: "convert-to-dm",
    description: "Mark this room as a direct message",
    requires: ["room"],
    command: { name: "converttodm", aliases: ["convert-to-dm"], args: "[room-id]" },
  },
  {
    id: "convert-to-room",
    description: "Unmark this room as a direct message",
    requires: ["room"],
    command: { name: "converttoroom", aliases: ["convert-to-room"], args: "[room-id]" },
  },
  {
    id: "set-topic",
    description: "Set the room topic",
    requires: ["room"],
    command: { name: "topic", args: "<text>" },
  },

  // ── Membership ─────────────────────────────────────────────────────────
  {
    id: "invite-user",
    description: "Invite a user to this room",
    requires: ["room"],
    command: { name: "invite", args: "<user-id>" },
  },
  {
    id: "kick-user",
    description: "Remove a user from this room",
    requires: ["room"],
    command: { name: "kick", args: "<user-id> [reason]" },
  },
  {
    id: "ban-user",
    description: "Ban a user from this room",
    requires: ["room"],
    command: { name: "ban", args: "<user-id> [reason]" },
  },
  {
    id: "unban-user",
    description: "Lift a ban on a user",
    requires: ["room"],
    command: { name: "unban", args: "<user-id>" },
  },

  // ── Account ────────────────────────────────────────────────────────────
  {
    id: "set-nick",
    description: "Set your display name",
    requires: ["session"],
    command: { name: "nick", args: "<display-name>" },
    chrome: ["settings"],
  },
  {
    id: "verify-user",
    description: "Start verification with a user",
    requires: ["session"],
    command: { name: "verify", args: "<user-id>" },
    chrome: ["settings"],
  },
  {
    id: "verify-session",
    description: "Verify one of your other sessions",
    requires: ["session"],
    chrome: ["settings"],
    // No `:` form, but a real user action — opt into the palette, which
    // otherwise lists only entries that carry a command.
    palette: true,
  },
  {
    id: "setup-cross-signing",
    description: "Set up cross-signing for this account",
    requires: ["session"],
    command: { name: "cross-sign", aliases: ["setup-cross-signing"], args: "[password]" },
    chrome: ["settings"],
  },
  {
    id: "logout",
    description: "Log out",
    requires: ["session"],
    command: { name: "logout" },
    chrome: ["settings"],
  },

  // ── App ────────────────────────────────────────────────────────────────
  {
    id: "load-theme",
    description: "Switch to a colour theme",
    command: { name: "theme", args: "<name>" },
    chrome: ["settings"],
  },
  {
    id: "show-version",
    description: "Show the running version",
    command: { name: "version" },
    chrome: ["settings"],
  },
  {
    // Desktop-only: mobile builds update through the app store or F-Droid, and
    // Settings → About hides the whole Updates section there.
    id: "check-for-updates",
    description: "Check for updates",
    requires: ["desktop"],
    command: { name: "update" },
    chrome: ["settings"],
  },
  {
    id: "upload-file",
    description: "Upload a file to this room (not yet implemented)",
    requires: ["room"],
    command: { name: "upload", args: "<path>" },
  },
  {
    id: "quit",
    description: "Close Quark",
    requires: ["desktop"],
    command: { name: "quit", aliases: ["q"] },
  },
] as const satisfies readonly ActionEntry[];

// `as const` above is load-bearing rather than decoration: it narrows every
// `id` to a string literal, which is what lets the `:` executor switch
// exhaustively over CommandId so that `tsc` — not a test, not a reviewer —
// refuses a build where a command has been added here with no handler behind
// it. That is the drift this module exists to make impossible.
//
// The literal types stop there. Consumers iterate the *widened* ACTIONS below,
// because under `as const` an omitted optional field does not exist on the
// union at all, and every `entry.command` read would need narrowing first.

/** Every action id in the registry. */
export type ActionId = (typeof ACTION_LITERALS)[number]["id"];

/** Ids of entries exposing a `:` command — the executor's exhaustive domain. */
export type CommandId = Extract<
  (typeof ACTION_LITERALS)[number],
  { command: object }
>["id"];

/** An entry known to expose a `:` command. */
export type CommandEntry = ActionEntry & { id: CommandId; command: CommandSpec };

/** The registry, widened for iteration. */
export const ACTIONS: readonly ActionEntry[] = ACTION_LITERALS;

// ── Lookups ──────────────────────────────────────────────────────────────────

const _byId = new Map<string, ActionEntry>();
const _byCommand = new Map<string, CommandEntry>();

for (const entry of ACTIONS) {
  _byId.set(entry.id, entry);
  if (!entry.command) continue;
  // Sound by construction: only entries carrying a `command` reach this line,
  // and every such id is in the CommandId union by derivation.
  const withCommand = entry as CommandEntry;
  _byCommand.set(withCommand.command.name, withCommand);
  for (const alias of withCommand.command.aliases ?? []) {
    _byCommand.set(alias, withCommand);
  }
}

/** Look up an entry by its stable id. */
export function actionById(id: string): ActionEntry | undefined {
  return _byId.get(id);
}

/**
 * Resolve a `:` command name — canonical or alias — to its entry. This is the
 * single place an alias collapses, which is why `:room-settings` now behaves
 * identically to `:roomsettings` in completion, help and execution rather than
 * in whichever of the three happened to list it.
 */
export function actionByCommand(name: string): CommandEntry | undefined {
  return _byCommand.get(name.toLowerCase());
}

/** Every accepted `:` command name, aliases included, in registration order. */
export function commandNames(): string[] {
  return [..._byCommand.keys()];
}

/** Entries that expose a `:` command, in registration order. */
export function commandEntries(): CommandEntry[] {
  return ACTIONS.filter((e): e is CommandEntry => e.command !== undefined);
}

/** Entries offered in the command palette (#98), respecting the opt-out. */
export function paletteEntries(): ActionEntry[] {
  return ACTIONS.filter((e) => e.palette ?? e.command !== undefined);
}

/** Entries appearing in a given context menu, sorted into their groups. */
export function menuEntries(surface: MenuSurface): Array<ActionEntry & { menu: MenuSpec }> {
  const rows: Array<ActionEntry & { menu: MenuSpec }> = [];
  for (const entry of ACTIONS) {
    const menu = entry.menus?.find((m) => m.surface === surface);
    if (menu) rows.push({ ...entry, menu });
  }
  rows.sort((a, b) => a.menu.group - b.menu.group || a.menu.order - b.menu.order);
  return rows;
}

// ── Availability ─────────────────────────────────────────────────────────────

/** Snapshot of the app state the requirement predicates read. */
export interface AvailabilityContext {
  loggedIn: boolean;
  roomId: string | null;
  spaceId: string | null;
  selectedMessageId: string | null;
  selectedMessageIsOwn: boolean;
  isMobile: boolean;
}

/**
 * Whether every requirement an entry declares is satisfied.
 *
 * Pure, so the palette can filter its list, a menu builder can drop a row, and
 * the `:` executor can refuse with a consistent message — all from one rule
 * rather than three hand-written state checks that disagree about, say, whether
 * "a room is open" also means "a message is selected".
 */
export function isAvailable(entry: ActionEntry, ctx: AvailabilityContext): boolean {
  for (const req of entry.requires ?? []) {
    switch (req) {
      case "session":
        if (!ctx.loggedIn) return false;
        break;
      case "room":
        if (!ctx.roomId) return false;
        break;
      case "space":
        if (!ctx.spaceId) return false;
        break;
      case "message":
        if (!ctx.selectedMessageId) return false;
        break;
      case "own-message":
        if (!ctx.selectedMessageId || !ctx.selectedMessageIsOwn) return false;
        break;
      case "desktop":
        if (ctx.isMobile) return false;
        break;
    }
  }
  return true;
}

// ── Live bindings ────────────────────────────────────────────────────────────

/**
 * The key sequences currently bound to an action, newest registration last.
 *
 * Read from keymapManager rather than from this file's `bindings` so the answer
 * reflects the user's quarkrc. A menu that prints its defaults is worse than one
 * that prints nothing: it tells a user who has remapped `dd` that their delete
 * key is still `dd`.
 */
export function liveSequences(id: string, context?: KeyContext): string[] {
  return keymapManager
    .getEntries()
    .filter((e) => e.action === id && (context === undefined || e.context === context))
    .map((e) => e.sequence);
}

/**
 * The single sequence to print beside a menu row, or undefined when the action
 * has no binding at all. First match wins — `edit` is bound to both `E` and `c`,
 * and a menu has room for one.
 */
export function menuHint(id: string): string | undefined {
  return liveSequences(id)[0];
}

/**
 * Register every default binding the registry declares.
 *
 * Replaces the hand-written `registerDefaultBindings()` list in keyboard.ts, so
 * adding an action with a default key is one edit here rather than two edits
 * that can disagree.
 */
export function registerDefaultBindings(): void {
  for (const entry of ACTIONS) {
    for (const binding of entry.bindings ?? []) {
      keymapManager.map(binding.context, binding.sequence, entry.id, false);
    }
  }
}

/**
 * Whether a command cannot run without an argument the caller must type.
 *
 * The args spec is the grammar: `<…>` is required, `[…]` is optional. So
 * `:search [query]` and `:leave [room-id]` are runnable bare — they fall back
 * to the open room or an empty query — while `:join <room-id|alias>` is not.
 * The palette uses this to decide between running a command outright and
 * prefilling the command bar for the user to finish (#98).
 */
export function requiresArguments(entry: ActionEntry): boolean {
  return entry.command?.args?.includes("<") ?? false;
}

/** Help dialog MODE column: the binding's context, in the spec's vocabulary. */
export function modeLabel(entry: ActionEntry, context: KeyContext): string {
  if (entry.mode) return entry.mode;
  switch (context) {
    case "global": return "normal";
    case "timeline": return "timeline";
    case "roomlist": return "roomlist";
    case "insert": return "insert";
    case "command": return "command";
    case "picker": return "picker";
    case "visual": return "visual";
  }
}

// ── Completion ───────────────────────────────────────────────────────────────

export type CompletionResult = string[];

/**
 * Tab-complete a partial command name against every accepted name and alias.
 *
 * Sourced from the registry rather than a parallel list, which is what fixes
 * `:room-settings` and `:space-settings` — both executed but neither completed,
 * because the old KNOWN_COMMANDS array had been updated on one side only.
 */
export function completeCommand(partial: string): CompletionResult {
  const lower = partial.toLowerCase();
  return commandNames().filter((name) => name.startsWith(lower));
}

/**
 * Tab-complete within a full command line. Operates on the name portion only —
 * argument completion is per-command and out of scope here.
 */
export function completeLine(line: string): CompletionResult {
  const trimmed = line.startsWith(":") ? line.slice(1) : line;
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx !== -1) return [];
  return completeCommand(trimmed);
}
