// Android back-button handler.
//
// Tauri's WryActivity routes hardware back-press to `WebView.goBack()`. If
// there's nothing in the WebView history to go back to, the press falls
// through to `super.onBackPressed()` and the app exits.
//
// We hijack that by seeding one history entry on startup, so the OS back
// press fires a `popstate` event in JS instead of exiting. The handler
// below decides what "back" should mean given the current UI state, then
// re-pushes the placeholder entry so subsequent presses keep firing.
//
// Precedence (from highest to lowest):
//   1. Any modal/overlay open → close the top one
//   2. Member list panel open → close it
//   3. Thread view open → close it
//   4. Drawer open → close drawer
//   5. Drawer closed → open drawer (per issue #31's request)
//
// iOS has no hardware back button; this module is a no-op on non-Android
// platforms. We still seed history on every platform — `history.pushState`
// is harmless and `popstate` is only ever fired by deliberate navigation.
//
// The one exception is a page that embeds the client in an iframe (the
// landing page's live demo, the quark.tel/theme preview). A frame shares the
// browser's session history with the page around it, so the seeded entry
// and the re-push on every popstate would take over that page's Back button:
// its own history steps get swallowed and Back can never leave the page.
// Framed, there is no hardware back press to catch, so we do nothing.

import { isMobile, isDrawerOpen, openDrawer, closeDrawer } from "./mobile.js";
import { AppState } from "./state.js";
import { closeThread, toggleMemberList } from "./actions.js";
import { modalManager } from "../ui/ModalManager.js";
import type { AppComponents } from "../ui/App.js";

const BACK_STATE_TAG = "quark-back";

/**
 * Wire up Android back-button handling. Safe to call on iOS / desktop —
 * popstate just never fires there.
 */
export function setupBackButton(_components: AppComponents): void {
  if (isFramed()) return;

  // Seed one history entry so the back-press has somewhere to go.
  history.pushState({ tag: BACK_STATE_TAG }, "");

  window.addEventListener("popstate", () => {
    // Re-seed immediately so the next press keeps firing popstate instead
    // of falling through to the system back (which would exit the app).
    history.pushState({ tag: BACK_STATE_TAG }, "");

    // Any open overlay handles the back press — close the topmost one.
    if (modalManager.closeTopMost()) return;

    if (AppState.get("memberListVisible")) {
      toggleMemberList();
      return;
    }
    if (AppState.get("threadRootEventId")) {
      closeThread();
      return;
    }

    if (!isMobile()) {
      // Desktop: nothing more to do; the WebView already popped state.
      return;
    }

    if (isDrawerOpen()) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });
}

/** Whether this page runs inside another page's iframe. */
function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Some browsers throw on touching a cross-origin `top`: that is framed too.
    return true;
  }
}
