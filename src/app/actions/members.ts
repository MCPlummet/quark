// Member list actions: toggling the member-list sidebar.

import { AppState } from "../state.js";
import { isMobile, closeDrawer, dismissKeyboard } from "../mobile.js";

import { getComponents } from "./context.js";

/**
 * Set the member list sidebar visibility explicitly. Drives the layout class and
 * the AppState flag; used by the @-toggle, the top-bar button, and the mobile
 * swipe gesture (#8), so they all share one source of truth.
 */
export function setMemberListVisible(visible: boolean): void {
  const { mainLayout } = getComponents();
  if (AppState.get("memberListVisible") === visible) return;
  AppState.set("memberListVisible", visible);

  if (!visible && AppState.get("activePanel") === "members") {
    AppState.set("activePanel", "timeline");
  }

  mainLayout.classList.toggle("quark-layout--member-list-open", visible);

  // Mobile is one-overlay-at-a-time: opening the member-list pulls focus
  // away from the drawer — and dismisses the keyboard, which would otherwise
  // sit over the panel and keep typing into the covered room (#37).
  if (visible && isMobile()) {
    closeDrawer();
    dismissKeyboard();
  }
}

/**
 * Toggle the member list sidebar visibility.
 */
export function toggleMemberList(): void {
  setMemberListVisible(!AppState.get("memberListVisible"));
}
