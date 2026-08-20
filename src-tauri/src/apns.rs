//! iOS push transport: APNs by way of our own Sygnal.
//!
//! The mirror of `unifiedpush.rs`, and deliberately smaller. Android has to find
//! a distributor and then discover which gateway that distributor speaks for;
//! iOS has neither choice to make. The OS is the transport, and the only gateway
//! that can sign a push for `tel.quark.app` is the one holding the APNs key for
//! it — so both are constants here.
//!
//! Compiled on every platform for the reason `push_jni.rs` gives for the JNI
//! entry points, only more so: CI type-checks Linux, the Android APK is built at
//! release-tag time, and iOS is not in CI at all. An `#[cfg(target_os = "ios")]`
//! on this module would mean a rename in `push.rs` first breaks on someone's
//! Mac, weeks after the commit that broke it. Nothing here registers anything on
//! its own — the call sites in `commands.rs` and `main.mm` are what stay gated.

/// Our Sygnal. Fixed, because only the holder of the APNs key for this bundle
/// id can push to it; there is no third-party equivalent to discover, and no
/// `push_gateway_override` case worth honouring — a user pointing this at their
/// own gateway would need our APNs key to go with it.
pub const GATEWAY: &str = "https://push.quark.tel/_matrix/push/v1/notify";

/// Sandbox and production APNs are separate endpoints, and a token minted by one
/// is rejected by the other. Xcode builds get sandbox tokens; TestFlight and the
/// App Store get production ones. The `app_id` this picks is a key in Sygnal's
/// config, so the two halves have to be chosen by the same switch — hence
/// `debug_assertions` rather than anything the user or the config file can set.
pub fn transport_for_build(debug: bool) -> crate::push::PushTransport {
    crate::push::PushTransport::Apns { sandbox: debug }
}

/// Label for this device in the user's pusher list on other clients.
fn device_display_name() -> String {
    "Quark (iOS)".to_owned()
}

// ─── The token that arrives before there is anywhere to put it ───────────────

/// A device token the OS issued before app setup finished.
///
/// The delegate callback fires whenever apsd answers, which is not ordered
/// against Tauri's `setup()` — and `Paths` only exists after it. APNs does not
/// re-issue a token on request, so a callback that lands in that window and is
/// merely logged leaves push dead until the next launch, silently. Parking it
/// here costs a `Mutex<Option<String>>` and closes that window: the next caller
/// with a config dir in hand drains it.
static PENDING_TOKEN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn stash_token(token: &str) {
    if let Ok(mut slot) = PENDING_TOKEN.lock() {
        *slot = Some(token.to_owned());
    }
}

fn take_stashed_token() -> Option<String> {
    PENDING_TOKEN.lock().ok().and_then(|mut slot| slot.take())
}

// ─── Reacting to the OS ──────────────────────────────────────────────────────

/// The OS handed us a device token. Record it, and register it with the
/// homeserver if we can reach one.
///
/// Storing comes first and unconditionally, so the token survives a failed
/// registration — the next launch retries from what is on disk. Tokens rotate on
/// reinstall, on restore from backup, and at Apple's discretion, but they are
/// re-issued unchanged on every ordinary launch, and `store_endpoint` reporting
/// "already knew" is what stops that becoming a pusher round-trip per launch.
pub async fn on_new_token(data_dir: &std::path::Path, token_base64: &str) -> Result<(), String> {
    if !crate::push::store_endpoint(data_dir, token_base64)? {
        tracing::debug!("APNs re-issued the token we already had");
        return Ok(());
    }
    register_stored_token(data_dir).await
}

/// Register whatever token is on disk with the homeserver.
///
/// Safe to call whenever a session appears — `push::register` returns without a
/// round-trip when push is off or the address is already registered.
pub async fn register_stored_token(data_dir: &std::path::Path) -> Result<(), String> {
    // Fold in a token that arrived before there was a config dir to write it to.
    // This is the first moment one exists, and the only place that window is
    // recovered from.
    if let Some(token) = take_stashed_token() {
        crate::push::store_endpoint(data_dir, &token)?;
    }

    let Some(token) = crate::push::load_push_state(data_dir).and_then(|state| state.endpoint) else {
        return Ok(()); // The OS has not issued a token yet.
    };
    let config = crate::notifications::load_notification_config_from(data_dir);
    if !config.push_enabled {
        return Ok(());
    }

    let client = crate::push_wake::background_client(data_dir).await?;
    crate::push::register(
        &client,
        data_dir,
        &config,
        transport_for_build(cfg!(debug_assertions)),
        token,
        GATEWAY.to_owned(),
        device_display_name(),
    )
    .await
    .map(|_| ())
}

