// Tab contract for the room dialog.
//
// Mirrors src/ui/settings/types.ts deliberately: the two dialogs have the same
// shape (a tab strip over a content pane, tabs that may hide themselves on
// mobile), so they share the contract, the controls and the stylesheet rather
// than growing a second set of each.
//
// A tab receives the room it is for rather than reading AppState itself. The
// dialog resolves that once, up front, so a tab cannot render against a room
// the user has since navigated away from — the old RoomSettingsDialog re-read
// `AppState.currentRoomId` inside every builder and could act on a different
// room than the one whose header it was showing.

import type { SettingsControls } from "../settings/controls.js";
import type { RoomInfo } from "../../ipc/types.js";

export interface RoomTabContext {
  content: HTMLElement;
  controls: SettingsControls;
  /** The room this dialog was opened for. */
  roomId: string;
  /** Cached metadata, when the room list has it. */
  room: RoomInfo | undefined;
  isMobile: boolean;
  close(): void;
  dispatch(action: string): void;
  /** Re-run the active tab's builder, e.g. after a change it cannot patch. */
  refresh(): void;
}

export interface RoomTab {
  id: string;
  label: string;
  /** Hide this whole tab on mobile. */
  mobileHidden?: boolean;
  build(ctx: RoomTabContext): void | Promise<void>;
}
