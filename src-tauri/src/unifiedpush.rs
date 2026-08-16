//! UnifiedPush transport (Android).
//!
//! UnifiedPush separates *who wakes the device* from *what protocol the sender
//! speaks*. The user installs a distributor (ntfy, Conversations, …) which hands
//! Quark an endpoint URL; a **gateway** then translates the homeserver's Matrix
//! push request into a POST to that endpoint. The gateway holds no secrets and
//! sees only what `event_id_only` allows, which is why a public one can exist at
//! all — but a user running their own distributor usually has their own gateway
//! too, and finding it is what keeps their metadata on their own hardware.

// ─── Gateway discovery ───────────────────────────────────────────────────────

/// The gateway of last resort, run by the UnifiedPush project. Used when the
/// endpoint's own host has told us it does not translate Matrix.
pub const PUBLIC_GATEWAY: &str = "https://matrix.gateway.unifiedpush.org/_matrix/push/v1/notify";

/// The path both the discovery probe and the pusher registration use. The
/// homeserver rejects a pusher whose URL does not end in it.
const NOTIFY_PATH: &str = "/_matrix/push/v1/notify";

/// The gateway URL to probe for a given distributor endpoint.
///
/// Only the origin of the endpoint carries over. The rest is a per-subscription
/// path and query — a topic id, often an auth token — which identifies *this
/// device's mailbox*, not the server's capabilities, and must not be pasted in
/// front of a Matrix path.
pub fn gateway_url_for(endpoint: &str) -> Result<String, String> {
    let url = endpoint
        .parse::<url::Url>()
        .map_err(|e| format!("Distributor endpoint is not a URL: {e}"))?;
    let host = url.host_str().ok_or("Distributor endpoint has no host")?;
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Ok(format!("{}://{host}{port}{NOTIFY_PATH}", url.scheme()))
}

/// What the endpoint's host said when asked whether it speaks Matrix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeOutcome {
    /// It answered with the UnifiedPush Matrix gateway advertisement.
    AdvertisesMatrix,
    /// It answered, but not as a Matrix gateway.
    NotAGateway,
    /// It served the request and definitively said there is nothing here.
    Declined,
    /// It could not be asked, or could not answer right now.
    Unreachable,
}

/// Read a probe response.
///
/// The split that matters is between a host that *answered* "no gateway here"
/// and one that could not answer at all — they lead to opposite decisions in
/// [`gateway_from_probe`], and a 5xx is the second kind however final it looks.
pub fn classify_probe(status: u16, body: &str) -> ProbeOutcome {
    match status {
        200 => {
            let advertises = serde_json::from_str::<serde_json::Value>(body)
                .ok()
                .and_then(|v| {
                    v.get("unifiedpush")?
                        .get("gateway")?
                        .as_str()
                        .map(|g| g == "matrix")
                })
                .unwrap_or(false);
            if advertises { ProbeOutcome::AdvertisesMatrix } else { ProbeOutcome::NotAGateway }
        }
        401 | 403 | 404 | 405 | 406 => ProbeOutcome::Declined,
        _ => ProbeOutcome::Unreachable,
    }
}

/// Pick the gateway to register, given what the probe found.
///
/// A refusal is trustworthy, so it earns the public fallback — that is how a
/// plain ntfy.sh user gets working push with no configuration.
///
/// A *failure to answer* is not trustworthy, and the two wrong answers are not
/// symmetric. Falling back would route this user's room and event ids through a
/// third party silently and durably: the choice is persisted and never revisited
/// unless the endpoint changes. Keeping their own host risks the opposite error
/// — no notifications — which Settings shows and the user can act on. Between a
/// silent privacy downgrade and a visible outage, prefer the visible one.
pub fn gateway_from_probe(candidate: &str, outcome: ProbeOutcome) -> String {
    match outcome {
        ProbeOutcome::AdvertisesMatrix | ProbeOutcome::Unreachable => candidate.to_owned(),
        ProbeOutcome::NotAGateway | ProbeOutcome::Declined => PUBLIC_GATEWAY.to_owned(),
    }
}

// ─── Probing the endpoint's host ─────────────────────────────────────────────

/// Ask the endpoint's host whether it translates Matrix, and pick a gateway.
///
/// Never fails: an endpoint we cannot even parse falls back to the public
/// gateway, which is the one thing guaranteed to work with any endpoint.
pub async fn discover_gateway(endpoint: &str) -> String {
    let Ok(candidate) = gateway_url_for(endpoint) else {
        tracing::warn!("Endpoint {endpoint} is not a URL; using the public gateway");
        return PUBLIC_GATEWAY.to_owned();
    };

    // Short: this runs while the user waits for push to turn on, and an
    // unreachable host keeps their own gateway anyway.
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            tracing::warn!("Could not build the discovery client: {e}");
            return gateway_from_probe(&candidate, ProbeOutcome::Unreachable);
        }
    };

    let outcome = match client.get(&candidate).send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            classify_probe(status, &body)
        }
        Err(e) => {
            tracing::warn!("Gateway discovery for {candidate} failed: {e}");
            ProbeOutcome::Unreachable
        }
    };
    let gateway = gateway_from_probe(&candidate, outcome);
    tracing::info!("Gateway discovery: {outcome:?} → {gateway}");
    gateway
}

