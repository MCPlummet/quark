// Keyboard orchestration — wires vim mode + keymaps to action dispatcher

import { modeManager, Mode } from "../vim/mode.js";
import { keymapManager } from "../vim/keybindings.js";
import { ComposeNormalEditor } from "../vim/compose_normal.js";
import { modalManager } from "../ui/ModalManager.js";
import type { AppComponents } from "../ui/App.js";
import type { ContextMenuEntry } from "../ui/ContextMenu.js";
import {
  sendMessage,
  sendReaction,
  cancelReply,
  openEmojiPicker,
  openGifPicker,
  openProfileDialog,
  openSettings,
  openRoomInfo,
  openRoomSettings,
  openSpaceSettings,
  openDebugViewer,
  openDebugViewerForEvent,
  openPinnedMessages,
  openSearch,
  openRoomDirectory,
  executeCommand,
  toggleMemberList,
  startReply,
  startEdit,
  cancelEdit,
  editMessage,
  redactMessage,
  openThread,
  closeThread,
  openQuickReactPicker,
  setupReactionChipHandler,
  setupMessageActionHandlers,
  sendPendingImage,
  handleFilePick,
  setupStatusBar,
  editStatus,
  jumpToMessage,
  jumpToLatest,
  loadTheme,
  selectRoom,
  startVerification,
  setupCrossSigning,
  logout,
} from "./actions.js";
import { AppState } from "./state.js";
import { resolveComposeSubmit } from "./compose_submit.js";
import {
  enterMessageTextSelect,
  enterComposeTextSelect,
  exitTextSelect,
  copyTextSelection,
  quoteTextSelectionIntoCompose,
  modifyMessageSelection,
  modifyComposeSelection,
  primeBlockSelection,
  collapseMessageSelectionToStart,
  collapseToFocus,
  setVisualModeClass,
} from "./text_select.js";
import { loadQuarkrc } from "../ipc/config.js";
import type { ParsedRc } from "../ipc/types.js";
import { getAppConfig, setAppConfig } from "../ipc/app_config.js";
import type { KeyContext } from "../vim/keybindings.js";
import { BUILTIN_EMOJI } from "../data/unicode-emoji.js";
import { _shortcodeToMxc } from "./actions/context.js";
import { onMobileChange } from "./mobile.js";
import { effectiveSendOnEnter, shouldShowSendButton } from "./send_behavior.js";
import { showToast } from "../ui/NotificationToast.js";
import { filterShortcodes, type ShortcodeEntry } from "../ui/ShortcodePreview.js";
import { filterMembers, type MentionEntry } from "../ui/MentionPreview.js";
import { getEmojiPacks } from "../ipc/emoji.js";
import { getThumbnail } from "../ipc/media.js";
import { getRoomMembers } from "../ipc/rooms.js";
import { extractShortcodeQuery, extractMentionQuery } from "./autocomplete_query.js";
import { applySetOptions } from "./set_options.js";

// ── Default keybindings ───────────────────────────────────────────────────────

