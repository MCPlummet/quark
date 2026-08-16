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
/// Declared as an *instance* method on `PushSyncService` so the symbol is this
/// plain name — a `companion object` would mangle it to `…_00024Companion_…`
/// and fail to link at call time rather than at build time.
///
/// Returns a JSON `PushResult` string. Errors travel in the payload rather than
/// as a Java exception because the caller is a service with ~30 s to live and
/// nothing useful to do with a throwable except log it.
#[no_mangle]
pub extern "system" fn Java_tel_quark_app_PushSyncService_nativeHandlePush<'local>(
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
