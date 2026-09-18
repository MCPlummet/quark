// Command input overlay — appears in Command mode above the status bar

import { parseCommand, CommandHistory, ParsedCommand } from "../vim/commands.js";
import { completeLine } from "../app/registry.js";

export type CommandExecuteHandler = (parsed: ParsedCommand) => void;
export type CommandCancelHandler = () => void;

export class CommandBar {
  private _el: HTMLElement;
  private _promptEl: HTMLElement;
  private _inputEl: HTMLInputElement;
  private _completionEl: HTMLElement;

  private _history: CommandHistory = new CommandHistory();
  private _savedInput: string = "";
  private _completions: string[] = [];
  private _completionIndex: number = -1;

  private _onExecute: CommandExecuteHandler | null = null;
  private _onCancel: CommandCancelHandler | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "command-bar";
    this._el.setAttribute("role", "search");
    this._el.setAttribute("aria-label", "Command input");
    // Hidden by default — shown only in Command mode
    this._el.style.display = "none";

    // ── Prompt character ─────────────────────────────────────────────────────
    this._promptEl = document.createElement("span");
    this._promptEl.className = "command-bar__prompt";
    this._promptEl.setAttribute("aria-hidden", "true");
    this._promptEl.textContent = ":";
    this._el.appendChild(this._promptEl);

    // ── Text input ───────────────────────────────────────────────────────────
    this._inputEl = document.createElement("input");
    this._inputEl.type = "text";
    this._inputEl.className = "command-bar__input";
    this._inputEl.setAttribute("autocomplete", "off");
    this._inputEl.setAttribute("autocorrect", "off");
    this._inputEl.setAttribute("autocapitalize", "off");
    this._inputEl.setAttribute("spellcheck", "false");
    this._inputEl.setAttribute("aria-label", "Command");
    this._inputEl.placeholder = "command…";
    this._el.appendChild(this._inputEl);

    // ── Completion hint ──────────────────────────────────────────────────────
    this._completionEl = document.createElement("span");
    this._completionEl.className = "command-bar__completion";
    this._completionEl.setAttribute("aria-hidden", "true");
    this._el.appendChild(this._completionEl);

    // ── Event listeners ──────────────────────────────────────────────────────
    this._inputEl.addEventListener("keydown", (e) => this._handleKeydown(e));
    this._inputEl.addEventListener("input", () => this._handleInput());
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getElement(): HTMLElement {
    return this._el;
  }

  /** Show the command bar and focus the input. Optionally seed with initial text. */
  show(initialText: string = ""): void {
    this._el.style.display = "";
    this._inputEl.value = initialText;
    this._savedInput = initialText;
    this._resetCompletions();
    this._updateCompletionHint();
    this._inputEl.focus();
  }

  hide(): void {
    this._el.style.display = "none";
    this._inputEl.value = "";
    this._resetCompletions();
    this._completionEl.textContent = "";
  }

  /** Called when the user executes a command (Enter). */
  onExecute(handler: CommandExecuteHandler): void {
    this._onExecute = handler;
  }

  /** Called when the user cancels (Escape). */
  onCancel(handler: CommandCancelHandler): void {
    this._onCancel = handler;
  }

  focus(): void {
    this._inputEl.focus();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _handleKeydown(e: KeyboardEvent): void {
    // Ctrl+[ is the vim equivalent of Escape — cancel command entry.
    if (e.ctrlKey && e.key === "[") {
      e.preventDefault();
      this._cancel();
      return;
    }
    switch (e.key) {
      case "Enter": {
        e.preventDefault();
        this._execute();
        break;
      }

      case "Escape": {
        e.preventDefault();
        this._cancel();
        break;
      }

      case "Tab": {
        e.preventDefault();
        this._cycleCompletion(e.shiftKey ? -1 : 1);
        break;
      }

      case "ArrowUp": {
        e.preventDefault();
        this._historyPrev();
        break;
      }

      case "ArrowDown": {
        e.preventDefault();
        this._historyNext();
        break;
      }

      default:
        // Reset history cursor when user edits freely (not via arrows)
        if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") {
          this._history.resetCursor();
        }
        break;
    }
  }

  private _handleInput(): void {
    this._resetCompletions();
    this._updateCompletionHint();
  }

  private _execute(): void {
    const raw = this._inputEl.value.trim();
    if (!raw) {
      this._cancel();
      return;
    }

    const parsed = parseCommand(raw);
    if (!parsed) {
      this._cancel();
      return;
    }

    this._history.push(raw);
    this.hide();
    this._onExecute?.(parsed);
  }

  private _cancel(): void {
    this.hide();
    this._onCancel?.();
  }

  private _historyPrev(): void {
    // Save current live input before first navigation
    if (this._history.cursor === -1) {
      this._savedInput = this._inputEl.value;
    }
    const entry = this._history.prev();
    if (entry !== undefined) {
      this._inputEl.value = entry;
      this._resetCompletions();
      this._updateCompletionHint();
    }
  }

  private _historyNext(): void {
    const entry = this._history.next();
    if (entry !== undefined) {
      this._inputEl.value = entry;
    } else {
      // Restored to live input
      this._inputEl.value = this._savedInput;
    }
    this._resetCompletions();
    this._updateCompletionHint();
  }

  private _cycleCompletion(direction: 1 | -1): void {
    const line = this._inputEl.value;

    // Build completions list if not already built for this input
    if (this._completions.length === 0) {
      this._completions = completeLine(line);
      this._completionIndex = -1;
    }

    if (this._completions.length === 0) return;

    this._completionIndex =
      (this._completionIndex + direction + this._completions.length) %
      this._completions.length;

    const chosen = this._completions[this._completionIndex];
    if (chosen !== undefined) {
      // Reconstruct the full line: preserve leading colon if present
      const prefix = line.startsWith(":") ? ":" : "";
      this._inputEl.value = `${prefix}${chosen}`;
      this._updateCompletionHint();
    }
  }

  private _resetCompletions(): void {
    this._completions = [];
    this._completionIndex = -1;
  }

  private _updateCompletionHint(): void {
    const line = this._inputEl.value;
    if (!line) {
      this._completionEl.textContent = "";
      return;
    }

    const candidates = completeLine(line);
    if (candidates.length === 0) {
      this._completionEl.textContent = "";
    } else if (candidates.length === 1) {
      this._completionEl.textContent = `  →  ${candidates[0]}`;
    } else {
      this._completionEl.textContent = `  [${candidates.slice(0, 5).join("  ")}]`;
    }
  }
}
