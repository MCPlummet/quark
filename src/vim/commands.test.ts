import { describe, it, expect, beforeEach } from "vitest";
import { parseCommand, CommandHistory } from "./commands";

describe("parseCommand", () => {
  // ── Basic parsing ─────────────────────────────────────────────────────

  it("parses a bare command with no args", () => {
    expect(parseCommand("leave")).toEqual({
      name: "leave",
      args: [],
      raw: "leave",
    });
  });

  it("parses a colon-prefixed command with no args", () => {
    expect(parseCommand(":leave")).toEqual({
      name: "leave",
      args: [],
      raw: ":leave",
    });
  });

  it("parses a command with a single argument", () => {
    const result = parseCommand(":theme phosphor");
    expect(result).toEqual({ name: "theme", args: ["phosphor"], raw: ":theme phosphor" });
  });

  it("parses join with a Matrix room ID", () => {
    const result = parseCommand(":join #room:server.org");
    expect(result).toEqual({ name: "join", args: ["#room:server.org"], raw: ":join #room:server.org" });
  });

  it("parses upload with a file path", () => {
    const result = parseCommand(":upload /path/to/file");
    expect(result).toEqual({ name: "upload", args: ["/path/to/file"], raw: ":upload /path/to/file" });
  });

  it("parses a command with multiple arguments", () => {
    const result = parseCommand(":invite @user:server.org #room:server.org");
    expect(result).toEqual({
      name: "invite",
      args: ["@user:server.org", "#room:server.org"],
      raw: ":invite @user:server.org #room:server.org",
    });
  });

  it("normalises command name to lower-case", () => {
    const result = parseCommand(":LEAVE");
    expect(result?.name).toBe("leave");
  });

  it("returns null for empty input", () => {
    expect(parseCommand("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(parseCommand("   ")).toBeNull();
  });

  it("returns null for lone colon", () => {
    expect(parseCommand(":")).toBeNull();
  });

  it("trims leading/trailing whitespace", () => {
    const result = parseCommand("  :theme phosphor  ");
    expect(result?.name).toBe("theme");
    expect(result?.args).toEqual(["phosphor"]);
  });
});

describe("CommandHistory", () => {
  let history: CommandHistory;

  beforeEach(() => {
    history = new CommandHistory();
  });

  it("starts empty", () => {
    expect(history.entries).toHaveLength(0);
  });

  it("push() adds a command", () => {
    history.push(":join #room:server.org");
    expect(history.entries).toHaveLength(1);
  });

  it("push() ignores empty strings", () => {
    history.push("");
    expect(history.entries).toHaveLength(0);
  });

  it("push() ignores whitespace-only strings", () => {
    history.push("   ");
    expect(history.entries).toHaveLength(0);
  });

  it("push() deduplicates consecutive identical entries", () => {
    history.push(":leave");
    history.push(":leave");
    expect(history.entries).toHaveLength(1);
  });

  it("push() allows non-consecutive duplicates", () => {
    history.push(":leave");
    history.push(":join #a:b");
    history.push(":leave");
    expect(history.entries).toHaveLength(3);
  });

  it("prev() returns the most recent entry", () => {
    history.push(":join #a:b");
    history.push(":leave");
    expect(history.prev()).toBe(":leave");
  });

  it("prev() navigates backwards through history", () => {
    history.push(":join #a:b");
    history.push(":leave");
    history.prev(); // :leave
    expect(history.prev()).toBe(":join #a:b");
  });

  it("prev() stops at the oldest entry", () => {
    history.push(":leave");
    history.prev(); // :leave
    expect(history.prev()).toBe(":leave"); // no older entry, stays
  });

  it("prev() returns undefined when history is empty", () => {
    expect(history.prev()).toBeUndefined();
  });

  it("next() returns a newer entry after prev()", () => {
    history.push(":join #a:b");
    history.push(":leave");
    history.prev(); // :leave
    history.prev(); // :join #a:b
    expect(history.next()).toBe(":leave");
  });

  it("next() returns undefined when navigating past the newest entry", () => {
    history.push(":leave");
    history.prev();
    expect(history.next()).toBeUndefined();
  });

  it("next() returns undefined with no prior prev() call", () => {
    history.push(":leave");
    expect(history.next()).toBeUndefined();
  });

  it("resetCursor() resets navigation to live position", () => {
    history.push(":join #a:b");
    history.push(":leave");
    history.prev();
    history.resetCursor();
    expect(history.cursor).toBe(-1);
    // After reset, next() should be undefined
    expect(history.next()).toBeUndefined();
  });

  it("push() resets cursor", () => {
    history.push(":leave");
    history.prev();
    history.push(":join #a:b");
    expect(history.cursor).toBe(-1);
  });
});