// ─── The Kotlin plugin (Activity-bound half) ─────────────────────────────────

/// What the distributor side of things looks like right now.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributorStatus {
    /// Every UnifiedPush distributor installed on the device.
    pub distributors: Vec<String>,
    /// The one we are registered with. Empty when none is chosen yet.
    pub saved: String,
}

#[cfg(target_os = "android")]
mod android {
    use tauri::{
        plugin::{Builder, PluginHandle, TauriPlugin},
        AppHandle, Manager, Runtime, Wry,
    };

    pub struct UnifiedPushHandle(PluginHandle<Wry>);

    #[derive(serde::Deserialize)]
    pub struct Registered {
        pub registered: bool,
    }

    pub fn init() -> TauriPlugin<Wry> {
        Builder::<Wry>::new("quark-unifiedpush")
            .setup(|app, api| {
                let handle = api.register_android_plugin("tel.quark.app", "UnifiedPushPlugin")?;
                app.manage(UnifiedPushHandle(handle));
                Ok(())
            })
            .build()
    }

    fn handle<R: Runtime>(app: &AppHandle<R>) -> Option<&UnifiedPushHandle> {
        app.try_state::<UnifiedPushHandle>().map(|s| s.inner())
    }

    pub fn status(app: &AppHandle<Wry>) -> Option<super::DistributorStatus> {
        handle(app)?
            .0
            .run_mobile_plugin::<super::DistributorStatus>("status", ())
            .ok()
    }

    pub fn register(app: &AppHandle<Wry>) -> Result<bool, String> {
        handle(app)
            .ok_or("UnifiedPush plugin not registered")?
            .0
            .run_mobile_plugin::<Registered>("register", ())
            .map(|r| r.registered)
            .map_err(|e| e.to_string())
    }

