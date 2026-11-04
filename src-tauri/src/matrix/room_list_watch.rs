//! Deciding when a sync response changes what the room list shows.
//!
//! The frontend's room list, space strip and invite count are all built from a
//! `get_rooms` / `get_invites` / space-children read, and it re-reads them on
//! `quark://sync/rooms`. For a long time nothing emitted that event — the only
//! refreshes came from reconnecting and from room keys arriving — so a room
//! joined, left or renamed from another client did not appear here until the
//! app was restarted, and an invite never appeared at all.
//!
//! The sync loop runs [`room_list_changed`] on every response, after the SDK
//! has already folded it into the store, and emits the event when it says so.
//! It is deliberately a cheap, conservative test over the raw events rather
//! than a diff of the room list: a false positive costs one debounced refresh,
//! a false negative is the bug this module exists to fix.

use matrix_sdk::ruma::serde::Raw;
use matrix_sdk::sync::SyncResponse;
use serde::Deserialize;

/// State event types whose change alters a room's row, its place in a space,
/// or whether it is listed at all.
///
/// `m.room.member` is handled separately: only the account's *own* membership
/// moves a room in or out of the list, and every other member event (which is
/// most state traffic in a busy room) must not trigger a refresh.
const ROOM_LIST_STATE_TYPES: &[&str] = &[
    "m.room.name",
    "m.room.avatar",
    "m.room.canonical_alias",
    "m.room.topic",
    "m.room.create",
    "m.room.encryption",
    "m.room.tombstone",
    "m.space.child",
    "m.space.parent",
];

/// Global account data that re-files rooms: `m.direct` moves a room between
/// the DMs and Group Rooms pseudo-spaces, and `m.push_rules` carries the mute
/// flag the list draws.
const ROOM_LIST_ACCOUNT_DATA: &[&str] = &["m.direct", "m.push_rules"];

/// The two fields of an event this module looks at, without deserializing the
/// rest of it.
#[derive(Deserialize)]
struct EventHead {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    state_key: Option<String>,
}

/// Whether one event, given its type and state key, changes the room list.
pub fn is_room_list_event(event_type: &str, state_key: Option<&str>, own_user_id: &str) -> bool {
    if event_type == "m.room.member" {
        return state_key == Some(own_user_id);
    }
    // A message-like event never has a state key; one carrying a state-event
    // type without one is not a state change.
    state_key.is_some() && ROOM_LIST_STATE_TYPES.contains(&event_type)
}

fn raw_is_room_list_event<T>(raw: &Raw<T>, own_user_id: &str) -> bool {
    raw.deserialize_as::<EventHead>()
        .map(|head| is_room_list_event(&head.kind, head.state_key.as_deref(), own_user_id))
        .unwrap_or(false)
}

fn raw_is_room_list_account_data<T>(raw: &Raw<T>) -> bool {
    raw.get_field::<String>("type")
        .ok()
        .flatten()
        .is_some_and(|kind| ROOM_LIST_ACCOUNT_DATA.contains(&kind.as_str()))
}

/// Whether a sync response changes what the room list shows.
///
/// Any invite, leave or knock section is a membership change by definition —
/// the server only lists a room there when this account's membership in it
/// moved. Joined rooms are checked event by event: a room joined since the
/// last sync carries our own `m.room.member` join, in its state or timeline.
pub fn room_list_changed(response: &SyncResponse, own_user_id: &str) -> bool {
    let rooms = &response.rooms;
    if !rooms.invite.is_empty() || !rooms.leave.is_empty() || !rooms.knocked.is_empty() {
        return true;
    }
    if response.account_data.iter().any(raw_is_room_list_account_data) {
        return true;
    }
    rooms.join.values().any(|update| {
        update.state.iter().any(|raw| raw_is_room_list_event(raw, own_user_id))
            || update
                .timeline
                .events
                .iter()
                .any(|ev| raw_is_room_list_event(ev.raw(), own_user_id))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: &str = "@me:example.org";

    #[test]
    fn our_own_membership_changes_the_list() {
        assert!(is_room_list_event("m.room.member", Some(ME), ME));
    }

    #[test]
    fn someone_elses_membership_does_not() {
        // Most state traffic in a busy room is other people joining and
        // leaving; refreshing the whole list for each would be a storm.
        assert!(!is_room_list_event("m.room.member", Some("@them:example.org"), ME));
    }

    #[test]
    fn a_rename_or_a_space_edit_changes_the_list() {
        for kind in ["m.room.name", "m.space.child", "m.space.parent", "m.room.avatar"] {
            assert!(is_room_list_event(kind, Some(""), ME), "{kind}");
        }
        // m.space.child is keyed by the child's room ID, not the empty string.
        assert!(is_room_list_event("m.space.child", Some("!child:example.org"), ME));
    }

    #[test]
    fn messages_and_unrelated_state_do_not() {
        assert!(!is_room_list_event("m.room.message", None, ME));
        assert!(!is_room_list_event("m.reaction", None, ME));
        assert!(!is_room_list_event("m.room.power_levels", Some(""), ME));
        assert!(!is_room_list_event("m.room.pinned_events", Some(""), ME));
    }

    #[test]
    fn a_state_type_without_a_state_key_is_not_a_state_change() {
        assert!(!is_room_list_event("m.room.name", None, ME));
    }

    #[test]
    fn raw_events_are_read_by_type_and_state_key() {
        let join: Raw<serde_json::Value> = Raw::new(&serde_json::json!({
            "type": "m.room.member", "state_key": ME, "sender": ME,
            "content": { "membership": "join" },
        }))
        .unwrap();
        assert!(raw_is_room_list_event(&join, ME));

        let message: Raw<serde_json::Value> = Raw::new(&serde_json::json!({
            "type": "m.room.message", "sender": ME, "content": { "body": "hi" },
        }))
        .unwrap();
        assert!(!raw_is_room_list_event(&message, ME));

        // Garbage is not a reason to refresh, and not a reason to panic.
        let junk: Raw<serde_json::Value> = Raw::new(&serde_json::json!([1, 2])).unwrap();
        assert!(!raw_is_room_list_event(&junk, ME));
    }

    #[test]
    fn dm_and_push_rule_account_data_refile_rooms() {
        let direct: Raw<serde_json::Value> =
            Raw::new(&serde_json::json!({ "type": "m.direct", "content": {} })).unwrap();
        assert!(raw_is_room_list_account_data(&direct));
        let other: Raw<serde_json::Value> =
            Raw::new(&serde_json::json!({ "type": "im.ponies.user_emotes", "content": {} })).unwrap();
        assert!(!raw_is_room_list_account_data(&other));
    }
}
