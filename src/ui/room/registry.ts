// Room dialog tab registry — the single source of truth for which tabs exist
// and their order, read by RoomDialog to build the strip and cycle with Tab.

import type { RoomTab } from "./types.js";
import { infoTab } from "./tabs/info.js";
import { settingsTab } from "./tabs/settings.js";
import { membersTab } from "./tabs/members.js";
import { permissionsTab } from "./tabs/permissions.js";

export const ROOM_TABS: RoomTab[] = [infoTab, settingsTab, membersTab, permissionsTab];

export function visibleRoomTabs(tabs: RoomTab[], isMobile: boolean): RoomTab[] {
  return tabs.filter((t) => !(t.mobileHidden && isMobile));
}
