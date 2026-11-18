// Room dialog tab registry — the single source of truth for which tabs exist
// and their order, read by RoomDialog to build the strip and cycle with Tab.

import type { RoomTab } from "./types.js";
import { infoTab } from "./tabs/info.js";
import { settingsTab } from "./tabs/settings.js";
import { membersTab } from "./tabs/members.js";
import { permissionsTab } from "./tabs/permissions.js";
import { packsTab } from "../packs/packs_tab.js";

export const ROOM_TABS: RoomTab[] = [infoTab, settingsTab, packsTab, membersTab, permissionsTab];
