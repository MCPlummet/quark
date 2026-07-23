// The `:` command executor — parses and dispatches vim-style ex commands.

import { AppState } from "../state.js";

import {
  inviteUser as ipcInviteUser,
  kickUser as ipcKickUser,
  banUser as ipcBanUser,
  unbanUser as ipcUnbanUser,
  setDisplayName as ipcSetDisplayName,
  setRoomTopic,
} from "../../ipc/index.js";

import type { ParsedCommand } from "../../vim/commands.js";

import { showToast, showError, showSuccess } from "../../ui/NotificationToast.js";
import packageJson from "../../../package.json";

import { getComponents } from "./context.js";
import { joinRoom, leaveRoomWithFeedback, openOrCreateDm } from "./rooms.js";
import { logout } from "./session.js";
import { loadTheme } from "./theme.js";
import { openProfileDialog } from "./profile.js";
import {
  openSettings,
  openRoomInfo,
  openPinnedMessages,
  openSearch,
  openRoomDirectory,
  openRoomSettings,
  openSpaceSettings,
  openDebugViewer,
  openDebugViewerForEvent,
} from "./dialogs.js";
import { startVerification, setupCrossSigning } from "./crypto.js";
import { runUpdateCheck } from "../update_check.js";

/**
 * Execute a parsed : command.
 */
export async function executeCommand(parsed: ParsedCommand): Promise<void> {
  switch (parsed.name) {
    case "join": {
      const alias = parsed.args[0];
      if (!alias) {
        showError("Usage: :join <room-id-or-alias>");
        return;
      }
      try {
        await joinRoom(alias);
      } catch (err) {
        showError(`Failed to join: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "leave": {
      const roomId = parsed.args[0] ?? AppState.get("currentRoomId");
      if (!roomId) {
        showError("No room to leave");
        return;
      }
      await leaveRoomWithFeedback(roomId);
      break;
    }

    case "theme": {
      const themeName = parsed.args[0];
      if (!themeName) {
        showError("Usage: :theme <name>");
        return;
      }
      await loadTheme(themeName);
      break;
    }

    case "logout": {
      await logout();
      break;
    }

    case "q":
    case "quit": {
      // In Tauri: close the window
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        void getCurrentWindow().close();
      } catch {
        showToast("quit not available in this context", "info");
      }
      break;
    }

    case "upload": {
      showToast("Upload: not yet implemented", "info");
      break;
    }

    case "help": {
      getComponents().helpDialog.show();
      break;
    }

    case "profile": {
      void openProfileDialog();
      break;
    }

    case "settings": {
      openSettings();
      break;
    }

    case "info": {
      void openRoomInfo();
      break;
    }

    case "pinned": {
      void openPinnedMessages();
      break;
    }

    case "search": {
      openSearch(parsed.args.join(" "));
      break;
    }

    case "directory": {
      openRoomDirectory();
      break;
    }

    case "roomsettings":
    case "room-settings": {
      void openRoomSettings();
      break;
    }

    case "spacesettings":
    case "space-settings": {
      void openSpaceSettings();
      break;
    }

    case "debug": {
      const subjectArg = parsed.args[0];
      if (subjectArg === "cache") {
        // :debug cache — show event-cache diagnostics
        void openDebugViewer({ kind: "cache" });
      } else if (subjectArg && subjectArg.startsWith("$")) {
        // :debug $eventId — show raw event
        void openDebugViewerForEvent(subjectArg);
      } else {
        // :debug — show room state
        void openDebugViewer();
      }
      break;
    }

    case "version": {
      showToast(`Quark v${packageJson.version}`, "info");
      break;
    }

    case "update": {
      showToast("Checking for updates…", "info");
      await runUpdateCheck(getComponents(), true);
      break;
    }

    case "msg": {
      const targetUser = parsed.args[0];
      if (!targetUser) {
        showError("Usage: :msg <user-id>");
        return;
      }
      void openOrCreateDm(targetUser);
      break;
    }

    case "verify": {
      const userId = parsed.args[0];
      if (!userId) {
        showError("Usage: :verify <user-id>");
        return;
      }
      await startVerification(userId);
      break;
    }

    case "cross-sign":
    case "setup-cross-signing": {
      await setupCrossSigning(parsed.args[0]);
      break;
    }

    case "invite": {
      const userId = parsed.args[0];
      if (!userId) {
        showError("Usage: :invite <user-id>");
        return;
      }
      const roomId = AppState.get("currentRoomId");
      if (!roomId) {
        showError("No room selected");
        return;
      }
      try {
        await ipcInviteUser(roomId, userId);
        showSuccess(`Invited ${userId}`);
      } catch (err) {
        showError(`Failed to invite: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "kick": {
      const userId = parsed.args[0];
      if (!userId) {
        showError("Usage: :kick <user-id> [reason]");
        return;
      }
      const roomId = AppState.get("currentRoomId");
      if (!roomId) {
        showError("No room selected");
        return;
      }
      const reason = parsed.args.slice(1).join(" ") || undefined;
      try {
        await ipcKickUser(roomId, userId, reason);
        showSuccess(`Kicked ${userId}`);
      } catch (err) {
        showError(`Failed to kick: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "ban": {
      const userId = parsed.args[0];
      if (!userId) {
        showError("Usage: :ban <user-id> [reason]");
        return;
      }
      const roomId = AppState.get("currentRoomId");
      if (!roomId) {
        showError("No room selected");
        return;
      }
      const reason = parsed.args.slice(1).join(" ") || undefined;
      try {
        await ipcBanUser(roomId, userId, reason);
        showSuccess(`Banned ${userId}`);
      } catch (err) {
        showError(`Failed to ban: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "unban": {
      const userId = parsed.args[0];
      if (!userId) {
        showError("Usage: :unban <user-id>");
        return;
      }
      const roomId = AppState.get("currentRoomId");
      if (!roomId) {
        showError("No room selected");
        return;
      }
      try {
        await ipcUnbanUser(roomId, userId);
        showSuccess(`Unbanned ${userId}`);
      } catch (err) {
        showError(`Failed to unban: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "nick": {
      const newName = parsed.args.join(" ");
      if (!newName) {
        showError("Usage: :nick <display-name>");
        return;
      }
      try {
        await ipcSetDisplayName(newName);
        showSuccess(`Display name set to "${newName}"`);
      } catch (err) {
        showError(`Failed to set display name: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "topic": {
      const topic = parsed.args.join(" ");
      if (!topic) {
        showError("Usage: :topic <text>");
        return;
      }
      const roomId = AppState.get("currentRoomId");
      if (!roomId) {
        showError("No room selected");
        return;
      }
      try {
        await setRoomTopic(roomId, topic);
        showSuccess("Topic updated");
      } catch (err) {
        showError(`Failed to set topic: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    default:
      showError(`Unknown command: ${parsed.name}`);
  }
}