function registerDefaultBindings(): void {
  // Normal mode — global
  keymapManager.nmap("i", "mode-insert");
  keymapManager.nmap(":", "mode-command");
  keymapManager.nmap("v", "mode-visual");
  keymapManager.nmap("j", "nav-down");
  keymapManager.nmap("k", "nav-up");
  keymapManager.nmap("h", "nav-left");
  keymapManager.nmap("l", "nav-right");
  keymapManager.nmap("ArrowLeft", "nav-left");
  keymapManager.nmap("ArrowRight", "nav-right");
  keymapManager.nmap("ArrowUp", "nav-up");
  keymapManager.nmap("ArrowDown", "nav-down");
  keymapManager.nmap("gg", "jump-top");
  keymapManager.nmap("G", "jump-bottom");
  keymapManager.nmap("r", "reply");
  keymapManager.nmap("e", "react");
  keymapManager.nmap("dd", "redact");
  keymapManager.nmap("E", "edit");
  keymapManager.nmap("c", "edit");
  keymapManager.nmap("t", "open-thread");
  keymapManager.nmap("m", "toggle-members");
  keymapManager.nmap("P", "open-profile");
  keymapManager.nmap("S", "edit-status");
  keymapManager.nmap("?", "open-settings");
  keymapManager.nmap("I", "open-room-info");

  // select — activates the focused item in panels that support it (roomlist, spaces)
  keymapManager.nmap("Enter", "select");
  keymapManager.nmap("o", "select");
  // In the timeline, `o` enters text-select mode on the selected message rather
  // than the generic "select" action. Other panels keep `o` as a select alias.
  keymapManager.tmap("o", "enter-text-select");

  // copy / paste
  keymapManager.nmap("y", "copy-message");
  keymapManager.nmap("p", "paste-to-input");

  // Quote-selection — text-select Visual mode only. Outside text-select the
  // action is unhandled (no-op), so binding it globally costs nothing.
  keymapManager.nmap(">", "quote-selection");

  // close — clears selection / reply / thread for the active panel
  keymapManager.nmap("Escape", "close");
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

function dispatchAction(action: string, components: AppComponents): void {
  const { input, commandBar, timeline, imageLightbox, revisionHistoryDialog, contextMenu } = components;

  switch (action) {
    case "mode-insert":
      modeManager.transition(Mode.Insert);
      input.focus();
      break;

    case "mode-command":
      modeManager.transition(Mode.Command);
      commandBar.show();
      break;

    case "mode-visual":
      modeManager.transition(Mode.Visual);
      break;

    // ── Navigation — routed through panel registry ─────────────────────
    case "nav-down": {
      // When nav-down can't advance the timeline selection any further, fall
      // through into the compose box (#15) — it behaves like the message below
      // the last one.
      const movedWithinPanel = AppState.navDown();
      if (!movedWithinPanel && AppState.get("activePanel") === "timeline") {
        enterComposeFromTimeline(components);
      }
      break;
    }

    case "nav-up":
      AppState.navUp();
      break;

    case "nav-left":
      AppState.moveFocusLeft();
      break;

    case "nav-right":
      AppState.moveFocusRight();
      break;

    case "jump-top":
      AppState.jumpTop();
      break;

    case "jump-bottom":
      if (AppState.get("activePanel") === "timeline") {
        void jumpToLatest();
      } else {
        AppState.jumpBottom();
      }
      break;

    // ── Message actions — operate on the selected message ───────────────
    case "reply": {
      const msgId = timeline.selectedMessageId;
      if (msgId) {
        const events = AppState.get("currentTimeline");
        const evt = events.find((e) => e.event_id === msgId);
        if (evt) {
          startReply(msgId, evt.sender, evt.body.slice(0, 80));
          modeManager.transition(Mode.Insert);
          input.focus();
        }
      }
      break;
    }

    case "redact": {
      const msgId = timeline.selectedMessageId;
      if (msgId) void redactMessage(msgId);
      break;
    }

    case "copy-message": {
      const msgId = timeline.selectedMessageId;
      if (msgId) {
        const events = AppState.get("currentTimeline");
        const evt = events.find((e) => e.event_id === msgId);
        if (evt) {
          void navigator.clipboard.writeText(evt.body).then(() => {
            showToast("Copied message");
          });
        }
      }
      break;
    }

    case "paste-to-input": {
      // Avoid navigator.clipboard.readText() — on macOS it triggers a system
      // permission popup for external clipboard sources. Switch to insert mode
      // and focus the input; the user pastes with ⌘V / Ctrl+V as usual.
      modeManager.transition(Mode.Insert);
      input.focus();
      break;
    }

    case "open-thread": {
      if (timeline.inlineThreadRootId) {
        closeThread();
      } else {
        // selectedMessageId returns the thread-reply ID when a thread is
        // navigated — we need the underlying timeline selection here.
        const msgId = timeline.timelineSelectedMessageId;
        if (msgId) void openThread(msgId);
      }
      break;
    }

    case "react": {
      const msgId = timeline.selectedMessageId;
      if (msgId) openQuickReactPicker(msgId);
      break;
    }

    case "select":
    case "select-room": {
      // If in the timeline and the selected message is an image, open the lightbox
      const sel = timeline.selectedMessage;
      if (sel?.type === "image" && sel.mediaUrl && AppState.get("activePanel") === "timeline") {
        imageLightbox.show(sel.mediaUrl, sel.mediaAlt ?? sel.body);
      } else {
        AppState.select();
      }
      break;
    }

    case "enter-text-select": {
      // `o` in timeline: drop a caret into the selected message's body. Images
      // (and other media) have no text to select — fall back to the lightbox.
      const sel = timeline.selectedMessage;
      if (sel?.type === "image" && sel.mediaUrl) {
        imageLightbox.show(sel.mediaUrl, sel.mediaAlt ?? sel.body);
        break;
      }
      const bodyEl = timeline.getSelectedMessageBodyElement();
      if (bodyEl) enterMessageTextSelect(bodyEl);
      break;
    }

    case "edit": {
      const msg = timeline.selectedMessage;
      if (msg?.id && msg.isOwn) {
        // Use body from MessageData (already has _applyEdits applied and
        // reflects any subsequent updateMessageBody calls).
        startEdit(msg.id, msg.body);
        modeManager.transition(Mode.Insert);
        input.focus();
      }
      break;
    }

    case "toggle-members":
      toggleMemberList();
      break;

    case "open-profile":
      void openProfileDialog();
      break;

    case "open-settings":
      openSettings();
      break;

    case "open-room-info":
      void openRoomInfo();
      break;

    case "open-room-settings":
      void openRoomSettings();
      break;

    case "open-space-settings":
      void openSpaceSettings();
      break;

    case "open-debug":
      void openDebugViewer();
      break;

    case "edit-status":
      editStatus();
      break;

    case "help":
      components.helpDialog.show();
      break;

    case "verify-session": {
      // Self-verification: verify one of your own other sessions.
      const uid = AppState.get("ownUserId");
      if (uid) void startVerification(uid);
      break;
    }

    case "setup-cross-signing":
      void setupCrossSigning();
      break;

    case "logout":
      void logout();
      break;

    case "open-quick-nav":
      components.quickNavPalette.show();
      break;

    case "close":
      AppState.close();
      break;

    default:
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action } }));
      break;
  }
}

// ── Shortcode autocomplete ──────────────────────────────────────────────────

/** Cached custom emoji entries from server packs (refreshed per room). */
let _customEmoji: ShortcodeEntry[] = [];
let _customEmojiRoomId: string | null = null;

/**
 * Refresh the custom emoji cache when the room changes.
 * Falls back silently to an empty list on error.
 */
async function refreshCustomEmoji(): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (roomId === _customEmojiRoomId) return;
  _customEmojiRoomId = roomId;

  try {
    const packs = await getEmojiPacks(roomId ?? undefined);
    _customEmoji = [];
    for (const pack of packs) {
      for (const entry of pack.emojis) {
        if (!entry.usage.includes("emoticon")) continue;
        // Don't set imageUrl to a bare mxc:// URL — browsers can't load those
        // and the shortcode preview would show a broken image. Leave it unset
        // until the thumbnail is resolved, then replace in-place.
        const customEntry: ShortcodeEntry = {
          key: `:${entry.shortcode}:`,
          shortcode: entry.shortcode,
          imageUrl: entry.url.startsWith("mxc://") ? undefined : entry.url,
        };
        _customEmoji.push(customEntry);
        if (entry.url.startsWith("mxc://")) {
          // Record the shortcode → mxc mapping so sendMessage() can resolve custom
          // emoji into <img data-mx-emoticon> even when the emoji picker was never
          // opened for this room (previously the map was only populated lazily on
          // picker/reaction-picker open, so a plain `:shortcode:` send was sent
          // raw). This runs on every room change.
          _shortcodeToMxc.set(entry.shortcode, entry.url);
          // Capture by object reference to avoid stale-index bugs if the room
          // switches (and _customEmoji is rebuilt) before the download finishes.
          const captured = customEntry;
          getThumbnail(entry.url, 32, 32).then((dl) => {
            const i = _customEmoji.indexOf(captured);
            if (i >= 0) {
              _customEmoji[i] = {
                ...captured,
                imageUrl: `data:${dl.mime_type};base64,${dl.data_base64}`,
              };
            }
          }).catch(() => { /* non-critical */ });
        }
      }
    }
  } catch {
    _customEmoji = [];
  }
}

