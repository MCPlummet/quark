import { describe, it, expect, beforeEach } from "vitest";
import { keymapManager } from "../vim/keybindings";
import { registerDefaultBindings, commandEntries } from "../app/registry";
import { HelpDialog } from "./HelpDialog";

const rowsIn = (dialog: HelpDialog, section: "bindings" | "commands"): HTMLElement[] => {
  dialog.show();
  // Tab switches sections; the dialog opens on bindings.
  if (section === "commands") {
    dialog.getElement().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
  }
  return Array.from(
    dialog.getElement().querySelectorAll<HTMLElement>(`.help-dialog__row--${section}`),
  );
};

beforeEach(() => {
  for (const entry of keymapManager.getEntries()) {
    keymapManager.unmap(entry.context, entry.sequence);
  }
  registerDefaultBindings();
});

describe("HelpDialog", () => {
  // The drift that motivated #97: the hand-written table listed fifteen
  // commands while the executor implemented twenty-nine.
  it("documents every command the executor accepts", () => {
    const rows = rowsIn(new HelpDialog(), "commands");
    const listed = rows.map(
      (r) => r.querySelector(".help-dialog__cmd-name")?.textContent ?? "",
    );
    for (const entry of commandEntries()) {
      expect(listed.some((l) => l.includes(entry.command.name))).toBe(true);
    }
    expect(rows.length).toBe(commandEntries().length);
  });

  it("shows aliases beside their canonical name", () => {
    const rows = rowsIn(new HelpDialog(), "commands");
    const text = rows.map((r) => r.textContent ?? "").join("\n");
    expect(text).toContain("roomsettings / room-settings");
    expect(text).toContain("quit / q");
  });

  it("renders arrow keys as glyphs", () => {
    const rows = rowsIn(new HelpDialog(), "bindings");
    const keys = rows.map((r) => r.querySelector(".help-dialog__key")?.textContent ?? "");
    expect(keys).toContain("j / ↓");
  });

  // Arrow rows compare the prettified default against the raw live sequence,
  // so a missing prettify on one side flags every one of them as remapped.
  it("does not flag unremapped bindings as customised", () => {
    const rows = rowsIn(new HelpDialog(), "bindings");
    const flagged = rows.filter((r) =>
      r.querySelector(".help-dialog__key")?.getAttribute("title")?.startsWith("Remapped"),
    );
    expect(flagged).toEqual([]);
  });

  it("shows the live sequence after a remap", () => {
    keymapManager.unmap("global", "dd");
    keymapManager.map("global", "xx", "redact", false);
    const rows = rowsIn(new HelpDialog(), "bindings");
    const row = rows.find((r) => r.textContent?.includes("Delete the selected message"));
    const keyEl = row?.querySelector(".help-dialog__key");
    expect(keyEl?.textContent).toBe("xx");
    expect(keyEl?.getAttribute("title")).toContain("default: dd");
  });
});