    pub fn unregister(app: &AppHandle<Wry>) -> Result<(), String> {
        handle(app)
            .ok_or("UnifiedPush plugin not registered")?
            .0
            .run_mobile_plugin::<()>("unregister", ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "android")]
pub use android::init;

/// Transport state for the Settings snapshot.
///
/// `available` is "at least one distributor is installed" rather than "one is
/// chosen": a user who installed ntfy but has not registered yet is a step
/// further along than one who has installed nothing, and Settings tells them
/// different things.
pub fn transport_status(app: &tauri::AppHandle) -> crate::push::TransportStatus {
    #[cfg(target_os = "android")]
    {
        let status = android::status(app).unwrap_or_default();
        crate::push::TransportStatus {
            available: !status.distributors.is_empty(),
            distributor: Some(status.saved).filter(|s| !s.is_empty()),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        crate::push::TransportStatus::default()
    }
}

/// Ask a distributor to start pushing to us.
///
/// `Ok(false)` means no distributor could be chosen — almost always because
/// none is installed. That is a state Settings has to explain, not an error.
pub fn subscribe(app: &tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        android::register(app)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(false)
    }
}

/// Tell the distributor to stop. The homeserver-side pusher is removed
/// separately — see [`on_unregistered`].
pub fn unsubscribe(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android::unregister(app)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

// ─── Reacting to the distributor ─────────────────────────────────────────────

/// The distributor handed us an endpoint. Record it, and register it with the
/// homeserver if we can reach one.
///
/// Storing comes first and unconditionally, so an address survives even when
/// registration fails — the next launch retries from what is on disk instead of
/// waiting for the distributor to volunteer the endpoint again.
///
/// An unchanged endpoint stops here. Distributors re-announce on every app
/// start, and turning that into a pusher round-trip per launch is exactly the
/// kind of chatter this app has hurt its homeserver with before.
pub async fn on_new_endpoint(data_dir: &std::path::Path, endpoint: &str) -> Result<(), String> {
    if !crate::push::store_endpoint(data_dir, endpoint)? {
        tracing::debug!("Distributor re-announced the endpoint we already had");
        return Ok(());
    }
    register_stored_endpoint(data_dir).await
}

/// Register whatever endpoint is on disk with the homeserver.
///
/// Safe to call whenever a session appears — `push::register` returns without a
/// round-trip when push is off or the address is already registered.
pub async fn register_stored_endpoint(data_dir: &std::path::Path) -> Result<(), String> {
    let state = crate::push::load_push_state(data_dir);
    let Some(endpoint) = state.and_then(|s| s.endpoint) else {
        return Ok(()); // No distributor has given us an address yet.
    };
    let config = crate::notifications::load_notification_config_from(data_dir);
    if !config.push_enabled {
        return Ok(());
    }

    let client = crate::push_wake::background_client(data_dir).await?;
    let gateway = discover_gateway(&endpoint).await;
    crate::push::register(
        &client,
        data_dir,
        &config,
        crate::push::PushTransport::UnifiedPush,
        endpoint,
        gateway,
        device_display_name(),
    )
    .await
    .map(|_| ())
}

/// The distributor revoked our registration. Drop the address and the pusher
/// that pointed at it — leaving the pusher would have the homeserver waking a
/// gateway that no longer knows this device.
pub async fn on_unregistered(data_dir: &std::path::Path) -> Result<(), String> {
    crate::push::forget_endpoint(data_dir)?;
    match crate::push_wake::background_client(data_dir).await {
        Ok(client) => crate::push::unregister(&client, data_dir).await,
        // No session to delete it with; the delete is owed and retried on the
        // next authenticated start.
        Err(e) => {
            tracing::warn!("Deferring pusher removal after unregistration: {e}");
            crate::push::defer_unregister(data_dir)
        }
    }
}

/// Label for this device in the user's pusher list on other clients.
fn device_display_name() -> String {
    "Quark (Android)".to_owned()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod gateway_tests {
    use super::*;

    #[test]
    fn probes_the_endpoints_origin_not_its_path() {
        // The endpoint is a per-subscription URL with a topic and often a token
        // in it. Discovery asks the *host* whether it speaks Matrix, so
        // everything after the origin has to go — including the query, which
        // can carry an auth secret we must not append a Matrix path onto.
        assert_eq!(
            gateway_url_for("https://ntfy.example.org/UPxyzabc?auth=s3cret").unwrap(),
            "https://ntfy.example.org/_matrix/push/v1/notify"
        );
    }

    #[test]
    fn keeps_a_non_default_port() {
        assert_eq!(
            gateway_url_for("https://push.example.org:8443/UPxyz").unwrap(),
            "https://push.example.org:8443/_matrix/push/v1/notify"
        );
    }

    #[test]
    fn rejects_an_endpoint_that_is_not_a_url() {
        assert!(gateway_url_for("not a url").is_err());
        assert!(gateway_url_for("").is_err());
    }

    #[test]
    fn a_matrix_advertisement_is_a_gateway() {
        assert_eq!(
            classify_probe(200, r#"{"unifiedpush":{"gateway":"matrix"}}"#),
            ProbeOutcome::AdvertisesMatrix
        );
    }

    #[test]
    fn a_two_hundred_that_is_not_an_advertisement_is_not_a_gateway() {
        // A catch-all route or a captive portal answers 200 with anything.
        assert_eq!(classify_probe(200, "<html>hello</html>"), ProbeOutcome::NotAGateway);
        assert_eq!(classify_probe(200, r#"{"unifiedpush":{"gateway":"other"}}"#), ProbeOutcome::NotAGateway);
        assert_eq!(classify_probe(200, "{}"), ProbeOutcome::NotAGateway);
    }

    #[test]
    fn the_statuses_that_mean_no_gateway_here_are_declined() {
        // A definitive answer from a live host: it served the request and said
        // no. ntfy.sh answers 404 here, which is how the public distributor
        // ends up on the public gateway.
        for status in [401, 403, 404, 405, 406] {
            assert_eq!(classify_probe(status, ""), ProbeOutcome::Declined, "status {status}");
        }
    }

    #[test]
    fn a_server_error_is_transient_not_a_refusal() {
        // 5xx says the host is having a bad day, not that it lacks a gateway.
        assert_eq!(classify_probe(500, ""), ProbeOutcome::Unreachable);
        assert_eq!(classify_probe(502, ""), ProbeOutcome::Unreachable);
        assert_eq!(classify_probe(429, ""), ProbeOutcome::Unreachable);
    }

    #[test]
    fn a_host_that_advertises_matrix_keeps_the_users_own_gateway() {
        let candidate = "https://ntfy.example.org/_matrix/push/v1/notify";
        assert_eq!(
            gateway_from_probe(candidate, ProbeOutcome::AdvertisesMatrix),
            candidate
        );
    }

    #[test]
    fn a_declining_host_falls_back_to_the_public_gateway() {
        let candidate = "https://ntfy.sh/_matrix/push/v1/notify";
        assert_eq!(gateway_from_probe(candidate, ProbeOutcome::Declined), PUBLIC_GATEWAY);
        assert_eq!(gateway_from_probe(candidate, ProbeOutcome::NotAGateway), PUBLIC_GATEWAY);
    }

    #[test]
    fn a_transient_failure_does_not_reroute_a_self_hoster_through_a_third_party() {
        // The whole point of discovery. Falling back here would hand room and
        // event ids to the public gateway *silently and persistently* — it is
        // written to push.json and never revisited unless the endpoint changes.
        // Keeping the candidate risks visible silence instead, which the user
        // can see in Settings and fix; a silent privacy downgrade they cannot.
        let candidate = "https://ntfy.example.org/_matrix/push/v1/notify";
        assert_eq!(
            gateway_from_probe(candidate, ProbeOutcome::Unreachable),
            candidate
        );
    }

    #[test]
    fn the_public_gateway_is_a_matrix_push_endpoint() {
        // The homeserver rejects a pusher whose URL doesn't end in the notify
        // path, so a typo here breaks registration for every fallback user.
        assert!(PUBLIC_GATEWAY.ends_with("/_matrix/push/v1/notify"));
    }
}
