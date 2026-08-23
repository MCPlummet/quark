// Settings → Notifications tab.
//
// Enable/preview toggles, Android background-sync controls, and a
// test-notification button. Migrated from SettingsDialog._buildNotificationsTab;
// behaviour is unchanged. The bespoke background-sync / quiet-hours / test DOM
// stays inline (no shared control covers it); the standard rows use controls.

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
} from "../../../ipc/notifications.js";
import type { PushStatus, BackgroundSyncState } from "../../../ipc/notifications.js";
import { showSuccess, showError } from "../../NotificationToast.js";
import type { SettingsTab } from "../types.js";

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
      return "push: off · the app must stay running to notify";
    case "ready":
      return `push: registered · gateway: ${s.gateway_url ?? "unknown"}`;
    case "no_transport":
      return ios
        ? "push: iOS has not provided a device token yet"
        : "push: no distributor installed — nothing can wake the app";
    case "waiting":
      if (ios) return "push: waiting for a device token from iOS — no pusher registered yet";
      // Several installed and none saved is not a wait at all: UnifiedPush
      // refuses to break the tie, so nothing will happen until the user picks.
      // Calling that "waiting" leaves them staring at a line that never moves.
      if (!s.distributor && s.distributors.length > 1) {
        return `push: ${s.distributors.length} distributors installed — pick one below to finish setup`;
      }
      return s.distributor
        ? `push: waiting for ${s.distributor} — no pusher registered yet`
        : "push: waiting for a distributor — no pusher registered yet";
  }
}

/** What the user can do about it, likewise per transport. */
export function pushHint(s: PushStatus): string {
  const privacy =
    "Only a room ID and event ID ever reach the push gateway — never message content.";
  if (s.transport === "apns") {
    return `Delivered through Apple's push service and Quark's own gateway; nothing to install. ${privacy}`;
  }
  if (s.readiness === "no_transport") {
    // Somewhere to go, rather than a restatement of what's missing.
    return `Install a UnifiedPush distributor — see unifiedpush.org/users/distributors. Until then Quark can only notify while it is running. ${privacy}`;
  }
  // Telling someone to install a distributor when they have installed two is
  // the same dead end the status line above just escaped — the thing they need
  // to do is choose, and the picker is right there.
  if (!s.distributor && s.distributors.length > 1) {
    return `Quark won't pick between installed distributors for you — whichever you choose carries this device's push traffic. ${privacy}`;
  }
  return `Android needs a UnifiedPush distributor installed (ntfy, NextPush, …). ${privacy}`;
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
      hint: () =>
        "Per-category sound & importance (Messages / Mentions) is configured in Android Settings → Notifications.",
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
