// Text-selection submode — orthogonal to vim Normal/Visual modes.
//
// Two targets exist:
//
//   "message" — caret is placed inside a timeline message body via `o`. Users
//     can move the caret with arrows/h/j/k/l, extend selection with `v`, and
//     act on the selection with `y` (copy) or `>` (quote into compose).
//
//   "compose" — caret stays in the compose field when leaving Insert mode while
//     the compose box is non-empty. Users can navigate/select in the compose
//     box and use `p` to paste at the caret position.
//
// Routing is done in keyboard.ts via `handleTextSelectKeydown`. This module
// owns the lifecycle (enter/exit, DOM mutations) and the selection helpers.

import { AppState } from "./state.js";
import { modeManager, Mode } from "../vim/mode.js";
import { showToast } from "../ui/NotificationToast.js";
import type { AppComponents } from "../ui/App.js";

/** The message body element currently in text-select mode (null when on compose). */
let _messageBodyEl: HTMLElement | null = null;
/** Saved attributes restored on exit. */
let _savedContentEditable: string | null = null;
let _savedTabIndex: string | null = null;

/**
 * Enter text-select mode on the given timeline message body.
 *
 * Makes the body contenteditable so the browser maintains a real caret —
 * we trap inserting keys at the keyboard layer, so it's effectively read-only.
 */
