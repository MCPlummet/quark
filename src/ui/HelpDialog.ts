// Help dialog — :commands and vim keybindings reference.
//
// Both tables are generated from the action registry. They used to be
// hand-maintained arrays here, and had drifted badly: fourteen implemented
// commands were missing, `:upload` was advertised as working when it is a
// stub, and the Ctrl-e / Ctrl-g rows named action ids ("emoji", "gif") that do
// not exist in dispatchAction, so their live-binding lookup could never
// resolve and the rows were permanently static.
//
// What the registry cannot describe stays in EXTRA_BINDINGS below: behaviours
// with no action id behind them, like the Enter key sending a message or
// `:word:` opening shortcode autocomplete. They are documentation, not
// bindings, and are marked as such so nobody expects them to be remappable.

import { keymapManager, type KeyContext } from "../vim/keybindings.js";
import { ACTIONS, commandEntries, modeLabel } from "../app/registry.js";
import { DialogBase } from "./DialogBase.js";

interface CommandEntry {
  name: string;
  args: string;
  description: string;
}

interface BindingEntry {
  keys: string;
  mode: string;
  description: string;
  /** keymapManager action ID — used to look up the live binding */
  action?: string;
  /** keymapManager context for the action */
  context?: string;
}

/** Arrow keys read better as glyphs than as their DOM key names. */
const KEY_GLYPHS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const prettyKey = (sequence: string): string => KEY_GLYPHS[sequence] ?? sequence;

/** `:command` rows, straight from the registry. */
function buildCommands(): CommandEntry[] {
  return commandEntries().map((entry) => ({
    name: entry.command.aliases?.length
      ? `${entry.command.name} / ${entry.command.aliases.join(" / ")}`
      : entry.command.name,
    args: entry.command.args ?? "",
    description: entry.description,
  }));
}

/**
 * Keybinding rows, one per registry entry that declares a default binding.
 *
 * The `keys` value here is the *default*; _buildBindingsTable replaces it with
 * the live sequence and flags the row when the two differ, which is what makes
 * the table honest about a user's quarkrc.
 */
function buildBindings(): BindingEntry[] {
  const rows: BindingEntry[] = [];
  for (const entry of ACTIONS) {
    if (!entry.bindings?.length) continue;
    const context = entry.bindings[0].context;
    rows.push({
      keys: entry.bindings.map((b) => prettyKey(b.sequence)).join(" / "),
      mode: modeLabel(entry, context),
      description: entry.description,
      action: entry.id,
      context,
    });
  }
  return rows;
}

/**
 * Behaviours with no registry action behind them. Not remappable, and listed
 * after the generated rows so the two are not confused.
 */
const EXTRA_BINDINGS: BindingEntry[] = [
  { keys: "Enter", mode: "roomlist", description: "Open the selected room" },
  { keys: "Enter", mode: "insert", description: "Send the message (see send-key behaviour)" },
  { keys: "Ctrl-Enter", mode: "insert", description: "Send regardless of send-key behaviour" },
  { keys: ":word:", mode: "insert", description: "Shortcode emoji autocomplete" },
  { keys: "Tab", mode: "picker", description: "Switch emoji ↔ sticker ↔ GIF" },
];

type Section = "bindings" | "commands";

/** Keyboard-navigable command and keybinding reference overlay. */
export class HelpDialog extends DialogBase {
  private _titleEl: HTMLElement;
  private _contentEl: HTMLElement;

  private _activeSection: Section = "bindings";
  private _tabBindings: HTMLElement;
  private _tabCommands: HTMLElement;

  private _focusIndex = 0;
  private _rows: HTMLElement[] = [];

