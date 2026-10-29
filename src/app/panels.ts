// Panel nav wiring — registers each UI panel's nav callbacks with AppState.
// Kept separate from keyboard.ts (keyboard concerns) and state.ts (no UI deps).

import { AppState } from "./state.js";
import { cancelReply, cancelEdit, closeThread, dismissComposeBanner } from "./actions.js";
import type { AppComponents } from "../ui/App.js";

export function setupPanelNav(components: AppComponents): void {
  const { spaceStrip, roomList, timeline, threadView, memberList, homeView } = components;

  AppState.registerPanelNav("spaces", {
    navDown: () => spaceStrip.navDown(),
    navUp: () => spaceStrip.navUp(),
    jumpTop: () => spaceStrip.navFirst(),
    jumpBottom: () => spaceStrip.navLast(),
    select: () => spaceStrip.selectFocused(),
    focusActive: () => spaceStrip.focusActive(),
    close: () => { /* no-op */ },
  });

  AppState.registerPanelNav("roomlist", {
    navDown: () => roomList.navDown(),
    navUp: () => roomList.navUp(),
    jumpTop: () => roomList.navFirst(),
    jumpBottom: () => roomList.navLast(),
    select: () => roomList.selectFocused(),
    focusActive: () => roomList.focusActive(),
    close: () => { /* no-op */ },
  });

  AppState.registerPanelNav("timeline", {
    navDown: () => timeline.selectNext(),
    navUp: () => timeline.selectPrev(),
    jumpTop: () => timeline.selectFirst(),
    jumpBottom: () => timeline.selectLast(),
    // focusActive: no DOM focus needed — activePanel state alone drives keyboard routing
    close: () => {
      timeline.clearSelection();
      cancelReply();
      cancelEdit();
      closeThread();
    },
    selectedMessageId: () => timeline.selectedMessageId,
  });

  // The open thread is its own panel. It used to borrow the timeline's
  // registration, with every timeline nav method branching on "is a thread
  // open" — the branch that made jump-to-latest scroll the room to the thread
  // (#132). Opening a thread makes this the active panel; closing it hands
  // focus back to the timeline (actions/threads.ts).
  AppState.registerPanelNav("thread", {
    navDown: () => threadView.selectNext(),
    navUp: () => threadView.selectPrev(),
    jumpTop: () => threadView.selectFirst(),
    jumpBottom: () => { threadView.selectLast(); },
    // Esc in Normal does what the banner's [x] does: drops an armed reply or
    // edit first, else closes the thread outright — panel, banner and routing.
    // (The Esc that leaves Insert doesn't get here; see escapeRunsPanelClose.)
    close: () => dismissComposeBanner(),
    selectedMessageId: () => threadView.selectedMessageId,
  });
  threadView.onFocus(() => {
    if (AppState.get("activePanel") !== "thread") AppState.set("activePanel", "thread");
  });

  // Clicking in the timeline should immediately route j/k there, even if the
  // user hasn't explicitly pressed l to move focus from the room list.
  timeline.onFocus(() => {
    if (AppState.get("activePanel") !== "timeline") {
      AppState.set("activePanel", "timeline");
    }
  });

  AppState.registerPanelNav("members", {
    navDown: () => memberList.navDown(),
    navUp: () => memberList.navUp(),
    jumpTop: () => memberList.navFirst(),
    jumpBottom: () => memberList.navLast(),
    focusActive: () => memberList.focusFirst(),
    close: () => { /* no-op */ },
  });

  // Home view canvas — j/k cycle the floating DMs, Enter opens, Esc returns
  // to the space strip (panel order is [spaces, home] while it's active).
  AppState.registerPanelNav("home", {
    navDown: () => homeView.navNext(),
    navUp: () => homeView.navPrev(),
    select: () => homeView.selectFocused(),
    focusActive: () => homeView.focusActive(),
    close: () => AppState.focusPanel("spaces"),
  });
}
