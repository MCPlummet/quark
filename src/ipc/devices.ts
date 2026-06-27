import { invoke } from "./invoke.js";
import type { DeviceSessionInfo } from "./types.js";

export async function listSessions(): Promise<DeviceSessionInfo[]> {
  return invoke<DeviceSessionInfo[]>("list_sessions");
}