/** All available shortcode entries (built-in + custom). */
function allShortcodes(): ShortcodeEntry[] {
  return [..._customEmoji, ...BUILTIN_EMOJI];
}

// extractShortcodeQuery lives in ./autocomplete_query.ts (pure, unit-tested).

// ── Mention autocomplete ──────────────────────────────────────────────────────

/** Cached member list for the current room. */
let _roomMembers: MentionEntry[] = [];
let _roomMembersRoomId: string | null = null;

async function refreshRoomMembers(): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId || roomId === _roomMembersRoomId) return;
  _roomMembersRoomId = roomId;
  try {
    const members = await getRoomMembers(roomId);
    _roomMembers = members.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name ?? m.user_id,
      avatarUrl: undefined, // resolved lazily below if needed
    }));
  } catch {
    _roomMembers = [];
  }
}

// extractMentionQuery lives in ./autocomplete_query.ts (pure, unit-tested).

// ── Text-select submode keyboard handler ──────────────────────────────────────

/**
 * Translate a movement direction + active target into the appropriate
 * Selection.modify / input-selection call.
 *
 * In Visual mode this just extends the existing selection (vim semantics).
 * In Normal mode, the 1-character block cursor must slide one character per
 * keystroke — so we collapse the current selection to its "cursor" end,
 * apply the move, then prime back to a 1-char block. Without the collapse,
 * `Selection.modify("move", "forward", "character")` on `[N, N+1)` would
 * land at `N+2`, making each press feel like a two-character jump.
 *
 * Direction is given in semantic vim terms (up/down/left/right). Compose-box
 * vertical movement uses word granularity (the field is single-line, so
 * line granularity would just bounce to either end).
 */
function moveTextSelection(
  components: AppComponents,
  dir: "up" | "down" | "left" | "right",
): void {
  const target = AppState.get("textSelectMode");
  const inVisual = modeManager.current === Mode.Visual;
  const alter: "move" | "extend" = inVisual ? "extend" : "move";

  if (target === "message") {
    const direction = dir === "up" || dir === "left" ? "backward" : "forward";
    const granularity = dir === "up" || dir === "down" ? "line" : "character";
    if (!inVisual) collapseMessageSelectionToStart();
    modifyMessageSelection(alter, direction, granularity);
    if (!inVisual) primeBlockSelection();
    return;
  }

  if (target === "compose") {
    const field = components.input.getFieldElement();
    const direction = dir === "up" || dir === "left" ? "backward" : "forward";
    const granularity = dir === "up" || dir === "down" ? "word" : "character";
    if (!inVisual) {
      const cursor = field.selectionStart ?? 0;
      field.setSelectionRange(cursor, cursor);
    }
    modifyComposeSelection(field, alter, direction, granularity);
    if (!inVisual) primeBlockSelection(field);
  }
}

// Vim Normal-mode editor for the compose textarea (#45). Holds pending
// count/operator state between keystrokes; reset whenever we leave the
// compose-normal submode.
const composeEditor = new ComposeNormalEditor();

// The compose editor speaks canonical vim keys (h/j/k/l), but the user may have
// remapped navigation in their quarkrc (e.g. the documented ijkl scheme). The
// rest of the app honours those remaps because it resolves keys to action names
// through the keymap; the compose editor didn't, so rebinds never reached it.
// We bridge the gap by mapping a key's bound nav action back to the canonical
// motion key before the editor sees it. Only nav actions are translated —
// operators/word-motions have no keymap action to rebind, so they pass through
// as literal keys and keep working.
const NAV_ACTION_TO_COMPOSE_KEY: Record<string, string> = {
  "nav-left": "h",
  "nav-down": "j",
  "nav-up": "k",
  "nav-right": "l",
};

/**
 * Translate a physical key into the canonical compose-editor key, honouring
 * quarkrc nav remaps. A key bound to a nav action becomes its motion key; any
 * other key (operators, word motions, insert-entry, unbound keys) is returned
 * unchanged so the editor's own grammar still applies.
 */
function translateComposeKey(key: string): string {
  const action = keymapManager.actionForKey(key, "global");
  if (action && action in NAV_ACTION_TO_COMPOSE_KEY) {
    return NAV_ACTION_TO_COMPOSE_KEY[action];
  }
  return key;
}

/**
 * Routes keys for compose-box Normal mode (#45) through the vim editor:
 * motions, operators, counts, x/D/C/Y, insert-entry, p/P, r. Returns true if
 * the key was handled. Keys the editor doesn't own (v, :, copy/quote/paste)
 * fall through to {@link handleTextSelectKeydown}.
 */
