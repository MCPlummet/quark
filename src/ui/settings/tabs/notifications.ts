// Settings → Notifications tab.
//
// Enable/preview toggles, Android background-sync controls, and a
// test-notification button. Migrated from SettingsDialog._buildNotificationsTab;
// behaviour is unchanged. The bespoke background-sync / test DOM stays inline
// (no shared control covers it); the standard rows use controls.

import { getConfig, setNotificationConfig } from "../../../app/notifications.js";
import type { NotificationConfig } from "../../../app/notifications.js";
import {
  testNotification,
  getBackgroundSyncState,
  setBackgroundSync,
  requestBatteryExemption,
  getPushStatus,
  setPushEnabled,
  selectPushDistributor,
  getAccountMute,
  setAccountMute,
} from "../../../ipc/notifications.js";
import type { PushStatus, BackgroundSyncState } from "../../../ipc/notifications.js";
import { showSuccess, showError } from "../../NotificationToast.js";
import type { SettingsTab } from "../types.js";

/**
 * What an account-wide mute means, in the user's terms rather than the rule's.
 * Shown in the notice at the top of the tab.
 */
export const ACCOUNT_MUTE_MESSAGE =
  "Notifications are disabled for your whole account (set by another client). " +
  "Push will deliver nothing until that is turned off.";

/**
 * The banner for an account-wide `.m.rule.master` mute, with the button that
 * clears it.
 *
 * Lives at the top of the tab rather than inside the push section on purpose:
 * the rule empties `push_actions` on the warm sync path too, so it silences a
 * desktop build — which renders no push section at all — exactly as
 * thoroughly. It is also the only state in this tab that no control below it
 * can explain: every toggle here can read "on" while this one rule drops every
 * notification.
 *
 * `onFix` is expected to reject on failure; a mute that could not be cleared
 * must leave the notice standing, because the account is still silent.
 */
export function accountMuteNotice(onFix: () => Promise<void>): HTMLElement {
  const notice = document.createElement("div");
  notice.className = "settings-dialog__section";

  const text = document.createElement("div");
  text.className = "settings-dialog__hint";
  text.style.color = "var(--accent-warning)";
  text.textContent = ACCOUNT_MUTE_MESSAGE;
  notice.appendChild(text);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "settings-dialog__save-btn";
  btn.textContent = "[ re-enable notifications for this account ]";
  btn.addEventListener("click", () => {
    btn.disabled = true;
    void onFix()
      .then(() => {
        showSuccess("Notifications re-enabled for your account");
        // The push section above was built from a status read before this
        // fix, so it still says "blocked". Removing the notice is the honest
        // half we can do from here; the section catches up when Settings is
        // reopened.
        notice.remove();
      })
      .catch((err) => {
        btn.disabled = false;
        showError(`Could not re-enable notifications: ${err instanceof Error ? err.message : String(err)}`);
      });
  });
  notice.appendChild(btn);

  return notice;
}

/**
 * What push is currently doing, in the terms of the platform's own transport.
 *
 * "Enabled" and "working" are different states, and the gap between them is
 * filled with software Quark doesn't control — the distributor the user
 * installs, the gateway that may decline, the homeserver round-trip that may
 * fail. Each stall gets its own line, because the fix differs: nothing
 * installed is the user's to solve, waiting is theirs to wait out, and an
 * unmade choice between several distributors is theirs to make below.
 *
 * The stalled cases also have to be transport-specific. On iOS the OS supplies
 * the token and there is nothing to install, so naming a distributor sends
 * those users chasing an Android app that isn't on their phone.
 */
export function pushStatusLine(s: PushStatus): string {
  const ios = s.transport === "apns";
  switch (s.readiness) {
    case "off":
      return "push: off · Quark can only notify while it is running";
    // Not a stall in the chain at all: everything below can be green while the
    // account-wide rule (`.m.rule.master`) guarantees the homeserver sends
    // nothing. The notice at the top of the tab explains it and undoes it.
    case "muted_account":
      return "push: blocked — notifications are disabled for your account";
    case "ready":
      return `push: registered · gateway: ${s.gateway_url ?? "unknown"}`;
    case "no_transport":
      return ios
        ? "push: iOS has not provided a device token yet"
        : "push: no distributor installed — nothing can wake the app";
    case "waiting":
      if (ios) return "push: waiting for iOS";
      // Several installed and none saved is not a wait at all: UnifiedPush
      // refuses to break the tie, so nothing will happen until the user picks.
      // Calling that "waiting" leaves them staring at a line that never moves.
      if (!s.distributor && s.distributors.length > 1) {
        return `push: ${s.distributors.length} distributors installed — pick one below to finish setup`;
      }
      return s.distributor
        ? `push: waiting for ${s.distributor}`
        : "push: waiting for a distributor";
  }
}

/**
 * What the user can do about it — or "" when there is nothing for them to do.
 *
 * Only states with a user action get a hint (#113): explanations of how push
 * works, or of what the gateway sees, belong in DESIGN.md, not under a switch.
 */
