// E2EE actions: SAS device verification (outgoing & incoming) and
// cross-signing bootstrap.

import {
  getCrossSigningStatus,
  bootstrapCrossSigning,
  getVerificationStatus,
  getUserDevices,
  startSasVerification,
  acceptVerificationRequest,
  acceptSasVerification,
  confirmSasVerification,
  cancelSasVerification,
  getSasInfo,
} from "../../ipc/index.js";

import { showToast, showError, showSuccess } from "../../ui/NotificationToast.js";
import { PasswordPromptDialog } from "../../ui/PasswordPromptDialog.js";

import { getComponents } from "./context.js";

/**
 * Start a SAS device verification flow for a user.
 *
 * Gets the user's devices. If there is more than one, shows the DevicePicker
 * overlay so the user can choose. Then starts the SAS flow and polls for emoji.
 */
export async function startVerification(userId: string): Promise<void> {
  const { verification, devicePicker } = getComponents();

  try {
    let devices = await getUserDevices(userId);

    // You can't emoji-verify the current device against itself, so drop it from
    // the picker when verifying your own devices — otherwise the self entry
    // (shown as "self-verified") is a dead-end that requests verification from
    // the very device making the request.
    const own = await getVerificationStatus();
    if (userId === own.user_id) {
      devices = devices.filter((d) => d.device_id !== own.device_id);
    }

    if (devices.length === 0) {
      showError(`No other devices to verify against for ${userId}`);
      return;
    }

    if (devices.length === 1) {
      // Only one device — skip the picker.
      await _beginSasFlow(userId, devices[0].device_id, verification);
    } else {
      // Multiple devices — let the user choose.
      devicePicker.show(devices, userId);
      devicePicker.onPick(async (device) => {
        await _beginSasFlow(userId, device.device_id, verification);
      });
      devicePicker.onCancel(() => {
        // Nothing to do — user closed the picker.
      });
    }
  } catch (err) {
    showError(`Failed to start verification: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Handle an incoming verification request from another device.
 * Shows the Verification overlay in "incoming" state so the user can accept or
 * reject. If accepted, transitions to SAS emoji polling.
 */
export function handleIncomingVerificationRequest(
  fromUserId: string,
  fromDeviceId: string,
  flowId: string,
): void {
  const { verification } = getComponents();

  verification.setIncomingRequest(fromUserId, fromDeviceId);
  verification.setState("incoming");
  verification.show();

  verification.onConfirm(async () => {
    try {
      await acceptVerificationRequest(fromUserId, flowId);
      verification.setState("waiting");

      // Re-wire for the emoji comparison phase.
      verification.onConfirm(async () => {
        try {
          await confirmSasVerification(fromUserId, flowId);
          verification.setState("verified");
        } catch (err) {
          showError(`Confirm failed: ${err instanceof Error ? err.message : String(err)}`);
          verification.setState("failed");
        }
      });
      verification.onDeny(async () => {
        try { await cancelSasVerification(fromUserId, flowId); } catch { /* best-effort */ }
        verification.setState("cancelled");
      });

      // skipAccept = false: we attempt sas.accept() on each poll tick so that
      // we handle both sides of a race — if start_sas() returned None (the
      // other device won the start race), we'll accept their flow instead.
      // When we ARE the initiator, accept() fails with a wrong-state error
      // that is silently ignored.
      pollSasEmoji(fromUserId, flowId, verification, /* skipAccept */ false);
    } catch (err) {
      showError(`Failed to accept verification: ${err instanceof Error ? err.message : String(err)}`);
      verification.setState("failed");
    }
  });

  verification.onDeny(async () => {
    try {
      await cancelSasVerification(fromUserId, flowId);
    } catch {
      // Best-effort.
    }
    verification.setState("cancelled");
  });
}

/** Shared helper: start a SAS flow for a known device_id. */
async function _beginSasFlow(
  userId: string,
  deviceId: string,
  verification: import("../../ui/Verification.js").Verification,
): Promise<void> {
  const flowId = await startSasVerification(userId, deviceId);

  verification.setState("waiting");
  verification.show();

  verification.onConfirm(async () => {
    try {
      await confirmSasVerification(userId, flowId);
      verification.setState("verified");
    } catch (err) {
      showError(`Confirm failed: ${err instanceof Error ? err.message : String(err)}`);
      verification.setState("failed");
    }
  });

  verification.onDeny(async () => {
    try {
      await cancelSasVerification(userId, flowId);
    } catch {
      // Best-effort.
    }
    verification.setState("cancelled");
  });

  // Accept our side; may fail if the other device hasn't responded yet — the
  // poll will retry.
  try {
    await acceptSasVerification(userId, flowId);
  } catch {
    // Ignored.
  }

  pollSasEmoji(userId, flowId, verification);
}

/**
 * Poll for SAS emoji info until they become available, then populate the UI.
 * Gives up after ~60 seconds (30 × 2 s intervals).
 */
function pollSasEmoji(
  userId: string,
  flowId: string,
  verification: import("../../ui/Verification.js").Verification,
  skipAccept = false,
): void {
  let attempts = 0;
  const MAX_ATTEMPTS = 30;

  const tick = async () => {
    if (attempts >= MAX_ATTEMPTS) {
      verification.setState("cancelled");
      showError("Verification timed out waiting for the other device.");
      return;
    }
    attempts++;

    try {
      const info = await getSasInfo(userId, flowId);
      if (info && info.emoji.length > 0) {
        verification.setSasEmoji(
          info.emoji.map(([emoji, description]) => ({ emoji, description })),
        );
        verification.setState("comparing");
        return; // Done polling.
      }

      // When we are the SAS acceptor (outgoing flow), retry accept until the
      // other device's start message arrives. Skip for incoming flows where we
      // are the SAS initiator — only the acceptor sends the accept message.
      if (!skipAccept) {
        try {
          await acceptSasVerification(userId, flowId);
        } catch {
          // Ignore — may already be accepted.
        }
      }
    } catch {
      // Ignore transient errors and keep polling.
    }

    setTimeout(tick, 2000);
  };

  setTimeout(tick, 1500);
}

/**
 * Bootstrap cross-signing keys for the local user.
 *
 * If the server requires UIAA and a password was not supplied, prompts the
 * user by showing an error with instructions to retry with their password:
 *   :cross-sign <password>
 */
export async function setupCrossSigning(password?: string): Promise<void> {
  try {
    // Show current status first.
    const status = await getCrossSigningStatus();

    if (status.is_complete) {
      showToast("Cross-signing is already set up for this account.", "info");
      return;
    }

    showToast("Setting up cross-signing…", "info");

    await bootstrapCrossSigning(password);

    showSuccess("Cross-signing keys uploaded successfully. Your account is now set up for cross-signing.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "UIAA_REQUIRED") {
      // The server needs the user's password (UIAA). Prompt for it and retry the
      // bootstrap with the supplied password instead of asking them to re-run a
      // `:cross-sign <password>` command.
      const dlg = new PasswordPromptDialog();
      document.body.appendChild(dlg.getElement());
      let password: string | null;
      try {
        password = await dlg.prompt({
          title: "Confirm your password",
          message: "Your server requires your password to set up cross-signing.",
        });
      } finally {
        dlg.getElement().remove();
      }
      if (!password) return;
      try {
        await bootstrapCrossSigning(password);
        showSuccess("Cross-signing keys uploaded successfully. Your account is now set up for cross-signing.");
      } catch (retryErr) {
        showError(`Cross-signing setup failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
      }
    } else {
      showError(`Cross-signing setup failed: ${msg}`);
    }
  }
}
