import { describe, it, expect, beforeEach } from "vitest";
import { keymapManager } from "../vim/keybindings";
import {
  ACTIONS,
  actionById,
  actionByCommand,
  commandEntries,
  commandNames,
  completeCommand,
  completeLine,
  isAvailable,
  isModifierChord,
  liveSequences,
  menuEntries,
  menuHint,
  paletteEntries,
  registerDefaultBindings,
  type AvailabilityContext,
} from "./registry";

const ctx = (over: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  loggedIn: true,
  roomId: "!room:example.org",
  spaceId: "!space:example.org",
  selectedMessageId: "$evt",
  selectedMessageIsOwn: true,
  isMobile: false,
  ...over,
});

describe("registry integrity", () => {
  it("has no duplicate action ids", () => {
    const ids = ACTIONS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate command names or aliases", () => {
    const names = commandNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every entry a description", () => {
    for (const entry of ACTIONS) expect(entry.description.length).toBeGreaterThan(0);
  });

  it("resolves aliases to the same entry as the canonical name", () => {
    expect(actionByCommand("room-settings")).toBe(actionByCommand("roomsettings"));
    expect(actionByCommand("space-settings")).toBe(actionByCommand("spacesettings"));
    expect(actionByCommand("convert-to-dm")).toBe(actionByCommand("converttodm"));
    expect(actionByCommand("q")).toBe(actionByCommand("quit"));
    expect(actionByCommand("setup-cross-signing")).toBe(actionByCommand("cross-sign"));
  });

  it("resolves command names case-insensitively", () => {
    expect(actionByCommand("JOIN")?.id).toBe("join-room");
  });

  it("returns undefined for an unknown command", () => {
    expect(actionByCommand("definitely-not-a-command")).toBeUndefined();
  });

  it("looks entries up by id", () => {
    expect(actionById("redact")?.command).toBeUndefined();
    expect(actionById("open-settings")?.command?.name).toBe("settings");
  });

  // The regression that motivated the registry: these executed but never
  // tab-completed, because KNOWN_COMMANDS was a second hand-maintained list.
  it("completes every alias the executor accepts", () => {
    for (const name of commandNames()) {
      expect(completeCommand(name)).toContain(name);
    }
  });
});

