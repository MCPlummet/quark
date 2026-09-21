// The `:` command executor — dispatches ex commands to the action layer.
//
// Switches on the *registry id*, not on the raw name the user typed. Aliases
// (`:room-settings`, `:q`, `:convert-to-dm`) collapse in exactly one place —
// actionByCommand — instead of accumulating parallel case labels here that tab
// completion and the help dialog then had to be taught about separately.
//
// Preconditions are declared in the registry and checked once, up front, by
// isAvailable. That replaces six hand-written copies of "No room selected"
// which had drifted into slightly different wording, and it means the palette
// (#98) can grey out exactly the commands this function would have refused.

import {
  inviteUser as ipcInviteUser,
  kickUser as ipcKickUser,
  banUser as ipcBanUser,
  unbanUser as ipcUnbanUser,
  setDisplayName as ipcSetDisplayName,
  setRoomTopic,
} from "../../ipc/index.js";

import type { ParsedCommand } from "../../vim/commands.js";
import {
  actionByCommand,
  isAvailable,
  type ActionEntry,
  type AvailabilityContext,
} from "../registry.js";
import { currentAvailability } from "../availability.js";
import { AppState } from "../state.js";
import { muteRoom, unmuteRoom } from "../notifications.js";

import { showToast, showError, showSuccess } from "../../ui/NotificationToast.js";
import packageJson from "../../../package.json";

import { getComponents } from "./context.js";
import {
  joinRoom,
  leaveRoomWithFeedback,
  openOrCreateDm,
  convertRoomDirectness,
  markRoomAsRead,
} from "./rooms.js";
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
import { openEmojiPicker, openStickerPicker, openGifPicker } from "./gif.js";
import { runUpdateCheck } from "../update_check.js";

/**
 * Commands that accept a room ID as their first argument, and so can run with
 * no room open. Their "room" requirement still holds for the palette and menus,
 * where no argument can be supplied — it is only the typed form that can name a
 * target the app is not currently looking at.
 */
const ROOM_ARG_COMMANDS = new Set([
  "leave-room",
  "mark-room-read",
  "convert-to-dm",
  "convert-to-room",
  "mute-room",
  "unmute-room",
]);

/**
 * Subcommands that lift their action's "room" requirement.
 *
 * `:debug` dumps the open room's state, so open-debug declares `requires:
 * ["room"]` — which is right for the bare form, for the palette and for the
 * usage error. `:debug cache` reports on the app-wide event cache and has no
 * room to be scoped to; it ran fine until the requirement was declared and then
 * started failing with "No room selected". Naming the spelling here keeps the
 * requirement honest about the common case instead of dropping it for all three.
 */
const ROOM_FREE_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  "open-debug": new Set(["cache"]),
};

/** "Usage: :kick <user-id> [reason]", built from the registry's args spec. */
function usageError(entry: ActionEntry): void {
  const { name, args } = entry.command!;
  showError(args ? `Usage: :${name} ${args}` : `Usage: :${name}`);
}

/**
 * The entry to check requirements against, with any requirement this particular
 * spelling escapes dropped. The registry entry itself is unchanged — the palette
 * and the help text still read the requirement as declared.
 */
function gateFor(entry: ActionEntry, firstArg: string | undefined): ActionEntry {
  if (firstArg === undefined) return entry;
  if (!ROOM_FREE_SUBCOMMANDS[entry.id]?.has(firstArg)) return entry;
  return { ...entry, requires: entry.requires?.filter((r) => r !== "room") };
}

/** Why an action can't run right now, in the user's terms. */
function unavailableReason(entry: ActionEntry, ctx: AvailabilityContext): string {
  const name = entry.command?.name ?? entry.id;
  for (const req of entry.requires ?? []) {
    if (req === "session" && !ctx.loggedIn) return "Not logged in";
    if (req === "room" && !ctx.roomId) return "No room selected";
    if (req === "space" && !ctx.spaceId) return "No space selected";
    if (req === "desktop" && ctx.isMobile) return `:${name} is not available on mobile`;
  }
  return `:${name} is not available right now`;
}

/**
 * Execute a parsed `:` command.
 */
