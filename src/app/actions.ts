// Action dispatcher — connects IPC calls to UI state updates.
//
// This file was historically a 3000-line god-module containing all 61 action
// functions plus their shared module state and helpers. It has been split into
// domain-scoped modules under `actions/` (see `actions/context.ts` for the
// shared state/helpers that every domain module reads from).
//
// This file is now a barrel: it re-exports every name that was previously
// exported here, with identical signatures, so existing importers (keyboard.ts,
// sync.ts, back.ts, ui/ components, …) need no changes. Add new action
// functions to the appropriate domain module and re-export them below.

// Shared context: components ref, dedupe set, pagination view flag, and a few
// timeline/avatar helpers that are also part of the public action surface.
export {
  setComponents,
  consumeOwnSentEvent,
  isInContextView,
  resolveDisplayName,
  stripReplyFallback,
  downloadSyncMessageImage,
  resolveSenderAvatarUrl,
  ensureSenderAvatarDownloaded,
  resolveInlineEmojiForTimeline,
} from "./actions/context.js";

// Session lifecycle.
export { login, attemptSessionRestore, logout, maybePromptSessionVerification } from "./actions/session.js";

// Home view (floating-DM canvas).
export {
  enterHomeView,
  exitHomeView,
  isHomeViewActive,
  homeViewHandleMessage,
  homeViewHandlePresence,
} from "./actions/home.js";

// Room & space navigation, pagination, joins, DMs, member loading.
export {
  selectRoom,
  jumpToMessage,
  jumpToLatest,
  reloadCurrentRoomTimeline,
  appendRoomTimelineCache,
  applyCacheConfig,
  selectSpace,
  joinRoom,
  leaveRoomWithFeedback,
  confirmAndLeaveRoom,
  refreshRooms,
  bumpRoomActivity,
  applyLocalRoomMeta,
  openOrCreateDm,
  loadRoomMembers,
  applyReadReceiptVisibility,
} from "./actions/rooms.js";

// Message composition & lifecycle.
export {
  sendMessage,
  startReply,
  cancelReply,
  startEdit,
  cancelEdit,
  editMessage,
  applyIncomingRedaction,
  redactMessage,
} from "./actions/messages.js";

// Threads.
export { openThread, closeThread } from "./actions/threads.js";

// Reactions.
export {
  sendReaction,
  applyIncomingReaction,
  openQuickReactPicker,
  setupReactionChipHandler,
} from "./actions/reactions.js";

// Profiles.
export {
  openProfileForUser,
  openProfileDialog,
  openOwnProfile,
  openProfileEdit,
} from "./actions/profile.js";

// Dialog/overlay openers.
export {
  openSettings,
  openRoomInfo,
  openPinnedMessages,
  refreshPinnedMessagesIfOpen,
  openSearch,
  openRoomDirectory,
  openRoomSettings,
  openSpaceSettings,
  openDebugViewer,
  openDebugViewerForEvent,
} from "./actions/dialogs.js";

// Emoji / sticker / GIF pickers.
export { openEmojiPicker, openStickerPicker, openGifPicker } from "./actions/gif.js";

// Media paste/pick, message hover-action handlers.
export { sendPendingImage, handleFilePick, setupMessageActionHandlers } from "./actions/media.js";

// `:` command executor.
export { executeCommand } from "./actions/commands.js";

// E2EE: verification & cross-signing.
export {
  startVerification,
  handleIncomingVerificationRequest,
  setupCrossSigning,
} from "./actions/crypto.js";

// Theme loading.
export { loadTheme, loadThemeFromConfig } from "./actions/theme.js";

// Member list.
export { toggleMemberList } from "./actions/members.js";

// Status bar.
export { setupStatusBar, editStatus } from "./actions/status.js";
