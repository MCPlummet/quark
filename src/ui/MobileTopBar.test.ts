import { describe, it, expect, beforeEach } from "vitest";
import { keymapManager } from "../vim/keybindings";
import { registerDefaultBindings, type AvailabilityContext } from "../app/registry";
import { buildMenu } from "../app/context_menus";
import { MobileTopBar } from "./MobileTopBar";

const ctx = (over: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  loggedIn: true,
  roomId: "!room:example.org",
  spaceId: null,
  selectedMessageId: null,
  selectedMessageIsOwn: false,
  isMobile: true,
  ...over,
});

const noop = () => { /* behaviour is irrelevant here */ };

const OVERFLOW_HANDLERS = {
  "open-search": noop,
  "open-pinned": noop,
  "open-room-info": noop,
  "toggle-members": noop,
  "help": noop,
};

const shape = (entries: ReturnType<typeof buildMenu>): string[] =>
  entries.map((e) => ("separator" in e && e.separator ? "──" : e.label));

beforeEach(() => {
  for (const entry of keymapManager.getEntries()) {
    keymapManager.unmap(entry.context, entry.sequence);
  }
  registerDefaultBindings();
});

describe("MobileTopBar", () => {
  it("exposes an overflow button", () => {
    const bar = new MobileTopBar();
    const btn = bar.getElement().querySelector<HTMLElement>(".mobile-top-bar__overflow");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-label")).toBe("More actions");
  });

  it("reports anchor coordinates when tapped", () => {
    const bar = new MobileTopBar();
    let called = false;
    bar.onOverflowClick(() => { called = true; });
    bar.getElement().querySelector<HTMLElement>(".mobile-top-bar__overflow")!.click();
    expect(called).toBe(true);
  });
});

// Mobile hides the desktop room header, which carried the only pointer path to
// search and pinned messages; presence lived in a status bar mobile hid too.
// These rows are what replaces them (#99).
describe("overflow menu contents", () => {
  it("carries the chrome the hidden room header used to", () => {
    expect(shape(buildMenu("overflow", ctx(), OVERFLOW_HANDLERS))).toEqual([
      "Search messages", "Pinned messages", "Room info",
      "──",
      "Members",
      "──",
      "Keys and commands",
    ]);
  });

  it("drops room-scoped rows when no room is open", () => {
    expect(shape(buildMenu("overflow", ctx({ roomId: null }), OVERFLOW_HANDLERS))).toEqual([
      "Keys and commands",
    ]);
  });
});
