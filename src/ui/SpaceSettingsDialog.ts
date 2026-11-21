// Space settings — the space's tabs (General, Children, Emoji) on the shared
// RoomTabsDialog host. A space is a room, so it uses the room dialog's tab
// contract, controls and stylesheet; it used to carry its own copy with the
// tabs hard-coded in three switchyards (#12).

import { AppState } from "../app/state.js";
import { RoomTabsDialog } from "./room/RoomTabsDialog.js";
import { SPACE_TABS } from "./space/registry.js";

export class SpaceSettingsDialog extends RoomTabsDialog {
  constructor() {
    super({
      title: "── space settings ──",
      ariaLabel: "Space Settings",
      closeLabel: "Close space settings",
      backLabel: "Back to space sections",
      tabs: SPACE_TABS,
      subject: "space",
      noRoomText: "No space selected.",
    });
  }

  /** Open for `spaceId`, or the space being viewed. */
  async show(spaceId?: string): Promise<void> {
    this.open(spaceId ?? AppState.snapshot.currentSpaceId ?? null);
  }
}
