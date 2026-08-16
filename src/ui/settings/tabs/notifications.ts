// Settings → Notifications tab.
//
// Enable/preview toggles, Android background-sync controls, quiet hours, and a
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
} from "../../../ipc/notifications.js";
import type { PushStatus, BackgroundSyncState } from "../../../ipc/notifications.js";
import { showSuccess, showError } from "../../NotificationToast.js";
import type { SettingsTab } from "../types.js";

/**
 * What push is currently doing, in the terms of the platform's own transport.
 *
 * The un-registered case is the one that has to be transport-specific: on
 * Android the user is genuinely waiting for a distributor they must install,
 * while on iOS the OS supplies the token and there is nothing to install — so
 * naming a distributor there sends them chasing an Android app that does not
 * exist on their phone.
 */
export function pushStatusLine(s: PushStatus): string {
  if (!s.enabled) return "push: off · the app must stay running to notify";
  if (s.registered) return `push: registered · gateway: ${s.gateway_url ?? "unknown"}`;
  return s.transport === "apns"
    ? "push: waiting for a device token from iOS — no pusher registered yet"
    : "push: waiting for a distributor — no pusher registered yet";
}

/** What the user can do about it, likewise per transport. */
export function pushHint(s: PushStatus): string {
  const privacy =
    "Only a room ID and event ID ever reach the push gateway — never message content.";
  return s.transport === "apns"
    ? `Delivered through Apple's push service and Quark's own gateway; nothing to install. ${privacy}`
    : `Android needs a UnifiedPush distributor installed (ntfy, NextPush, …). ${privacy}`;
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

    // Quiet hours
    const qhSection = document.createElement("div");
    qhSection.className = "settings-dialog__section";
    qhSection.appendChild(controls.sectionTitle("Quiet Hours"));

    const qhRow = document.createElement("div");
    qhRow.className = "settings-dialog__row settings-dialog__row--quiet-hours";

    const qhLabel = document.createElement("span");
    qhLabel.className = "settings-dialog__label";
    qhLabel.textContent = "start";
    qhRow.appendChild(qhLabel);

    const startInput = document.createElement("input");
    startInput.type = "time";
    startInput.className = "settings-dialog__time-input";
    if (draft.quiet_hours) {
      const h = String(draft.quiet_hours.start_hour).padStart(2, "0");
      const m = String(draft.quiet_hours.start_minute).padStart(2, "0");
      startInput.value = `${h}:${m}`;
    }
    qhRow.appendChild(startInput);

    const qhLabel2 = document.createElement("span");
    qhLabel2.className = "settings-dialog__label";
    qhLabel2.textContent = "end";
    qhRow.appendChild(qhLabel2);

    const endInput = document.createElement("input");
    endInput.type = "time";
    endInput.className = "settings-dialog__time-input";
    if (draft.quiet_hours) {
      const h = String(draft.quiet_hours.end_hour).padStart(2, "0");
      const m = String(draft.quiet_hours.end_minute).padStart(2, "0");
      endInput.value = `${h}:${m}`;
    }
    qhRow.appendChild(endInput);

    qhSection.appendChild(qhRow);

    const footer = document.createElement("div");
    footer.className = "settings-dialog__actions";

    const saveBtn = controls.saveButton(async () => {
      let quiet_hours = null;
      if (startInput.value && endInput.value) {
        const [sh, sm] = startInput.value.split(":").map(Number);
        const [eh, em] = endInput.value.split(":").map(Number);
        quiet_hours = { start_hour: sh, start_minute: sm, end_hour: eh, end_minute: em };
      }
      await setNotificationConfig({ ...draft, quiet_hours });
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

    content.appendChild(qhSection);
    content.appendChild(footer);
  },
};
