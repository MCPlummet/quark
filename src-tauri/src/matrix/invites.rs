//! Pending room invites: list, accept, decline.
//!
//! An invite is a room in `RoomState::Invited`. All we know about it is the
//! stripped state the inviting server chose to share (name, avatar, topic, join
//! rules, the inviter's member event), so every field here is optional except
//! the room ID, and nothing in this module touches the network to read one.

use matrix_sdk::{Client, RoomDisplayName, RoomState};
use matrix_sdk::ruma::RoomId;
use serde::{Deserialize, Serialize};
use tracing::info;

/// One pending invite, as the invites dialog and the status-line count see it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteInfo {
    pub room_id: String,
    /// The room's display name, when one can be computed from the stripped
    /// state. `None` rather than "Empty Room": the frontend picks a fallback
    /// that reads better for an invite (the inviter, for a DM).
    pub name: Option<String>,
    pub topic: Option<String>,
    pub avatar_url: Option<String>,
    pub canonical_alias: Option<String>,
    pub inviter_id: Option<String>,
    pub inviter_name: Option<String>,
    /// From the invite's own `is_direct` flag — the room is not in `m.direct`
    /// yet. Accepting marks it there (the SDK's `Room::join` does that).
    pub is_direct: bool,
    pub is_space: bool,
    pub is_encrypted: bool,
}

/// A computed display name, or `None` for the placeholder names the SDK makes
/// up for a room it knows nothing about.
fn real_name(name: RoomDisplayName) -> Option<String> {
    match name {
        RoomDisplayName::Named(n) | RoomDisplayName::Aliased(n) | RoomDisplayName::Calculated(n) => {
            Some(n)
        }
        RoomDisplayName::EmptyWas(_) | RoomDisplayName::Empty => None,
    }
}

/// Every room this account has been invited to and not yet answered.
pub async fn get_invites(client: &Client) -> Result<Vec<InviteInfo>, String> {
    let mut invites = Vec::new();
    for room in client.invited_rooms() {
        let details = room.invite_details().await.ok();
        let inviter = details.as_ref().and_then(|d| d.inviter.as_ref());
        let inviter_id = details
            .as_ref()
            .map(|d| d.invitee.event().sender().to_string());
        let is_direct = details
            .as_ref()
            .and_then(|d| d.invitee.event().original_content().and_then(|c| c.is_direct))
            .unwrap_or(false);

        invites.push(InviteInfo {
            room_id: room.room_id().to_string(),
            name: room.compute_display_name().await.ok().and_then(real_name),
            topic: room.topic(),
            avatar_url: room.avatar_url().map(|u| u.to_string()),
            canonical_alias: room.canonical_alias().map(|a| a.to_string()),
            inviter_name: inviter.and_then(|m| m.display_name().map(str::to_string)),
            inviter_id,
            is_direct,
            is_space: room.is_space(),
            is_encrypted: room.is_encrypted().await.unwrap_or(false),
        });
    }
    // Stable order for the dialog: the server gives no invite timestamp in
    // stripped state, so alphabetical by what the row will show.
    invites.sort_by_key(sort_key);
    Ok(invites)
}

fn sort_key(invite: &InviteInfo) -> String {
    invite
        .name
        .as_deref()
        .or(invite.inviter_name.as_deref())
        .unwrap_or(&invite.room_id)
        .to_lowercase()
}

fn invited_room(client: &Client, room_id: &str) -> Result<matrix_sdk::Room, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("No invite for {room_id}"))?;
    if room.state() != RoomState::Invited {
        return Err(format!("No pending invite for {room_id}"));
    }
    Ok(room)
}

/// Accept an invite. Returns the room ID, now joined.
pub async fn accept_invite(client: &Client, room_id: &str) -> Result<String, String> {
    let room = invited_room(client, room_id)?;
    room.join()
        .await
        .map_err(|e| format!("Failed to accept invite: {e}"))?;
    info!(room_id = %room.room_id(), "Accepted invite");
    Ok(room.room_id().to_string())
}

/// Decline an invite (leave the invited room).
pub async fn decline_invite(client: &Client, room_id: &str) -> Result<(), String> {
    let room = invited_room(client, room_id)?;
    room.leave()
        .await
        .map_err(|e| format!("Failed to decline invite: {e}"))?;
    info!(room_id = %room.room_id(), "Declined invite");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invite(name: Option<&str>, inviter: Option<&str>, id: &str) -> InviteInfo {
        InviteInfo {
            room_id: id.into(),
            name: name.map(Into::into),
            topic: None,
            avatar_url: None,
            canonical_alias: None,
            inviter_id: None,
            inviter_name: inviter.map(Into::into),
            is_direct: false,
            is_space: false,
            is_encrypted: false,
        }
    }

    #[test]
    fn placeholder_names_are_not_names() {
        assert_eq!(real_name(RoomDisplayName::Empty), None);
        assert_eq!(real_name(RoomDisplayName::EmptyWas("Alice".into())), None);
        assert_eq!(real_name(RoomDisplayName::Named("dev".into())).as_deref(), Some("dev"));
        assert_eq!(real_name(RoomDisplayName::Calculated("Bob".into())).as_deref(), Some("Bob"));
    }

    #[test]
    fn invites_sort_by_what_the_row_shows() {
        // A nameless DM invite is shown as its inviter, so it sorts as one.
        let mut v = [
            invite(Some("zeta"), None, "!z:x"),
            invite(None, Some("Alice"), "!a:x"),
            invite(Some("Beta"), None, "!b:x"),
        ];
        v.sort_by_key(sort_key);
        let ids: Vec<_> = v.iter().map(|i| i.room_id.as_str()).collect();
        assert_eq!(ids, ["!a:x", "!b:x", "!z:x"]);
    }
}