export async function executeCommand(parsed: ParsedCommand): Promise<void> {
  const entry = actionByCommand(parsed.name);
  if (!entry) {
    showError(`Unknown command: ${parsed.name}`);
    return;
  }

  // A room named as an argument satisfies the "room" requirement — `:leave
  // !other:server` is meaningful with nothing open.
  const explicitRoom = ROOM_ARG_COMMANDS.has(entry.id) ? parsed.args[0] : undefined;
  const ctx = currentAvailability(explicitRoom ? { roomId: explicitRoom } : {});
  if (!isAvailable(gateFor(entry, parsed.args[0]), ctx)) {
    showError(unavailableReason(entry, ctx));
    return;
  }

  // Gated above: anything declaring `requires: ["room"]` has reached this line
  // with a room in hand, so this is the gate's guarantee rather than an
  // assumption. Commands with no room requirement never read it — and neither
  // does the one branch a ROOM_FREE_SUBCOMMANDS spelling reaches, which is the
  // only way past the gate without a room.
  const roomId = ctx.roomId!;

  switch (entry.id) {
    case "join-room": {
      const alias = parsed.args[0];
      if (!alias) return usageError(entry);
      try {
        await joinRoom(alias);
      } catch (err) {
        showError(`Failed to join: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "leave-room": {
      await leaveRoomWithFeedback(roomId);
      break;
    }

    case "load-theme": {
      const themeName = parsed.args[0];
      if (!themeName) return usageError(entry);
      await loadTheme(themeName);
      break;
    }

    case "logout": {
      await logout();
      break;
    }

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

    case "upload-file": {
      showToast("Upload: not yet implemented", "info");
      break;
    }

    case "help": {
      getComponents().helpDialog.show();
      break;
    }

    case "open-profile": {
      void openProfileDialog();
      break;
    }

    case "open-settings": {
      openSettings();
      break;
    }

    case "open-room-info": {
      void openRoomInfo();
      break;
    }

    case "open-pinned": {
      void openPinnedMessages();
      break;
    }

    case "open-search": {
      openSearch(parsed.args.join(" "));
      break;
    }

    case "open-emoji-picker": {
      openEmojiPicker();
      break;
    }

    case "open-sticker-picker": {
      openStickerPicker();
      break;
    }

    case "open-gif-picker": {
      openGifPicker();
      break;
    }

    case "open-directory": {
      openRoomDirectory();
      break;
    }

    case "open-room-settings": {
      void openRoomSettings();
      break;
    }

    case "open-space-settings": {
      void openSpaceSettings();
      break;
    }

    // Direction is a literal per case rather than derived from the command
    // name: an alias like :converttodirectmessage would fall the wrong side of
    // any endsWith("dm") test and silently convert the opposite way.
    case "convert-to-dm": {
      await convertRoomDirectness(roomId, true);
      break;
    }

    case "convert-to-room": {
      await convertRoomDirectness(roomId, false);
      break;
    }

    case "open-debug": {
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

    case "show-version": {
      showToast(`Quark v${packageJson.version}`, "info");
      break;
    }

    case "check-for-updates": {
      showToast("Checking for updates…", "info");
      await runUpdateCheck(getComponents(), true);
      break;
    }

    case "mark-room-read": {
      markRoomAsRead(roomId);
      break;
    }

    case "mute-room":
    case "unmute-room": {
      // muteRoom/unmuteRoom raise their own toast on a ruleset write the server
      // did not take, so there is nothing to report here beyond the outcome.
      const outcome = entry.id === "mute-room"
        ? await muteRoom(roomId)
        : await unmuteRoom(roomId);
      if (outcome.synced) {
        const muted = entry.id === "mute-room";
        AppState.set(
          "roomListCache",
          AppState.get("roomListCache").map((r) =>
            r.room_id === roomId ? { ...r, muted } : r,
          ),
        );
        showSuccess(muted ? "Room muted" : "Room unmuted");
      }
      break;
    }

    case "open-dm": {
      const targetUser = parsed.args[0];
      if (!targetUser) return usageError(entry);
      void openOrCreateDm(targetUser);
      break;
    }

    case "verify-user": {
      const userId = parsed.args[0];
      if (!userId) return usageError(entry);
      await startVerification(userId);
      break;
    }

    case "setup-cross-signing": {
      await setupCrossSigning(parsed.args[0]);
      break;
    }

    case "invite-user": {
      const userId = parsed.args[0];
      if (!userId) return usageError(entry);
      try {
        await ipcInviteUser(roomId, userId);
        showSuccess(`Invited ${userId}`);
      } catch (err) {
        showError(`Failed to invite: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "kick-user": {
      const userId = parsed.args[0];
      if (!userId) return usageError(entry);
      const reason = parsed.args.slice(1).join(" ") || undefined;
      try {
        await ipcKickUser(roomId, userId, reason);
        showSuccess(`Kicked ${userId}`);
      } catch (err) {
        showError(`Failed to kick: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "ban-user": {
      const userId = parsed.args[0];
      if (!userId) return usageError(entry);
      const reason = parsed.args.slice(1).join(" ") || undefined;
      try {
        await ipcBanUser(roomId, userId, reason);
        showSuccess(`Banned ${userId}`);
      } catch (err) {
        showError(`Failed to ban: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "unban-user": {
      const userId = parsed.args[0];
      if (!userId) return usageError(entry);
      try {
        await ipcUnbanUser(roomId, userId);
        showSuccess(`Unbanned ${userId}`);
      } catch (err) {
        showError(`Failed to unban: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "set-nick": {
      const newName = parsed.args.join(" ");
      if (!newName) return usageError(entry);
      try {
        await ipcSetDisplayName(newName);
        showSuccess(`Display name set to "${newName}"`);
      } catch (err) {
        showError(`Failed to set display name: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "set-topic": {
      const topic = parsed.args.join(" ");
      if (!topic) return usageError(entry);
      try {
        await setRoomTopic(roomId, topic);
        showSuccess("Topic updated");
      } catch (err) {
        showError(`Failed to set topic: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    default: {
      // Unreachable: every CommandId has a case above, and `tsc` proves it —
      // adding a command to the registry without a handler here fails the build
      // on this line rather than shipping a `:command` that silently does
      // nothing. The runtime arm stays for a registry loaded at odds with this
      // bundle (a stale cached module, a hot reload mid-edit).
      const unhandled: never = entry.id;
      showError(`Unknown command: ${String(unhandled)}`);
    }
  }
}
