use matrix_sdk::{
    encryption::verification::Verification,
    ruma::{api::client::uiaa, UserId},
    Client,
};
use serde::{Deserialize, Serialize};
use tracing::info;

/// Verification status for a device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationStatus {
    pub user_id: String,
    pub device_id: String,
    /// Human-readable device name set at login (matrix-sdk `Device::display_name`,
    /// e.g. "Quark on Linux", "Element iOS"). `None` if the device didn't set one.
    pub display_name: Option<String>,
    pub is_verified: bool,
    pub is_cross_signed: bool,
    pub trust_level: String,
}

/// Get verification status for the local device.
pub async fn get_own_verification_status(client: &Client) -> Result<VerificationStatus, String> {
    let user_id = client
        .user_id()
        .ok_or("Not logged in")?;
    let device_id = client
        .device_id()
        .ok_or("No device ID")?;

    let encryption = client.encryption();

    let own_device = encryption
        .get_device(user_id, device_id)
        .await
        .map_err(|e| format!("Failed to get device: {e}"))?
        .ok_or_else(|| "Own device not found in store".to_string())?;

    let is_verified = own_device.is_verified();
    let is_cross_signed = own_device.is_cross_signed_by_owner();

    let trust_level = if is_cross_signed {
        "cross-signed".to_string()
    } else if is_verified {
        "self-verified".to_string()
    } else {
        "unverified".to_string()
    };

    Ok(VerificationStatus {
        user_id: user_id.to_string(),
        device_id: device_id.to_string(),
        display_name: own_device.display_name().map(str::to_string),
        is_verified,
        is_cross_signed,
        trust_level,
    })
}

/// Get verification status for another user's devices.
pub async fn get_user_verification_statuses(
    client: &Client,
    user_id_str: &str,
) -> Result<Vec<VerificationStatus>, String> {
    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    let devices = encryption
        .get_user_devices(&user_id)
        .await
        .map_err(|e| format!("Failed to get user devices: {e}"))?;

    let statuses = devices
        .devices()
        .map(|device| {
            let is_verified = device.is_verified();
            let is_cross_signed = device.is_cross_signed_by_owner();
            let trust_level = if is_cross_signed {
                "cross-signed".to_string()
            } else if is_verified {
                "self-verified".to_string()
            } else {
                "unverified".to_string()
            };

            VerificationStatus {
                user_id: user_id.to_string(),
                device_id: device.device_id().to_string(),
                display_name: device.display_name().map(str::to_string),
                is_verified,
                is_cross_signed,
                trust_level,
            }
        })
        .collect();

    Ok(statuses)
}

/// Request info about a started SAS verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SasInfo {
    pub flow_id: String,
    pub other_user_id: String,
    pub other_device_id: String,
    /// The emoji list for SAS verification (index 0..6, each is [emoji, description]).
    pub emoji: Vec<[String; 2]>,
    pub decimals: Option<[u16; 3]>,
}

/// Start a SAS verification with a user/device.
/// Returns a flow_id that the frontend can use to accept/confirm.
pub async fn start_sas_verification(
    client: &Client,
    user_id_str: &str,
    device_id_str: &str,
) -> Result<String, String> {
    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    let device = encryption
        .get_device(&user_id, device_id_str.into())
        .await
        .map_err(|e| format!("Failed to get device: {e}"))?
        .ok_or_else(|| format!("Device {} not found for user {}", device_id_str, user_id_str))?;

    let request = device
        .request_verification()
        .await
        .map_err(|e| format!("Failed to start verification request: {e}"))?;

    let flow_id = request.flow_id().to_string();
    info!(flow_id = %flow_id, user = %user_id_str, device = %device_id_str, "SAS verification requested");
    Ok(flow_id)
}

