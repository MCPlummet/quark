// Settings tab registry.
//
// The single source of truth for which tabs exist and their order. The host
// (SettingsDialog) iterates this to build the tab bar, switch content, and cycle
// with Tab — replacing the three hardcoded tab lists it used to carry.

import type { SettingsTab } from "./types.js";
import { generalTab } from "./tabs/general.js";
import { mediaTab } from "./tabs/media.js";
import { gifTab } from "./tabs/gif.js";
import { emojiTab } from "./tabs/emoji.js";
import { notificationsTab } from "./tabs/notifications.js";
import { themesTab } from "./tabs/themes.js";
import { aboutTab } from "./tabs/about.js";

export const SETTINGS_TABS: SettingsTab[] = [
  generalTab, mediaTab, gifTab, emojiTab, notificationsTab, themesTab, aboutTab,
];

export function visibleTabs(tabs: SettingsTab[], isMobile: boolean): SettingsTab[] {
  return tabs.filter((t) => !(t.mobileHidden && isMobile));
}