  constructor() {
    super({ prefix: "help-dialog", ariaLabel: "Help" });

    // ── Header (title text is set per-section in _switchSection) ───────────
    this.buildHeader("", "Close help");
    this._titleEl = this.titleEl!;

    // ── Tab bar ───────────────────────────────────────────────────────────
    const tabs = document.createElement("div");
    tabs.className = "help-dialog__tabs";
    tabs.setAttribute("role", "tablist");
    this.content.appendChild(tabs);

    this._tabBindings = this._makeTab("Keybindings", "Tab for :commands", "bindings", tabs);
    this._tabCommands = this._makeTab(":Commands", "Tab for keybindings", "commands", tabs);

    // ── Scrollable content ────────────────────────────────────────────────
    this._contentEl = document.createElement("div");
    this._contentEl.className = "help-dialog__content";
    this.content.appendChild(this._contentEl);

    // ── Footer ────────────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.className = "help-dialog__footer";
    footer.textContent = "j/k navigate · Tab switch section · Esc close";
    footer.setAttribute("aria-hidden", "true");
    this.content.appendChild(footer);
  }

  show(): void {
    this.reveal();
    this._switchSection("bindings");
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _makeTab(label: string, hint: string, section: Section, parent: HTMLElement): HTMLElement {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "help-dialog__tab";
    tab.textContent = label;
    tab.title = hint;
    tab.setAttribute("role", "tab");
    tab.addEventListener("click", () => this._switchSection(section));
    parent.appendChild(tab);
    return tab;
  }

  private _switchSection(section: Section): void {
    this._activeSection = section;
    this._contentEl.innerHTML = "";
    this._rows = [];
    this._focusIndex = 0;

    if (section === "bindings") {
      this._titleEl.textContent = "help — keybindings";
      this._tabBindings.classList.add("help-dialog__tab--active");
      this._tabCommands.classList.remove("help-dialog__tab--active");
      this._tabBindings.setAttribute("aria-selected", "true");
      this._tabCommands.setAttribute("aria-selected", "false");
      this._buildBindingsTable();
    } else {
      this._titleEl.textContent = "help — :commands";
      this._tabCommands.classList.add("help-dialog__tab--active");
      this._tabBindings.classList.remove("help-dialog__tab--active");
      this._tabCommands.setAttribute("aria-selected", "true");
      this._tabBindings.setAttribute("aria-selected", "false");
      this._buildCommandsTable();
    }

    this._updateFocus();
    this._rows[0]?.focus();
  }

  private _buildHeadings(cols: string[]): void {
    const headings = document.createElement("div");
    headings.className = `help-dialog__headings help-dialog__headings--${this._activeSection}`;
    headings.setAttribute("aria-hidden", "true");
    for (const col of cols) {
      const span = document.createElement("span");
      span.textContent = col;
      headings.appendChild(span);
    }
    this._contentEl.appendChild(headings);
  }

  private _buildBindingsTable(): void {
    this._buildHeadings(["KEYS", "MODE", "DESCRIPTION"]);

    // Build a lookup: action → [sequences] from the live keymapManager
    const liveEntries = keymapManager.getEntries();
    const actionToSeqs = new Map<string, string[]>();
    for (const e of liveEntries) {
      const key = `${e.context}:${e.action}`;
      if (!actionToSeqs.has(key)) actionToSeqs.set(key, []);
      actionToSeqs.get(key)!.push(e.sequence);
    }

    const table = document.createElement("div");
    table.className = "help-dialog__table";
    table.setAttribute("role", "list");

    const bindingRows = [...buildBindings(), ...EXTRA_BINDINGS];
    for (let i = 0; i < bindingRows.length; i++) {
      const b = bindingRows[i];
      const row = document.createElement("div");
      row.className = "help-dialog__row help-dialog__row--bindings";
      row.setAttribute("role", "listitem");
      row.setAttribute("tabindex", i === 0 ? "0" : "-1");

      const keysEl = document.createElement("span");
      keysEl.className = "help-dialog__key";

      // Check if there's a live binding for this action and whether it differs from the default
      let displayKeys = b.keys;
      let isCustomized = false;
      if (b.action && b.context) {
        const liveSeqs = actionToSeqs.get(`${b.context as KeyContext}:${b.action}`);
        if (liveSeqs && liveSeqs.length > 0) {
          // Prettified the same way as the declared default, or every arrow
          // row would compare unequal and be flagged as remapped.
          const liveKey = liveSeqs.map(prettyKey).join(" / ");
          if (liveKey !== b.keys) {
            isCustomized = true;
            displayKeys = liveKey;
          }
        }
      }

      keysEl.textContent = displayKeys;
      if (isCustomized) {
        keysEl.title = `Remapped (default: ${b.keys})`;
        keysEl.style.color = "var(--accent-primary)";
      }
      row.appendChild(keysEl);

      const modeEl = document.createElement("span");
      modeEl.className = "help-dialog__mode";
      modeEl.textContent = b.mode;
      row.appendChild(modeEl);

      const descEl = document.createElement("span");
      descEl.className = "help-dialog__cmd-desc";
      descEl.textContent = b.description;
      row.appendChild(descEl);

      this._rows.push(row);
      table.appendChild(row);
    }

    this._contentEl.appendChild(table);
  }

  private _buildCommandsTable(): void {
    this._buildHeadings(["COMMAND", "ARGS", "DESCRIPTION"]);

    const table = document.createElement("div");
    table.className = "help-dialog__table";
    table.setAttribute("role", "list");

    const commandRows = buildCommands();
    for (let i = 0; i < commandRows.length; i++) {
      const cmd = commandRows[i];
      const row = document.createElement("div");
      row.className = "help-dialog__row help-dialog__row--commands";
      row.setAttribute("role", "listitem");
      row.setAttribute("tabindex", i === 0 ? "0" : "-1");

      const nameEl = document.createElement("span");
      nameEl.className = "help-dialog__cmd-name";
      nameEl.textContent = `:${cmd.name}`;
      row.appendChild(nameEl);

      const argsEl = document.createElement("span");
      argsEl.className = "help-dialog__cmd-args";
      argsEl.textContent = cmd.args;
      row.appendChild(argsEl);

      const descEl = document.createElement("span");
      descEl.className = "help-dialog__cmd-desc";
      descEl.textContent = cmd.description;
      row.appendChild(descEl);

      this._rows.push(row);
      table.appendChild(row);
    }

    this._contentEl.appendChild(table);
  }

  private _updateFocus(): void {
    for (let i = 0; i < this._rows.length; i++) {
      this._rows[i].setAttribute("tabindex", i === this._focusIndex ? "0" : "-1");
    }
  }

  private _moveFocus(delta: number): void {
    this._focusIndex = Math.max(0, Math.min(this._focusIndex + delta, this._rows.length - 1));
    this._updateFocus();
    this._rows[this._focusIndex]?.focus();
  }

  protected override handleKeydown(e: KeyboardEvent): void {
    // Stop all keys from reaching the global handler while dialog is open
    e.stopPropagation();

    // Tab is overlay-specific (switch sections) — not remappable
    if (e.key === "Tab") {
      e.preventDefault();
      this._switchSection(this._activeSection === "bindings" ? "commands" : "bindings");
      return;
    }

    const result = keymapManager.resolveKey(e.key, "picker");

    if (result.kind === "action") {
      switch (result.action) {
        case "close":
          e.preventDefault();
          this.hide();
          break;
        case "nav-down":
          e.preventDefault();
          this._moveFocus(1);
          break;
        case "nav-up":
          e.preventDefault();
          this._moveFocus(-1);
          break;
        case "jump-top":
          e.preventDefault();
          this._moveFocus(-this._rows.length);
          break;
        case "jump-bottom":
          e.preventDefault();
          this._moveFocus(this._rows.length);
          break;
      }
    } else if (result.kind === "partial") {
      e.preventDefault();
    }
  }
}