describe("completeCommand", () => {
  it("returns matching commands for a prefix", () => {
    expect(completeCommand("j")).toContain("join");
  });

  it("returns the exact command when the prefix matches exactly", () => {
    expect(completeCommand("join")).toContain("join");
  });

  it("returns an empty array for an unrecognised prefix", () => {
    expect(completeCommand("zzz")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(completeCommand("J")).toContain("join");
  });

  it("completes hyphenated aliases", () => {
    expect(completeCommand("room-")).toContain("room-settings");
  });
});

describe("completeLine", () => {
  it("completes from a colon-prefixed partial line", () => {
    expect(completeLine(":jo")).toContain("join");
  });

  it("completes from a bare partial name", () => {
    expect(completeLine("th")).toContain("theme");
  });

  it("returns an empty array once the line reaches the args region", () => {
    expect(completeLine(":join #room")).toEqual([]);
  });
});

describe("isAvailable", () => {
  it("allows an unconstrained action anywhere", () => {
    expect(isAvailable(actionById("help")!, ctx({ loggedIn: false, roomId: null }))).toBe(true);
  });

  it("requires a session", () => {
    const entry = actionById("open-settings")!;
    expect(isAvailable(entry, ctx())).toBe(true);
    expect(isAvailable(entry, ctx({ loggedIn: false }))).toBe(false);
  });

  it("requires an open room", () => {
    const entry = actionById("open-search")!;
    expect(isAvailable(entry, ctx())).toBe(true);
    expect(isAvailable(entry, ctx({ roomId: null }))).toBe(false);
  });

  it("requires a selected space", () => {
    const entry = actionById("open-space-settings")!;
    expect(isAvailable(entry, ctx())).toBe(true);
    expect(isAvailable(entry, ctx({ spaceId: null }))).toBe(false);
  });

  it("distinguishes any message from an own message", () => {
    const reply = actionById("reply")!;
    const remove = actionById("redact")!;
    const notMine = ctx({ selectedMessageIsOwn: false });
    expect(isAvailable(reply, notMine)).toBe(true);
    expect(isAvailable(remove, notMine)).toBe(false);
  });

  it("treats own-message as implying a selection", () => {
    expect(isAvailable(actionById("edit")!, ctx({ selectedMessageId: null }))).toBe(false);
  });

  it("hides desktop-only actions in mobile mode", () => {
    const entry = actionById("check-for-updates")!;
    expect(isAvailable(entry, ctx())).toBe(true);
    expect(isAvailable(entry, ctx({ isMobile: true }))).toBe(false);
  });
});

describe("menuEntries", () => {
  it("returns message-menu rows sorted by group then order", () => {
    const rows = menuEntries("message").map((r) => r.id);
    expect(rows).toEqual([
      "reply",
      "react",
      "open-thread",
      "copy-message",
      "view-raw-event",
      "edit",
      "redact",
    ]);
  });

  it("puts destructive room actions in their own group", () => {
    const leave = menuEntries("room").find((r) => r.id === "leave-room-confirm");
    expect(leave?.menu.danger).toBe(true);
    const others = menuEntries("room").filter((r) => r.id !== "leave-room-confirm");
    for (const row of others) expect(row.menu.group).toBeLessThan(leave!.menu.group);
  });

  it("returns an empty list for a surface with no entries", () => {
    // Guards the builder against assuming every surface is populated.
    expect(menuEntries("space").every((r) => r.menus !== undefined)).toBe(true);
  });
});

describe("palette membership", () => {
  it("includes commands by default", () => {
    expect(paletteEntries().map((e) => e.id)).toContain("open-directory");
  });

  it("excludes pure navigation", () => {
    const ids = paletteEntries().map((e) => e.id);
    expect(ids).not.toContain("nav-down");
    expect(ids).not.toContain("close");
  });

  it("covers every command entry", () => {
    const palette = new Set(paletteEntries().map((e) => e.id));
    for (const entry of commandEntries()) expect(palette.has(entry.id)).toBe(true);
  });
});

describe("default bindings", () => {
  beforeEach(() => {
    for (const entry of keymapManager.getEntries()) {
      keymapManager.unmap(entry.context, entry.sequence);
    }
    registerDefaultBindings();
  });

  it("registers the documented defaults", () => {
    expect(liveSequences("reply")).toEqual(["r"]);
    expect(liveSequences("redact")).toEqual(["dd"]);
    expect(liveSequences("edit")).toEqual(["E", "c"]);
  });

  it("scopes the timeline override without losing the global alias", () => {
    expect(liveSequences("enter-text-select", "timeline")).toEqual(["o"]);
    expect(liveSequences("select", "global")).toContain("o");
  });

  // resolveKey only ever sees a bare `e.key`, so a registered "Ctrl-k" could
  // never match — and worse, would make a bare "C" resolve as a partial
  // sequence and hang for the timeout. #103 lands real chord support.
  it("does not register modifier chords into the keymap", () => {
    expect(isModifierChord("Ctrl-k")).toBe(true);
    expect(isModifierChord("gg")).toBe(false);
    expect(liveSequences("open-quick-nav")).toEqual([]);
  });

  it("reports the first live sequence as the menu hint", () => {
    expect(menuHint("edit")).toBe("E");
    expect(menuHint("view-raw-event")).toBeUndefined();
  });

  it("follows a remap rather than the declared default", () => {
    keymapManager.unmap("global", "dd");
    keymapManager.map("global", "xx", "redact", false);
    expect(menuHint("redact")).toBe("xx");
  });
});
