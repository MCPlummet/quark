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
} from "../../../ipc/notifications.js";
import { showSuccess, showError } from "../../NotificationToast.js";
import type { SettingsTab } from "../types.js";

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

    // Background sync (Android-only — desktop/iOS report unsupported). The
    // toggle applies immediately (starts/stops the foreground service) rather
    // than waiting for [save], since the service state is what users come
    // here to flip.
    try {
      const bgState = await getBackgroundSyncState();
      if (bgState.supported) {
        const bgSection = document.createElement("div");
        bgSection.className = "settings-dialog__section";
        bgSection.appendChild(controls.sectionTitle("Background sync"));

        const status = document.createElement("div");
        status.className = "settings-dialog__hint";
        const renderStatus = (s: { running: boolean; battery_exempt: boolean }) => {
          status.textContent =
            `service: ${s.running ? "running" : "stopped"} · ` +
            `battery optimization: ${s.battery_exempt ? "unrestricted" : "restricted"}`;
        };
        renderStatus(bgState);

        bgSection.appendChild(controls.checkbox(
          "Stay connected in the background (uses more battery)",
          bgState.enabled,
          (v) => {
            void setBackgroundSync(v)
              .then(getBackgroundSyncState)
              .then(renderStatus)
              .catch((err) => showError(`Background sync toggle failed: ${err instanceof Error ? err.message : String(err)}`));
          },
        ));
        bgSection.appendChild(status);

        if (!bgState.battery_exempt) {
          const exemptBtn = document.createElement("button");
          exemptBtn.type = "button";
          exemptBtn.className = "settings-dialog__save-btn";
          exemptBtn.textContent = "[ allow unrestricted battery ]";
          exemptBtn.addEventListener("click", () => {
            void requestBatteryExemption()
              .then(getBackgroundSyncState)
              .then((s) => {
                renderStatus(s);
                if (s.battery_exempt) exemptBtn.remove();
              })
              .catch(() => {/* user dismissed the system dialog */});
          });
          bgSection.appendChild(exemptBtn);
        }

        const hint = document.createElement("div");
        hint.className = "settings-dialog__hint";
        hint.textContent =
          "Per-category sound & importance (Messages / Mentions) is configured in Android Settings → Notifications.";
        bgSection.appendChild(hint);

        section.appendChild(bgSection);
      }
    } catch {
      // Non-critical — the rest of the tab still works.
    }

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
    footer.className = "settings-dialog__section settings-dialog__actions";

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

    section.appendChild(qhSection);
    section.appendChild(footer);
  },
};
