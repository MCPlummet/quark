// Startup + manual update-check orchestration. Reads the channel/auto_check
// prefs via the existing app-config IPC, drives the UpdateBanner, and remembers
// the last version the user dismissed so we don't re-nag for it.

import type { AppComponents } from "../ui/App.js";
import { AppState } from "./state.js";
import { getAppConfig, updateCheck } from "../ipc/index.js";
import { showError, showToast } from "../ui/NotificationToast.js";

let _lastDismissed: string | null = null;

/** Auto path: only checks when the user has auto_check enabled. Fire-and-forget. */
export async function maybeCheckForUpdates(components: AppComponents): Promise<void> {
  let autoCheck = true;
  try {
    autoCheck = (await getAppConfig()).updater.auto_check;
  } catch {
    return;
  }
  if (!autoCheck) return;
  await runUpdateCheck(components, false);
}

/**
 * Run a check. `manual` = triggered by `:update` (show "up to date"/errors and
 * re-show a previously dismissed version); auto runs are silent on no-op.
 */
export async function runUpdateCheck(components: AppComponents, manual: boolean): Promise<void> {
  try {
    const info = await updateCheck();
    if (info) {
      AppState.set("updateAvailable", info);
      if (manual || info.version !== _lastDismissed) {
        components.updateBanner.show(info);
      }
    } else if (manual) {
      showToast("You're on the latest version.", "info");
    }
  } catch (e) {
    if (manual) {
      showError(`Update check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Record a dismissal so the auto path won't re-show this version. */
export function rememberDismissed(version: string): void {
  _lastDismissed = version;
}
