// Crypto / verification IPC calls

import { invoke } from "./invoke.js";
import type { CrossSigningInfo, KeyBackupStatus, SasInfo, VerificationStatus } from "./types.js";

export type { CrossSigningInfo, KeyBackupStatus, SasInfo, VerificationStatus };

/** Get the verification status of the local device. */
export async function getVerificationStatus(): Promise<VerificationStatus> {
  return invoke<VerificationStatus>("get_verification_status");
}

/** Get cross-signing key status for the local user. */
export async function getCrossSigningStatus(): Promise<CrossSigningInfo> {
  return invoke<CrossSigningInfo>("get_cross_signing_status");
}

/**
 * Bootstrap cross-signing keys.
 *
 * Pass the user's password if the server requires UIAA.
 * If the server needs a password but none is supplied, throws an error with
 * message "UIAA_REQUIRED" — the caller should prompt for a password and retry.
 */
export async function bootstrapCrossSigning(
  password?: string,
): Promise<void> {
  return invoke<void>("bootstrap_cross_signing", { password: password ?? null });
}

/**
 * List all devices for a user with their verification status.
 * Used to pick which device to verify.
 */
export async function getUserDevices(
  userId: string,
): Promise<VerificationStatus[]> {
  return invoke<VerificationStatus[]>("get_user_devices", { userId });
}

/**
 * Start a SAS verification flow with a specific user/device.
 * Returns the flow ID — use it with getSasInfo, acceptSasVerification, etc.
 */
export async function startSasVerification(
  userId: string,
  deviceId: string,
): Promise<string> {
  return invoke<string>("start_sas_verification", { userId, deviceId });
}

/**
 * Accept an incoming verification request sent from another device.
 * Accepts the request and starts the SAS key exchange.
 * The same flow_id is then used with getSasInfo / confirmSasVerification.
 */
export async function acceptVerificationRequest(
  userId: string,
  flowId: string,
): Promise<void> {
  return invoke<void>("accept_verification_request", { userId, flowId });
}

/** Accept an incoming SAS verification request. */
export async function acceptSasVerification(
  userId: string,
  flowId: string,
): Promise<void> {
  return invoke<void>("accept_sas_verification", { userId, flowId });
}

/**
 * Confirm a SAS verification (user has compared emoji and they match).
 */
export async function confirmSasVerification(
  userId: string,
  flowId: string,
): Promise<void> {
  return invoke<void>("confirm_sas_verification", { userId, flowId });
}

/** Cancel / deny a SAS verification. */
export async function cancelSasVerification(
  userId: string,
  flowId: string,
): Promise<void> {
  return invoke<void>("cancel_sas_verification", { userId, flowId });
}

/**
 * Poll for SAS emoji info for an active verification flow.
 * Returns null if the flow is not yet at the emoji comparison step.
 */
export async function getSasInfo(
  userId: string,
  flowId: string,
): Promise<SasInfo | null> {
  return invoke<SasInfo | null>("get_sas_info", { userId, flowId });
}

/**
 * Reset the local cross-signing identity, rotating all three keys.
 *
 * Pass the user's password if the server requires UIAA. If the server needs a
 * password but none is supplied, throws an error with message "UIAA_REQUIRED"
 * — the caller should prompt for a password and retry.
 */
export async function resetCrossSigning(password?: string): Promise<void> {
  return invoke<void>("reset_cross_signing", { password: password ?? null });
}

/** Get the current key backup status (read-only). */
export async function getKeyBackupStatus(): Promise<KeyBackupStatus> {
  return invoke<KeyBackupStatus>("get_key_backup_status");
}

/**
 * Decide whether to show the post-login "verify this session" prompt. Returns
 * the own user ID to verify against when the prompt should appear, or null to
 * skip (the backend logs the skip reason at INFO). Matches the Rust
 * `verification_prompt_target` command.
 */
export async function verificationPromptTarget(): Promise<string | null> {
  return invoke<string | null>("verification_prompt_target", {});
}

/**
 * Record (in the backend log, INFO) the user's choice on the verify-this-session
 * prompt: "verify" | "later" | "never". Matches the Rust
 * `log_verification_prompt_choice` command.
 */
export async function logVerificationPromptChoice(
  choice: "verify" | "later" | "never",
): Promise<void> {
  return invoke<void>("log_verification_prompt_choice", { choice });
}
