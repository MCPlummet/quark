// Command palette — one searchable surface over every room and every action.
//
// Grew out of the Ctrl+K room switcher, which only ever listed rooms. The
// problem it now solves is reachability: `commandBar.show()` is reachable only
// through the `mode-command` action, so with vim mode off — which is *always*
// the case on mobile, since initMobile force-disables it — no `:` command can
// be run at all. :update, :help, :directory, :join and :debug had no path to
// them for anyone not using vim on a desktop.
//
// So the palette is the parity net for the whole milestone: anything in the
// registry is reachable from here, filtered by the same availability
// predicates the `:` executor enforces, with no dependency on modal editing.
// Discoverable affordances on top of it (#99, #102) are what a normal user
// actually finds; this is what guarantees the thing is *there* to be found.
//
// Three ways to invoke a row, decided by the registry's arg grammar:
//   • no command behind it          → dispatch the action id
//   • command, no required argument → run it outright
//   • command with `<required>`     → prefill the command bar and let the user
//     finish the line, because a palette row cannot supply `@user:server`
// That last case makes the palette a discovery path *into* the command bar
// rather than a replacement that quietly drops half the vocabulary.

import { AppState } from "../app/state.js";
import { currentAvailability } from "../app/availability.js";
import {
  isAvailable,
  paletteEntries,
  requiresArguments,
  menuHint,
  type ActionEntry,
} from "../app/registry.js";
import type { RoomInfo } from "../ipc/types.js";
import { PickerBase, SelectionList } from "./PickerBase.js";

/** A navigable row. Section headings are rendered but are not items. */
export type PaletteItem =
  | { kind: "room"; room: RoomInfo }
  | { kind: "action"; entry: ActionEntry };

/** What selecting an action row should do. */
export type Invocation =
  | { kind: "dispatch"; actionId: string }
  | { kind: "run"; command: string }
  | { kind: "prefill"; line: string };

export type RoomSelectCallback = (roomId: string) => void;
export type InvokeCallback = (invocation: Invocation) => void;

/**
 * How an action row is invoked. Pure, so the arg-grammar rule is testable
 * without standing up the DOM.
 */
export function invocationFor(entry: ActionEntry): Invocation {
  if (!entry.command) return { kind: "dispatch", actionId: entry.id };
  if (requiresArguments(entry)) return { kind: "prefill", line: `:${entry.command.name} ` };
  return { kind: "run", command: entry.command.name };
}

/**
 * Score a candidate against a query. Higher is better; 0 means no match.
 *
 * A prefix match outranks a word-start match, which outranks a bare substring,
 * so typing "se" puts ":settings" and "#sec-ops" above "Browse the public room
 * directory" — which merely contains "se" inside "Browse". Without the tiering
 * the most-typed commands sink below incidental description hits.
 */