function handleComposeNormalKeydown(e: KeyboardEvent, components: AppComponents): boolean {
  // Modifier combos (clipboard, Ctrl+K palette, …) and bare modifier presses
  // are not editor commands — let them reach their handlers.
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return false;

  const field = components.input.getFieldElement();
  const res = composeEditor.handleKey(translateComposeKey(e.key), field);
  if (!res.consumed) return false;

  e.preventDefault();
  e.stopPropagation();

  if (res.exitUp) {
    // `k` on the first line: leave the compose box upward into the timeline.
    // Falls back to staying put (and re-priming the block) when there's no
    // message to land on (#15).
    if (!exitComposeToTimeline(components)) composeEditor.primeBlock(field);
  } else if (res.enterInsert) {
    exitTextSelect();
    composeEditor.reset();
    modeManager.transition(Mode.Insert);
    components.input.focus();
  } else {
    composeEditor.primeBlock(field);
  }
  return true;
}

/**
 * Leave the compose box upward into the timeline (#15). The compose box reads
 * as the bottom-most message, so this drops compose text-select and lands the
 * selection on the last timeline message. Returns false (and changes nothing)
 * when the timeline has no message to move to, so the caller can stay put.
 */
function exitComposeToTimeline(components: AppComponents): boolean {
  const { input, timeline } = components;
  if (!timeline.selectLast()) return false; // nothing to land on — stay in compose
  exitTextSelect();
  composeEditor.reset();
  input.blur(); // focus has left the compose box; keys now drive the timeline
  AppState.set("activePanel", "timeline");
  return true;
}

/**
 * Enter the compose box from the timeline's bottom edge (#15). Triggered when
 * `nav-down` can't move the timeline selection any further and the compose box
 * holds a draft: focus the field in compose-Normal mode with the caret at the
 * top so a subsequent `k` returns to the timeline. No-op on an empty draft, so
 * plain timeline navigation in an empty room is unaffected — `i` still composes.
 */
function enterComposeFromTimeline(components: AppComponents): void {
  const { input, timeline } = components;
  if (modeManager.current !== Mode.Normal) return;
  if (input.getValue().length === 0) return;
  timeline.clearSelection();
  input.focus();
  const field = input.getFieldElement();
  field.setSelectionRange(0, 0); // entered from above — caret at the top
  enterComposeTextSelect(field);
  composeEditor.reset();
}

/**
 * Routes keys when text-select mode is active.
 *
 * Resolves through the keymap so user remappings (e.g. ijkl-nav) apply here
 * too — we switch on the resolved action name (`nav-down`, `copy-message`, …)
 * rather than the literal key, so the text-select layer inherits whatever
 * movement scheme the user has configured.
 *
 * Returns true to consume the key (preventing it from reaching the focused
 * contenteditable / input). The handler preventDefault's everything except
 * Ctrl/Cmd/Alt combos so destructive keys (Backspace, Enter, Tab, raw
 * character typing) can't reach the focused editable region.
 */
function handleTextSelectKeydown(e: KeyboardEvent, components: AppComponents): boolean {
  const { input } = components;
  const target = AppState.get("textSelectMode");
  if (target === null) return false;

  // Let modifier combos (Ctrl/Cmd/Alt) through so browser copy/cut/paste/
  // select-all and our Ctrl+K palette still work without being shadowed.
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  // Shift+modifier-only events (pressing Shift alone, etc.) carry no semantic
  // payload — let them through so the user can prepare for the next key combo.
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") {
    return false;
  }

  // Default: consume the key so contenteditable / input don't process it.
  // This is what blocks Backspace, Delete, Enter, Tab, and raw typing from
  // mutating the focused region.
  e.preventDefault();
  e.stopPropagation();

  // Resolve through the keymap so `nmap k nav-down` etc. apply here too.
  const panel = AppState.get("activePanel");
  const activeContext: KeyContext = panel === "timeline" ? "timeline"
    : panel === "roomlist" ? "roomlist"
    : "global";
  const result = keymapManager.resolveKey(e.key, activeContext);

  if (result.kind === "partial") return true;
  const action = result.kind === "action" ? result.action : null;

  switch (action) {
    case "nav-up":    moveTextSelection(components, "up"); return true;
    case "nav-down":  moveTextSelection(components, "down"); return true;
    case "nav-left":  moveTextSelection(components, "left"); return true;
    case "nav-right": moveTextSelection(components, "right"); return true;

    case "mode-visual":
      modeManager.transition(Mode.Visual);
      return true;

    case "mode-insert":
      // Re-enter Insert at the current caret. exitTextSelect() before the
      // transition so the mode listener doesn't try to bounce us back into
      // text-select. The compose field stays focused, so the caret position
      // the user navigated to is preserved for typing.
      exitTextSelect();
      modeManager.transition(Mode.Insert);
      input.focus();
      return true;

    case "mode-command":
      exitTextSelect();
      dispatchAction("mode-command", components);
      return true;

    case "copy-message":
      copyTextSelection(components);
      exitTextSelect();
      if (modeManager.current === Mode.Visual) modeManager.transition(Mode.Normal);
      return true;

    case "paste-to-input":
      // We don't read the system clipboard programmatically — on macOS that
      // pops a permission dialog every time. Instead, exit text-select with
      // the caret preserved and drop into Insert; the user pastes with
      // Ctrl/Cmd+V at the cursor.
      if (target === "compose") {
        const field = input.getFieldElement();
        const start = field.selectionStart;
        const end = field.selectionEnd;
        exitTextSelect();
        modeManager.transition(Mode.Insert);
        if (start !== null && end !== null) {
          field.setSelectionRange(start, end);
        }
      }
      return true;

    case "quote-selection":
      quoteTextSelectionIntoCompose(components);
      return true;

    default:
      // Block anything else — typing, Backspace, Enter, Tab, unrelated
      // actions (reply/redact/etc.) — to keep the text-select layer
      // read-only and non-destructive. The user can Escape to leave first.
      return true;
  }
}

// ── Insert mode keyboard handlers ─────────────────────────────────────────────

