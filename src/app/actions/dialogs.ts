// Dialog/overlay opener actions: settings, room info, pinned messages, room
// directory, room & space settings, and the debug viewer.

import { AppState } from "../state.js";

import { showError } from "../../ui/NotificationToast.js";

import { getComponents } from "./context.js";

/**
 * Open the settings dialog.
 */
export function openSettings(): void {
  const { settingsDialog } = getComponents();
  settingsDialog.show();
}

/**
 * Open the room info dialog for the current room.
 */
export async function openRoomInfo(): Promise<void> {
  getComponents().roomDialog.show("info");
}

/**
 * Open the pinned messages dialog for the current room.
 */
export async function openPinnedMessages(): Promise<void> {
  const { pinnedMessagesDialog } = getComponents();
  await pinnedMessagesDialog.show();
}

/**
 * Re-fetch and re-render the pinned messages dialog if it's currently open.
 * Called when new room keys arrive so previously-undecryptable pins refresh
 * to plaintext without the user having to close and reopen the dialog.
 */
export async function refreshPinnedMessagesIfOpen(): Promise<void> {
  const { pinnedMessagesDialog } = getComponents();
  if (pinnedMessagesDialog.isVisible()) await pinnedMessagesDialog.show();
}

/**
 * Open the message search dialog for the current room, optionally seeded with
 * an initial query.
 */
export function openSearch(query = ""): void {
  const { searchDialog } = getComponents();
  searchDialog.show(query);
}

/**
 * Open the room directory dialog.
 */
export function openRoomDirectory(): void {
  const { roomDirectoryDialog } = getComponents();
  roomDirectoryDialog.show();
}

/**
 * Open the room settings dialog for the current room.
 */
export async function openRoomSettings(): Promise<void> {
  getComponents().roomDialog.show("settings");
}

/**
 * Open the space settings dialog for the current or specified space.
 */
export async function openSpaceSettings(spaceId?: string): Promise<void> {
  const { spaceSettingsDialog } = getComponents();
  await spaceSettingsDialog.show(spaceId);
}

/**
 * Open the debug viewer for the current room's state events.
 */
export async function openDebugViewer(subject?: import("../../ui/DebugViewer.js").DebugSubject): Promise<void> {
  const { debugViewer } = getComponents();
  if (subject) {
    await debugViewer.show(subject);
  } else {
    await debugViewer.showCurrentRoom();
  }
}

/**
 * Open the debug viewer for a specific event in the current room.
 */
export async function openDebugViewerForEvent(eventId: string): Promise<void> {
  const roomId = AppState.snapshot.currentRoomId;
  if (!roomId) {
    showError("No room selected");
    return;
  }
  await openDebugViewer({ kind: "event", roomId, eventId });
}
