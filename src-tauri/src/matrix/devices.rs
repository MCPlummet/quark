use matrix_sdk::Client;
use serde::{Deserialize, Serialize};

use crate::matrix::crypto;

/// Intermediate struct for account-level device data (network-fetched, no crypto store).
/// Kept separate from `SessionInfo` so `merge_sessions` is network-free and unit-testable.
#[derive(Debug, Clone)]
pub struct AccountDevice {
    pub device_id: String,
    pub display_name: Option<String>,
    pub last_seen_ts: Option<u64>,
    pub last_seen_ip: Option<String>,
}

/// Merged session info returned over IPC — matches the TS `DeviceSessionInfo` type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub device_id: String,
    pub display_name: Option<String>,
    pub last_seen_ts: Option<u64>,
    pub last_seen_ip: Option<String>,
    pub is_current: bool,
    pub is_verified: bool,
    pub is_cross_signed: bool,
    pub trust_level: String,
}

/// Pure merge: join account-level device list with crypto-store trust status.
/// Devices with no crypto-store entry default to unverified.
/// `current_device_id` is the local device ID (used to set `is_current`).
pub fn merge_sessions(
    account: Vec<AccountDevice>,
    trust: Vec<crypto::VerificationStatus>,
    current_device_id: &str,
) -> Vec<SessionInfo> {
    account
        .into_iter()
        .map(|dev| {
            let trust_entry = trust.iter().find(|t| t.device_id == dev.device_id);
            let (is_verified, is_cross_signed, trust_level) = match trust_entry {
                Some(t) => (t.is_verified, t.is_cross_signed, t.trust_level.clone()),
                None => (false, false, "unverified".to_string()),
            };
            SessionInfo {
                is_current: dev.device_id == current_device_id,
                device_id: dev.device_id,
                display_name: dev.display_name,
                last_seen_ts: dev.last_seen_ts,
                last_seen_ip: dev.last_seen_ip,
                is_verified,
                is_cross_signed,
                trust_level,
            }
        })
        .collect()
}

/// Fetch all sessions for the logged-in user, merging account device list with
/// crypto-store trust status.
pub async fn list_sessions(client: &Client) -> Result<Vec<SessionInfo>, String> {
    let user_id = client.user_id().ok_or("Not logged in")?.to_string();
    let current_device_id = client
        .device_id()
        .ok_or("No device ID")?
        .to_string();

    // Fetch account-level device list (includes last-seen IP/timestamp).
    let response = client
        .devices()
        .await
        .map_err(|e| format!("Failed to fetch devices: {e}"))?;

    let account_devices: Vec<AccountDevice> = response
        .devices
        .into_iter()
        .map(|dev| AccountDevice {
            device_id: dev.device_id.to_string(),
            display_name: dev.display_name,
            last_seen_ts: dev
                .last_seen_ts
                .map(|ts| u64::from(ts.get())),
            last_seen_ip: dev.last_seen_ip,
        })
        .collect();

    // Fetch crypto-store trust status for own user's devices.
    let trust = crypto::get_user_verification_statuses(client, &user_id).await?;

    Ok(merge_sessions(account_devices, trust, &current_device_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_marks_current_and_fills_trust() {
        let acct = vec![AccountDevice {
            device_id: "A".into(),
            display_name: Some("Phone".into()),
            last_seen_ts: Some(1),
            last_seen_ip: Some("1.2.3.4".into()),
        }];
        let trust = vec![crate::matrix::crypto::VerificationStatus {
            user_id: "@u:s".into(),
            device_id: "A".into(),
            display_name: None,
            is_verified: true,
            is_cross_signed: true,
            trust_level: "cross-signed".into(),
        }];
        let out = merge_sessions(acct, trust, "A");
        assert_eq!(out.len(), 1);
        assert!(out[0].is_current && out[0].is_cross_signed);
        assert_eq!(out[0].last_seen_ip.as_deref(), Some("1.2.3.4"));
    }

    #[test]
    fn merge_defaults_unverified_when_no_trust_entry() {
        let acct = vec![AccountDevice {
            device_id: "B".into(),
            display_name: None,
            last_seen_ts: None,
            last_seen_ip: None,
        }];
        let out = merge_sessions(acct, vec![], "A");
        assert_eq!(out[0].trust_level, "unverified");
        assert!(!out[0].is_current);
    }
}