export function scoreMatch(haystack: string, query: string): number {
  if (query === "") return 1;
  const h = haystack.toLowerCase();
  const idx = h.indexOf(query);
  if (idx === -1) return 0;
  if (idx === 0) return 3;
  return /[\s\-_:#@]/.test(h[idx - 1]) ? 2 : 1;
}

export class CommandPalette extends PickerBase {
  private _panelEl: HTMLElement;
  private _searchInput: HTMLInputElement;
  private _listEl: HTMLElement;

  private _allRooms: RoomInfo[] = [];
  private _items: PaletteItem[] = [];
  private _list: SelectionList;
  private _onSelectRoom: RoomSelectCallback | null = null;
  private _onInvoke: InvokeCallback | null = null;

  constructor() {
    super({
      className: "command-palette",
      ariaLabel: "Command palette",
      displayValue: "flex",
    });

    this._el.addEventListener("click", (e) => {
      if (e.target === this._el) this.hide();
    });

    this._panelEl = document.createElement("div");
    this._panelEl.className = "command-palette__panel";
    this._el.appendChild(this._panelEl);

    this._searchInput = document.createElement("input");
    this._searchInput.type = "text";
    this._searchInput.className = "command-palette__search";
    this._searchInput.placeholder = "jump to room or run a command…";
    this._searchInput.setAttribute("aria-label", "Search rooms and commands");
    this._searchInput.setAttribute("autocomplete", "off");
    this._searchInput.setAttribute("spellcheck", "false");

    this._searchInput.addEventListener("input", () => this._filter());
    this._searchInput.addEventListener("keydown", (e) => {
      // Let the panel handler take navigation/selection keys. Tab is included
      // so you can dive from the search box into the list without reaching for
      // the arrow keys (mirrors the emoji picker's Tab-into-grid).
      if (
        e.key === "Escape" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Enter" ||
        e.key === "Tab"
      ) {
        return;
      }
      e.stopPropagation();
    });

    this._panelEl.appendChild(this._searchInput);

    this._listEl = document.createElement("div");
    this._listEl.className = "command-palette__list";
    this._panelEl.appendChild(this._listEl);

    const footer = document.createElement("div");
    footer.className = "command-palette__footer";
    footer.textContent = "↑/↓ navigate · Enter run · : actions only · Esc close";
    footer.setAttribute("aria-hidden", "true");
    this._panelEl.appendChild(footer);

    this._list = new SelectionList({
      columns: 1,
      highlight: { kind: "class", activeClass: "command-palette__item--focused" },
      getItems: () =>
        Array.from(this._listEl.querySelectorAll<HTMLElement>(".command-palette__item")),
      onSelect: (i) => this._select(i),
      onFocusChange: (i) => {
        const items = this._listEl.querySelectorAll<HTMLElement>(".command-palette__item");
        items[i]?.scrollIntoView({ block: "nearest" });
      },
    });

    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  /** Wire room rows. */
  onSelectRoom(cb: RoomSelectCallback): void { this._onSelectRoom = cb; }

  /** Wire action rows. The host decides how to honour each invocation kind. */
  onInvoke(cb: InvokeCallback): void { this._onInvoke = cb; }

  show(): void {
    this._allRooms = AppState.get("roomListCache");
    this._searchInput.value = "";
    this.reveal();
    this._filter();
    this._searchInput.focus();
  }

  /** The rows currently listed, in display order. Exposed for testing. */
  get items(): readonly PaletteItem[] {
    return this._items;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _filter(): void {
    const raw = this._searchInput.value.trim();
    // A leading colon drops the rooms, echoing the command bar — the one piece
    // of syntax a Quark user already knows. It narrows to *actions* rather than
    // strictly to `:` commands: a few real actions (toggle the member list, set
    // your status) have no `:` form, and hiding them behind that distinction
    // would be a rule the user cannot see.
    const actionsOnly = raw.startsWith(":");
    const query = (actionsOnly ? raw.slice(1) : raw).toLowerCase();

    const rooms = actionsOnly ? [] : this._matchRooms(query);
    const actions = this._matchActions(query);

    this._items = [
      ...rooms.map((room): PaletteItem => ({ kind: "room", room })),
      ...actions.map((entry): PaletteItem => ({ kind: "action", entry })),
    ];

    this._render(rooms.length);
    this._list.setFocus(0);
  }

  private _matchRooms(query: string): RoomInfo[] {
    return this._allRooms
      .map((room) => ({
        room,
        score: Math.max(
          scoreMatch(room.name ?? "", query),
          scoreMatch(room.room_id, query),
        ),
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((c) => c.room);
  }

  private _matchActions(query: string): ActionEntry[] {
    // Availability is the same predicate the `:` executor enforces, so the
    // palette never offers a row that would immediately refuse itself.
    const ctx = currentAvailability();
    return paletteEntries()
      .filter((entry) => isAvailable(entry, ctx))
      .map((entry) => ({
        entry,
        score: Math.max(
          entry.command ? scoreMatch(entry.command.name, query) : 0,
          ...(entry.command?.aliases ?? []).map((a) => scoreMatch(a, query)),
          scoreMatch(entry.description, query),
        ),
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((c) => c.entry);
  }

  private _render(roomCount: number): void {
    this._listEl.innerHTML = "";

    if (this._items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "command-palette__empty";
      empty.textContent = "Nothing matches.";
      this._listEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < this._items.length; i++) {
      // Headings are emitted at each boundary rather than up front, so a list
      // with no rooms (":" mode, or a query matching commands alone) does not
      // render an empty "Rooms" heading above the commands.
      if (i === 0 && roomCount > 0) this._listEl.appendChild(this._makeSection("Rooms"));
      if (i === roomCount) this._listEl.appendChild(this._makeSection("Actions"));

      const item = this._items[i];
      this._listEl.appendChild(
        item.kind === "room" ? this._makeRoomItem(item.room, i) : this._makeActionItem(item.entry, i),
      );
    }

    this._list.refresh();
  }

  private _makeSection(label: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "command-palette__section";
    el.textContent = label;
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  private _makeRow(index: number): HTMLElement {
    const item = document.createElement("div");
    item.className = "command-palette__item";
    item.setAttribute("data-index", String(index));
    item.setAttribute("role", "option");
    item.addEventListener("click", () => this._select(index));
    item.addEventListener("mousemove", () => {
      if (this._list.focusIndex !== index) this._list.setFocus(index);
    });
    return item;
  }

  private _makeRoomItem(room: RoomInfo, index: number): HTMLElement {
    const item = this._makeRow(index);

    const name = document.createElement("span");
    name.className = "command-palette__name";
    name.textContent = room.name ?? room.room_id;
    item.appendChild(name);

    if (room.name) {
      const idEl = document.createElement("span");
      idEl.className = "command-palette__alias";
      idEl.textContent = room.room_id;
      item.appendChild(idEl);
    }

    return item;
  }

  private _makeActionItem(entry: ActionEntry, index: number): HTMLElement {
    const item = this._makeRow(index);

    const name = document.createElement("span");
    name.className = "command-palette__name";
    // Show the `:` form where there is one — it is what the user would type,
    // and seeing it here is how they learn the command exists at all.
    name.textContent = entry.command ? `:${entry.command.name}` : entry.description;
    item.appendChild(name);

    if (entry.command) {
      const desc = document.createElement("span");
      desc.className = "command-palette__desc";
      desc.textContent = entry.command.args
        ? `${entry.command.args} — ${entry.description}`
        : entry.description;
      item.appendChild(desc);
    }

    // The live keybinding, when there is one: the palette doubles as the place
    // you find out an action has a shortcut.
    const hint = menuHint(entry.id);
    if (hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "command-palette__hint";
      hintEl.textContent = hint;
      item.appendChild(hintEl);
    }

    return item;
  }

  private _select(index: number): void {
    const item = this._items[index];
    if (!item) return;
    this.hide();
    if (item.kind === "room") {
      this._onSelectRoom?.(item.room.room_id);
    } else {
      this._onInvoke?.(invocationFor(item.entry));
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      this.hide();
      return;
    }

    // Tab / Shift-Tab step through the list, so the search box and the results
    // are reachable from the keyboard home row (Tab isn't a remappable action).
    if (e.key === "Tab") {
      e.preventDefault();
      this._list.dispatch(e.shiftKey ? "nav-up" : "nav-down");
      return;
    }

    // Navigation + select route through the keymap (honours rebindings). With
    // vim mode off there are still default picker bindings registered, so
    // arrows and Enter work regardless.
    const result = this._list.handleKey(e.key);
    if (result.partial || result.consumed) e.preventDefault();
  }
}
