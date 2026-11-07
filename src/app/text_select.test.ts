import { describe, it, expect, beforeEach } from "vitest";
import {
  enterMessageTextSelect,
  enterComposeTextSelect,
  exitTextSelect,
  getSelectedText,
  modifyComposeSelection,
  primeBlockSelection,
  setBlockCursor,
  setVisualModeClass,
  collapseToFocus,
} from "./text_select";
import { AppState } from "./state";

describe("text_select", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    AppState.set("textSelectMode", null);
  });

  // ── enter / exit ─────────────────────────────────────────────────────────

  describe("enterMessageTextSelect", () => {
    it("flags state and makes the body editable + focused", () => {
      const body = document.createElement("div");
      body.className = "message__body";
      body.textContent = "hello world";
      document.body.appendChild(body);

      enterMessageTextSelect(body);

      expect(AppState.get("textSelectMode")).toBe("message");
      expect(body.getAttribute("contenteditable")).toBe("true");
      expect(body.getAttribute("tabindex")).toBe("0");
      expect(body.classList.contains("message__body--text-select")).toBe(true);
      expect(document.activeElement).toBe(body);
    });

    it("exits any prior text-select before entering a new one", () => {
      const bodyA = document.createElement("div");
      bodyA.textContent = "alpha";
      document.body.appendChild(bodyA);
      const bodyB = document.createElement("div");
      bodyB.textContent = "beta";
      document.body.appendChild(bodyB);

      enterMessageTextSelect(bodyA);
      enterMessageTextSelect(bodyB);

      // Old body should no longer be in text-select state
      expect(bodyA.classList.contains("message__body--text-select")).toBe(false);
      expect(bodyA.hasAttribute("contenteditable")).toBe(false);
      // New body should be active
      expect(bodyB.classList.contains("message__body--text-select")).toBe(true);
      expect(AppState.get("textSelectMode")).toBe("message");
    });
  });

  describe("enterComposeTextSelect", () => {
    it("sets the submode to 'compose'", () => {
      enterComposeTextSelect();
      expect(AppState.get("textSelectMode")).toBe("compose");
    });

    it("supersedes an active message-target text-select", () => {
      const body = document.createElement("div");
      body.textContent = "x";
      document.body.appendChild(body);
      enterMessageTextSelect(body);
      enterComposeTextSelect();

      expect(AppState.get("textSelectMode")).toBe("compose");
      expect(body.classList.contains("message__body--text-select")).toBe(false);
    });
  });

  describe("exitTextSelect", () => {
    it("restores the message body to its prior state", () => {
      const body = document.createElement("div");
      body.textContent = "hello";
      document.body.appendChild(body);

      enterMessageTextSelect(body);
      exitTextSelect();

      expect(AppState.get("textSelectMode")).toBe(null);
      expect(body.hasAttribute("contenteditable")).toBe(false);
      expect(body.hasAttribute("tabindex")).toBe(false);
      expect(body.classList.contains("message__body--text-select")).toBe(false);
    });

    it("is a no-op when no text-select is active", () => {
      exitTextSelect();
      expect(AppState.get("textSelectMode")).toBe(null);
    });

    // The block cursor is a real one-character selection. Leaving it in place
    // let the next insertion — an emoji picked after `:emoji` — replace the
    // character under it.
    describe("on the compose box", () => {
      function composeField(value: string, caret: number): HTMLTextAreaElement {
        const field = document.createElement("textarea");
        field.value = value;
        document.body.appendChild(field);
        field.focus();
        field.setSelectionRange(caret, caret);
        return field;
      }

      it("collapses a block at the end of the text to the caret after it", () => {
        const field = composeField("hello", 5);
        enterComposeTextSelect(field);
        expect([field.selectionStart, field.selectionEnd]).toEqual([4, 5]); // block on "o"
        exitTextSelect();
        expect([field.selectionStart, field.selectionEnd]).toEqual([5, 5]);
        field.setRangeText("😂", field.selectionStart!, field.selectionEnd!, "end");
        expect(field.value).toBe("hello😂");
      });

      it("collapses a block inside the text to the caret before it", () => {
        const field = composeField("hello", 2);
        enterComposeTextSelect(field);
        expect([field.selectionStart, field.selectionEnd]).toEqual([2, 3]);
        exitTextSelect();
        expect([field.selectionStart, field.selectionEnd]).toEqual([2, 2]);
      });

      it("drops the block and Visual styling from the field", () => {
        const field = composeField("hello", 1);
        enterComposeTextSelect(field);
        setVisualModeClass(true, field);
        exitTextSelect();
        expect(field.classList.contains("input-bar__field--text-select-block")).toBe(false);
        expect(field.classList.contains("input-bar__field--text-select-visual")).toBe(false);
      });
    });

    it("restores prior contenteditable / tabindex attributes if they existed", () => {
      const body = document.createElement("div");
      body.setAttribute("contenteditable", "false");
      body.setAttribute("tabindex", "-1");
      body.textContent = "hi";
      document.body.appendChild(body);

      enterMessageTextSelect(body);
      exitTextSelect();

      expect(body.getAttribute("contenteditable")).toBe("false");
      expect(body.getAttribute("tabindex")).toBe("-1");
    });
  });

  // ── getSelectedText ──────────────────────────────────────────────────────

  describe("getSelectedText", () => {
    it("returns the selected substring of the compose input", () => {
      const input = document.createElement("textarea");
      input.value = "hello world";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(6, 11);

      enterComposeTextSelect();
      expect(getSelectedText(input)).toBe("world");
    });

    it("returns empty string when text-select is inactive", () => {
      const input = document.createElement("textarea");
      input.value = "hello world";
      document.body.appendChild(input);
      input.setSelectionRange(0, 5);

      expect(getSelectedText(input)).toBe("");
    });
  });

  // ── modifyComposeSelection ───────────────────────────────────────────────

  describe("modifyComposeSelection", () => {
    it("moves the caret forward one character", () => {
      const input = document.createElement("textarea");
      input.value = "abcdef";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(2, 2);

      modifyComposeSelection(input, "move", "forward", "character");
      expect(input.selectionStart).toBe(3);
      expect(input.selectionEnd).toBe(3);
    });

    it("clamps caret movement at the start and end", () => {
      const input = document.createElement("textarea");
      input.value = "ab";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(0, 0);
      modifyComposeSelection(input, "move", "backward", "character");
      expect(input.selectionStart).toBe(0);

      input.setSelectionRange(2, 2);
      modifyComposeSelection(input, "move", "forward", "character");
      expect(input.selectionEnd).toBe(2);
    });

    it("extends selection forward by one character", () => {
      const input = document.createElement("textarea");
      input.value = "abcdef";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(2, 2);

      modifyComposeSelection(input, "extend", "forward", "character");
      expect(input.selectionStart).toBe(2);
      expect(input.selectionEnd).toBe(3);
    });

    it("extends selection backward across the anchor", () => {
      const input = document.createElement("textarea");
      input.value = "abcdef";
      document.body.appendChild(input);
      input.focus();
      // Start a forward selection 2..4, then extend backward past anchor (2).
      input.setSelectionRange(2, 4, "forward");

      modifyComposeSelection(input, "extend", "backward", "character"); // focus 4→3
      expect(input.selectionStart).toBe(2);
      expect(input.selectionEnd).toBe(3);

      modifyComposeSelection(input, "extend", "backward", "character"); // focus 3→2 (collapsed)
      modifyComposeSelection(input, "extend", "backward", "character"); // focus 2→1; anchor 2
      expect(input.selectionStart).toBe(1);
      expect(input.selectionEnd).toBe(2);
    });

    it("jumps by word", () => {
      const input = document.createElement("textarea");
      input.value = "hello world from quark";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(0, 0);

      modifyComposeSelection(input, "move", "forward", "word");
      // After first word ("hello"), caret should be at the space boundary (5)
      expect(input.selectionStart).toBe(5);
    });
  });

  // ── Block cursor (visual mode) ───────────────────────────────────────────

  describe("primeBlockSelection (compose target)", () => {
    it("expands a collapsed caret to cover one forward character", () => {
      const input = document.createElement("textarea");
      input.value = "hello";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(2, 2);

      enterComposeTextSelect();
      primeBlockSelection(input);

      expect(input.selectionStart).toBe(2);
      expect(input.selectionEnd).toBe(3);
    });

    it("falls back to extending backward at the end of the field", () => {
      const input = document.createElement("textarea");
      input.value = "hi";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(2, 2);

      enterComposeTextSelect();
      primeBlockSelection(input);

      expect(input.selectionStart).toBe(1);
      expect(input.selectionEnd).toBe(2);
    });

    it("leaves a non-collapsed selection alone", () => {
      const input = document.createElement("textarea");
      input.value = "hello";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(1, 3);

      enterComposeTextSelect();
      primeBlockSelection(input);

      expect(input.selectionStart).toBe(1);
      expect(input.selectionEnd).toBe(3);
    });
  });

  describe("setBlockCursor", () => {
    it("toggles the message-body block-cursor class", () => {
      const body = document.createElement("div");
      body.textContent = "abc";
      document.body.appendChild(body);
      enterMessageTextSelect(body);

      // Entering text-select already turns the class on.
      expect(body.classList.contains("message__body--text-select-block")).toBe(true);
      setBlockCursor(false);
      expect(body.classList.contains("message__body--text-select-block")).toBe(false);
      setBlockCursor(true);
      expect(body.classList.contains("message__body--text-select-block")).toBe(true);
    });

    it("toggles the compose input's block-cursor class", () => {
      const input = document.createElement("textarea");
      input.value = "abc";
      document.body.appendChild(input);
      enterComposeTextSelect(input);

      // Entering compose text-select sets the class via the optional field arg.
      expect(input.classList.contains("input-bar__field--text-select-block")).toBe(true);
      setBlockCursor(false, input);
      expect(input.classList.contains("input-bar__field--text-select-block")).toBe(false);
      setBlockCursor(true, input);
      expect(input.classList.contains("input-bar__field--text-select-block")).toBe(true);
    });

    it("drops the class on exit", () => {
      const body = document.createElement("div");
      body.textContent = "abc";
      document.body.appendChild(body);
      enterMessageTextSelect(body);

      exitTextSelect();
      expect(body.classList.contains("message__body--text-select-block")).toBe(false);
    });
  });

  describe("setVisualModeClass", () => {
    it("toggles the message-body visual class for muted selection palette", () => {
      const body = document.createElement("div");
      body.textContent = "hi";
      document.body.appendChild(body);
      enterMessageTextSelect(body);

      setVisualModeClass(true);
      expect(body.classList.contains("message__body--text-select-visual")).toBe(true);
      setVisualModeClass(false);
      expect(body.classList.contains("message__body--text-select-visual")).toBe(false);
    });

    it("toggles the compose input's visual class", () => {
      const input = document.createElement("textarea");
      input.value = "hi";
      document.body.appendChild(input);
      enterComposeTextSelect(input);

      setVisualModeClass(true, input);
      expect(input.classList.contains("input-bar__field--text-select-visual")).toBe(true);
      setVisualModeClass(false, input);
      expect(input.classList.contains("input-bar__field--text-select-visual")).toBe(false);
    });

    it("drops on exit", () => {
      const body = document.createElement("div");
      body.textContent = "hi";
      document.body.appendChild(body);
      enterMessageTextSelect(body);
      setVisualModeClass(true);
      exitTextSelect();
      expect(body.classList.contains("message__body--text-select-visual")).toBe(false);
    });
  });

  describe("collapseToFocus (compose target)", () => {
    it("collapses a forward-direction selection to its end", () => {
      const input = document.createElement("textarea");
      input.value = "hello";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(1, 4, "forward");

      enterComposeTextSelect();
      collapseToFocus(input);

      expect(input.selectionStart).toBe(4);
      expect(input.selectionEnd).toBe(4);
    });

    it("collapses a backward-direction selection to its start", () => {
      const input = document.createElement("textarea");
      input.value = "hello";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(1, 4, "backward");

      enterComposeTextSelect();
      collapseToFocus(input);

      expect(input.selectionStart).toBe(1);
      expect(input.selectionEnd).toBe(1);
    });
  });
});
