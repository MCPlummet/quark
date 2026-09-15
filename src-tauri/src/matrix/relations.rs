//! Building the `m.relates_to` of an outgoing message.
//!
//! `Relation` is an enum, so "reply" and "thread" cannot both occupy the slot as
//! separate variants — a reply *inside* a thread is a `Thread` relation carrying
//! the replied-to event, not a `Reply` alongside it. Getting that wrong sends a
//! threaded reply to the main timeline, which is the shape of #78.
//!
//! Every media sender needs the same three-way decision, so it lives here once
//! rather than as a third and fourth copy of the match.

use matrix_sdk::ruma::events::{
    relation::{InReplyTo, Thread as ThreadRelation},
    room::message::Relation,
};
use matrix_sdk::ruma::OwnedEventId;

fn parse_id(id: &str, what: &str) -> Result<OwnedEventId, String> {
    OwnedEventId::try_from(id).map_err(|e| format!("Invalid {what} event ID: {e}"))
}

/// Build the relation for a message that may be a reply, may be in a thread, or
/// both.
///
/// Generic over the content type `Relation` carries for replacements: the two
/// variants built here don't use it, which is what lets stickers
/// (`StickerEventContentWithoutRelation`) and room messages
/// (`RoomMessageEventContentWithoutRelation`) share one helper.
///
/// - thread + reply → `Thread::reply`, the MSC3440 threaded reply.
/// - thread alone → `Thread::plain`, whose `is_falling_back` reply pointer is
///   what non-threaded clients render.
/// - reply alone → `Relation::Reply`.
/// - neither → `None`.
pub fn build_relation<C>(
    thread_root: Option<&str>,
    in_reply_to: Option<&str>,
) -> Result<Option<Relation<C>>, String> {
    let reply_id = in_reply_to.map(|id| parse_id(id, "reply")).transpose()?;

    let Some(root) = thread_root else {
        return Ok(reply_id.map(|id| Relation::Reply { in_reply_to: InReplyTo::new(id) }));
    };

    let root_id = parse_id(root, "thread root")?;
    Ok(Some(Relation::Thread(match reply_id {
        Some(id) => ThreadRelation::reply(root_id, id),
        None => ThreadRelation::plain(root_id.clone(), root_id),
    })))
}

/// Where an outgoing message is going: which thread, and what it replies to.
///
/// Both are optional and both must travel together to build one correct
/// relation, so they move as a pair. Four senders needed the same two arguments;
/// as positional `Option<&str>`s that is eight call-site slots to get the order
/// right in, and the media senders had zero of them before #78.
#[derive(Debug, Clone, Copy, Default)]
pub struct SendTarget<'a> {
    /// Root event of the thread this belongs to, if a thread is open.
    pub thread_root: Option<&'a str>,
    /// Event being replied to, if a reply is armed.
    pub in_reply_to: Option<&'a str>,
}

impl<'a> SendTarget<'a> {
    /// The main timeline, no reply.
    pub fn none() -> Self {
        Self::default()
    }

    /// Build this target's `m.relates_to`. See [`build_relation`].
    pub fn relation<C>(&self) -> Result<Option<Relation<C>>, String> {
        build_relation(self.thread_root, self.in_reply_to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use matrix_sdk::ruma::events::room::message::RoomMessageEventContentWithoutRelation;

    type Rel = Option<Relation<RoomMessageEventContentWithoutRelation>>;

    const ROOT: &str = "$root:example.org";
    const REPLIED: &str = "$replied:example.org";

    fn build(thread: Option<&str>, reply: Option<&str>) -> Rel {
        build_relation(thread, reply).expect("valid ids")
    }

    #[test]
    fn no_relation_when_neither_is_armed() {
        assert!(build(None, None).is_none());
    }

    #[test]
    fn reply_alone_is_a_plain_reply() {
        match build(None, Some(REPLIED)) {
            Some(Relation::Reply { in_reply_to }) => {
                assert_eq!(in_reply_to.event_id, REPLIED);
            }
            other => panic!("expected a reply relation, got {other:?}"),
        }
    }

    // The #78 case: an attachment sent with a thread open must carry the thread
    // relation, or it lands in the main timeline.
    #[test]
    fn thread_alone_falls_back_to_the_root() {
        match build(Some(ROOT), None) {
            Some(Relation::Thread(t)) => {
                assert_eq!(t.event_id, ROOT);
                assert!(t.is_falling_back, "non-reply thread events carry the fallback pointer");
                assert_eq!(t.in_reply_to.expect("fallback pointer").event_id, ROOT);
            }
            other => panic!("expected a thread relation, got {other:?}"),
        }
    }

    // Both armed: one Thread relation pointing at the replied-to event, *not* a
    // Reply — the enum has room for only one, and dropping the thread is the bug.
    #[test]
    fn thread_and_reply_become_one_threaded_reply() {
        match build(Some(ROOT), Some(REPLIED)) {
            Some(Relation::Thread(t)) => {
                assert_eq!(t.event_id, ROOT);
                assert!(!t.is_falling_back, "a real reply is not a fallback pointer");
                assert_eq!(t.in_reply_to.expect("reply pointer").event_id, REPLIED);
            }
            other => panic!("expected a threaded reply, got {other:?}"),
        }
    }

    #[test]
    fn send_target_defaults_to_the_main_timeline() {
        let rel: Rel = SendTarget::none().relation().expect("no ids to parse");
        assert!(rel.is_none());
    }

    #[test]
    fn send_target_carries_both_halves_through() {
        let target = SendTarget { thread_root: Some(ROOT), in_reply_to: Some(REPLIED) };
        match target.relation::<RoomMessageEventContentWithoutRelation>().expect("valid ids") {
            Some(Relation::Thread(t)) => assert_eq!(t.event_id, ROOT),
            other => panic!("expected a threaded reply, got {other:?}"),
        }
    }

    #[test]
    fn malformed_ids_are_reported_rather_than_dropped() {
        let bad_reply: Result<Rel, _> = build_relation(None, Some("not-an-event-id"));
        assert!(bad_reply.unwrap_err().contains("reply"));

        let bad_root: Result<Rel, _> = build_relation(Some("not-an-event-id"), None);
        assert!(bad_root.unwrap_err().contains("thread root"));
    }
}