export function enterMessageTextSelect(bodyEl: HTMLElement): void {
  // If we're already in some text-select mode, exit it first so state is clean.
  exitTextSelect();

  _messageBodyEl = bodyEl;
  _savedContentEditable = bodyEl.getAttribute("contenteditable");
  _savedTabIndex = bodyEl.getAttribute("tabindex");

  bodyEl.classList.add("message__body--text-select");
  bodyEl.setAttribute("contenteditable", "true");
  bodyEl.setAttribute("tabindex", "0");
  bodyEl.setAttribute("spellcheck", "false");
  bodyEl.focus();

  // Place caret at the start of the body so movement keys work predictably.
  const sel = window.getSelection();
  if (sel && bodyEl.firstChild) {
    const range = document.createRange();
    range.setStart(bodyEl.firstChild, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  AppState.set("textSelectMode", "message");

  // Block-cursor styling stays on for the duration of text-select. Prime the
  // selection to 1 char so the block has something to highlight immediately.
  setBlockCursor(true);
  primeBlockSelection();
}

/**
 * Enter text-select mode on the compose box. The caller is expected to have
 * already focused the field — this just records the submode and ensures the
 * vim mode is Normal (so j/k etc. don't get typed into the input).
 */
export function enterComposeTextSelect(composeField?: HTMLTextAreaElement): void {
  // Don't blow away an active message-target selection silently.
  if (AppState.get("textSelectMode") === "message") exitTextSelect();
  AppState.set("textSelectMode", "compose");

  // Apply the block-cursor styling and ensure a visible 1-char block at the
  // caret. Caller passes the field so we can target it without component refs.
  if (composeField) {
    setBlockCursor(true, composeField);
    primeBlockSelection(composeField);
  }
}

/**
 * Exit text-select mode. Restores the message body's editable/tabindex state,
 * clears the selection, and resets state.
 */
export function exitTextSelect(): void {
  if (AppState.get("textSelectMode") === null) return;

  // Drop both selection-styling classes from whichever target was active.
  setBlockCursor(false);
  setVisualModeClass(false);

  if (_messageBodyEl) {
    _messageBodyEl.classList.remove("message__body--text-select");
    if (_savedContentEditable === null) {
      _messageBodyEl.removeAttribute("contenteditable");
    } else {
      _messageBodyEl.setAttribute("contenteditable", _savedContentEditable);
    }
    if (_savedTabIndex === null) {
      _messageBodyEl.removeAttribute("tabindex");
    } else {
      _messageBodyEl.setAttribute("tabindex", _savedTabIndex);
    }
    _messageBodyEl.removeAttribute("spellcheck");
    _messageBodyEl.blur();

    // Drop any text selection inside the message so navigation feels clean.
    const sel = window.getSelection();
    if (sel && _messageBodyEl.contains(sel.anchorNode)) {
      sel.removeAllRanges();
    }
    _messageBodyEl = null;
  }

  _savedContentEditable = null;
  _savedTabIndex = null;
  AppState.set("textSelectMode", null);
}

/**
 * Toggle the block-cursor CSS class on whichever element is the active
 * text-select target. The CSS rule hides the native caret-color so the
 * selection highlight (kept at least one character wide by the keymap layer)
 * reads as a vim-style block.
 */
export function setBlockCursor(on: boolean, composeField?: HTMLTextAreaElement): void {
  const target = AppState.get("textSelectMode");
  if (target === "message" && _messageBodyEl) {
    _messageBodyEl.classList.toggle("message__body--text-select-block", on);
  } else if (target === "compose" && composeField) {
    composeField.classList.toggle("input-bar__field--text-select-block", on);
  }
}

/**
 * Toggle the Visual-mode override class. When on, the selection highlight
 * uses the theme's muted selection palette (`--selection-bg`/`--selection-fg`)
 * instead of the bright cursor color — distinguishing "this is what I've
 * selected" from "this is my cursor".
 */
export function setVisualModeClass(on: boolean, composeField?: HTMLTextAreaElement): void {
  const target = AppState.get("textSelectMode");
  if (target === "message" && _messageBodyEl) {
    _messageBodyEl.classList.toggle("message__body--text-select-visual", on);
  } else if (target === "compose" && composeField) {
    composeField.classList.toggle("input-bar__field--text-select-visual", on);
  }
}

/**
 * Ensure the active selection covers at least one character so the block
 * cursor has something to highlight.
 *
 * For "message" target, extends `window.getSelection()` forward by a
 * character if it's currently collapsed. For "compose", expands the input's
 * selection range. If the caret is already at the end of the content, falls
 * back to extending backward so the block lands on the previous character
 * rather than disappearing past the end.
 */
export function primeBlockSelection(composeField?: HTMLTextAreaElement): void {
  const target = AppState.get("textSelectMode");

  if (target === "message" && _messageBodyEl) {
    const sel = window.getSelection();
    if (!sel) return;
    if (!sel.isCollapsed) return;
    // Selection.modify is non-standard (Webkit/Blink/Gecko all implement it,
    // but JSDOM doesn't). Skip the prime in environments without it — the
    // rest of text-select still works; we just don't get the visible 1-char
    // block until the user moves.
    if (typeof sel.modify !== "function") return;
    // Try extending forward; if the caret is at the very end, try backward.
    const before = sel.toString();
    sel.modify("extend", "forward", "character");
    if (sel.toString() === before) {
      sel.modify("extend", "backward", "character");
    }
    return;
  }

  if (target === "compose" && composeField) {
    const start = composeField.selectionStart ?? 0;
    const end = composeField.selectionEnd ?? 0;
    if (start !== end) return;
    const len = composeField.value.length;
    if (end < len) {
      composeField.setSelectionRange(start, end + 1, "forward");
    } else if (start > 0) {
      composeField.setSelectionRange(start - 1, end, "backward");
    }
  }
}

/**
 * Collapse the message body's selection to its "start" (the lower offset)
 * end. Used in Normal mode before each move so the 1-char block follows
 * the cursor cleanly instead of jumping two characters per keystroke.
 */
export function collapseMessageSelectionToStart(): void {
  if (!_messageBodyEl) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const collapsed = range.cloneRange();
  collapsed.collapse(true);
  sel.removeAllRanges();
  sel.addRange(collapsed);
}

/**
 * Collapse the selection to the "focus" end — the side the user was
 * moving towards in Visual mode. Used on Visual → Normal so the resulting
 * block cursor lands where vim would put it.
 */
export function collapseToFocus(composeField?: HTMLTextAreaElement): void {
  const target = AppState.get("textSelectMode");

  if (target === "message") {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !_messageBodyEl) return;
    // Selection has anchor/focus; collapsing to focus keeps the cursor where
    // the user last moved towards. There's no direct API, so use the focus
    // node/offset on the existing range.
    if (sel.focusNode) {
      sel.collapse(sel.focusNode, sel.focusOffset);
    }
    return;
  }

  if (target === "compose" && composeField) {
    const dir = composeField.selectionDirection === "backward" ? "backward" : "forward";
    const start = composeField.selectionStart ?? 0;
    const end = composeField.selectionEnd ?? 0;
    const focus = dir === "forward" ? end : start;
    composeField.setSelectionRange(focus, focus);
  }
}

/**
 * Returns the currently selected text within the active text-select target,
 * or an empty string if no selection exists.
 *
 * For "compose" target we read from the input element's selection range so
 * the result is unaffected by anything else focused on the page.
 */
export function getSelectedText(input: HTMLTextAreaElement): string {
  const target = AppState.get("textSelectMode");
  if (target === "message") {
    return window.getSelection()?.toString() ?? "";
  }
  if (target === "compose") {
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    return input.value.slice(start, end);
  }
  return "";
}

/**
 * Copy the current text-selection to the clipboard and show a brief toast.
 * No-op if nothing is selected.
 */
export function copyTextSelection(components: AppComponents): void {
  const text = getSelectedText(components.input.getFieldElement());
  if (!text) {
    showToast("No text selected");
    return;
  }
  void navigator.clipboard.writeText(text).then(() => {
    showToast("Copied selection");
  });
}

/**
 * Insert the current selection into the compose box prefixed with markdown
 * quote markers (one `> ` per line). Exits text-select mode and switches to
 * Insert so the user can continue typing immediately.
 *
 * No-op if nothing is selected.
 */
export function quoteTextSelectionIntoCompose(components: AppComponents): void {
  const { input } = components;
  const text = getSelectedText(input.getFieldElement());
  if (!text) {
    showToast("No text selected");
    return;
  }

  // Prefix each line with "> " — covers multi-line selections cleanly.
  const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");

  const existing = input.getValue();
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  input.setValue(existing + sep + quoted + "\n");

  exitTextSelect();
  modeManager.transition(Mode.Insert);
  input.focus();
  // Move caret to end so the user types after the quote.
  const field = input.getFieldElement();
  const len = field.value.length;
  field.selectionStart = field.selectionEnd = len;
}

/**
 * Extend (or move, in Normal) the selection by the given granularity and
 * direction. Used by Visual mode in text-select to grow the selection with
 * h/j/k/l. Only applies to "message" target — compose uses the input's
 * native selection model elsewhere.
 */
export function modifyMessageSelection(
  alter: "move" | "extend",
  direction: "forward" | "backward",
  granularity: "character" | "line" | "word"
): void {
  const sel = window.getSelection();
  if (!sel || !_messageBodyEl) return;
  // Anchor the selection inside our body if it's somehow drifted out.
  if (!sel.anchorNode || !_messageBodyEl.contains(sel.anchorNode)) {
    const range = document.createRange();
    range.setStart(_messageBodyEl.firstChild ?? _messageBodyEl, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  if (typeof sel.modify !== "function") return; // not in JSDOM
  sel.modify(alter, direction, granularity);
}

/**
 * Extend or move the input field's selection by one character/word.
 * Used in compose-box text-select mode for keyboard movement.
 */
export function modifyComposeSelection(
  input: HTMLTextAreaElement,
  alter: "move" | "extend",
  direction: "forward" | "backward",
  granularity: "character" | "word"
): void {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  const value = input.value;

  // Anchor is the side that doesn't move when extending. With selectionDirection
  // = "forward", the anchor is at `start` and the focus is at `end` (and vice
  // versa for "backward"). We compute the new focus position and let the
  // anchor follow only when `alter === "move"`.
  const dir = input.selectionDirection === "backward" ? "backward" : "forward";
  const focusPos = dir === "forward" ? end : start;
  const anchorPos = dir === "forward" ? start : end;

  let newFocus = focusPos;
  if (granularity === "character") {
    newFocus = direction === "forward"
      ? Math.min(value.length, focusPos + 1)
      : Math.max(0, focusPos - 1);
  } else {
    // Word: scan past whitespace then word chars.
    if (direction === "forward") {
      let i = focusPos;
      while (i < value.length && /\s/.test(value[i])) i++;
      while (i < value.length && !/\s/.test(value[i])) i++;
      newFocus = i;
    } else {
      let i = focusPos;
      while (i > 0 && /\s/.test(value[i - 1])) i--;
      while (i > 0 && !/\s/.test(value[i - 1])) i--;
      newFocus = i;
    }
  }

  if (alter === "move") {
    input.selectionStart = input.selectionEnd = newFocus;
  } else {
    // Keep the anchor pinned; the new focus may be on either side of it.
    const lo = Math.min(anchorPos, newFocus);
    const hi = Math.max(anchorPos, newFocus);
    input.selectionStart = lo;
    input.selectionEnd = hi;
    input.selectionDirection = newFocus >= anchorPos ? "forward" : "backward";
  }
}

// ── Touch text selection ──────────────────────────────────────────────────────

/** Body element currently opted into native selection, if any. */
let _touchSelectableEl: HTMLElement | null = null;
let _touchSelectCleanup: (() => void) | null = null;

/**
 * Hand one message body over to the platform's own text selection (#100).
 *
 * On mobile, message bodies carry `user-select: none` so a long press opens the
 * action sheet cleanly instead of racing the engine's selection — the sheet used
 * to appear on top of a blue highlight nobody asked for. That trades away the
 * ability to copy part of a message, so the sheet offers this instead: opt this
 * one body back into selection, select its contents, and let the OS take over
 * with its own drag handles and Copy callout.
 *
 * Deliberately *not* {@link enterMessageTextSelect}: that path sets
 * contenteditable, which on a phone raises the soft keyboard over the message
 * the user is trying to read. This only touches the selection.
 */
export function selectMessageTextForTouch(bodyEl: HTMLElement): void {
  clearTouchTextSelection();

  bodyEl.classList.add("message__body--selectable");
  _touchSelectableEl = bodyEl;

  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(bodyEl);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Drop the opt-in as soon as the user presses somewhere else, so exactly one
  // message is selectable at a time and a later long press opens the sheet
  // rather than extending this selection. Registered on the next frame: the
  // touch that opened the sheet is still in flight and would cancel instantly.
  const onOutside = (e: Event): void => {
    const target = e.target instanceof Node ? e.target : null;
    if (target && bodyEl.contains(target)) return;
    clearTouchTextSelection();
  };
  const timer = setTimeout(() => {
    document.addEventListener("touchstart", onOutside, { passive: true, capture: true });
    document.addEventListener("mousedown", onOutside, { capture: true });
  }, 0);

  _touchSelectCleanup = () => {
    clearTimeout(timer);
    document.removeEventListener("touchstart", onOutside, { capture: true });
    document.removeEventListener("mousedown", onOutside, { capture: true });
  };
}

/** Revoke the native-selection opt-in, if one is active. */
export function clearTouchTextSelection(): void {
  _touchSelectCleanup?.();
  _touchSelectCleanup = null;
  if (!_touchSelectableEl) return;
  _touchSelectableEl.classList.remove("message__body--selectable");
  _touchSelectableEl = null;
}

/** The body currently opted into native selection. Exposed for testing. */
export function touchSelectableElement(): HTMLElement | null {
  return _touchSelectableEl;
}
