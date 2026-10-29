// Session lifecycle actions: login, session restore, logout.

import { AppState } from "../state.js";
import { clearLegacySession } from "../session.js";

import {
  login as ipcLogin,
  restoreSession as ipcRestoreSession,
  clearStoredSession as ipcClearStoredSession,
  logout as ipcLogout,
  getOwnProfile,
  downloadMedia,
  getAppConfig,
  setAppConfig,
  verificationPromptTarget,
  logVerificationPromptChoice,
} from "../../ipc/index.js";
import type { RestoreOutcome } from "../../ipc/index.js";
import { startVerification, verificationInProgress } from "./verification.js";

import { showMainLayout } from "../../ui/App.js";
import { showSuccess } from "../../ui/NotificationToast.js";

import { getComponents } from "./context.js";
import { refreshRooms, applyCacheConfig } from "./rooms.js";
import { loadThemeFromConfig } from "./theme.js";

/** Apply persisted runtime preferences from config at session start: the
 *  in-memory cache budgets and the read-receipt display setting (non-critical). */
function _applyStartupConfig(): void {
  void getAppConfig().then((cfg) => {
    applyCacheConfig(cfg);
    AppState.set("showReadReceipts", cfg.general.show_read_receipts);
  }).catch(() => { /* defaults stand */ });
}

/** Fetch own profile and store userId + displayName in AppState. Non-critical. */
async function _loadOwnProfile(): Promise<void> {
  try {
    const profile = await getOwnProfile();
    AppState.set("ownUserId", profile.user_id);
    AppState.set("ownDisplayName", profile.display_name);

    // Render the user's avatar in the space-strip profile button. Mxc URLs
    // need downloading; the initial fallback works without network. Both
    // the space strip's own renderer handles either case.
    const initialSource = profile.display_name || profile.user_id.replace(/^@/, "");
    const { spaceStrip } = getComponents();
    spaceStrip.setOwnProfile(initialSource, null);

    if (profile.avatar_url?.startsWith("mxc://")) {
      try {
        const dl = await downloadMedia(profile.avatar_url);
        const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
        spaceStrip.setOwnProfile(initialSource, dataUrl);
      } catch {
        // Network or media error — leave the initial fallback in place.
      }
    }
  } catch {
    // Non-critical — sendMessage falls back to user ID string
  }
}

/**
 * Poll refreshRooms() until the room cache populates, capped at ~8s.
 *
 * Rationale: on first login the backend `start_sync` has only just been
 * spawned and the long-poll sync hasn't returned any rooms yet. Calling
 * refreshRooms() once at this point gets an empty list. The matrix-sdk
 * sync loop runs internally and exits the `Ok(_)` arm of our Rust loop
 * rarely — so the EVENT_CONNECTED frontend listener can't be relied on
 * for the initial population on slower mobile networks.
 *
 * We poll instead, backing off as we go: tight 500ms ticks early (fast networks
 * land rooms in a second or two), then easing off so a slow first sync — common
 * on mobile networks and when the initial E2EE/room state is large — still gets
 * picked up without hammering IPC. The window is ~30s (the old 8s cap gave up
 * before slow first syncs completed, leaving the list blank until an app
 * restart, when the persisted store makes getRooms() instant). Stops the moment
 * rooms appear; after that the sync/connected and sync/rooms listeners take over.
 */
async function _pollUntilRoomsLoaded(): Promise<void> {
  const DELAYS_MS = [
    ...Array<number>(10).fill(500),   // 0–5s
    ...Array<number>(10).fill(1000),  // 5–15s
    ...Array<number>(8).fill(2000),   // 15–31s
  ];
  for (const delay of DELAYS_MS) {
    if (AppState.get("roomListCache").length > 0) return;
    await new Promise((r) => setTimeout(r, delay));
    try { await refreshRooms(); } catch { /* keep polling */ }
  }
}

/**
 * Attempt password login. On success, transitions to main layout and loads rooms.
 */