/// Accept a SAS verification request.
pub async fn accept_sas_verification(
    client: &Client,
    user_id_str: &str,
    flow_id: &str,
) -> Result<(), String> {
    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    // The Sas object only exists once one side has sent m.key.verification.start.
    // For OUTBOUND requests nobody starts automatically: when the other device
    // accepts (the request turns Ready), it is on us — the requester — to
    // transition into SAS. The frontend retries this call while polling for
    // emoji, so the start fires on the first tick after the remote accept.
    let verification = match encryption.get_verification(&user_id, flow_id).await {
        Some(v) => v,
        None => {
            let request = encryption
                .get_verification_request(&user_id, flow_id)
                .await
                .ok_or_else(|| format!("Verification flow {} not found", flow_id))?;
            if request.is_ready() {
                request
                    .start_sas()
                    .await
                    .map_err(|e| format!("Failed to start SAS: {e}"))?;
                info!(flow_id = %flow_id, "Verification request ready — SAS started");
            }
            return Ok(());
        }
    };

    if let Verification::SasV1(sas) = verification {
        sas.accept()
            .await
            .map_err(|e| format!("Failed to accept verification: {e}"))?;
        info!(flow_id = %flow_id, "SAS verification accepted");
    }

    Ok(())
}

/// Confirm a SAS verification (after checking emojis match).
pub async fn confirm_sas_verification(
    client: &Client,
    user_id_str: &str,
    flow_id: &str,
) -> Result<(), String> {
    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    let verification = encryption
        .get_verification(&user_id, flow_id)
        .await
        .ok_or_else(|| format!("Verification flow {} not found", flow_id))?;

    if let Verification::SasV1(sas) = verification {
        sas.confirm()
            .await
            .map_err(|e| format!("Failed to confirm verification: {e}"))?;
        info!(flow_id = %flow_id, "SAS verification confirmed");
    }

    Ok(())
}

/// Accept an incoming verification request and start SAS.
///
/// Called when Quark receives a `m.key.verification.request` to-device event
/// from another session. Accepts the request and transitions into the SAS
/// key-exchange phase. The same `flow_id` is used for subsequent `get_sas_info`
/// / `confirm_sas_verification` calls.
pub async fn accept_verification_request(
    client: &Client,
    user_id_str: &str,
    flow_id: &str,
) -> Result<(), String> {
    use matrix_sdk::ruma::events::key::verification::VerificationMethod;

    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    let request = encryption
        .get_verification_request(&user_id, flow_id)
        .await
        .ok_or_else(|| format!("Verification request {} not found", flow_id))?;

    // Accept the request, advertising only SAS as the supported method.
    request
        .accept_with_methods(vec![VerificationMethod::SasV1])
        .await
        .map_err(|e| format!("Failed to accept verification request: {e}"))?;

    // Start SAS — this triggers the key exchange so emojis become available.
    if let Some(_sas) = request
        .start_sas()
        .await
        .map_err(|e| format!("Failed to start SAS: {e}"))?
    {
        info!(flow_id = %flow_id, user = %user_id_str, "Accepted incoming verification request, SAS started");
    }

    Ok(())
}

/// Cancel / deny a SAS verification.
pub async fn cancel_sas_verification(
    client: &Client,
    user_id_str: &str,
    flow_id: &str,
) -> Result<(), String> {
    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    let verification = encryption
        .get_verification(&user_id, flow_id)
        .await
        .ok_or_else(|| format!("Verification flow {} not found", flow_id))?;

    if let Verification::SasV1(sas) = verification {
        sas.cancel()
            .await
            .map_err(|e| format!("Failed to cancel verification: {e}"))?;
        info!(flow_id = %flow_id, "SAS verification cancelled");
    }

    Ok(())
}

/// Get SAS emoji info for an active verification flow.
/// Returns None if the flow doesn't exist or emojis are not yet available.
pub async fn get_sas_info(
    client: &Client,
    user_id_str: &str,
    flow_id: &str,
) -> Result<Option<SasInfo>, String> {
    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    let verification = match encryption.get_verification(&user_id, flow_id).await {
        Some(v) => v,
        None => return Ok(None),
    };

    if let Verification::SasV1(sas) = verification {
        let emoji = sas
            .emoji()
            .map(|emojis| {
                emojis
                    .iter()
                    .map(|e| [e.symbol.to_string(), e.description.to_string()])
                    .collect()
            })
            .unwrap_or_default();

        let decimals = sas.decimals().map(|(a, b, c)| [a, b, c]);

        let other_device_id = sas.other_device().device_id().to_string();

        return Ok(Some(SasInfo {
            flow_id: flow_id.to_string(),
            other_user_id: user_id_str.to_string(),
            other_device_id,
            emoji,
            decimals,
        }));
    }

    Ok(None)
}

