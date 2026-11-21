// Space settings tab registry — read by SpaceSettingsDialog (a RoomTabsDialog,
// like the room dialog: a space is a room, so the tabs share its contract).

import type { RoomTab } from "../room/types.js";
import { spaceGeneralTab } from "./tabs/general.js";
import { spaceChildrenTab } from "./tabs/children.js";
import { packsTab } from "../packs/packs_tab.js";

export const SPACE_TABS: RoomTab[] = [spaceGeneralTab, spaceChildrenTab, packsTab];