/// APNs refused to issue a token. Nothing to retry here — the OS decides when to
/// try again — so this only records why push is not working.
pub fn on_registration_failed(reason: &str) {
    tracing::warn!("APNs registration failed: {reason}");
}

// ─── FFI: the app delegate calls in ──────────────────────────────────────────

/// Called from the app delegate when APNs issues a device token.
///
/// `#[no_mangle] extern "C"` rather than a Tauri command because the delegate
/// callback is not reached through the webview and has no `AppHandle` of its
/// own. Unlike Android's push receiver this is *not* a cold path — it runs
/// inside the live app — so the config dir comes from managed state rather than
/// being handed in the way `push_jni.rs` is handed one by Kotlin.
///
/// # Safety
/// `token` must be null or a valid NUL-terminated C string that outlives this
/// call.
#[no_mangle]
pub unsafe extern "C" fn quark_apns_token(token: *const std::os::raw::c_char) {
    if token.is_null() {
        tracing::warn!("APNs handed us a null device token");
        return;
    }
    let Ok(token) = std::ffi::CStr::from_ptr(token).to_str() else {
        tracing::warn!("APNs device token was not valid UTF-8");
        return;
    };
    let token = token.to_owned();
    stash_token(&token);

    use tauri::Manager;
    let Some(app) = crate::push_wake::app_handle() else {
        // Stashed above; `settle_pending_pushers` picks it up once a session
        // exists. Not an error — just an ordering the OS does not promise.
        tracing::info!("APNs token arrived before setup; holding it until a session appears");
        return;
    };
    let Some(paths) = app.try_state::<crate::Paths>() else {
        tracing::info!("APNs token arrived before paths were resolved; holding it");
        return;
    };
    let config_dir = paths.config_dir.clone();

    // Detached: the delegate callback must return promptly, and nothing on
    // screen depends on the outcome.
    tauri::async_runtime::spawn(async move {
        if let Err(e) = on_new_token(&config_dir, &token).await {
            tracing::warn!("Could not register the APNs token: {e}");
        }
    });
}

// ─── Clearing delivered notifications ────────────────────────────────────────

/// Removes a room's delivered notifications by thread id. Implemented in
/// `main.mm`; handed in as a pointer for the same reason the app-group calls
/// are — Rust naming an ObjC symbol fails the cdylib link.
type RoomCleaner = unsafe extern "C" fn(*const std::os::raw::c_char);

static ROOM_CLEANER: std::sync::OnceLock<RoomCleaner> = std::sync::OnceLock::new();

/// Called once from `main()`, before Tauri starts.
///
/// # Safety
/// `clear_room` must stay valid for the life of the process.
#[no_mangle]
pub unsafe extern "C" fn quark_register_notification_cleaner(clear_room: Option<RoomCleaner>) {
    if let Some(clear_room) = clear_room {
        let _ = ROOM_CLEANER.set(clear_room);
    }
}

/// Dismiss every pushed notification for a room.
///
/// The NSE stamps `threadIdentifier = room id` on everything it renders, and
/// that is the only handle the app has on them — their request identifiers
/// were assigned by the system in a process that was never ours, so the
/// registry-based removal cannot reach them. Fire-and-forget: the native side
/// enumerates and removes asynchronously.
pub fn cancel_room_notifications(room_id: &str) {
    let Some(clear) = ROOM_CLEANER.get() else {
        return; // Not on iOS, or main() has not registered yet.
    };
    let Ok(c_room) = std::ffi::CString::new(room_id) else {
        return;
    };
    // SAFETY: the pointer came from main() where it names a function in this
    // binary, and c_room outlives the call — the ObjC side copies the string
    // before returning.
    unsafe { clear(c_room.as_ptr()) };
}

/// Event telling a live webview a notification tap just landed, so it can
/// consume the pending-action file without waiting for the next boot.
pub const EVENT_NOTIFICATION_TAP: &str = "quark://notification/tap";

