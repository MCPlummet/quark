// IPC calls for room settings and the debug viewer.

import { invoke } from "./invoke.js";
import type { PowerLevels, RawStateEvent } from "./types.js";

export type { PowerLevels, RawStateEvent };

// ─── Room Settings ────────────────────────────────────────────────────────────

/** Get the current power levels for a room. */
export async function getPowerLevels(roomId: string): Promise<PowerLevels> {
  return invoke<PowerLevels>("get_power_levels", { roomId });
}

/** Replace the power levels for a room. */
export async function setPowerLevels(roomId: string, levels: PowerLevels): Promise<void> {
  return invoke<void>("set_power_levels", { roomId, levels });
}

/** Set the room's display name. */
export async function setRoomName(roomId: string, name: string): Promise<void> {
  return invoke<void>("set_room_name", { roomId, name });
}

/** Set the room's topic. */
export async function setRoomTopic(roomId: string, topic: string): Promise<void> {
  return invoke<void>("set_room_topic", { roomId, topic });
}

/** Set the room's join rule: "public" | "invite" | "knock" | "private". */
export async function setRoomJoinRule(roomId: string, rule: string): Promise<void> {
  return invoke<void>("set_room_join_rule", { roomId, rule });
}

/** Set the room's history visibility: "invited" | "joined" | "shared" | "world_readable". */
export async function setRoomHistoryVisibility(roomId: string, visibility: string): Promise<void> {
  return invoke<void>("set_room_history_visibility", { roomId, visibility });
}

/**
 * Mark the room as a DM (or unmark it) in the `m.direct` account data.
 * Account data only — no power level required.
 */
export async function setRoomDirect(roomId: string, isDirect: boolean): Promise<void> {
  return invoke<void>("set_room_direct", { roomId, isDirect });
}

// ─── Debug Viewer ─────────────────────────────────────────────────────────────

/** Fetch all key state events for a room as raw JSON blobs. */
export async function getRoomStateEvents(roomId: string): Promise<RawStateEvent[]> {
  return invoke<RawStateEvent[]>("get_room_state_events", { roomId });
}

/** Fetch the raw JSON string for a single timeline event. */
export async function getRawEvent(roomId: string, eventId: string): Promise<string> {
  return invoke<string>("get_raw_event", { roomId, eventId });
}
