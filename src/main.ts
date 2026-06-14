// Quark entry point — clean bootstrap wiring everything together
// Note: base.css and vars.css are referenced via <link> tags in index.html

import { mountApp } from "./ui/App.js";
import { AppState } from "./app/state.js";
import { setComponents, login, logout, attemptSessionRestore, maybePromptSessionVerification, selectRoom, selectSpace, refreshRooms, openSettings, openRoomSettings, openOwnProfile } from "./app/actions.js";
import { setupKeyboard } from "./app/keyboard.js";
import { setupPanelNav } from "./app/panels.js";
import { setupBackButton } from "./app/back.js";
import { initNotifications } from "./app/notifications.js";
import { initNotificationRouting } from "./app/notification_routing.js";
import { startSync } from "./app/sync.js";
import { showError } from "./ui/NotificationToast.js";
import { setForceMock } from "./ipc/invoke.js";
import { maybeCheckForUpdates, rememberDismissed } from "./app/update_check.js";
import { updateInstall } from "./ipc/updater.js";
import { showMainLayout } from "./ui/App.js";

// ── Debug mode ────────────────────────────────────────────────────────────────
// Append ?debug to the URL to skip login and show the chat UI with mock data.

const DEBUG_MODE = new URLSearchParams(window.location.search).has("debug");

// ── Startup overlay ───────────────────────────────────────────────────────────
// The overlay is embedded in index.html so it's visible from the first paint
// before any JS runs. Dismiss it once the app is ready to be interacted with.

function dismissStartupOverlay(): void {
  const overlay = document.getElementById("startup-overlay");
  if (!overlay) return;
  overlay.classList.add("startup-overlay--out");
  overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const appEl = document.getElementById("app");
if (!appEl) {
  throw new Error("Fatal: #app element not found in DOM");
}

// Mount all UI components into the DOM
const components = mountApp(appEl);

// Register components with the action dispatcher
setComponents(components);

// ── Auto-update wiring ────────────────────────────────────────────────────────
components.updateBanner.onInstall(() => {
  void updateInstall().catch((e) => {
    showError(`Update failed: ${e instanceof Error ? e.message : String(e)}`);
  });
});
components.updateBanner.onDismiss((version) => rememberDismissed(version));

// Reflect download progress on the banner using the same tauriListen shim as
// sync.ts — gracefully falls back when running outside Tauri (browser dev mode).
void (async () => {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<{ chunk_length: number; content_length: number | null }>(
      "quark://update/progress",
      (e) => components.updateBanner.setProgress(e.payload.chunk_length, e.payload.content_length),
    );
  } catch {
    /* not running under Tauri (browser dev) — no progress events */
  }
})();

// Wire panel navigation (must happen before any keyboard setup)
setupPanelNav(components);

// Wire Android hardware back button. Seeds one history entry now so the OS
// back press fires `popstate` instead of exiting the app.
setupBackButton(components);

// ── Debug auto-login ──────────────────────────────────────────────────────────

if (DEBUG_MODE) {
  setForceMock(true);
  AppState.set("loggedIn", true);
  showMainLayout(components);
  setupKeyboard(components);
  void refreshRooms().then(async () => {
    dismissStartupOverlay();
    // Auto-select the first room so the timeline is populated
    const rooms = AppState.get("roomListCache");
    if (rooms.length > 0) {
      await selectRoom(rooms[0].room_id);
    }
  });
}

// ── Session restore ───────────────────────────────────────────────────────────
// Try to restore a saved session before showing the login form. Only runs in
// Tauri (the real IPC is needed); skipped in DEBUG_MODE which uses mock data.

if (!DEBUG_MODE) {
  void attemptSessionRestore(components).then((restored) => {
    // Dismiss the overlay regardless — either the main layout or login is now ready.
    dismissStartupOverlay();
    if (restored) {
      setupKeyboard(components);
      void startSync(components);
      void initNotifications().then(() => initNotificationRouting());
      // Nudge unverified sessions to verify. Delayed so the first key-query has
      // a chance to populate the other-device list and cross-signing status.
      setTimeout(() => void maybePromptSessionVerification(), 2500);
      // Background update check — deferred so it doesn't compete with first sync.
      setTimeout(() => void maybeCheckForUpdates(components), 4000);
    }
  });
}

