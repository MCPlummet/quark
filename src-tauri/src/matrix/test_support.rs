//! A homeserver for tests: a `wiremock` server and a `Client` logged in to it.
//!
//! For behaviour that lives in what the SDK stores from a sync and in which
//! requests the backend then sends — neither of which a pure-function test can
//! see. Sync the state a test needs with [`TestHomeserver::sync`], mount any
//! other endpoint the code under test is meant to reach, and count the requests
//! that arrived with [`TestHomeserver::requests_to`].
//!
//! Anything left unmounted answers 404. The SDK's own background traffic (key
//! uploads after a sync, for instance) lands there harmlessly, so tests count
//! the paths they care about rather than every request.
//!
//! Space and hierarchy state is cached process-wide (`spaces::HIERARCHY_CACHE`,
//! `RECONCILED`), and tests share the process: give each test its own room IDs.

use matrix_sdk::config::SyncSettings;
use matrix_sdk::matrix_auth::{MatrixSession, MatrixSessionTokens};
use matrix_sdk::ruma::api::MatrixVersion;
use matrix_sdk::sync::SyncResponse;
use matrix_sdk::{Client, SessionMeta};
use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// The account every test client is logged in as.
pub const ME: &str = "@me:example.org";

pub struct TestHomeserver {
    pub server: MockServer,
    pub client: Client,
}

impl TestHomeserver {
    pub async fn new() -> Self {
        let server = MockServer::start().await;
        let client = Client::builder()
            .homeserver_url(server.uri())
            // Known up front, so the client never asks `/versions`.
            .server_versions([MatrixVersion::V1_1])
            .build()
            .await
            .expect("build test client");
        client
            .matrix_auth()
            .restore_session(MatrixSession {
                meta: SessionMeta {
                    user_id: ME.try_into().expect("user ID"),
                    device_id: "QUARKTEST".into(),
                },
                tokens: MatrixSessionTokens { access_token: "token".into(), refresh_token: None },
            })
            .await
            .expect("restore test session");
        Self { server, client }
    }

    /// Answer the next `/sync` with `body` and run one sync through the SDK, so
    /// its store holds what `body` describes.
    pub async fn sync(&self, body: Value) -> SyncResponse {
        let _sync = self.mount_sync(body).await;
        self.client
            .sync_once(SyncSettings::default())
            .await
            .expect("sync against the test homeserver")
    }

    /// Answer `/sync` with `body` until the guard drops — for code under test
    /// that runs its own sync.
    pub async fn mount_sync(&self, body: Value) -> wiremock::MockGuard {
        Mock::given(method("GET"))
            .and(path("/_matrix/client/v3/sync"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount_as_scoped(&self.server)
            .await
    }

    /// Answer `GET /hierarchy` for `space` with `status` and `body`.
    ///
    /// Matched by suffix: the SDK picks the stable `v1` path or MSC2946's
    /// unstable one from the server's advertised versions.
    pub async fn mount_hierarchy(&self, space: &str, status: u16, body: Value) {
        let suffix = format!("/rooms/{space}/hierarchy");
        Mock::given(method("GET"))
            .and(move |req: &wiremock::Request| req.url.path().ends_with(&suffix))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(&self.server)
            .await;
    }

    /// How many requests reached a path containing `fragment`.
    pub async fn requests_to(&self, fragment: &str) -> usize {
        self.server
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter(|r| r.url.path().contains(fragment))
            .count()
    }
}

/// A state event as a sync response carries it.
pub fn state_event(kind: &str, state_key: &str, sender: &str, content: Value) -> Value {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    json!({
        "type": kind,
        "state_key": state_key,
        "sender": sender,
        "content": content,
        "event_id": format!("$test-{n}"),
        "origin_server_ts": 1_700_000_000_000u64 + n,
    })
}

/// Our own join, which a joined room's state needs for the SDK to list it.
pub fn own_join() -> Value {
    state_event("m.room.member", ME, ME, json!({ "membership": "join" }))
}

/// A space's `m.space.child` for `child`, live (`via` set).
pub fn space_child(child: &str) -> Value {
    state_event("m.space.child", child, ME, json!({ "via": ["example.org"] }))
}

/// A `/sync` body whose `rooms.join` holds each `(room ID, state events)`.
pub fn joined_rooms(rooms: &[(&str, Vec<Value>)]) -> Value {
    let join: serde_json::Map<String, Value> = rooms
        .iter()
        .map(|(id, state)| {
            (id.to_string(), json!({ "state": { "events": state }, "timeline": { "events": [] } }))
        })
        .collect();
    json!({ "next_batch": "test-batch", "rooms": { "join": join } })
}

/// The `m.room.create` that makes a room a space.
pub fn space_create() -> Value {
    state_event("m.room.create", "", ME, json!({ "creator": ME, "type": "m.space" }))
}