export async function login(homeserver: string, username: string, password: string): Promise<void> {
  const { loginScreen } = getComponents();
  loginScreen.setLoading(true);

  try {
    // The backend persists the session in the OS keyring; nothing comes back to
    // the frontend and nothing is written to localStorage.
    await ipcLogin(homeserver, username, password);
    AppState.set("loggedIn", true);

    showMainLayout(getComponents());
    loginScreen.hide();

    void _loadOwnProfile();
    await loadThemeFromConfig();
    _applyStartupConfig();
    await refreshRooms();
    // First-login race: the Rust sync loop is up but hasn't returned rooms yet.
    // Keep retrying in the background so the user doesn't have to relaunch.
    void _pollUntilRoomsLoaded();

    showSuccess("Connected successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    loginScreen.setStatus(message, "error");
  } finally {
    loginScreen.setLoading(false);
  }
}

/**
 * Attempt to restore a previously saved session. Returns true on success.
 * Call this on startup before showing the login form.
 */
export async function attemptSessionRestore(components: import("../../ui/App.js").AppComponents): Promise<boolean> {
  // Scrub any plaintext session left by a pre-keyring build before doing
  // anything else — those users are sent through a fresh (encrypted) login.
  clearLegacySession();

  let outcome: RestoreOutcome;
  try {
    // The backend loads the session from the keyring itself and reports how it
    // went; only `Invalid` means the stored session should be thrown away.
    outcome = await ipcRestoreSession();
  } catch (err) {
    // Unexpected internal failure (e.g. the backend task panicked). Be
    // conservative — never wipe on an error we can't classify — and show login.
    console.warn("Session restore failed, showing login:", err);
    return false;
  }

  switch (outcome) {
    case "Restored":
      break; // continue to the success path below
    case "NoSession":
      // Fresh install or pre-keyring upgrade — nothing to restore.
      return false;
    case "Unavailable":
      // The keyring is locked/unreachable. Crucially, do NOT clear anything: a
      // transient lock must not destroy the encrypted local store. Show login
      // with guidance so unlocking + relaunching resumes the existing session.
      getComponents().loginScreen.setStatus(
        "Secure storage is locked. Unlock your system keyring (GNOME Keyring / " +
          "KWallet on Linux, Keychain on macOS), then restart Quark to resume " +
          "your session.",
        "error",
      );
      return false;
    case "Invalid":
      // A stored session existed but is unusable (missing key, bad token). Drop
      // it so the next launch starts from a clean login instead of looping.
      try { await ipcClearStoredSession(); } catch { /* best effort */ }
      return false;
  }

  AppState.set("loggedIn", true);
  showMainLayout(components);
  void _loadOwnProfile();
  await loadThemeFromConfig();
  _applyStartupConfig();
  await refreshRooms();
  // Persisted sync state usually makes getRooms() instant on restore, but if
  // the store hasn't hydrated yet (cold start) the first call can be empty —
  // keep retrying in the background so the list isn't blank until a relaunch.
  // Same race the login path guards against. (#33/#43)
  void _pollUntilRoomsLoaded();
  return true;
}

/**
 * On startup, prompt the user to verify this session if it isn't verified yet
 * and there's another device to emoji-compare against. Honors the
 * `prompt_session_verification` config flag ("Never ask" turns it off). Safe to
 * call on both fresh login and session restore; every check is best-effort and
 * silently no-ops on error so it can never block sign-in.
 *
 * Note: on a brand-new login the homeserver's device list may not have synced
 * yet, so `others` can be empty here — callers run this after a short delay, and
 * if it still misses, the prompt simply appears on the next launch (restore).
 */
export async function maybePromptSessionVerification(): Promise<void> {
  try {
    // The backend decides (and logs at INFO why it skips: disabled, already
    // cross-signed, or no other device). It returns the own user ID to verify
    // against, or null to skip.
    const userId = await verificationPromptTarget();
    if (!userId) return;
    // A verification is already under way (typically another device's request
    // arrived first): the prompt would only cover it, and "Verify now" would
    // race it with a competing request.
    if (verificationInProgress()) return;

    getComponents().verificationPrompt.show((choice) => {
      void logVerificationPromptChoice(choice); // record the choice in the log
      if (choice === "verify") {
        // Reuses the SAS flow: device picker (if >1) → emoji compare. If the
        // chosen device has already asked us, the backend joins that request.
        void startVerification(userId);
      } else if (choice === "never") {
        void getAppConfig()
          .then((cfg) =>
            setAppConfig({
              ...cfg,
              general: { ...cfg.general, prompt_session_verification: false },
            }),
          )
          .catch(() => { /* best-effort; will just prompt again next time */ });
      }
      // "later" → do nothing; the prompt re-appears on the next startup.
    });
  } catch (err) {
    console.warn("Verification prompt check skipped:", err);
  }
}

/**
 * Logout: revoke server session, clear local session, show login screen.
 */
export async function logout(): Promise<void> {
  try {
    // Revokes the token server-side and clears the keyring session + store key.
    await ipcLogout();
  } catch (err) {
    console.warn("Logout IPC failed (continuing anyway):", err);
  }
  clearLegacySession();
  AppState.set("loggedIn", false);
  window.location.reload();
}
