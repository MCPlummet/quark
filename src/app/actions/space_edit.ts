// Creating rooms and spaces, and reordering a space's rooms.

import { AppState } from "../state.js";
import { getPseudoSpace } from "../pseudo_spaces.js";
import {
  createRoom,
  addSpaceChild,
  reorderSpaceChildren,
  getUserSpaces,
} from "../../ipc/index.js";
import type { CreateRoomRequest, CreateKind } from "../../ui/CreateRoomDialog.js";
import { showError, showSuccess } from "../../ui/NotificationToast.js";
import { getComponents } from "./context.js";
import { refreshRooms, renderSpaceView, selectRoom, selectSpace } from "./rooms.js";

// ── Create ───────────────────────────────────────────────────────────────────

/** The real (non-pseudo) space currently selected, if any. */
function currentRealSpace(): string | null {
  const id = AppState.get("currentSpaceId");
  return id && !getPseudoSpace(id) ? id : null;
}

/**
 * Open the create dialog. The parent defaults to the space being viewed;
 * pass `parentSpaceId: null` to create outside any space.
 */
export async function openCreateRoom(opts: {
  kind?: CreateKind;
  name?: string;
  parentSpaceId?: string | null;
} = {}): Promise<void> {
  const spaces = await getUserSpaces().catch(() => []);
  const ownUserId = AppState.get("ownUserId") ?? "";
  const serverName = ownUserId.includes(":") ? ownUserId.slice(ownUserId.indexOf(":") + 1) : "";
  getComponents().createRoomDialog.show({
    kind: opts.kind,
    name: opts.name,
    parentSpaceId: opts.parentSpaceId === undefined ? currentRealSpace() : opts.parentSpaceId,
    spaces: spaces
      .map((s) => ({ id: s.room_id, name: s.name ?? s.room_id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    serverName,
  });
}

/**
 * Create what the dialog describes, list it in its space, and go to it.
 *
 * Throws when the room could not be created at all — the dialog shows the
 * message inline and stays open. Listing it in the space is a second write
 * that can fail on its own (no permission in that space, say); the room then
 * exists, so that is a warning and the dialog closes.
 */
export async function createRoomFromForm(req: CreateRoomRequest): Promise<boolean> {
  const isSpace = req.kind === "space";
  let roomId: string;
  try {
    roomId = await createRoom({
      name: req.name,
      topic: req.topic || null,
      alias: req.alias || null,
      is_public: req.access === "public",
      is_direct: false,
      invite: req.invite,
      enable_encryption: !isSpace && req.encrypted,
      is_space: isSpace,
      parent_space_id: req.parentSpaceId,
      space_members_can_join: req.access === "space",
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  let listedInSpace = true;
  if (req.parentSpaceId) {
    try {
      await addSpaceChild(req.parentSpaceId, roomId);
    } catch (err) {
      listedInSpace = false;
      const msg = err instanceof Error ? err.message : String(err);
      showError(`Created ${req.name}, but couldn't add it to the space: ${msg}`, 8000);
    }
  }
  if (listedInSpace) showSuccess(`Created ${isSpace ? "space" : "room"} ${req.name}`);

  await refreshRooms();
  if (isSpace && !req.parentSpaceId) {
    await selectSpace(roomId);
  } else if (isSpace) {
    // A subspace is a section of its parent's list, not a strip icon.
    await selectSpace(req.parentSpaceId!, { skipRoomRestore: true });
  } else {
    if (req.parentSpaceId && listedInSpace) {
      await selectSpace(req.parentSpaceId, { skipRoomRestore: true });
    }
    await selectRoom(roomId);
  }
  return true;
}

// ── Reorder ──────────────────────────────────────────────────────────────────

/**
 * Reorders, one at a time and in the order made: each is computed by the
 * backend from the writes of the one before, so overlapping them could
 * interleave two different plans.
 */
let _reorderChain: Promise<void> = Promise.resolve();

/**
 * Put a space section's rooms in `roomIds` order: at once in the list, then on
 * the server. A failure puts the list back the way the server has it.
 */
export function applySpaceOrder(spaceId: string, roomIds: string[], movedRoomId: string): Promise<void> {
  const { roomList } = getComponents();
  roomList.applySectionOrder(spaceId, roomIds);
  roomList.focusRoom(movedRoomId, spaceId);

  _reorderChain = _reorderChain.then(async () => {
    try {
      await reorderSpaceChildren(spaceId, roomIds);
    } catch (err) {
      showError(`Couldn't reorder: ${err instanceof Error ? err.message : String(err)}`);
      const viewing = AppState.get("currentSpaceId");
      if (viewing) await renderSpaceView(viewing).catch(() => {});
    }
  });
  return _reorderChain;
}

/**
 * Move a room one place up or down within its section of the space being
 * viewed. Does nothing in a pseudo-space (sorted by activity) or at either end.
 */
export function moveRoomInSpace(roomId: string, delta: -1 | 1): Promise<void> {
  const section = getComponents().roomList.getSectionFor(roomId);
  if (!section) {
    showError("Rooms can only be reordered inside a space");
    return Promise.resolve();
  }
  const ids = section.roomIds;
  const from = ids.indexOf(roomId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return Promise.resolve();
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return applySpaceOrder(section.spaceId, next, roomId);
}

/** Whether `roomId` can move by `delta` in the list as shown. */
export function canMoveRoom(roomId: string, delta: -1 | 1): boolean {
  const section = getComponents().roomList.getSectionFor(roomId);
  if (!section) return false;
  const i = section.roomIds.indexOf(roomId) + delta;
  return i >= 0 && i < section.roomIds.length && section.roomIds.indexOf(roomId) >= 0;
}

/** The room the reorder keys act on: the focused row, else the open room. */
export function roomForReorder(): string | null {
  return getComponents().roomList.getFocusedRoomId() ?? AppState.get("currentRoomId");
}