export function pushHint(s: PushStatus): string {
  // The control that undoes the mute is at the top of this tab, where every
  // platform can reach it — desktop has no push section for it to live in.
  if (s.readiness === "muted_account") {
    return "Turn notifications back on at the top of this tab.";
  }
  if (s.transport !== "apns" && s.readiness === "no_transport") {
    return "Install a UnifiedPush distributor (such as ntfy) to be notified while Quark is closed.";
  }
  return "";
}

export const notificationsTab: SettingsTab = {
  id: "notifications",
  label: "Notifications",
  async build(ctx) {
    const { content, controls } = ctx;
    const { section, loading } = controls.loadingSection(content);

    let config: NotificationConfig;
    try {
      config = await getConfig();
    } catch {
      loading.textContent = "Failed to load notification config.";
      return;
    }

    section.innerHTML = "";

    // Before anything the user can toggle here, because it overrules all of
    // it: with `.m.rule.master` enabled every switch below can read "on" and
    // not one notification will arrive. A failed read is not worth a toast —
    // logged out is a legitimate answer, and the command reports it as "not
    // muted" rather than an error.
    try {
      if (await getAccountMute()) {
        section.appendChild(accountMuteNotice(() => setAccountMute(false)));
      }
    } catch {
      /* status only — the rest of the tab still works */
    }

    let draft = { ...config };

    section.appendChild(controls.checkbox("Enable notifications", draft.enabled, (v) => { draft = { ...draft, enabled: v }; }));
    section.appendChild(controls.checkbox("Show message preview", draft.show_body, (v) => { draft = { ...draft, show_body: v }; }));
    section.appendChild(controls.checkbox("Show sender name", draft.show_sender, (v) => { draft = { ...draft, show_sender: v }; }));

    // Push and background sync are both backend-owned switches: mobile-only,
    // with a side effect that lands the moment they are flipped (registering a
    // pusher, starting the foreground service) rather than on [save]. Deferring
    // them would let a stale draft contradict what already happened.
    const pushSection = await controls.toggleSection<PushStatus>({
      title: "Push notifications",
      label: "Let your homeserver wake the app (saves battery)",
      get: getPushStatus,
      set: setPushEnabled,
      status: pushStatusLine,
      hint: pushHint,
      // iOS derives this from the master switch (see `derivedPushEnabled`), so
      // there is no toggle to show — only the status, which is worth keeping
      // for the times push is enabled and still not working.
      hideToggle: (s) => s.transport === "apns",
      // The tie-break UnifiedPush won't make: with two or more distributors
      // installed and none saved it declines to guess, since choosing would be
      // choosing the user's notification provider for them. Nobody else can
      // settle it, and without a control here the section sits on "waiting"
      // with nothing attached to it that would ever change that.
      //
      // Like the battery button below, this is built once from the state the
      // section opened with — installing a distributor while Settings is open
      // won't grow the list until it is reopened, which is acceptable for a
      // list that only changes when the user installs an app.
      extra: (state, refresh) => {
        if (state.distributors.length < 2) return null;
        const options: [string, string][] = state.distributors.map((d) => [d, d]);
        // A <select> fires nothing for the option already showing, so an
        // unmade choice needs a placeholder for the user to move away from.
        if (!state.distributor) options.unshift(["", "— choose —"]);
        return controls.selectRow("distributor", state.distributor ?? "", options, (v) => {
          if (!v) return;
          void selectPushDistributor(v)
            .then(refresh)
            .catch((err) => showError(`Distributor failed: ${err instanceof Error ? err.message : String(err)}`));
        });
      },
      failureLabel: "Push",
    });
    if (pushSection) content.appendChild(pushSection);

    const bgSection = await controls.toggleSection<BackgroundSyncState>({
      title: "Background sync",
      label: "Stay connected in the background (uses more battery)",
      get: getBackgroundSyncState,
      set: setBackgroundSync,
      status: (s) =>
        `service: ${s.running ? "running" : "stopped"} · ` +
        `battery optimization: ${s.battery_exempt ? "unrestricted" : "restricted"}`,
      hint: () => "Notification sounds are set in Android Settings → Notifications.",
      extra: (state, refresh) => {
        if (state.battery_exempt) return null;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "settings-dialog__save-btn";
        btn.textContent = "[ allow unrestricted battery ]";
        btn.addEventListener("click", () => {
          void requestBatteryExemption()
            .then(refresh)
            .then((s) => { if (s.battery_exempt) btn.remove(); })
            .catch(() => {/* user dismissed the system dialog */});
        });
        return btn;
      },
      failureLabel: "Background sync",
    });
    if (bgSection) content.appendChild(bgSection);

    const footer = document.createElement("div");
    footer.className = "settings-dialog__actions";

    const saveBtn = controls.saveButton(async () => {
      await setNotificationConfig(draft);
    });
    footer.appendChild(saveBtn);

    // Test button — sends a one-shot OS notification so the user can confirm
    // the permission grant and channel setup work end-to-end (especially on
    // Android, where missing POST_NOTIFICATIONS used to silently drop them).
    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "settings-dialog__save-btn";
    testBtn.textContent = "[ test notification ]";
    testBtn.style.marginLeft = "8px";
    testBtn.addEventListener("click", async () => {
      try {
        await testNotification();
        showSuccess("Sent test notification");
      } catch (err) {
        showError(`Test notification failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    footer.appendChild(testBtn);

    content.appendChild(footer);
  },
};
