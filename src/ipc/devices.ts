import { invoke } from "./invoke.js";
import type { DeviceSessionInfo } from "./types.js";

export async function listSessions(): Promise<DeviceSessionInfo[]> {
  return invoke<DeviceSessionInfo[]>("list_sessions");
}

export async function renameDevice(deviceId: string, name: string): Promise<void> {
  return invoke<void>("rename_device", { deviceId, name });
}

export async function deleteDevices(deviceIds: string[], password?: string): Promise<void> {
  return invoke<void>("delete_devices", { deviceIds, password: password ?? null });
}
