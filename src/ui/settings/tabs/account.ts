// Settings → Account tab.
//
// Devices & verification: the current session, other sessions (rename/remove),
// security (reset cross-signing, prompt-to-verify on startup), key-backup status,
// and log out. Sessions/crypto come from the backend IPC; the prompt-to-verify
// checkbox is bound to general.prompt_session_verification via the app config.
//
// UIAA: removing a session and resetting cross-signing may require the user's
// password. The backend throws the string sentinel "UIAA_REQUIRED" when so; we
// catch it, prompt for the password via PasswordPromptDialog, and retry.

import {
  listSessions,
  renameDevice,
  deleteDevices,
  resetCrossSigning,
  getKeyBackupStatus,
} from "../../../ipc/index.js";
import type { DeviceSessionInfo, KeyBackupStatus } from "../../../ipc/index.js";
import { getAppConfig, setAppConfig } from "../../../ipc/app_config.js";
import type { AppConfig } from "../../../ipc/app_config.js";
import { ConfirmDialog } from "../../ConfirmDialog.js";
import type { ConfirmOpts } from "../../ConfirmDialog.js";
import { PasswordPromptDialog } from "../../PasswordPromptDialog.js";
import { showSuccess, showError } from "../../NotificationToast.js";
import type { SettingsTab } from "../types.js";

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sessionLabel(s: DeviceSessionInfo): string {
  return s.display_name || s.device_id;
}

/** Human-readable "last seen" line: timestamp (if any) · IP (if any). */
function formatLastSeen(s: DeviceSessionInfo): string {
  const parts: string[] = [];
  if (s.last_seen_ts) parts.push(new Date(s.last_seen_ts).toLocaleString());
  if (s.last_seen_ip) parts.push(s.last_seen_ip);
  return parts.length ? parts.join(" · ") : "Last seen: unknown";
}

/** Mount a ConfirmDialog, await the choice, then always unmount it. */
async function askConfirm(opts: ConfirmOpts): Promise<boolean> {
  const dlg = new ConfirmDialog();
  document.body.appendChild(dlg.getElement());
  try {
    return await dlg.confirm(opts);
  } finally {
    dlg.getElement().remove();
  }
}

/**
 * Run a privileged operation that may need a password (UIAA). Calls `run()`
 * first; if it throws the "UIAA_REQUIRED" sentinel, prompts for the password and
 * retries with it. Returns true if the operation completed, false if the user
 * cancelled the password prompt. Non-UIAA errors propagate to the caller.
 */
async function withUiaa(
  run: (password?: string) => Promise<void>,
  pwOpts: { title: string; message?: string },
): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (e) {
    if (String(e) !== "UIAA_REQUIRED") throw e;
    const dlg = new PasswordPromptDialog();
    document.body.appendChild(dlg.getElement());
    let pw: string | null;
    try {
      pw = await dlg.prompt(pwOpts);
    } finally {
      dlg.getElement().remove();
    }
    if (!pw) return false;
    await run(pw);
    return true;
  }
}

