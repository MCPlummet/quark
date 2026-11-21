// Room dialog — the room's tabs on the shared RoomTabsDialog host.
//
// Replaces RoomInfoDialog and RoomSettingsDialog, which captured overlapping
// room state with the split drawn in the wrong place (#92): both stated name,
// topic, members, encryption and directness, while only one of them could
// change any of it, and mute and leave existed on the info dialog alone — so
// with the desktop room header hidden on mobile, neither was reachable by
// touch.
//
// `show()` takes the tab to land on — `:info` and `:roomsettings` are two
// doors into one room — and the room is the one open now, resolved once.

import { AppState } from "../app/state.js";
import { RoomTabsDialog } from "./room/RoomTabsDialog.js";
import { ROOM_TABS } from "./room/registry.js";

export class RoomDialog extends RoomTabsDialog {
  constructor() {
    super({
      title: "── room ──",
      ariaLabel: "Room",
      closeLabel: "Close room dialog",
      backLabel: "Back to room sections",
      tabs: ROOM_TABS,
      subject: "room",
      noRoomText: "No room selected.",
    });
  }

  /**
   * Open the dialog for the current room, on `tabId` (`:info` lands on Info,
   * `:roomsettings` on Settings).
   */
  show(tabId?: string): void {
    this.open(AppState.get("currentRoomId"), tabId);
  }
}
