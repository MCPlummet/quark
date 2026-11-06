import { describe, it, expect, beforeEach } from "vitest";
import { keymapManager } from "../vim/keybindings";
import { actionByCommand, actionById, commandEntries, registerDefaultBindings } from "./registry";

beforeEach(() => {
  for (const entry of keymapManager.getEntries()) {
    keymapManager.unmap(entry.context, entry.sequence);
  }
  registerDefaultBindings();
});

// DESIGN.md documented :emoji, :stickers and :gif all along; the executor had
// none of them, and openStickerPicker existed with no caller at all (#102).
describe("picker commands", () => {
  it("exposes the picker commands DESIGN.md documents", () => {
    expect(actionByCommand("emoji")?.id).toBe("open-emoji-picker");
    expect(actionByCommand("stickers")?.id).toBe("open-sticker-picker");
    expect(actionByCommand("gif")?.id).toBe("open-gif-picker");
  });

  it("scopes them to a room", () => {
    for (const name of ["emoji", "stickers", "gif"]) {
      expect(actionByCommand(name)?.requires).toContain("room");
    }
  });
});

describe("pointer reachability gap-fills", () => {
  it("declares the update check reachable from settings", () => {
    expect(actionById("check-for-updates")?.chrome).toContain("settings");
  });

  // The room list header's `+` now opens a menu (new room, new space,
  // directory) rather than the directory outright (#14).
  it("declares the room directory reachable from the create menu", () => {
    expect(actionById("open-directory")?.menus?.map((m) => m.surface)).toContain("create");
  });

  // The button moved from the room-list header to the space strip, and then to
  // the status line — the drawer's footer on mobile, so it stays touch-reachable.
  it("declares the palette reachable from the status line", () => {
    expect(actionById("open-command-palette")?.chrome).toContain("status-bar");
  });

  it("gives creating rooms and spaces, and invites, real affordances", () => {
    expect(actionById("create-room")?.menus?.map((m) => m.surface)).toEqual(
      expect.arrayContaining(["create", "space", "section"]),
    );
    expect(actionById("create-space")?.chrome).toContain("space-strip");
    expect(actionById("open-invites")?.chrome).toContain("status-bar");
    expect(actionById("set-room-nick")?.chrome).toContain("settings");
  });

  it("reorders rooms from the keyboard and the room menu", () => {
    expect(actionById("move-room-up")?.bindings).toEqual([{ sequence: "K", context: "roomlist" }]);
    expect(actionById("move-room-down")?.bindings).toEqual([{ sequence: "J", context: "roomlist" }]);
    expect(actionById("move-room-up")?.menus?.[0]?.surface).toBe("room");
  });
});

// Guards the #97 invariant as the registry grows: every `:` command must still
// resolve to exactly one entry, aliases included.
describe("command vocabulary stays coherent", () => {
  it("resolves every registered command name to its own entry", () => {
    for (const entry of commandEntries()) {
      expect(actionByCommand(entry.command.name)).toBe(entry);
      for (const alias of entry.command.aliases ?? []) {
        expect(actionByCommand(alias)).toBe(entry);
      }
    }
  });
});
