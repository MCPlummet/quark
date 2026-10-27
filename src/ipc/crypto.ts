// Crypto / verification IPC calls

import { invoke } from "./invoke.js";
import type {
  CrossSigningInfo,
  IncomingVerificationRequest,
  KeyBackupStatus,
  SasInfo,
  VerificationStatus,
  VerificationUpdate,
} from "./types.js";

export type {
  CrossSigningInfo,
  IncomingVerificationRequest,
  KeyBackupStatus,
  SasInfo,
  VerificationStatus,
  VerificationUpdate,
};

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
 * Returns the flow ID. If that device already sent us an unanswered request,
 * the backend accepts it instead and returns ITS flow ID (no competing request).
 * Progress arrives as `quark://verification/state` events.
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

/**
 * Accept a SAS the other side started. The backend does this on its own as
 * soon as the start arrives; kept as an idempotent nudge. Never starts SAS.
 */
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

/**
 * Cancel a verification flow — the request and/or the SAS, at any stage, so
 * the other device is told. `mismatch` reports the emoji as not matching.
 */
export async function cancelSasVerification(
  userId: string,
  flowId: string,
  mismatch = false,
): Promise<void> {
  return invoke<void>("cancel_sas_verification", { userId, flowId, mismatch });
}

/**
 * Legacy: SAS emoji info for a flow, null until a SAS exists. The UI uses
 * getVerificationState / the state events instead.
 */
export async function getSasInfo(
  userId: string,
  flowId: string,
): Promise<SasInfo | null> {
  return invoke<SasInfo | null>("get_sas_info", { userId, flowId });
}

/**
 * Current state of a verification flow (same shape as the
 * `quark://verification/state` event), or null if the backend doesn't know it.
 */
export async function getVerificationState(
  userId: string,
  flowId: string,
): Promise<VerificationUpdate | null> {
  return invoke<VerificationUpdate | null>("get_verification_state", { userId, flowId });
}

/**
 * Incoming verification requests still awaiting an answer. Called once the
 * event listeners are registered, to catch a request emitted before they were.
 */
export async function pendingVerificationRequests(): Promise<IncomingVerificationRequest[]> {
  return invoke<IncomingVerificationRequest[]>("pending_verification_requests", {});
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
