// E2EE actions: cross-signing bootstrap. (SAS device verification lives in
// ./verification.ts.)

import {
  getCrossSigningStatus,
  bootstrapCrossSigning,
} from "../../ipc/index.js";

import { showToast, showError, showSuccess } from "../../ui/NotificationToast.js";
import { PasswordPromptDialog } from "../../ui/PasswordPromptDialog.js";
import { mountOverlay } from "../../ui/overlay.js";

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
      mountOverlay(dlg.getElement());
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
