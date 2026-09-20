// Keyboard orchestration — wires vim mode + keymaps to action dispatcher

import { modeManager, Mode } from "../vim/mode.js";
import { keymapManager, eventChord } from "../vim/keybindings.js";
import { registerDefaultBindings } from "./registry.js";
import { currentAvailability } from "./availability.js";
import { buildMenu } from "./context_menus.js";
import { ComposeNormalEditor } from "../vim/compose_normal.js";
import { modalManager } from "../ui/ModalManager.js";
import type { AppComponents } from "../ui/App.js";
import {
  sendMessage,
  sendReaction,
  cancelReply,
  openEmojiPicker,
  openGifPicker,
  openStickerPicker,
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
  configThemeOverridesRc,
  selectRoom,
  markRoomAsRead,
  confirmAndLeaveRoom,
  startVerification,
  setupCrossSigning,
  logout,
} from "./actions.js";
import { AppState } from "./state.js";
import { resolveComposeSubmit } from "./compose_submit.js";
import {
  enterMessageTextSelect,
  enterComposeTextSelect,
  selectMessageTextForTouch,
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
import { onMobileChange, isMobile } from "./mobile.js";
import { effectiveSendOnEnter, shouldShowSendButton } from "./send_behavior.js";
import { showToast } from "../ui/NotificationToast.js";
import { runUpdateCheck } from "./update_check.js";
import { muteRoom as muteRoomAction, unmuteRoom as unmuteRoomAction } from "./notifications.js";
import { filterShortcodes, type ShortcodeEntry } from "../ui/ShortcodePreview.js";
import { filterMembers, type MentionEntry } from "../ui/MentionPreview.js";
import { getEmojiPacks } from "../ipc/emoji.js";
import { getThumbnail } from "../ipc/media.js";
import { getRoomMembers } from "../ipc/rooms.js";
import { extractShortcodeQuery, extractMentionQuery } from "./autocomplete_query.js";
import { applySetOptions } from "./set_options.js";

// ── Mode routing ──────────────────────────────────────────────────────────────

/** Which handler owns a keystroke, once modals and Escape have had their say. */
export type ModeRoute = "insert" | "command" | "vim";

/**
 * Decide which handler a keystroke belongs to.
 *
 * Extracted from the global keydown ladder because the ordering is load-bearing
 * and was wrong: the vim-off fallback used to be tested before Command mode, so
 * with vim disabled every keystroke meant for the command bar was routed into
 * the compose box instead. That never surfaced while the command bar was
 * reachable only through the `mode-command` action — which requires vim — but
 * the palette now opens it to finish a command that needs arguments, and on
 * mobile vim is always off (#98).
 *
 * Command mode therefore outranks the vim-mode question: if the command bar is
 * open, it owns the keys, whatever the editing model is.
 */
export function resolveModeRoute(mode: Mode, vimMode: boolean): ModeRoute {
  if (mode === Mode.Insert) return "insert";
  if (mode === Mode.Command) return "command";
  // Normal/Visual are unreachable with vim disabled; treat anything that gets
  // here as Insert rather than letting it fall through to the vim keymap.
  if (!vimMode) return "insert";
  return "vim";
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

export function dispatchAction(action: string, components: AppComponents): void {
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

    case "open-emoji-picker":
      modeManager.transition(Mode.Insert);
      input.focus();
      openEmojiPicker();
      break;

    case "open-gif-picker":
      modeManager.transition(Mode.Insert);
      input.focus();
      openGifPicker();
      break;

    // Markdown wrappers. Previously a hardcoded chord ladder in
    // handleInsertKeydown; they are actions now so a quarkrc can move them.
    case "format-bold":
      input.wrapSelection("**");
      break;

    case "format-italic":
      input.wrapSelection("*");
      break;

    case "format-underline":
      input.wrapSelection("__");
      break;

    case "format-strikethrough":
      input.wrapSelection("~~");
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

    case "open-directory":
      openRoomDirectory();
      break;

    case "open-sticker-picker":
      modeManager.transition(Mode.Insert);
      input.focus();
      openStickerPicker();
      break;

    // Settings → About's [check now]. The `:update` path goes through
    // executeCommand; this is the same work reached from a button.
    case "check-for-updates":
      showToast("Checking for updates…", "info");
      void runUpdateCheck(components, true);
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

    case "open-command-palette":
      components.commandPalette.show();
      break;

    case "close":
      AppState.close();
      break;

    case "leave-room-confirm":
      void confirmAndLeaveRoom();
      break;

    default:
      // Never re-dispatch quark:action here — the quark:action listener feeds
      // back into dispatchAction, so an unhandled name would recurse forever
      // and hang the app (#22).
      console.warn(`[keyboard] unhandled action: ${action}`);
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

  // Insert-mode chords (emoji/GIF pickers, the markdown wrappers) resolve
  // through the keymap in the "insert" context, which is what finally makes
  // `imap` mean something: the parser accepted imap directives and registered
  // them, but nothing ever resolved that context, so a user's insert-mode
  // mapping was silently ignored (#103).
  //
  // Only bindings that exist are claimed, so Ctrl+C / Ctrl+V / Ctrl+A keep
  // reaching the browser untouched.
  const insertChord = eventChord(e);
  if (insertChord) {
    const chordAction = keymapManager.actionForKey(insertChord, "insert");
    if (chordAction) {
      e.preventDefault();
      dispatchAction(chordAction, components);
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

/**
 * Contexts no key handler consults, so a mapping into one can never fire.
 *
 * `insert` and `visual` used to be here too: the quarkrc parser accepted imap
 * and vmap directives, registered them, and nothing ever resolved those
 * contexts — the user's mapping was taken and silently dropped. Both are wired
 * now. `command` remains because the command bar is a text field that handles
 * its own structural keys (Enter, Tab, history) and has no action vocabulary to
 * bind against; rather than accept cmap and ignore it, say so (#103).
 */
const UNSUPPORTED_CONTEXTS: ReadonlySet<KeyContext> = new Set<KeyContext>(["command"]);

// applySetOptions lives in ./set_options.ts (pure, unit-tested).

export async function applyRcDirectives(rc: ParsedRc): Promise<void> {
  // Collected rather than warned per-directive so a file with several gets one
  // message instead of a stack of toasts.
  const unsupportedMaps: string[] = [];

  // Read the config up front: `colorscheme` is subordinate to config.toml's
  // `general.theme` (#91), so that decision needs the config in hand before any
  // directive runs. A config we cannot read leaves `cfg` null, which lets the rc
  // file apply as it always did — losing the config read should not also lose
  // the user's theme.
  const cfg = await getAppConfig().catch((err) => {
    console.warn("[quarkrc] failed to read config:", err);
    return null;
  });

  for (const directive of rc.directives) {
    if (directive.type === "map") {
      const context = MAP_TYPE_TO_CONTEXT[directive.map_type];
      if (context && UNSUPPORTED_CONTEXTS.has(context)) {
        unsupportedMaps.push(`${directive.map_type}: ${directive.key}`);
        continue;
      }
      if (context) keymapManager.map(context, directive.key, directive.action, directive.noremap);
    } else if (directive.type === "unmap") {
      const context = MAP_TYPE_TO_CONTEXT[directive.map_type];
      if (context) keymapManager.unmap(context, directive.key);
    } else if (directive.type === "let" && directive.name === "mapleader") {
      keymapManager.setLeaderKey(directive.value);
    } else if (directive.type === "colorscheme") {
      if (configThemeOverridesRc(cfg?.general.theme)) {
        // Not a failure, so no toast — but the user is looking at a theme their
        // rc file does not name, and this is the only place that says why.
        console.info(
          `[quarkrc] colorscheme ${directive.name} ignored: config.toml's ` +
          `general.theme (${cfg?.general.theme}) takes precedence`,
        );
        continue;
      }
      // Silent: this is the rc file being applied at startup, not the user
      // asking for a theme. It is also the second of two startup paths that can
      // name one — config.toml's `general.theme` is the other — so announcing
      // here toasted the same theme twice on every launch.
      void loadTheme(directive.name, { announce: false });
    }
  }
  if (rc.errors.length > 0) {
    console.warn("[quarkrc] parse errors:", rc.errors);
  }

  // A mapping that cannot fire is worse than a rejected one: the user believes
  // it took. Say which, once.
  if (unsupportedMaps.length > 0) {
    const detail = unsupportedMaps.join(", ");
    console.warn(`[quarkrc] ignored — command mode has no bindable actions: ${detail}`);
    showToast(`quarkrc: cmap is not supported (${unsupportedMaps.length} ignored)`, "info");
  }

  const setDirectives = rc.directives.filter(
    (d): d is Extract<typeof d, { type: "set" }> => d.type === "set"
  );
  if (setDirectives.length === 0 || !cfg) return;

  try {
    await setAppConfig(applySetOptions(cfg, setDirectives));
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
          roomHeader, imageLightbox, commandPalette, contextMenu,
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

  // ── Context menus ────────────────────────────────────────────────────────
  // Rows, order and grouping come from the registry; hints come from the live
  // keymap. Only behaviour is wired here, keyed by action id — and an id with
  // no handler is dropped, which is how "Mark as read" appears on unread rooms
  // alone without the registry needing to model that.

  // The hover bar's ⋯ button opens the same menu right-click and long-press do,
  // so all three routes to a message offer the same capabilities.
  document.addEventListener("quark:msg-menu" as keyof DocumentEventMap, (e: Event) => {
    const { eventId, x, y } = (e as CustomEvent<{ eventId: string; x: number; y: number }>).detail;
    if (eventId) timeline.emitContextMenu(eventId, x, y);
  });

  // Right-click / long-press context menu for messages
  timeline.onContextMenu((eventId, x, y) => {
    const events = AppState.get("currentTimeline");
    const evt = events.find((ev) => ev.event_id === eventId);
    const ownUserId = AppState.get("ownUserId");
    const isOwn = !!evt && !!ownUserId && evt.sender === ownUserId;

    // Both the desktop right-click menu and the mobile long-press sheet flow
    // through this callback, so this is the single place that gives
    // finger-input users a way to edit or delete.
    const ctx = currentAvailability({
      selectedMessageId: eventId,
      selectedMessageIsOwn: isOwn,
    });

    contextMenu.show(x, y, buildMenu("message", ctx, {
      "reply": () => {
        if (!evt) return;
        startReply(eventId, evt.sender, evt.body.slice(0, 80));
        input.focus();
      },
      "react": () => openQuickReactPicker(eventId),
      "open-thread": () => void openThread(eventId),
      "copy-message": () => {
        void navigator.clipboard.writeText(evt?.body ?? "");
      },
      // Mobile only. On desktop you select text by dragging, so the row would
      // be noise; withholding the handler is what keeps it out of the menu.
      "select-message-text": isMobile()
        ? () => {
            const bodyEl = timeline.getMessageBodyElementById(eventId);
            if (bodyEl) selectMessageTextForTouch(bodyEl);
          }
        : undefined,
      "view-raw-event": () => void openDebugViewerForEvent(eventId),
      "edit": () => {
        // Prefer the MessageData body (reflects applied edits) over the raw
        // timeline event.
        const body = timeline.getMessageBodyById(eventId) ?? evt?.body ?? "";
        startEdit(eventId, body);
        modeManager.transition(Mode.Insert);
        input.focus();
      },
      "redact": () => void redactMessage(eventId),
    }));
  });

  // Right-click context menu for rooms in the room list
  roomList.onContextMenu((roomId, x, y) => {
    const room = AppState.get("roomListCache").find((r) => r.room_id === roomId);
    // The menu targets the room under the cursor, which is not necessarily the
    // one that is open — so the room requirement is evaluated against that
    // target rather than against AppState's current room.
    const ctx = currentAvailability({ roomId });

    contextMenu.show(x, y, buildMenu("room", ctx, {
      "open-room": () => void selectRoom(roomId),
      "open-room-settings": () => void selectRoom(roomId).then(() => openRoomSettings()),
      "open-room-info": () => void selectRoom(roomId).then(() => openRoomInfo()),
      // Unread rooms only; see the note above buildMenu's handler map. Marks
      // read *without* opening — it used to call selectRoom, so the item both
      // did the wrong thing and did nothing at all on the open room (#102).
      "mark-room-read": room && room.unread_count > 0
        ? () => markRoomAsRead(roomId)
        : undefined,
      // Exactly one of these is applicable, so exactly one gets a handler.
      // `muted` is undefined before the room has synced, which reads as unmuted
      // — the same fallback the Info tab uses.
      "mute-room": room?.muted ? undefined : () => void muteRoomAction(roomId),
      "unmute-room": room?.muted ? () => void unmuteRoomAction(roomId) : undefined,
      "leave-room-confirm": () => void selectRoom(roomId).then(() => confirmAndLeaveRoom()),
    }));
  });

  // Right-click context menu for subspace section labels in the room list
  roomList.onSectionContextMenu((spaceId, x, y) => {
    contextMenu.show(x, y, buildMenu("section", currentAvailability({ spaceId }), {
      "open-space-settings": () => void openSpaceSettings(spaceId),
    }));
  });

  // Mobile top bar's ⋮ menu — the room-scoped chrome the hidden desktop header
  // used to carry. Same registry rows, same builder, rendered by ContextMenu as
  // a bottom sheet in mobile mode.
  components.mobileTopBar.onOverflowClick((x, y) => {
    contextMenu.show(x, y, buildMenu("overflow", currentAvailability(), {
      "open-search": () => openSearch(),
      "open-pinned": () => void openPinnedMessages(),
      "open-room-info": () => void openRoomInfo(),
      "toggle-members": () => toggleMemberList(),
      "help": () => components.helpDialog.show(),
      ...(() => {
        const id = AppState.get("currentRoomId");
        const current = AppState.get("roomListCache").find((r) => r.room_id === id);
        return id && current?.muted
          ? { "unmute-room": () => void unmuteRoomAction(id) }
          : id
            ? { "mute-room": () => void muteRoomAction(id) }
            : {};
      })(),
    }));
  });

  // Right-click context menu for spaces in the space strip
  spaceStrip.onContextMenu((spaceId, x, y) => {
    contextMenu.show(x, y, buildMenu("space", currentAvailability({ spaceId }), {
      "open-space-settings": () => void openSpaceSettings(spaceId),
    }));
  });

  // ── User keybindings ──────────────────────────────────────────────────────
  void loadQuarkrc().then(applyRcDirectives).catch(() => { /* no rc file is fine */ });

  // Wire quick nav palette → selectRoom
  // Visible palette affordance in the space strip, beside the other app-level
  // controls. The strip is inside the drawer on mobile, so the palette still
  // does not depend on knowing Ctrl+K or finding the pull-down gesture.
  spaceStrip.onSearchClick(() => commandPalette.show());
  roomList.onDirectoryClick(() => openRoomDirectory());

  commandPalette.onSelectRoom((roomId) => {
    void selectRoom(roomId);
  });

  // Action rows. The registry's arg grammar decides which of the three routes
  // a row takes; see invocationFor in CommandPalette.ts.
  commandPalette.onInvoke((invocation) => {
    switch (invocation.kind) {
      case "dispatch":
        dispatchAction(invocation.actionId, components);
        break;
      case "run":
        void executeCommand({ name: invocation.command, args: [], raw: `:${invocation.command}` });
        break;
      case "prefill":
        // The command needs an argument the palette cannot supply, so hand the
        // user the command bar with the line started. This is the one path that
        // needs Command mode to work without vim — see the keydown ordering.
        modeManager.transition(Mode.Command);
        commandBar.show(invocation.line);
        break;
    }
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
  // Where the command bar returns to depends on whether there *is* a Normal
  // mode to return to. With vim off, dropping the user into Normal would strand
  // them in a mode the rest of the app refuses to route keys for.
  const leaveCommandMode = (): void => {
    if (AppState.get("vimMode")) {
      modeManager.transition(Mode.Normal);
    } else {
      modeManager.transition(Mode.Insert);
      input.focus();
    }
  };

  commandBar.onExecute((parsed) => {
    leaveCommandMode();
    void executeCommand(parsed);
  });

  commandBar.onCancel(leaveCommandMode);

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

    // Global chords, resolved through the keymap so a quarkrc can move them.
    // Runs above the vim branches because the palette is the one entry point
    // that must not depend on modal editing — and only claims a chord that is
    // actually bound, so browser copy/paste/select-all stay untouched.
    if (AppState.get("loggedIn")) {
      const chord = eventChord(e);
      if (chord) {
        const chordAction = keymapManager.actionForKey(chord, "global");
        if (chordAction) {
          e.preventDefault();
          dispatchAction(chordAction, components);
          return;
        }
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

    const route = resolveModeRoute(mode, AppState.get("vimMode"));
    if (route === "insert") {
      handleInsertKeydown(e, components);
      return;
    }
    if (route === "command") {
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

    // Normal / Visual — resolve through keymap. Visual gets its own context so
    // `vmap` applies; like `imap` it was parsed, registered, and never consulted.
    const panel = AppState.get("activePanel");
    const activeContext: KeyContext = mode === Mode.Visual ? "visual"
      : panel === "timeline" ? "timeline"
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
