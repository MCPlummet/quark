//! The one place Kotlin calls Rust without Tauri in between.
//!
//! Every other Rust⇄Kotlin call in this app goes through Tauri's mobile-plugin
//! bridge, which needs an `Activity` and a running Tauri runtime. A push wakes a
//! process that has neither: `PushSyncService` starts, loads the library itself
//! and calls straight in. So this module owns the three things Tauri would
//! otherwise have provided — a log sink, an async runtime, and a panic boundary.
//!
//! Nothing above this layer knows it exists. The work is `push_wake::run_wake`,
//! which is ordinary testable Rust; this file only carries values across the
//! boundary and refuses to let a panic cross it.

//! Compiled on every platform on purpose. PR CI type-checks Linux only and the
//! Android APK is built at release-tag time, so an Android-gated JNI signature
//! would first fail weeks after it was written. Nothing here links to Android
//! libraries except the logcat sink, which is the one genuinely gated part.

use jni::objects::{JObject, JString};
use jni::sys::jstring;
use jni::JNIEnv;

/// What `nativeHandlePush` hands back. Kotlin posts `specs` and logs `error`;
/// both being empty/absent is the ordinary "nothing to show" outcome.
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct PushResult {
    specs: Vec<crate::notify::NotificationSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl PushResult {
    fn failed(error: impl Into<String>) -> Self {
        PushResult { specs: Vec::new(), error: Some(error.into()) }
    }
}

/// Handle a push delivered to a cold (or merely Tauri-less) process.
///
/// Bound to `PushNative` rather than to the service that usually calls it:
/// Android can refuse to start a foreground service from the background, and
/// the fallback path then has to make this same call from the broadcast
/// receiver. A class whose only job is the binding can be called from both.
///
/// `PushNative` is a Kotlin `object`, whose members are instance methods on the
/// singleton — so the symbol is this plain name. A `companion object` would
/// mangle it to `…_00024Companion_…` and fail at call time, not at build time.
///
/// Returns a JSON `PushResult` string. Errors travel in the payload rather than
/// as a Java exception because the caller has ~30 s to live and nothing useful
/// to do with a throwable except log it.
#[no_mangle]
pub extern "system" fn Java_tel_quark_app_PushNative_nativeHandlePush<'local>(
    mut env: JNIEnv<'local>,
    _this: JObject<'local>,
    payload: JString<'local>,
    data_dir: JString<'local>,
) -> jstring {
    init_logging();

    // A panic unwinding into the JVM is undefined behaviour, and this path runs
    // code (matrix-sdk, SQLite, TLS) far too large to audit for panics. Catch
    // it here and report it as an ordinary failure.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let payload: String = env
            .get_string(&payload)
            .map_err(|e| format!("Unreadable push payload: {e}"))?
            .into();
        let data_dir: String = env
            .get_string(&data_dir)
            .map_err(|e| format!("Unreadable data dir: {e}"))?
            .into();
        Ok::<_, String>(handle_push(&payload, std::path::Path::new(&data_dir)))
    }));

    let result = match result {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => PushResult::failed(e),
        Err(_) => PushResult::failed("Push handler panicked"),
    };

    let json = serde_json::to_string(&result).unwrap_or_else(|e| {
        format!(r#"{{"specs":[],"error":"Could not serialise the push result: {e}"}}"#)
    });
    // If even handing the string back fails there is nothing left to report to,
    // so return a null jstring and let Kotlin treat it as "no notifications".
    env.new_string(json)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

/// The distributor handed us a new endpoint (or re-announced the old one).
///
/// Separate from the message path because it is cheap and must not be skipped:
/// it records the address that everything else depends on.
#[no_mangle]
pub extern "system" fn Java_tel_quark_app_PushNative_nativeOnNewEndpoint<'local>(
    mut env: JNIEnv<'local>,
    _this: JObject<'local>,
    endpoint: JString<'local>,
    data_dir: JString<'local>,
) -> jstring {
    two_string_call(&mut env, endpoint, data_dir, |endpoint, data_dir| {
        block_on(crate::unifiedpush::on_new_endpoint(data_dir, endpoint))
    })
}

/// The distributor revoked our registration.
#[no_mangle]
pub extern "system" fn Java_tel_quark_app_PushNative_nativeOnUnregistered<'local>(
    mut env: JNIEnv<'local>,
    _this: JObject<'local>,
    data_dir: JString<'local>,
) -> jstring {
    let unused = JString::from(JObject::null());
    two_string_call(&mut env, unused, data_dir, |_, data_dir| {
        block_on(crate::unifiedpush::on_unregistered(data_dir))
    })
}

