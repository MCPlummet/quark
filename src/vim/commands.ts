// Command parser for Quark's vim-style : commands

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

export type CompletionResult = string[];

// Known command names for tab completion
const KNOWN_COMMANDS: string[] = [
  "join",
  "leave",
  "theme",
  "upload",
  "quit",
  "q",
  "logout",
  "help",
  "msg",
  "invite",
  "kick",
  "ban",
  "unban",
  "nick",
  "topic",
  "verify",
  "cross-sign",
  "setup-cross-signing",
  "profile",
  "settings",
  "info",
  "pinned",
  "search",
  "directory",
  "roomsettings",
  "spacesettings",
  "debug",
  "version",
  "update",
];

/**
 * Parse a command string (with or without leading colon).
 * Examples:
 *   ":join #room:server.org"  -> { name: "join", args: ["#room:server.org"] }
 *   "leave"                   -> { name: "leave", args: [] }
 *   ":theme phosphor"         -> { name: "theme", args: ["phosphor"] }
 *   ":upload /path/to/file"   -> { name: "upload", args: ["/path/to/file"] }
 */
export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Strip leading colon
  const body = trimmed.startsWith(":") ? trimmed.slice(1).trim() : trimmed;
  if (!body) return null;

  // Split on whitespace; first token is the command name
  const tokens = body.split(/\s+/);
  const name = tokens[0].toLowerCase();
  const args = tokens.slice(1);

  return { name, args, raw: trimmed };
}

export class CommandHistory {
  private _history: string[] = [];
  private _cursor: number = -1; // -1 = at "current input" (no recall active)

  /** Push a command string into history (duplicates of the last entry are skipped). */
  push(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;
    if (this._history.length > 0 && this._history[this._history.length - 1] === trimmed) return;
    this._history.push(trimmed);
    this._cursor = -1; // Reset navigation
  }

  /** Navigate backwards (older commands). Returns undefined when at the oldest entry. */
  prev(): string | undefined {
    if (this._history.length === 0) return undefined;

    if (this._cursor === -1) {
      // Start navigating from the most recent
      this._cursor = this._history.length - 1;
    } else if (this._cursor > 0) {
      this._cursor--;
    }
    return this._history[this._cursor];
  }

  /** Navigate forwards (newer commands). Returns undefined when cursor is reset to live. */
  next(): string | undefined {
    if (this._cursor === -1) return undefined;
    this._cursor++;
    if (this._cursor >= this._history.length) {
      this._cursor = -1;
      return undefined;
    }
    return this._history[this._cursor];
  }

  /** Reset navigation cursor (e.g. when user edits input) */
  resetCursor(): void {
    this._cursor = -1;
  }

  get entries(): readonly string[] {
    return this._history;
  }

  get cursor(): number {
    return this._cursor;
  }
}

/**
 * Tab-complete a partial command name.
 * Returns all known command names that start with the given prefix.
 */
export function completeCommand(partial: string): CompletionResult {
  const lower = partial.toLowerCase();
  return KNOWN_COMMANDS.filter((cmd) => cmd.startsWith(lower));
}

/**
 * Tab-complete within a full command line. Operates on the name portion only
 * (argument completion is command-specific and out of scope here).
 */
export function completeLine(line: string): CompletionResult {
  const trimmed = line.startsWith(":") ? line.slice(1) : line;
  const spaceIdx = trimmed.indexOf(" ");
  // Only complete if we haven't typed a space yet (still typing the name)
  if (spaceIdx !== -1) return [];
  return completeCommand(trimmed);
}