// ── Login screen wiring ───────────────────────────────────────────────────────

components.loginScreen.onLogin(async (homeserver, username, password) => {
  await login(homeserver, username, password);

  // On successful login, set up keyboard handler and start sync
  if (AppState.get("loggedIn")) {
    setupKeyboard(components);
    void startSync(components);
    // Prompt for the OS notification permission once the user is in. Doing
    // this after login (not on cold start) keeps the system dialog tied to
    // an obvious "you're about to start chatting" context. Routing (action
    // types, tap listener, cold-start replay) follows once channels exist.
    void initNotifications().then(() => initNotificationRouting());
    // Nudge the user to verify this new session against another device. Delayed
    // so the homeserver's device list / cross-signing status can settle first.
    setTimeout(() => void maybePromptSessionVerification(), 2500);
    // Background update check — deferred so it doesn't compete with first sync.
    setTimeout(() => void maybeCheckForUpdates(components), 4000);
  }
});

// ── Room list wiring ──────────────────────────────────────────────────────────

components.roomList.onSelect((roomId) => {
  void selectRoom(roomId);
});

// ── Space strip wiring ────────────────────────────────────────────────────────

components.spaceStrip.onSelect((spaceId) => {
  void selectSpace(spaceId);
});

components.spaceStrip.onSettingsClick(() => {
  openSettings();
});

components.spaceStrip.onProfileClick(() => {
  void openOwnProfile();
});

// ── Mobile top bar wiring ────────────────────────────────────────────────────
// Tapping the room avatar opens room settings. This is the only entry to the
// room-settings flow on mobile since the desktop room-header is hidden.
components.mobileTopBar.onAvatarClick(() => {
  void openRoomSettings();
});

// ── GIF pause/resume on window focus ─────────────────────────────────────────
// Freeze GIF animations while the window is hidden or blurred to avoid wasting
// CPU/GPU when the user is not looking at the app.
//
// When a loaded GIF is paused we capture its current frame to a <canvas> and
// hide the <img>. This means scrolling to a paused GIF while unfocused shows
// the last frame instead of an empty rectangle.

const _gifCanvases = new WeakMap<HTMLImageElement, HTMLCanvasElement>();

function pauseGifs(): void {
  document.querySelectorAll<HTMLImageElement>('img[data-gif="1"]').forEach((img) => {
    if (img.dataset.gifSrc || !img.hasAttribute("src")) return;
    img.dataset.gifSrc = img.getAttribute("src") ?? "";

    // If the image is already decoded, capture the current frame as a canvas
    // placeholder so the user sees a still frame instead of a blank box.
    if (img.complete && img.naturalWidth > 0 && img.parentNode) {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.className = img.className;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        img.parentNode.insertBefore(canvas, img);
        img.style.display = "none";
        _gifCanvases.set(img, canvas);
      }
    }

    img.removeAttribute("src");
  });
}

function resumeGifs(): void {
  document.querySelectorAll<HTMLImageElement>('img[data-gif="1"]').forEach((img) => {
    if (!img.dataset.gifSrc) return;

    const canvas = _gifCanvases.get(img);
    if (canvas) {
      canvas.remove();
      _gifCanvases.delete(img);
      img.style.display = "";
    }

    img.src = img.dataset.gifSrc;
    delete img.dataset.gifSrc;
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseGifs(); else resumeGifs();
});
window.addEventListener("blur", pauseGifs);
window.addEventListener("focus", resumeGifs);

// ── Global error handler ──────────────────────────────────────────────────────

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
  showError(`Unhandled error: ${msg}`);
  console.error("Unhandled promise rejection:", e.reason);
});

window.addEventListener("error", (e) => {
  showError(`Runtime error: ${e.message}`);
  console.error("Runtime error:", e.error);
});