/// Shared shape for the endpoint callbacks: read two strings, run the closure,
/// hand back a `PushResult` carrying only an error (there is nothing to post).
fn two_string_call<'local>(
    env: &mut JNIEnv<'local>,
    first: JString<'local>,
    second: JString<'local>,
    work: impl FnOnce(&str, &std::path::Path) -> Result<(), String>,
) -> jstring {
    init_logging();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let first: String = if first.is_null() {
            String::new()
        } else {
            env.get_string(&first).map_err(|e| format!("Unreadable argument: {e}"))?.into()
        };
        let second: String = env
            .get_string(&second)
            .map_err(|e| format!("Unreadable data dir: {e}"))?
            .into();
        work(&first, std::path::Path::new(&second))
    }));

    let result = match outcome {
        Ok(Ok(())) => PushResult::default(),
        Ok(Err(e)) => PushResult::failed(e),
        Err(_) => PushResult::failed("Push callback panicked"),
    };
    let json = serde_json::to_string(&result)
        .unwrap_or_else(|_| r#"{"specs":[],"error":"unserialisable"}"#.to_owned());
    env.new_string(json).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
}

/// Run one future to completion on a runtime built for the purpose.
///
/// The endpoint callbacks are short — a file write and at most one HTTP
/// round-trip — so a single-threaded runtime is enough.
fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime.block_on(future),
        Err(e) => {
            // Only reachable if the OS refuses a reactor; nothing to fall back
            // to, and the caller's own timeout will notice.
            panic!("Could not start a runtime: {e}");
        }
    }
}

/// Blocking bridge into the async wake path.
///
/// Builds its own runtime because there is no guarantee one exists — and when
/// the app *is* running, this is called from a Kotlin service thread rather than
/// a tokio worker, so blocking on it is safe. Two worker threads: the work is
/// one sync, and a woken phone should not pay for a thread per core.
fn handle_push(payload: &str, data_dir: &std::path::Path) -> PushResult {
    let wake = match crate::push_wake::parse_wake(payload) {
        Ok(wake) => wake,
        Err(e) => return PushResult::failed(e),
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(e) => return PushResult::failed(format!("Could not start a runtime: {e}")),
    };

    match runtime.block_on(crate::push_wake::run_wake(data_dir, &wake)) {
        Ok(specs) => PushResult { specs, error: None },
        Err(e) => PushResult::failed(e),
    }
}

// ─── Logcat ──────────────────────────────────────────────────────────────────
//
// The app's `tracing` subscriber writes to stdout, which Android discards, and
// it is installed by `run()` — which never executes on this path. Without a sink
// here a failing push is completely silent, and "push does nothing" is exactly
// the bug that needs logs to diagnose. Bridging to liblog costs one extern
// declaration and makes `adb logcat -s quark` work for the cold path.

#[cfg(target_os = "android")]
mod logcat {
    const LOG_TAG: &str = "quark\0";
    /// `ANDROID_LOG_INFO` from `<android/log.h>`.
    const ANDROID_LOG_INFO: i32 = 4;

    #[link(name = "log")]
    extern "C" {
        fn __android_log_write(
            prio: i32,
            tag: *const std::os::raw::c_char,
            text: *const std::os::raw::c_char,
        ) -> i32;
    }

    /// A `tracing` writer that emits each line to logcat.
    pub struct Logcat;

    impl std::io::Write for Logcat {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            // An interior NUL would truncate the message; replacing keeps the
            // line readable rather than dropping it.
            let text = String::from_utf8_lossy(buf).replace('\0', "?");
            if let Ok(text) = std::ffi::CString::new(text) {
                // SAFETY: both pointers are NUL-terminated and outlive the call.
                unsafe {
                    __android_log_write(ANDROID_LOG_INFO, LOG_TAG.as_ptr().cast(), text.as_ptr());
                }
            }
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
}

/// Install the logcat subscriber once per process.
///
/// `try_init` failing is the expected case in a warm process — the app already
/// installed its own subscriber — so the result is deliberately discarded.
#[cfg(target_os = "android")]
fn init_logging() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _ = tracing_subscriber::fmt()
            .with_writer(|| logcat::Logcat)
            .with_ansi(false)
            .with_env_filter(
                tracing_subscriber::EnvFilter::from_default_env()
                    .add_directive("quark=debug".parse().expect("static directive")),
            )
            .try_init();
    });
}

/// Off Android this entry point exists only to be type-checked; whatever
/// subscriber the host already has is the right one.
#[cfg(not(target_os = "android"))]
fn init_logging() {}
