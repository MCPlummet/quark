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

  it("declares the room directory reachable from the drawer", () => {
    expect(actionById("open-directory")?.chrome).toContain("drawer");
  });

  // The button moved out of the room-list header and into the space strip,
  // which is inside the drawer on mobile — so it stays touch-reachable.
  it("declares the palette reachable from the space strip", () => {
    expect(actionById("open-command-palette")?.chrome).toContain("space-strip");
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