/// The user tapped a pushed notification. Route them to its room.
///
/// Reuses Android's whole delivery pipeline from the file down: the tap is
/// written as a `PendingNotificationAction` — the same JSON MainActivity
/// mirrors on Android — and the frontend replays it through
/// `take_pending_notification_action` exactly as it replays a cold Android
/// tap. The file is written even when the webview is alive, because the event
/// only *announces* it; a webview mid-construction misses the event and still
/// finds the file at boot. The frontend's existing take-once semantics are
/// what prevent the double-route.
///
/// # Safety
/// `room_id` must be null or a valid NUL-terminated C string.
#[no_mangle]
pub unsafe extern "C" fn quark_notification_tapped(room_id: *const std::os::raw::c_char) {
    if room_id.is_null() {
        return;
    }
    let Ok(room_id) = std::ffi::CStr::from_ptr(room_id).to_str() else {
        return;
    };
    let room_id = room_id.to_owned();

    use tauri::Manager;
    let Some(app) = crate::push_wake::app_handle() else {
        // A tap always runs the full app, so this means the observer fired
        // before Tauri finished setting up — nowhere to resolve a data dir
        // from yet. Rare enough to log rather than buffer.
        tracing::warn!("Notification tap for {room_id} arrived before setup; dropped");
        return;
    };
    let Ok(data_dir) = app.path().app_data_dir() else {
        tracing::warn!("Notification tap for {room_id}: no data dir to record it in");
        return;
    };

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let action = crate::notify::PendingNotificationAction {
        ts,
        action_id: Some("tap".to_owned()),
        input_value: None,
        notification: Some(serde_json::json!({ "extra": { "room_id": room_id } })),
    };
    match serde_json::to_string(&action) {
        Ok(json) => {
            if let Err(e) =
                std::fs::write(data_dir.join(crate::notify::PENDING_ACTION_FILENAME), json)
            {
                tracing::warn!("Could not record the notification tap: {e}");
            }
        }
        Err(e) => tracing::warn!("Could not serialise the notification tap: {e}"),
    }

    use tauri::Emitter;
    if let Err(e) = app.emit(EVENT_NOTIFICATION_TAP, ()) {
        tracing::debug!("No webview heard the notification tap ({e}); the file replay will");
    }
}

/// Called from the app delegate when APNs declines to issue a token.
///
/// # Safety
/// `reason` must be null or a valid NUL-terminated C string.
#[no_mangle]
pub unsafe extern "C" fn quark_apns_failed(reason: *const std::os::raw::c_char) {
    let reason = if reason.is_null() {
        "unknown".to_owned()
    } else {
        std::ffi::CStr::from_ptr(reason).to_string_lossy().into_owned()
    };
    on_registration_failed(&reason);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The sandbox flag picks the `app_id`, and Sygnal keys its config by that
    /// exact string. A debug build registering `.ios.prod` is rejected at APNs
    /// with no error the device ever sees.
    #[test]
    fn debug_builds_register_against_the_sandbox() {
        assert_eq!(
            transport_for_build(true),
            crate::push::PushTransport::Apns { sandbox: true }
        );
        assert_eq!(
            transport_for_build(false),
            crate::push::PushTransport::Apns { sandbox: false }
        );
    }

    /// The two halves of the environment choice have to move together: the
    /// entitlement (`aps-environment` in `project.yml`) and the `app_id` this
    /// selects. Pinning the strings here is what makes a rename of either show
    /// up as a test failure rather than as pushes that stop arriving.
    #[test]
    fn the_sandbox_flag_names_sygnals_two_config_keys() {
        assert_eq!(transport_for_build(true).app_id(), "tel.quark.app.ios.dev");
        assert_eq!(transport_for_build(false).app_id(), "tel.quark.app.ios.prod");
    }

    /// Unlike UnifiedPush there is nothing to discover: the only gateway that
    /// can sign for `tel.quark.app` is ours.
    #[test]
    fn the_gateway_is_fixed() {
        assert!(
            GATEWAY.ends_with("/_matrix/push/v1/notify"),
            "the homeserver rejects a pusher URL with any other path"
        );
        assert_eq!(GATEWAY, "https://push.quark.tel/_matrix/push/v1/notify");
    }

    /// The window this stash exists for: a token issued before `setup()` ran.
    /// Draining it is what turns that into a delayed registration instead of a
    /// device that never registers until it is launched again.
    #[test]
    fn a_stashed_token_is_handed_over_once_and_only_once() {
        stash_token("dG9rZW4=");
        assert_eq!(take_stashed_token().as_deref(), Some("dG9rZW4="));
        assert_eq!(take_stashed_token(), None, "draining it twice would re-register");
    }
}