/// Serializable cross-signing status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossSigningInfo {
    pub has_master: bool,
    pub has_self_signing: bool,
    pub has_user_signing: bool,
    pub is_complete: bool,
}

/// Get cross-signing key status for the local user.
pub async fn get_cross_signing_status(client: &Client) -> Result<CrossSigningInfo, String> {
    let encryption = client.encryption();

    let status = encryption
        .cross_signing_status()
        .await
        .ok_or("E2EE not initialized — OlmMachine not ready")?;

    Ok(CrossSigningInfo {
        has_master: status.has_master,
        has_self_signing: status.has_self_signing,
        has_user_signing: status.has_user_signing,
        is_complete: status.is_complete(),
    })
}

/// Key backup status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyBackupStatus {
    pub enabled: bool,
    pub exists_on_server: bool,
}

/// Get key backup status (read-only).
pub async fn get_key_backup_status(client: &Client) -> Result<KeyBackupStatus, String> {
    let backups = client.encryption().backups();
    let enabled = backups.are_enabled().await;
    let exists_on_server = backups.exists_on_server().await.unwrap_or(false);
    Ok(KeyBackupStatus { enabled, exists_on_server })
}

/// Reset cross-signing identity.
///
/// Rotates the cross-signing keys. Requires UIAA (password) on most servers.
/// Returns `Err("UIAA_REQUIRED")` when the server needs a password but none was
/// supplied — the frontend should prompt the user and retry with a password.
/// OIDC-based UIAA is not supported and returns an error.
pub async fn reset_cross_signing(client: &Client, password: Option<String>) -> Result<(), String> {
    use matrix_sdk::encryption::CrossSigningResetAuthType;

    let Some(handle) = client
        .encryption()
        .reset_cross_signing()
        .await
        .map_err(|e| format!("Failed to start cross-signing reset: {e}"))?
    else {
        return Ok(());
    };

    match handle.auth_type() {
        CrossSigningResetAuthType::Uiaa(uiaa_info) => {
            let Some(pwd) = password else {
                return Err("UIAA_REQUIRED".to_string());
            };
            let user_id = client.user_id().ok_or("Not logged in")?;
            let mut pw = uiaa::Password::new(
                uiaa::UserIdentifier::UserIdOrLocalpart(user_id.localpart().to_owned()),
                pwd,
            );
            pw.session = uiaa_info.session.clone();
            handle
                .auth(Some(uiaa::AuthData::Password(pw)))
                .await
                .map_err(|e| format!("Failed to reset cross-signing: {e}"))?;
        }
        CrossSigningResetAuthType::Oidc(_) => {
            return Err(
                "Cross-signing reset via OIDC is not supported in this client".to_string(),
            );
        }
    }

    Ok(())
}

/// Bootstrap cross-signing keys.
///
/// First attempts without authentication. If the server requires UIAA and a
/// password is provided, retries automatically with password auth.
///
/// Returns `Err("UIAA_REQUIRED")` when the server needs a password but none
/// was supplied — the frontend should prompt the user and retry.
pub async fn bootstrap_cross_signing(
    client: &Client,
    password: Option<String>,
) -> Result<(), String> {
    let encryption = client.encryption();

    // First try without auth — works on servers that don't require UIAA.
    match encryption.bootstrap_cross_signing(None).await {
        Ok(()) => {
            info!("Cross-signing bootstrapped (no auth required)");
            return Ok(());
        }
        Err(e) => {
            let Some(uiaa_info) = e.as_uiaa_response() else {
                return Err(format!("Failed to bootstrap cross-signing: {e}"));
            };

            // Server requires UIAA.
            let Some(pwd) = password else {
                return Err("UIAA_REQUIRED".to_string());
            };

            let user_id = client.user_id().ok_or("Not logged in")?;
            let mut pw = uiaa::Password::new(
                uiaa::UserIdentifier::UserIdOrLocalpart(user_id.localpart().to_owned()),
                pwd,
            );
            pw.session = uiaa_info.session.clone();

            encryption
                .bootstrap_cross_signing(Some(uiaa::AuthData::Password(pw)))
                .await
                .map_err(|e2| format!("Failed to bootstrap cross-signing (with auth): {e2}"))?;

            info!("Cross-signing bootstrapped (password auth)");
            Ok(())
        }
    }
}
