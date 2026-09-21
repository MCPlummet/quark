import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CommandBar } from "./CommandBar";
import type { ParsedCommand } from "../vim/commands";

let bar: CommandBar;
let executed: ParsedCommand[];
let cancelled: number;
/** Keydowns that reached the document — i.e. that the global handler would see. */
let escaped: string[];

const onDocument = (e: KeyboardEvent): void => { escaped.push(e.key); };

const key = (k: string, over: Partial<KeyboardEventInit> = {}): KeyboardEvent =>
  new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...over });

const input = (): HTMLInputElement =>
  bar.getElement().querySelector<HTMLInputElement>("input")!;

beforeEach(() => {
  bar = new CommandBar();
  document.body.appendChild(bar.getElement());
  executed = [];
  cancelled = 0;
  escaped = [];
  bar.onExecute((parsed) => executed.push(parsed));
  bar.onCancel(() => { cancelled++; });
  document.addEventListener("keydown", onDocument);
});

afterEach(() => {
  document.removeEventListener("keydown", onDocument);
  bar.getElement().remove();
});

describe("CommandBar", () => {
  it("runs the line on Enter", () => {
    bar.show(":join #room:server");
    input().dispatchEvent(key("Enter"));
    expect(executed).toEqual([{ name: "join", args: ["#room:server"], raw: ":join #room:server" }]);
  });

  // The global keydown handler re-reads modeManager.current rather than the mode
  // the keystroke arrived in, and Enter changes it on the way out — so an Enter
  // that reached the document was handled a second time under the mode the
  // command bar had just left: `select` with vim on (opening the focused room or
  // message), submitComposeBox with it off (sending a message, committing an
  // in-progress edit, or uploading a staged image) behind the command the user
  // actually asked for.
  it("does not let the Enter that ran a command reach the document", () => {
    bar.show(":join #room:server");
    input().dispatchEvent(key("Enter"));
    expect(executed).toHaveLength(1);
    expect(escaped).toEqual([]);
  });

  it("does not let the Escape that cancelled reach the document", () => {
    bar.show(":join ");
    input().dispatchEvent(key("Escape"));
    expect(cancelled).toBe(1);
    expect(escaped).toEqual([]);
  });

  it("does not let Ctrl+[ reach the document", () => {
    bar.show(":join ");
    input().dispatchEvent(key("[", { ctrlKey: true }));
    expect(cancelled).toBe(1);
    expect(escaped).toEqual([]);
  });

  // Ordinary text entry is the input's own business, but it must not reach the
  // document either — a bare character typed into the command line would
  // otherwise also be read as a global binding.
  it("keeps ordinary typing to itself", () => {
    bar.show(":");
    for (const k of ["j", "o", "i", "n", "Backspace"]) input().dispatchEvent(key(k));
    expect(escaped).toEqual([]);
  });

  it("keeps history and completion keys to itself", () => {
    bar.show(":join ");
    for (const k of ["ArrowUp", "ArrowDown", "Tab"]) input().dispatchEvent(key(k));
    expect(escaped).toEqual([]);
  });

  it("cancels rather than executing an empty line", () => {
    bar.show("");
    input().dispatchEvent(key("Enter"));
    expect(executed).toEqual([]);
    expect(cancelled).toBe(1);
  });

  it("hides on execute and on cancel", () => {
    bar.show(":settings");
    input().dispatchEvent(key("Enter"));
    expect(bar.getElement().style.display).toBe("none");

    bar.show(":settings");
    expect(bar.getElement().style.display).not.toBe("none");
    input().dispatchEvent(key("Escape"));
    expect(bar.getElement().style.display).toBe("none");
  });
});