/**
 * Submit the compose box: commit an in-progress edit, send a staged image
 * (typed text becomes its caption), or send a new message. Shared by the
 * Enter key, the dedicated send button (#4), and the staged-image Send button.
 */
function submitComposeBox(components: AppComponents): void {
  const { input, shortcodePreview } = components;
  shortcodePreview.hide();
  const plan = resolveComposeSubmit({
    rawValue: input.getValue(),
    editingEventId: AppState.get("editingEventId"),
    hasPendingImage: input.hasPendingImage(),
  });
  switch (plan.kind) {
    case "none":
      return;
    case "edit": {
      const editingId = AppState.get("editingEventId")!;
      AppState.set("editingEventId", null);
      components.replyPreview.hide();
      input.setValue("");
      void editMessage(editingId, plan.body);
      return;
    }
    case "image": {
      const pending = input.takePendingImage();
      if (!pending) return;
      input.setValue("");
      void sendPendingImage(pending.blob, pending.filename, plan.caption ?? undefined);
      return;
    }
    case "text":
      void sendMessage(plan.body);
  }
}

function handleInsertKeydown(e: KeyboardEvent, components: AppComponents): void {
  const { input, shortcodePreview, mentionPreview } = components;

  // Mention autocomplete intercepts first
  if (mentionPreview.isVisible()) {
    const consumed = mentionPreview.handleKeydown(e);
    if (consumed) return;
  }

  // Shortcode autocomplete intercepts next
  if (shortcodePreview.isVisible()) {
    const consumed = shortcodePreview.handleKeydown(e);
    if (consumed) return;
  }

  // Ctrl-e → emoji picker
  if (e.ctrlKey && e.key === "e") {
    e.preventDefault();
    openEmojiPicker();
    return;
  }

  // Ctrl-g → GIF picker
  if (e.ctrlKey && e.key === "g") {
    e.preventDefault();
    openGifPicker();
    return;
  }

  // Rich-text formatting shortcuts (#54): wrap the selection in markdown
  // markers. Cmd on macOS, Ctrl elsewhere. Bold/italic/underline are the bare
  // chord; strikethrough is Shift+X (no conventional bare chord), and the
  // mobile toolbar covers the rest.
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const key = e.key.toLowerCase();
    let marker: string | null = null;
    if (!e.shiftKey && key === "b") marker = "**";
    else if (!e.shiftKey && key === "i") marker = "*";
    else if (!e.shiftKey && key === "u") marker = "__";
    else if (e.shiftKey && key === "x") marker = "~~";
    if (marker) {
      e.preventDefault();
      input.wrapSelection(marker);
      return;
    }
  }

  // Enter → send message, reply, or commit an inline edit. Ctrl/Cmd+Enter always
  // sends (a send affordance when Enter inserts a newline). A bare Enter sends
  // only when the send-key behavior says so (see app/send_behavior.ts); otherwise
  // it falls through so the textarea inserts a newline.
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    submitComposeBox(components);
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    if (effectiveSendOnEnter()) {
      e.preventDefault();
      submitComposeBox(components);
    }
    return;
  }

  // Tab → trigger shortcode autocomplete (handled via input event elsewhere)
  if (e.key === "Tab") {
    e.preventDefault();
    // Shortcode autocomplete trigger — just cycle if visible
    return;
  }

  // Escape already handled globally

  // If focus escaped the compose box (e.g. user clicked elsewhere), redirect
  // printable characters back to it so typing always works in Insert mode.
  const field = input.getFieldElement();
  if (document.activeElement !== field && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    input.focus();
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    field.value = field.value.slice(0, start) + e.key + field.value.slice(end);
    field.selectionStart = field.selectionEnd = start + 1;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// ── User rc application ───────────────────────────────────────────────────────

const MAP_TYPE_TO_CONTEXT: Readonly<Record<string, KeyContext>> = {
  normal: "global",
  insert: "insert",
  timeline: "timeline",
  roomlist: "roomlist",
  picker: "picker",
  command: "command",
  visual: "visual",
};

// applySetOptions lives in ./set_options.ts (pure, unit-tested).

async function applyRcDirectives(rc: ParsedRc): Promise<void> {
  for (const directive of rc.directives) {
    if (directive.type === "map") {
      const context = MAP_TYPE_TO_CONTEXT[directive.map_type];
      if (context) keymapManager.map(context, directive.key, directive.action, directive.noremap);
    } else if (directive.type === "unmap") {
      const context = MAP_TYPE_TO_CONTEXT[directive.map_type];
      if (context) keymapManager.unmap(context, directive.key);
    } else if (directive.type === "let" && directive.name === "mapleader") {
      keymapManager.setLeaderKey(directive.value);
    } else if (directive.type === "colorscheme") {
      void loadTheme(directive.name);
    }
  }
  if (rc.errors.length > 0) {
    console.warn("[quarkrc] parse errors:", rc.errors);
  }

  const setDirectives = rc.directives.filter(
    (d): d is Extract<typeof d, { type: "set" }> => d.type === "set"
  );
  if (setDirectives.length === 0) return;

  try {
    const cfg = await getAppConfig();
    const updated = applySetOptions(cfg, setDirectives);
    await setAppConfig(updated);
  } catch (err) {
    console.warn("[quarkrc] failed to apply set directives:", err);
  }
}

// ── Global keydown handler ────────────────────────────────────────────────────

export function setupKeyboard(components: AppComponents): void {
  // Overlays no longer need to be referenced here for the keydown guard — they
  // self-register with modalManager. Only components wired with callbacks below
  // are destructured.
  const { input, commandBar, shortcodePreview, mentionPreview, timeline,
          quickReactPicker, pinnedMessagesDialog, searchDialog, revisionHistoryDialog,
          roomHeader, imageLightbox, quickNavPalette, contextMenu,
          spaceStrip, roomList } = components;

  registerDefaultBindings();

  // Load vim mode + send-key preferences from persisted config
  void getAppConfig().then((cfg) => {
    AppState.set("vimMode", cfg.general.vim_mode);
    // Apply immediately — the state listener won't fire if the value matches the default
    input.setVimMode(cfg.general.vim_mode);
    if (!cfg.general.vim_mode) {
      modeManager.transition(Mode.Insert);
      input.focus();
    }
    AppState.set("sendKeyBehavior", cfg.general.send_key_behavior);
    input.setSendButtonVisible(shouldShowSendButton());
  }).catch(() => { /* use defaults */ });

  // React to vim mode toggling at runtime (e.g. from Settings)
  AppState.on("vimMode", (_key, enabled) => {
    if (enabled) {
      modeManager.transition(Mode.Normal);
      input.blur();
    } else {
      modeManager.transition(Mode.Insert);
      input.focus();
    }
    input.setVimMode(enabled);
  });

  // The dedicated send button submits the compose box (#4); its visibility tracks
  // the send-key behavior and the platform (mobile vs desktop).
  input.onSendClick(() => submitComposeBox(components));
  AppState.on("sendKeyBehavior", () => input.setSendButtonVisible(shouldShowSendButton()));
  onMobileChange(() => input.setSendButtonVisible(shouldShowSendButton()));

  // Member count in the header toggles the member list sidebar
  roomHeader.setMemberCountClickHandler(() => toggleMemberList());

  // Pinned messages button in the header opens the pinned messages dialog
  roomHeader.setPinnedClickHandler(() => void openPinnedMessages());

  // Search button in the header opens the search dialog
  roomHeader.setSearchHandler(() => openSearch());

  // Clicking a search result jumps to it in the timeline
  searchDialog.onJumpToMessage((eventId) => void jumpToMessage(eventId));

  // Clicking a pinned message jumps to it in the timeline
  pinnedMessagesDialog.onJumpToMessage((eventId) => void jumpToMessage(eventId));

  // Reply preview jumps to the original when message is not loaded
  timeline.onJumpToMessage((eventId) => void jumpToMessage(eventId));

  // "Jump to latest" button
  timeline.onJumpToLatest(() => void jumpToLatest());

  // Image lightbox — wire timeline image clicks
  timeline.onImageClick((src, alt) => {
    imageLightbox.show(src, alt);
  });

  // Revision history — wire (edited) marker clicks
  timeline.onShowRevisionHistory((eventId, originalBody) => {
    revisionHistoryDialog.show(eventId, originalBody);
  });

  // Right-click / long-press context menu for messages
  timeline.onContextMenu((eventId, x, y) => {
    const events = AppState.get("currentTimeline");
    const evt = events.find((ev) => ev.event_id === eventId);
    const ownUserId = AppState.get("ownUserId");
    const isOwn = !!evt && !!ownUserId && evt.sender === ownUserId;

    const entries: ContextMenuEntry[] = [
      {
        label: "Reply",
        hint: "r",
        action: () => {
          if (evt) {
            startReply(eventId, evt.sender, evt.body.slice(0, 80));
            input.focus();
          }
        },
      },
      {
        label: "React",
        hint: "e",
        action: () => openQuickReactPicker(eventId),
      },
      {
        label: "Thread",
        hint: "t",
        action: () => void openThread(eventId),
      },
      { separator: true },
      {
        label: "Copy message text",
        hint: "y",
        action: () => {
          const text = evt?.body ?? "";
          void navigator.clipboard.writeText(text);
        },
      },
      {
        label: "View raw event",
        action: () => void openDebugViewerForEvent(eventId),
      },
    ];

    // Own-message actions: edit and delete. Both the desktop right-click menu
    // and the mobile long-press sheet flow through this callback, so this is
    // the single place that gives finger-input users a way to delete/edit.
    if (isOwn) {
      entries.push(
        { separator: true },
        {
          label: "Edit",
          hint: "E",
          action: () => {
            // Prefer the MessageData body (reflects applied edits) over the
            // raw timeline event.
            const body = timeline.getMessageBodyById(eventId) ?? evt?.body ?? "";
            startEdit(eventId, body);
            modeManager.transition(Mode.Insert);
            input.focus();
          },
        },
        {
          label: "Delete",
          hint: "dd",
          action: () => void redactMessage(eventId),
        },
      );
    }

    contextMenu.show(x, y, entries);
  });

  // Right-click context menu for rooms in the room list
  roomList.onContextMenu((roomId, x, y) => {
    const rooms = AppState.get("roomListCache");
    const room = rooms.find((r) => r.room_id === roomId);
    contextMenu.show(x, y, [
      {
        label: "Open",
        action: () => void selectRoom(roomId),
      },
      { separator: true },
      {
        label: "Room settings",
        action: () => void selectRoom(roomId).then(() => openRoomSettings()),
      },
      {
        label: "Room info",
        action: () => void selectRoom(roomId).then(() => openRoomInfo()),
      },
      ...(room && room.unread_count > 0 ? [
        { separator: true } as const,
        {
          label: "Mark as read",
          action: () => void selectRoom(roomId),
        },
      ] : []),
    ]);
  });

  // Right-click context menu for subspace section labels in the room list
  roomList.onSectionContextMenu((spaceId, x, y) => {
    contextMenu.show(x, y, [
      {
        label: "Space settings",
        action: () => void openSpaceSettings(spaceId),
      },
    ]);
  });

  // Right-click context menu for spaces in the space strip
  spaceStrip.onContextMenu((spaceId, x, y) => {
    contextMenu.show(x, y, [
      {
        label: "Space settings",
        action: () => void openSpaceSettings(spaceId),
      },
    ]);
  });

  // ── User keybindings ──────────────────────────────────────────────────────
  void loadQuarkrc().then(applyRcDirectives).catch(() => { /* no rc file is fine */ });

  // Wire quick nav palette → selectRoom
  quickNavPalette.onSelect((roomId) => {
    void selectRoom(roomId);
  });

  // Wire quick react picker → sendReaction
  quickReactPicker.onReact((eventId, key) => {
    void sendReaction(eventId, key);
  });

  // Track activePanel when focus lands on the space strip
  components.spaceStrip.getElement().addEventListener("quark:space-focused", () => {
    AppState.set("activePanel", "spaces");
  });

  // Clicking the input field while not in Insert mode switches to Insert mode
  input.onFocusEnterInsert(() => {
    if (AppState.get("vimMode") && modeManager.current !== Mode.Insert) {
      modeManager.transition(Mode.Insert);
      input.focus();
    }
  });

  // Wire compose box action buttons
  input.onEmojiPickerClick(() => {
    modeManager.transition(Mode.Insert);
    input.focus();
    openEmojiPicker();
  });

  input.onGifPickerClick(() => {
    modeManager.transition(Mode.Insert);
    input.focus();
    openGifPicker();
  });

  input.onAttachClick(() => {
    input.openFilePicker();
  });

  // Picked images stage in the same preview as pasted ones (Enter sends, typed
  // text becomes the caption); everything else uploads immediately.
  input.onFilePick((file) => {
    if (file.type.startsWith("image/")) {
      input.showImagePreview(file, file.name);
      modeManager.transition(Mode.Insert);
      input.focus();
    } else {
      void handleFilePick(file);
    }
  });

  // Wire reaction chip clicks (bubbling custom events) → sendReaction
  setupReactionChipHandler();
  // Wire hover action bar button clicks → react / reply
  setupMessageActionHandlers();
  setupStatusBar();

  // Sync mode indicators + blur/focus on mode change
  modeManager.on((from, to) => {
    input.setMode(to);

    if (to === Mode.Normal) {
      shortcodePreview.hide();
      mentionPreview.hide();

      // Insert → Normal with content in the compose box: keep the caret in
      // the field so the user can navigate/select text and `p` to paste at the
      // cursor position. The keyboard handler routes keys through text-select
      // instead of the normal panel keymap while textSelectMode is "compose".
      const enteringFromInsert = from === Mode.Insert;
      const hasContent = input.getValue().length > 0;
      const alreadyInTextSelect = AppState.get("textSelectMode") !== null;
      if (enteringFromInsert && hasContent && AppState.get("vimMode")) {
        enterComposeTextSelect(input.getFieldElement());
        composeEditor.reset(); // fresh sequence state for this editing session
        // Don't blur — the input field stays focused for caret-driven editing.
      } else if (!alreadyInTextSelect) {
        // Blur the input so normal-mode keys don't type into the textbox.
        // Skip when text-select is already active (e.g. Visual→Normal while
        // selecting in the compose box) so we don't kill the active caret.
        input.blur();
      }
    }

    // Any transition out of Normal/Visual exits text-select if it was active.
    // (Visual is the one mode where text-select makes sense alongside vim mode.)
    if (to === Mode.Insert || to === Mode.Command) {
      exitTextSelect();
      composeEditor.reset();
    }

    // Visual → Normal while text-select is active: the user has been extending
    // a selection in Visual; collapse it to the focus end and re-prime to a
    // 1-char block so the cursor lands where they last moved towards.
    if (AppState.get("textSelectMode") !== null && from === Mode.Visual && to === Mode.Normal) {
      collapseToFocus(input.getFieldElement());
      primeBlockSelection(input.getFieldElement());
    }

    // Toggle the Visual-mode selection-color override so the highlight reads
    // muted (theme `--selection-bg`/`--selection-fg`) while extending in
    // Visual and bright (theme `--cursor`) when it represents the block
    // cursor in Normal. Drops on Insert/Command too — exitTextSelect handles
    // those, this is the in-text-select toggle.
    if (AppState.get("textSelectMode") !== null) {
      setVisualModeClass(to === Mode.Visual, input.getFieldElement());
    }
  });

  // Command bar wiring
  commandBar.onExecute((parsed) => {
    modeManager.transition(Mode.Normal);
    void executeCommand(parsed);
  });

  commandBar.onCancel(() => {
    modeManager.transition(Mode.Normal);
  });

  // Reply preview dismiss → cancel reply
  components.replyPreview.onDismiss(() => {
    cancelReply();
    cancelEdit();
  });

  // Thread view close → closeThread (sidebar fallback)
  components.threadView.onClose(() => {
    closeThread();
  });

  // Inline thread close callback (the [x] button inside the panel)
  components.timeline.onInlineThreadClose(() => {
    closeThread();
  });

  // ── Shortcode preview wiring ────────────────────────────────────────────
  shortcodePreview.onSelect((entry) => {
    const value = input.getValue();
    const lastColon = value.lastIndexOf(":");
    if (lastColon >= 0) {
      // Replace :query with the emoji
      const before = value.slice(0, lastColon);
      const replacement = entry.imageUrl ? `:${entry.shortcode}: ` : `${entry.key} `;
      input.setValue(before + replacement);
    }
    input.focus();
  });

  // ── Mention preview wiring ───────────────────────────────────────────────
  mentionPreview.onSelect((entry) => {
    const value = input.getValue();
    const lastAt = value.lastIndexOf("@");
    if (lastAt >= 0) {
      const before = value.slice(0, lastAt);
      // Insert display name as the visible text, user ID as the Matrix mention pill
      input.setValue(`${before}@${entry.displayName} `);
    }
    input.focus();
  });

  input.onInput((value) => {
    if (modeManager.current !== Mode.Insert) return;

    // Mention autocomplete (@name) — takes precedence over shortcodes if active
    const mentionQuery = extractMentionQuery(value);
    if (mentionQuery !== null) {
      shortcodePreview.hide();
      const matches = filterMembers(_roomMembers, mentionQuery);
      if (matches.length > 0) {
        mentionPreview.show(matches);
      } else {
        mentionPreview.hide();
      }
      return;
    }
    mentionPreview.hide();

    // Shortcode autocomplete
    const query = extractShortcodeQuery(value);
    if (query) {
      const all = allShortcodes();
      const matches = filterShortcodes(all, query);
      console.debug("[shortcode]", { value, query, allCount: all.length, matchCount: matches.length });
      if (matches.length > 0) {
        shortcodePreview.show(matches);
      } else {
        shortcodePreview.hide();
      }
    } else {
      shortcodePreview.hide();
    }
  });

  // Refresh custom emoji and room members when room changes
  AppState.on("currentRoomId", () => {
    void refreshCustomEmoji();
    void refreshRoomMembers();
  });

  // ── quark:action events from UI components ───────────────────────────────
  // Components that can't import actions.ts dispatch quark:action custom events.
  document.addEventListener("quark:action" as keyof DocumentEventMap, (e: Event) => {
    const detail = (e as CustomEvent<{ action: string }>).detail;
    if (detail?.action) {
      dispatchAction(detail.action, components);
    }
  });

  // ── Global keydown ──────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    const mode = modeManager.current;

    // Inline autocomplete popups are not modals — they own their keys while
    // visible (handled inside Insert-mode routing) but must block global nav.
    if (mentionPreview.isVisible()) return;

    // Any open modal overlay (dialog / picker / context menu / lightbox) owns
    // its own keys; each stopPropagation's on its own keydown listener, so this
    // document-level guard only fires when focus has escaped the overlay. In
    // that case Escape / Ctrl+[ closes the topmost overlay and every other key
    // is swallowed. Overlays self-register with modalManager on show/hide, so
    // adding a new dialog or picker needs no change here.
    if (modalManager.isAnyOpen) {
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        e.preventDefault();
        modalManager.closeTopMost();
      }
      return;
    }

    // Quick nav palette — Ctrl+K opens from any mode (no overlay open here).
    if (e.ctrlKey && e.key === "k") {
      if (AppState.get("loggedIn")) {
        e.preventDefault();
        quickNavPalette.show();
        return;
      }
    }

    // Escape (or Ctrl+[) always resets to Normal (if not already) and clears sequences.
    // When vim mode is disabled, Escape just closes overlays — don't leave Insert mode.
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      // A staged image is a lightweight modal: the first Escape only discards
      // it — mode, text-select, and reply/edit state all stay untouched.
      if (input.discardPendingImage()) {
        e.preventDefault();
        keymapManager.resetSequence();
        return;
      }
      if (AppState.get("vimMode")) {
        // If a text-select submode is active in Visual, drop the selection
        // first (back to Normal+text-select). A second Escape exits text-select
        // entirely — and a third runs the usual panel `close` action.
        const inTextSelect = AppState.get("textSelectMode") !== null;
        const wasVisual = modeManager.current === Mode.Visual;
        if (inTextSelect && wasVisual) {
          modeManager.transition(Mode.Normal);
          keymapManager.resetSequence();
          return;
        }
        if (inTextSelect) {
          exitTextSelect();
          composeEditor.reset();
          keymapManager.resetSequence();
          return;
        }
        modeManager.transition(Mode.Normal);
        keymapManager.resetSequence();
        commandBar.hide();
      }
      AppState.close();
      return;
    }

    // Only intercept when logged in
    if (!AppState.get("loggedIn")) return;

    if (mode === Mode.Insert) {
      handleInsertKeydown(e, components);
      return;
    }

    // When vim mode is disabled we should never reach Normal/Visual/Command,
    // but guard just in case — treat everything as Insert.
    if (!AppState.get("vimMode")) {
      handleInsertKeydown(e, components);
      return;
    }

    if (mode === Mode.Command) {
      // Command bar handles its own keydown — nothing to do here
      return;
    }

    // Compose-box Normal mode: route through the vim editor first so motions /
    // operators / counts edit the textarea. Unhandled keys (v, :, copy, …) fall
    // through to the text-select handler below.
    if (AppState.get("textSelectMode") === "compose" && mode === Mode.Normal) {
      if (handleComposeNormalKeydown(e, components)) return;
    }

    // Text-select submode takes precedence over the normal panel keymap so
    // that h/j/k/l move the caret / extend selection inside a message or the
    // compose box, and y / > / p operate on the selection rather than the
    // whole message.
    if (AppState.get("textSelectMode") !== null) {
      if (handleTextSelectKeydown(e, components)) return;
    }

    // Normal / Visual — resolve through keymap
    const panel = AppState.get("activePanel");
    const activeContext: KeyContext = panel === "timeline" ? "timeline"
      : panel === "roomlist" ? "roomlist"
      : "global";

    // Quark's keymap encodes only bare keys — feeding Ctrl+C into resolveKey
    // would match the `c` (edit) action and preventDefault, stealing the
    // browser's native copy/cut/paste/select-all. Ctrl+K and Ctrl+[ are the
    // app-level Ctrl combos and are intercepted above this block.
    if (e.ctrlKey || e.metaKey) {
      keymapManager.resetSequence();
      return;
    }

    const result = keymapManager.resolveKey(e.key, activeContext);

    if (result.kind === "action") {
      e.preventDefault();
      e.stopPropagation();
      dispatchAction(result.action, components);
    } else if (result.kind === "partial") {
      e.preventDefault();
      e.stopPropagation();
    } else {
      // "none" — in Normal mode, prevent any key from reaching a focused input
      if (mode === Mode.Normal || mode === Mode.Visual) {
        // Allow modifier-only keys, function keys, and browser shortcuts through
        const passthrough = e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey;
        if (!passthrough) {
          e.preventDefault();
        }
      }
    }
  });
}
