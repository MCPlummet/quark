import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// End-to-end key routing for the compose box's undo (#117): real keydown
// events through setupKeyboard's document listener, into a real Input and the
// real autocomplete popups. Everything else setupKeyboard wires at startup is a
// stub that answers any call.

vi.mock("../ipc/app_config.js", () => ({
  getAppConfig: vi.fn(() => new Promise(() => {})), // never settles: keep the test's vimMode
  setAppConfig: vi.fn(async () => {}),
}));
vi.mock("../ipc/config.js", () => ({ loadQuarkrc: vi.fn(() => new Promise(() => {})) }));
vi.mock("./file_drop.js", () => ({ setupFileDrop: vi.fn(async () => () => {}) }));
vi.mock("./media_save.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media_save.js")>()),
  initSaveTargets: vi.fn(async () => []),
}));
vi.mock("./actions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actions.js")>()),
  setupReactionChipHandler: vi.fn(),
  setupMessageActionHandlers: vi.fn(),
  setupStatusBar: vi.fn(),
}));

import { setupKeyboard } from "./keyboard.js";
import { setComponents } from "./actions/context.js";
import { startEdit, cancelEdit } from "./actions/messages.js";
import { AppState } from "./state.js";
import { modeManager, Mode } from "../vim/mode.js";
import { keymapManager } from "../vim/keybindings.js";
import { exitTextSelect } from "./text_select.js";
import { Input } from "../ui/Input.js";
import { MentionPreview } from "../ui/MentionPreview.js";
import { ShortcodePreview } from "../ui/ShortcodePreview.js";
import type { AppComponents } from "../ui/App.js";

/**
 * An object any property of which is a function returning another such object,
 * except for the properties given.
 */
function stub(given: Record<PropertyKey, unknown> = {}): any {
  const cache = new Map<PropertyKey, unknown>(Object.entries(given));
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return undefined; // not a thenable
      if (!cache.has(prop)) cache.set(prop, stub());
      return cache.get(prop);
    },
    apply: () => stub(),
  });
}

let input: Input;
let mentionPreview: MentionPreview;
let field: HTMLTextAreaElement;
const timeline = stub({ selectLast: vi.fn(() => true) });

beforeAll(() => {
  input = new Input();
  document.body.appendChild(input.getElement());
  mentionPreview = new MentionPreview();
  document.body.appendChild(mentionPreview.getElement());
  field = input.getFieldElement();
  const components = new Proxy(
    { input, mentionPreview, shortcodePreview: new ShortcodePreview(), timeline } as Record<string, unknown>,
    { get: (t, prop: string) => (prop in t ? t[prop] : (t[prop] = stub())) },
  ) as unknown as AppComponents;
  setComponents(components);
  setupKeyboard(components);
  // The timeline as the panel above the compose box, its selection at the bottom.
  AppState.registerPanelNav("timeline", { navDown: () => false, navUp: () => false, composeBelow: true });
});

beforeEach(() => {
  AppState.patch({ loggedIn: true, vimMode: true, activePanel: "timeline", editingEventId: null });
  mentionPreview.hide();
  // An empty box with nothing to undo first, so leaving Insert below can't
  // land in compose Normal.
  input.restoreDraft();
  input.resetValue("");
  modeManager.transition(Mode.Normal);
  exitTextSelect();
  keymapManager.resetSequence();
});

/** Press a key, as the browser delivers it to whatever has focus. */
function press(key: string, mods: Partial<Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "metaKey" | "altKey">> = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
}

/** One browser edit of the field: beforeinput, the change, input. */
function browserEdit(inputType: string, data: string | null, next: string, caret: number): void {
  field.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true }));
  field.value = next;
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new InputEvent("input", { inputType, data, bubbles: true }));
}

function typeChars(text: string): void {
  for (const ch of text) {
    const at = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? at;
    browserEdit("insertText", ch, field.value.slice(0, at) + ch + field.value.slice(end), at + 1);
  }
}

/** Enter Insert as `i` does, with the caret at the end of the draft. */
function enterInsert(): void {
  press("i");
  field.setSelectionRange(field.value.length, field.value.length);
}

const inComposeNormal = (): boolean =>
  modeManager.current === Mode.Normal && AppState.get("textSelectMode") === "compose";

describe("compose Normal undo", () => {
  it("u undoes in compose Normal", () => {
    enterInsert();
    typeChars("hello world");
    press("Escape");
    expect(inComposeNormal()).toBe(true);
    press("u");
    expect(input.getValue()).toBe("hello ");
  });

  // Review fix: the Edit-menu / shake undo (a beforeinput historyUndo) skipped
  // the re-settle the chord and `u` did, so it could leave the caret past the
  // end of the line, where `x` and the block cursor find nothing.
  it.each([
    ["the platform's own undo", () => {
      field.dispatchEvent(new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true }));
    }],
    ["u", () => press("u")],
    ["Ctrl-z", () => press("z", { ctrlKey: true })],
  ])("%s re-settles the block cursor", (_name, undo) => {
    enterInsert();
    typeChars("abc");
    press("Escape");
    press("x"); // block on the "c": deletes it
    expect(input.getValue()).toBe("ab");
    undo();
    expect(input.getValue()).toBe("abc");
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 3]);
    press("x");
    expect(input.getValue()).toBe("ab");
  });
});

