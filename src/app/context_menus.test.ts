import { describe, it, expect, beforeEach } from "vitest";
import { keymapManager } from "../vim/keybindings";
import { registerDefaultBindings, type AvailabilityContext } from "./registry";
import { buildMenu, type MenuHandlers } from "./context_menus";

const ctx = (over: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  loggedIn: true,
  roomId: "!room:example.org",
  spaceId: "!space:example.org",
  selectedMessageId: "$evt",
  selectedMessageIsOwn: true,
  isMobile: false,
  ...over,
});

const noop = () => { /* behaviour is irrelevant to these assertions */ };

const MESSAGE_HANDLERS: MenuHandlers = {
  "reply": noop,
  "react": noop,
  "open-thread": noop,
  "copy-message": noop,
  "view-raw-event": noop,
  "edit": noop,
  "redact": noop,
};

/** Labels in order, with "──" standing in for a separator. */
const shape = (entries: ReturnType<typeof buildMenu>): string[] =>
  entries.map((e) => ("separator" in e && e.separator ? "──" : e.label));

beforeEach(() => {
  for (const entry of keymapManager.getEntries()) {
    keymapManager.unmap(entry.context, entry.sequence);
  }
  registerDefaultBindings();
});

describe("buildMenu", () => {
  it("reproduces the message menu's grouping", () => {
    expect(shape(buildMenu("message", ctx(), MESSAGE_HANDLERS))).toEqual([
      "Reply", "React", "Thread",
      "──",
      "Copy message text", "View raw event",
      "──",
      "Edit", "Delete",
    ]);
  });

  it("drops own-message rows on someone else's message", () => {
    const entries = buildMenu("message", ctx({ selectedMessageIsOwn: false }), MESSAGE_HANDLERS);
    expect(shape(entries)).toEqual([
      "Reply", "React", "Thread",
      "──",
      "Copy message text", "View raw event",
    ]);
  });

  it("drops rows the caller supplies no handler for", () => {
    const entries = buildMenu("message", ctx(), { "reply": noop, "redact": noop });
    expect(shape(entries)).toEqual(["Reply", "──", "Delete"]);
  });

  // A group emptied by filtering must not leave its rule behind.
  it("never emits a leading, trailing or doubled separator", () => {
    for (const handlers of [
      MESSAGE_HANDLERS,
      { "reply": noop } as MenuHandlers,
      { "redact": noop } as MenuHandlers,
      { "reply": noop, "edit": noop } as MenuHandlers,
      {} as MenuHandlers,
    ]) {
      const s = shape(buildMenu("message", ctx(), handlers));
      expect(s[0]).not.toBe("──");
      expect(s[s.length - 1]).not.toBe("──");
      for (let i = 1; i < s.length; i++) {
        expect(s[i] === "──" && s[i - 1] === "──").toBe(false);
      }
    }
  });

  it("returns nothing when no handler is supplied", () => {
    expect(buildMenu("message", ctx(), {})).toEqual([]);
  });

  it("labels rows with the live keybinding, not the registry default", () => {
    const hintFor = (label: string) => {
      const row = buildMenu("message", ctx(), MESSAGE_HANDLERS)
        .find((e) => !("separator" in e && e.separator) && e.label === label);
      return row && !("separator" in row && row.separator) ? row.hint : undefined;
    };
    expect(hintFor("Delete")).toBe("dd");

    keymapManager.unmap("global", "dd");
    keymapManager.map("global", "xx", "redact", false);
    expect(hintFor("Delete")).toBe("xx");
  });

  it("omits the hint for an action with no binding", () => {
    const raw = buildMenu("message", ctx(), MESSAGE_HANDLERS)
      .find((e) => !("separator" in e && e.separator) && e.label === "View raw event");
    expect(raw && !("separator" in raw && raw.separator) ? raw.hint : "unset").toBeUndefined();
  });

  it("offers Mark as read only when the caller passes its handler", () => {
    const base: MenuHandlers = {
      "open-room": noop,
      "open-room-settings": noop,
      "open-room-info": noop,
    };
    expect(shape(buildMenu("room", ctx(), base))).toEqual([
      "Open", "──", "Room settings", "Room info",
    ]);
    expect(shape(buildMenu("room", ctx(), { ...base, "mark-room-read": noop }))).toEqual([
      "Open", "──", "Room settings", "Room info", "──", "Mark as read",
    ]);
  });

  it("evaluates requirements against the menu's target, not the open room", () => {
    // The room menu passes the room under the cursor; with none supplied, the
    // room-scoped rows drop out rather than opening settings for nothing.
    const entries = buildMenu("room", ctx({ roomId: null }), {
      "open-room": noop,
      "open-room-settings": noop,
    });
    expect(shape(entries)).toEqual(["Open"]);
  });
});