export const accountTab: SettingsTab = {
  id: "account",
  label: "Account",
  async build(ctx) {
    const { content, controls } = ctx;

    // Which session row (by device_id) is currently in inline-rename mode.
    let editingId: string | null = null;

    const removeSession = async (s: DeviceSessionInfo): Promise<void> => {
      const ok = await askConfirm({
        title: "Remove session",
        message: `Remove "${sessionLabel(s)}"? That device will be signed out.`,
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      try {
        const done = await withUiaa(
          (pw) => deleteDevices([s.device_id], pw),
          { title: "Confirm your password", message: "Your server requires your password to remove a session." },
        );
        if (done) {
          showSuccess("Session removed.");
          await refresh();
        }
      } catch (e) {
        showError(`Couldn't remove session: ${msgOf(e)}`);
      }
    };

    const resetCrossSigningFlow = async (): Promise<void> => {
      const ok = await askConfirm({
        title: "Reset cross-signing",
        message:
          "This replaces your cross-signing identity. Every session — including this one — and everyone who has verified you will have to verify again. Continue?",
        confirmLabel: "Reset",
        danger: true,
      });
      if (!ok) return;
      try {
        const done = await withUiaa(
          (pw) => resetCrossSigning(pw),
          { title: "Confirm your password", message: "Your server requires your password to reset cross-signing." },
        );
        if (done) {
          showSuccess("Cross-signing reset. Re-verify your sessions.");
          await refresh();
        }
      } catch (e) {
        showError(`Couldn't reset cross-signing: ${msgOf(e)}`);
      }
    };

    /** Build the block for a single session (current or other). */
    const buildSession = (s: DeviceSessionInfo, isCurrent: boolean): HTMLElement => {
      const card = document.createElement("div");
      card.className = "settings-dialog__section";

      card.appendChild(controls.readRow(isCurrent ? "Device" : "Session", sessionLabel(s)));
      card.appendChild(controls.readRow("Device ID", s.device_id));
      card.appendChild(controls.readRow("Trust", `[${s.trust_level}]`));
      if (!isCurrent) {
        card.appendChild(controls.readRow("Last seen", formatLastSeen(s)));
      }

      if (editingId === s.device_id) {
        let draftName = s.display_name ?? "";
        card.appendChild(controls.textRow("New name", draftName, "Session name", (v) => { draftName = v; }));
        card.appendChild(controls.dispatchButton("[save]", "Save session name", async () => {
          try {
            await renameDevice(s.device_id, draftName.trim());
            showSuccess("Session renamed.");
          } catch (e) {
            showError(`Couldn't rename session: ${msgOf(e)}`);
          }
          editingId = null;
          await refresh();
        }));
        card.appendChild(controls.dispatchButton("[cancel]", "Cancel rename", () => {
          editingId = null;
          void refresh();
        }));
        return card;
      }

      card.appendChild(controls.dispatchButton("[rename]", "Rename this session", () => {
        editingId = s.device_id;
        void refresh();
      }));

      if (isCurrent) {
        // These flows take over the screen — close settings first (one overlay
        // at a time), then dispatch the existing actions.
        card.appendChild(controls.dispatchButton("[verify this session]", "Verify this session", () => {
          ctx.close();
          ctx.dispatch("verify-session");
        }));
        card.appendChild(controls.dispatchButton("[set up cross-signing]", "Set up cross-signing", () => {
          ctx.close();
          ctx.dispatch("setup-cross-signing");
        }));
      } else {
        card.appendChild(controls.dispatchButton("[remove]", "Remove this session", () => void removeSession(s)));
      }

      return card;
    };

    const renderError = (text: string): void => {
      content.innerHTML = "";
      const { loading } = controls.loadingSection(content);
      loading.textContent = text;
    };

    /** Clear and re-render the whole tab from fresh backend data. */
    async function refresh(): Promise<void> {
      content.innerHTML = "";
      controls.loadingSection(content);

      let sessions: DeviceSessionInfo[];
      let backup: KeyBackupStatus;
      let cfg: AppConfig;
      try {
        [sessions, backup, cfg] = await Promise.all([
          listSessions(),
          getKeyBackupStatus(),
          getAppConfig(),
        ]);
      } catch (e) {
        renderError(`Failed to load account info: ${msgOf(e)}`);
        return;
      }

      content.innerHTML = "";

      const current = sessions.find((s) => s.is_current) ?? null;
      const others = sessions.filter((s) => !s.is_current);

      // ── This session ──────────────────────────────────────────────────────
      content.appendChild(controls.sectionTitle("This session"));
      if (current) {
        content.appendChild(buildSession(current, true));
      } else {
        const note = document.createElement("div");
        note.className = "settings-dialog__hint";
        note.textContent = "This session isn't reporting yet.";
        content.appendChild(note);
      }

      // ── Other sessions ────────────────────────────────────────────────────
      content.appendChild(controls.sectionTitle("Other sessions"));
      if (others.length === 0) {
        const note = document.createElement("div");
        note.className = "settings-dialog__hint";
        note.textContent = "No other sessions are signed in.";
        content.appendChild(note);
      } else {
        for (const s of others) content.appendChild(buildSession(s, false));
      }

      // ── Security ──────────────────────────────────────────────────────────
      content.appendChild(controls.sectionTitle("Security"));
      const security = document.createElement("div");
      security.className = "settings-dialog__section";
      security.appendChild(controls.checkbox(
        "Prompt to verify this session on startup (when unverified)",
        cfg.general.prompt_session_verification,
        (v) => {
          const next: AppConfig = { ...cfg, general: { ...cfg.general, prompt_session_verification: v } };
          setAppConfig(next)
            .then(() => { cfg = next; })
            .catch((e) => showError(`Couldn't save setting: ${msgOf(e)}`));
        },
      ));
      security.appendChild(controls.dispatchButton(
        "[reset cross-signing]",
        "Reset cross-signing",
        () => void resetCrossSigningFlow(),
      ));
      content.appendChild(security);

      // ── Key backup (read-only for now) ────────────────────────────────────
      content.appendChild(controls.sectionTitle("Key backup"));
      const keySection = document.createElement("div");
      keySection.className = "settings-dialog__section";
      keySection.appendChild(controls.readRow(
        "Backup",
        `${backup.enabled ? "enabled" : "disabled"} · on server: ${backup.exists_on_server ? "yes" : "no"}`,
      ));
      const keyHint = document.createElement("div");
      keyHint.className = "settings-dialog__hint";
      keyHint.textContent = "Enabling or restoring key backup is coming in a later release.";
      keySection.appendChild(keyHint);
      content.appendChild(keySection);

      // ── Log out ───────────────────────────────────────────────────────────
      content.appendChild(controls.sectionTitle("Log out"));
      content.appendChild(controls.dispatchButton("[log out]", "Log out of this account", async () => {
        const ok = await askConfirm({
          title: "Log out",
          message: "Log out of Quark on this device?",
          confirmLabel: "Log out",
          danger: true,
        });
        if (ok) {
          ctx.close();
          ctx.dispatch("logout");
        }
      }));
    }

    await refresh();
  },
};