describe("compose Normal history chords", () => {
  /** A draft with two undo steps, in compose Normal. */
  function draftInComposeNormal(): void {
    enterInsert();
    typeChars("one two");
    press("Escape");
  }

  it("redoes with vim's Ctrl-r, counts included", () => {
    draftInComposeNormal();
    press("u");
    press("u");
    expect(input.getValue()).toBe("");
    press("2");
    const e = press("r", { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true); // not the webview's "reload"
    expect(input.getValue()).toBe("one two");
  });

  it("undoes and redoes with the Insert chords", () => {
    draftInComposeNormal();
    press("z", { ctrlKey: true });
    expect(input.getValue()).toBe("one ");
    press("y", { ctrlKey: true });
    expect(input.getValue()).toBe("one two");
    press("z", { ctrlKey: true });
    press("Z", { ctrlKey: true, shiftKey: true });
    expect(input.getValue()).toBe("one two");
  });

  // Review fix: the chords were hardcoded here, so a quarkrc remap applied in
  // Insert and not in compose Normal.
  it("follows a quarkrc's iunmap and imap", () => {
    keymapManager.unmap("insert", "Ctrl-y");
    keymapManager.map("insert", "Ctrl-Alt-z", "compose-undo");
    try {
      draftInComposeNormal();
      press("z", { ctrlKey: true, altKey: true });
      expect(input.getValue()).toBe("one ");
      const e = press("y", { ctrlKey: true });
      expect(e.defaultPrevented).toBe(false); // no longer claimed
      expect(input.getValue()).toBe("one ");
    } finally {
      keymapManager.unmap("insert", "Ctrl-Alt-z");
      keymapManager.map("insert", "Ctrl-y", "compose-redo");
    }
  });
});

describe("Insert undo with the mention popup open", () => {
  const alice = { userId: "@alice:x", displayName: "alice" };

  /** "hi @al" typed in Insert, with the popup offering a completion. */
  function mentionInProgress(): void {
    enterInsert();
    typeChars("hi @al");
    mentionPreview.show([alice]);
    expect(mentionPreview.isVisible()).toBe(true);
  }

  // Review fix: the global keydown returned before Insert routing while the
  // popup was up, so Ctrl-Z / Ctrl-Shift-Z / Ctrl-Y never reached the history.
  it("undoes and redoes, and the popup follows the text", () => {
    mentionInProgress();
    const e = press("z", { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(input.getValue()).toBe("hi ");
    expect(mentionPreview.isVisible()).toBe(false); // no @query left to complete

    mentionPreview.show([alice]);
    press("y", { ctrlKey: true });
    expect(input.getValue()).toBe("hi @al");
  });

  // The same early return left the popup's own keys dead.
  it("gives the popup its own keys", () => {
    mentionInProgress();
    press("Enter");
    expect(input.getValue()).toBe("hi @alice ");
    expect(mentionPreview.isVisible()).toBe(false);

    typeChars("@al");
    mentionPreview.show([alice]);
    press("Escape");
    expect(mentionPreview.isVisible()).toBe(false);
    expect(modeManager.current).toBe(Mode.Insert); // Esc closed the popup, not Insert
  });
});

describe("an emptied draft", () => {
  /** The review's repro: a draft, select-all + Backspace, Esc. */
  function emptyTheDraft(): void {
    enterInsert();
    typeChars("hello world");
    field.setSelectionRange(0, field.value.length);
    browserEdit("deleteContentBackward", null, "", 0);
    press("Escape");
  }

  // Review fix: Esc on an empty box always left it for the timeline, where `u`
  // is unbound — so the headline case, bringing back a deleted draft, did nothing.
  it("Esc keeps the box in compose Normal, where u brings the draft back", () => {
    emptyTheDraft();
    expect(inComposeNormal()).toBe(true);
    press("u");
    expect(input.getValue()).toBe("hello world");
  });

  it("j from the bottom of the timeline comes back to it", () => {
    emptyTheDraft();
    press("k"); // up into the timeline
    expect(inComposeNormal()).toBe(false);
    press("j");
    expect(inComposeNormal()).toBe(true);
    press("u");
    expect(input.getValue()).toBe("hello world");
  });

  it("an empty box with nothing to undo is still left for the timeline", () => {
    enterInsert();
    press("Escape");
    expect(inComposeNormal()).toBe(false);
    press("j");
    expect(inComposeNormal()).toBe(false);
  });
});

describe("editing a message with a draft in the box", () => {
  // Review fix: startEdit threw the draft away, so cancelling the edit — or
  // sending it — left an empty box.
  it("brings the draft back when the edit is cancelled", () => {
    enterInsert();
    typeChars("my draft");
    startEdit("$mine:x", "old message");
    expect(input.getValue()).toBe("old message");
    cancelEdit();
    expect(input.getValue()).toBe("my draft");
    input.undo();
    expect(input.getValue()).toBe("my ");
  });

  it("brings the draft back once the edit is sent", () => {
    enterInsert();
    typeChars("my draft");
    startEdit("$mine:x", "old message");
    enterInsert();
    typeChars(" fixed");
    press("Enter", { ctrlKey: true });
    expect(AppState.get("editingEventId")).toBeNull();
    expect(input.getValue()).toBe("my draft");
  });
});
