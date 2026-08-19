# iOS Push Notifications (APNs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wake a suspended or force-quit iOS build through APNs and render a notification naming the sender and room, so mobile notifications no longer depend on an in-process sync loop.

**Architecture:** The homeserver POSTs `event_id_only` metadata to our own Sygnal at `push.quark.tel`, which signs it for APNs. `mutable-content: 1` routes the push through a notification service extension (NSE), which resolves the room and sender with one `/context` request and rewrites the notification body. The NSE is **Swift only** — no Rust, no matrix-sdk, no decryption. Encrypted rooms render `"Encrypted message"` until Phase 4.

**Tech Stack:** Swift 5 / UIKit / UserNotifications, ObjC++ (`main.mm`), xcodegen, Rust (`push.rs` and a new `apns.rs`), Sygnal 0.17.0, matrix-sdk 0.9.

**Spec:** `DESIGN.md` § Architecture → Push notifications. That section is authoritative for the invariants; this plan implements the iOS half of it.

**Platform note:** iOS is **not in CI** — it is built locally from Xcode on macOS. Nothing in this plan can be verified on the Linux dev shell, and the Swift and ObjC++ in this document has never been compiled. Treat every code block as a starting point that must be built before it is trusted.

---

## Global Constraints

Exact values. Getting any of these wrong produces a silent failure rather than an error.

- **Bundle id:** `tel.quark.app`. NSE bundle id: `tel.quark.app.nse` (must be a *child* of the app's id).
- **App group:** `group.tel.quark.app`, enabled on both App IDs.
- **`app_id` sent to the homeserver:** `tel.quark.app.ios.dev` for debug builds, `tel.quark.app.ios.prod` for release. These are keys in Sygnal's config — a typo means Sygnal rejects the pusher. Produced by `push::PushTransport::app_id()`; do not hand-write them.
- **Gateway URL:** `https://push.quark.tel/_matrix/push/v1/notify`. The homeserver rejects any pusher URL not ending in `/_matrix/push/v1/notify`.
- **Pushkey format:** `deviceToken.base64EncodedString()`. Sygnal's `convert_device_token_to_hex` is left at its default of `true`, so it base64-**decodes** what we send. Sending hex, or the raw `Data` description, is the single most common cause of a pusher that registers cleanly and never delivers.
- **Deployment target:** iOS 17.0, in `tauri.conf.json`, `gen/apple/project.yml` and `gen/apple/Podfile`. All three are aligned as of `fix/ios-project-regen-drift`.
- **Signing team:** `STY28WCV84`, declared in `project.yml` under `settingGroups.app.base`.
- **`format: event_id_only`** on every pusher. Never send a format that lets message content reach the gateway.
- **`mutable-content: 1`** in `default_payload`, already emitted by `push::apns_default_payload()`. Without it the NSE never runs and the user sees the literal placeholder alert.
- **No secrets in this repo.** The APNs `.p8` and its key id live with the gateway's deployment config, not here. This repo is public.

---

## What is already done — do not rebuild

**Phase 0 (infrastructure) — complete and verified 2026-08-19.** Sygnal 0.17.0 serves `push.quark.tel`. It defines both `tel.quark.app.ios.dev` and `tel.quark.app.ios.prod` against one APNs auth key, with `send_badge_counts: false` because the homeserver cannot count encrypted rooms. Verified live:

```
$ curl -X POST -d '{}' https://push.quark.tel/_matrix/push/v1/notify
Invalid notification: expecting object in 'notification' key   # HTTP 400
```

A `405` on GET and a `400` on an empty POST both mean Sygnal itself is answering, not the proxy.

**Phase 1 (shared push plumbing) — merged, PR #49.** `src-tauri/src/push.rs` is transport-agnostic and already contains the iOS half:

- `PushTransport::Apns { sandbox: bool }` and `app_id()` returning the two Sygnal keys.
- `apns_default_payload()` emitting `mutable-content: 1` and the `loc-key` placeholder.
- `PlatformTransport::Apns` and `platform_transport()`, already correct under `target_os = "ios"`.
- `register()` / `unregister()` / `retry_pending_deletes()`, with pending-delete bookkeeping so a pusher can never exist unremembered.
- `PushStatus` / `PushReadiness` and the Settings section, gated on `supports_push()`.

**Phase 2 (Android UnifiedPush) — merged, PR #53.** Established the pattern this phase follows: a transport module (`unifiedpush.rs`) owns discovery and the platform callbacks, and hands a pushkey to `push::register`. Also produced `push_wake.rs`, whose `background_client()` is what supplies a `Client` on a path with no Tauri.

**Xcode regen safety — branch `fix/ios-project-regen-drift`.** `DEVELOPMENT_TEAM`, the three `NS*UsageDescription` keys and the 17.0 deployment target are now declared in `project.yml` rather than surviving only in generated files. This matters here because adding the NSE means regenerating the project, which would otherwise have dropped all three.

---

## File Structure

**Rust (new):**
- `src-tauri/src/apns.rs` — the iOS transport module. Mirrors `unifiedpush.rs` minus discovery (the gateway is fixed) and minus distributor selection (the OS is the transport). Owns `on_new_token`, `register_stored_token`, `on_registration_failed`, and the `extern "C"` entry points the app delegate calls.

**Rust (modified):**
- `src-tauri/src/push.rs:479` — `TRANSPORT_AVAILABLE` gains iOS; the `ios_does_not_offer_push_until_apns_lands` test at `:948` inverts.
- `src-tauri/src/lib.rs` — `mod apns;` under `#[cfg(target_os = "ios")]`.
- `src-tauri/src/commands.rs:113` — `settle_pending_pushers` registers a stored token on iOS the way it registers a stored endpoint on Android.
- `src-tauri/src/secrets.rs` — write the NSE credential blob into the app group container alongside the existing keychain write.

**Native (modified):**
- `src-tauri/gen/apple/Sources/quark/main.mm` — install the remote-notification delegate callbacks and the `quark_app_group_path()` helper.
- `src-tauri/gen/apple/Sources/quark/bindings/bindings.h` — declare the new `extern "C"` symbols.
- `src-tauri/gen/apple/quark_iOS/quark_iOS.entitlements` — `aps-environment`, app group.
- `src-tauri/gen/apple/project.yml` — `UIBackgroundModes`, the NSE target, the app-group entitlement.

**Native (new):**
- `src-tauri/gen/apple/QuarkNSE/NotificationService.swift` — the extension.
- `src-tauri/gen/apple/QuarkNSE/Info.plist` — `NSExtensionPointIdentifier`.
- `src-tauri/gen/apple/QuarkNSE/QuarkNSE.entitlements` — app group only.

**Docs:**
- `DESIGN.md` § Push notifications — replace "iOS is push-capable but has no transport until the APNs phase" with what shipped.

---

## Prerequisites (Apple Developer portal — manual, do first)

None of the code below signs or runs until these exist. Task 1 verifies them.

- [ ] Enable **Push Notifications** on App ID `tel.quark.app`.
- [ ] Create App ID `tel.quark.app.nse`.
- [ ] Create App Group `group.tel.quark.app`; enable it on **both** App IDs.
- [ ] Confirm the APNs auth key is still valid and that its Key ID and Team ID match what the gateway is configured with.
- [ ] Have a **physical iPhone** enrolled for development. Simulator push exists on Apple-silicon Macs but is not the path to bring this up on.

---

## Task 1: Push capability, entitlements and background mode

Config only — no behaviour yet. The deliverable is a build that signs with push entitlements, which is the thing every later task depends on and the thing most likely to fail for portal reasons rather than code reasons.

**Files:**
- Modify: `src-tauri/gen/apple/quark_iOS/quark_iOS.entitlements`
- Modify: `src-tauri/gen/apple/project.yml`

- [ ] **Step 1: Add the entitlements**

`quark_iOS.entitlements` is currently an empty `<dict/>`. Replace with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>aps-environment</key>
	<string>development</string>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>group.tel.quark.app</string>
	</array>
</dict>
</plist>
```

`development` is correct for local Xcode builds. Release/TestFlight needs `production`; that swap is Task 8, not now — a mismatch between this value and the `app_id` you register is the second most common silent-failure cause after the pushkey encoding.

- [ ] **Step 2: Declare the background mode**

In `project.yml`, under `targets.quark_iOS.info.properties`, alongside `LSRequiresIPhoneOS`:

```yaml
        UIBackgroundModes:
          - remote-notification
```

It goes in `project.yml`, not directly in `Info.plist` — xcodegen rewrites the plist from this file.

- [ ] **Step 3: Regenerate and confirm nothing was lost**

```bash
cd src-tauri/gen/apple && xcodegen generate && git diff
```

Expected: `project.pbxproj` still carries `DEVELOPMENT_TEAM = STY28WCV84` and `IPHONEOS_DEPLOYMENT_TARGET = 17.0`; `quark_iOS/Info.plist` gains only `UIBackgroundModes` and loses nothing. If the three `NS*UsageDescription` keys disappear, stop — `project.yml` has drifted and the fix from `fix/ios-project-regen-drift` has been undone.

- [ ] **Step 4: Build and verify the entitlements reached the binary**

```bash
pnpm tauri ios build --debug
codesign -d --entitlements :- src-tauri/gen/apple/build/*/Quark.app
```

Expected: `aps-environment` = `development` and the app group both present. If `codesign` shows no entitlements, the provisioning profile does not carry the capability — go back to the portal prerequisites.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/gen/apple/
git commit -m "feat(ios): add push entitlements and the remote-notification background mode"
```

---

## Task 2: Capture the APNs device token

**This is the task that cannot be written in advance, and the one to do before committing to anything else.** Tauri owns the `UIApplicationDelegate` — `main.mm` is four lines calling `ffi::start_app()`, and the delegate is constructed inside Tauri/wry. There is no compile-time hook and no local Swift plugin scaffolding to hang one on.

The approach below adds the delegate methods to whatever class Tauri instantiated, looked up **at runtime**, which avoids needing the class name at all. It is the technique push SDKs use for exactly this problem. It is also unverified here — if it does not work, the documented fallbacks are an ObjC category on Tauri's delegate class once you know its name (`NSStringFromClass([UIApplication.sharedApplication.delegate class])`), or a `UNUserNotificationCenter` delegate set after launch.

**Files:**
- Modify: `src-tauri/gen/apple/Sources/quark/main.mm`
- Modify: `src-tauri/gen/apple/Sources/quark/bindings/bindings.h`

**Interfaces:**
- Produces: `extern "C" void quark_apns_token(const char *token_base64)` and `extern "C" void quark_apns_failed(const char *error)`, both implemented in Rust in Task 4. Until then, stub them in `main.mm` with an `NSLog` so this task is independently testable.

- [ ] **Step 1: Add the delegate injection to `main.mm`**

```objc
#include "bindings/bindings.h"
#import <UIKit/UIKit.h>
#import <objc/runtime.h>

// Tauri constructs the UIApplicationDelegate, so there is no compile-time
// place to put these callbacks. Add them to whichever class it instantiated,
// once the app has launched and that class is knowable.

static void quark_did_register(id self, SEL _cmd, UIApplication *app, NSData *token) {
    NSString *b64 = [token base64EncodedStringWithOptions:0];
    NSLog(@"[quark] APNs token: %@", b64);   // replaced by quark_apns_token in Task 4
}

static void quark_did_fail(id self, SEL _cmd, UIApplication *app, NSError *error) {
    NSLog(@"[quark] APNs registration failed: %@", error.localizedDescription);
}

static void quark_install_push_delegate(void) {
    id delegate = UIApplication.sharedApplication.delegate;
    Class cls = object_getClass(delegate);

    SEL ok = @selector(application:didRegisterForRemoteNotificationsWithDeviceToken:);
    SEL bad = @selector(application:didFailToRegisterForRemoteNotificationsWithError:);

    // class_addMethod returns NO if the class already implements the selector,
    // in which case overwrite the existing implementation instead.
    if (!class_addMethod(cls, ok, (IMP)quark_did_register, "v@:@@")) {
        method_setImplementation(class_getInstanceMethod(cls, ok), (IMP)quark_did_register);
    }
    if (!class_addMethod(cls, bad, (IMP)quark_did_fail, "v@:@@")) {
        method_setImplementation(class_getInstanceMethod(cls, bad), (IMP)quark_did_fail);
    }

    [UIApplication.sharedApplication registerForRemoteNotifications];
}

int main(int argc, char * argv[]) {
    @autoreleasepool {
        // Registered before start_app because start_app runs the run loop and
        // does not return. The observer fires once the delegate exists.
        [NSNotificationCenter.defaultCenter
            addObserverForName:UIApplicationDidFinishLaunchingNotification
                        object:nil
                         queue:NSOperationQueue.mainQueue
                    usingBlock:^(NSNotification *note) {
                        quark_install_push_delegate();
                    }];
    }
    ffi::start_app();
    return 0;
}
```

- [ ] **Step 2: Build to the physical device and read the console**

Run from Xcode with the device attached, watching the console.

Expected: `[quark] APNs token: <base64>` within a second or two of launch, and the system permission prompt appearing.

If the token never arrives but no error does either, the observer is firing before the delegate is assigned — move `quark_install_push_delegate()` to a `dispatch_after` of 0.5s as a diagnostic. If it works there, the launch ordering is the problem and not the injection, and the real fix is to observe `UIApplicationDidBecomeActiveNotification` instead.

If `didFailToRegister` fires with "no valid 'aps-environment'", Task 1 did not actually take — recheck `codesign -d --entitlements`.

- [ ] **Step 3: Add the notification permission request**

A token arrives without permission, but nothing is displayed. In `quark_install_push_delegate`, before `registerForRemoteNotifications`:

```objc
    [UNUserNotificationCenter.currentNotificationCenter
        requestAuthorizationWithOptions:(UNAuthorizationOptionAlert |
                                         UNAuthorizationOptionSound |
                                         UNAuthorizationOptionBadge)
                      completionHandler:^(BOOL granted, NSError *error) {
                          NSLog(@"[quark] notification permission granted=%d", granted);
                      }];
```

Add `#import <UserNotifications/UserNotifications.h>` at the top.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/gen/apple/Sources/quark/
git commit -m "feat(ios): capture the APNs device token from Tauri's app delegate"
```

**Gate:** do not start Task 3 until a base64 token has appeared in the console. Every later task assumes this works.

---

## Task 3: The `apns` transport module in Rust

Mirrors `unifiedpush.rs`, which is the proven shape: the transport module owns the platform specifics and hands a pushkey to `push::register`. Simpler than the Android one — no discovery (the gateway is fixed), no distributor selection (the OS is the transport).

**Files:**
- Create: `src-tauri/src/apns.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/push.rs:479` and `:948`

**Interfaces:**
- Consumes: `push::register(&Client, &Path, &NotificationConfig, PushTransport, String, String, String) -> Result<bool, String>`; `push::store_endpoint(&Path, &str) -> Result<bool, String>`; `push_wake::background_client(&Path) -> Result<Client, String>`.
- Produces: `apns::on_new_token(&Path, &str) -> Result<(), String>` and `apns::register_stored_token(&Path) -> Result<(), String>`, both called from Task 4.

- [ ] **Step 1: Write the failing tests**

In a new `src-tauri/src/apns.rs`, inline `#[cfg(test)] mod tests` per the existing convention:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// The sandbox flag picks the app_id, and Sygnal keys its config by that
    /// exact string. A debug build registering .ios.prod is rejected by APNs
    /// with no error the device ever sees.
    #[test]
    fn debug_builds_register_against_the_sandbox() {
        assert_eq!(transport_for_build(true), crate::push::PushTransport::Apns { sandbox: true });
        assert_eq!(transport_for_build(false), crate::push::PushTransport::Apns { sandbox: false });
    }

    /// Unlike UnifiedPush there is nothing to discover: the only gateway that
    /// can sign for tel.quark.app is ours.
    #[test]
    fn the_gateway_is_fixed() {
        assert!(GATEWAY.ends_with("/_matrix/push/v1/notify"), "homeserver rejects any other path");
        assert_eq!(GATEWAY, "https://push.quark.tel/_matrix/push/v1/notify");
    }
}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd src-tauri && cargo test apns
```

Expected: FAIL — `apns` module not found.

- [ ] **Step 3: Write the module**

```rust
//! iOS push transport: APNs by way of our own Sygnal.
//!
//! The mirror of `unifiedpush.rs`, and deliberately smaller. Android has to
//! find a distributor and then discover which gateway that distributor speaks
//! for; iOS has neither choice to make. The OS is the transport, and the only
//! gateway that can sign a push for `tel.quark.app` is the one holding the
//! APNs key for it — so both are constants here.

/// Our Sygnal. Fixed, because only the holder of the APNs key for this bundle
/// id can push to it; there is no third-party equivalent to discover.
pub const GATEWAY: &str = "https://push.quark.tel/_matrix/push/v1/notify";

/// Sandbox and production APNs are separate endpoints, and a token minted by
/// one is rejected by the other. Xcode builds get sandbox tokens; TestFlight
/// and the App Store get production ones.
pub fn transport_for_build(debug: bool) -> crate::push::PushTransport {
    crate::push::PushTransport::Apns { sandbox: debug }
}

fn device_display_name() -> String {
    "Quark (iOS)".to_owned()
}

/// The OS handed us a device token. Store it and register it.
///
/// Tokens rotate — on reinstall, on restore from backup, and at Apple's
/// discretion — so this runs on every launch and `store_endpoint` reports
/// whether anything actually changed.
pub async fn on_new_token(data_dir: &std::path::Path, token_base64: &str) -> Result<(), String> {
    if !crate::push::store_endpoint(data_dir, token_base64)? {
        tracing::debug!("APNs re-issued the token we already had");
        return Ok(());
    }
    register_stored_token(data_dir).await
}

/// Register whatever token is on disk with the homeserver.
///
/// Safe to call whenever a session appears — `push::register` returns without
/// a round-trip when push is off or the address is already registered.
pub async fn register_stored_token(data_dir: &std::path::Path) -> Result<(), String> {
    let state = crate::push::load_push_state(data_dir);
    let Some(token) = state.and_then(|s| s.endpoint) else {
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

/// APNs refused to issue a token. Nothing to retry here — the OS decides when
/// to try again — so this only records why push is not working.
pub fn on_registration_failed(reason: &str) {
    tracing::warn!("APNs registration failed: {reason}");
}
```

- [ ] **Step 4: Register the module**

In `src-tauri/src/lib.rs`, beside the other transport module:

```rust
#[cfg(target_os = "ios")]
mod apns;
```

- [ ] **Step 5: Flip the transport flag**

`src-tauri/src/push.rs:479`:

```rust
pub const TRANSPORT_AVAILABLE: bool = cfg!(any(target_os = "android", target_os = "ios"));
```

Update the doc comment directly above it — it currently explains that iOS "gets APNs in a later phase and must not advertise a toggle that can only ever say waiting". That is no longer true, and a stale comment here is worse than none because it is the comment explaining why the two flags are separate.

- [ ] **Step 6: Invert the placeholder test**

`src-tauri/src/push.rs:948` currently reads `ios_does_not_offer_push_until_apns_lands` and was written to be flipped here. Replace with:

```rust
    #[cfg(target_os = "ios")]
    #[test]
    fn ios_has_a_transport_and_offers_push() {
        assert!(TRANSPORT_AVAILABLE);
        assert!(status(&config(true), Some(&empty_state()), &TransportStatus::default()).supported);
    }
```

- [ ] **Step 7: Run the tests**

```bash
cd src-tauri && cargo test
```

Expected: PASS. Note the iOS-gated tests do **not** run on the host — `cargo test` on macOS builds for macOS. Confirm them with:

```bash
cargo test --target aarch64-apple-ios 2>&1 | grep "test result:"
```

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/apns.rs src-tauri/src/lib.rs src-tauri/src/push.rs
git commit -m "feat(ios): add the APNs transport module and offer push on iOS"
```

---

## Task 4: Bridge the token into Rust and register the pusher

Ends with a real pusher on the homeserver and a real notification on the device — the checkpoint that separates "infrastructure works" from "the extension has a bug".

**Files:**
- Modify: `src-tauri/src/apns.rs`
- Modify: `src-tauri/gen/apple/Sources/quark/main.mm`
- Modify: `src-tauri/gen/apple/Sources/quark/bindings/bindings.h`
- Modify: `src-tauri/src/commands.rs:113`

**Interfaces:**
- Consumes: `apns::on_new_token`, `apns::on_registration_failed` from Task 3.
- Produces: the `extern "C"` symbols `main.mm` calls.

- [ ] **Step 1: Add the FFI entry points to `apns.rs`**

```rust
/// Called from the app delegate when APNs issues a token.
///
/// `#[no_mangle] extern "C"` rather than a Tauri command because the delegate
/// callback is not reached through the webview and has no `AppHandle`.
///
/// # Safety
/// `token` must be a valid NUL-terminated C string that outlives this call.
#[no_mangle]
pub unsafe extern "C" fn quark_apns_token(token: *const std::os::raw::c_char) {
    if token.is_null() {
        return;
    }
    let Ok(token) = std::ffi::CStr::from_ptr(token).to_str() else {
        tracing::warn!("APNs token was not valid UTF-8");
        return;
    };
    let token = token.to_owned();

    // Unlike Android's push receiver, this is *not* a cold path. The delegate
    // callback fires inside the running app, so Tauri exists and the config
    // dir comes from managed state — which is why this takes no dir argument,
    // where the JNI entry points in `push_jni.rs` are handed one by Kotlin.
    use tauri::Manager;
    let Some(app) = crate::push_wake::app_handle() else {
        tracing::warn!("APNs token arrived before setup; nothing to register it with");
        return;
    };
    let config_dir = app.state::<crate::Paths>().config_dir.clone();

    // Detached: the delegate callback must return promptly, and nothing on
    // screen depends on the outcome.
    tauri::async_runtime::spawn(async move {
        if let Err(e) = on_new_token(&config_dir, &token).await {
            tracing::warn!("Could not register the APNs token: {e}");
        }
    });
}

/// # Safety
/// `reason` must be a valid NUL-terminated C string or null.
#[no_mangle]
pub unsafe extern "C" fn quark_apns_failed(reason: *const std::os::raw::c_char) {
    let reason = if reason.is_null() {
        "unknown".to_owned()
    } else {
        std::ffi::CStr::from_ptr(reason).to_string_lossy().into_owned()
    };
    on_registration_failed(&reason);
}
```

`push_wake::app_handle()` is the existing stash, set in `lib.rs:365` during setup; `Paths` is the managed state holding `config_dir`. Reuse both rather than adding a second mechanism.

- [ ] **Step 2: Declare them in `bindings.h`**

```c
#pragma once

namespace ffi {
    extern "C" {
        void start_app();
        void quark_apns_token(const char *token_base64);
        void quark_apns_failed(const char *reason);
    }
}
```

- [ ] **Step 3: Call them from `main.mm`**

Replace the two `NSLog` stubs from Task 2:

```objc
static void quark_did_register(id self, SEL _cmd, UIApplication *app, NSData *token) {
    NSString *b64 = [token base64EncodedStringWithOptions:0];
    ffi::quark_apns_token(b64.UTF8String);
}

static void quark_did_fail(id self, SEL _cmd, UIApplication *app, NSError *error) {
    ffi::quark_apns_failed(error.localizedDescription.UTF8String);
}
```

- [ ] **Step 4: Register a stored token when a session appears**

`settle_pending_pushers` in `commands.rs` already does this for Android at line 113. Add the iOS arm beside it:

```rust
        #[cfg(target_os = "ios")]
        if let Err(e) = crate::apns::register_stored_token(&config_dir).await {
            tracing::warn!("Could not register the stored APNs token: {e}");
        }
```

Without this, a token issued while logged out is never registered — the iOS version of the endpoint-rotation bug fixed in Phase 2.

- [ ] **Step 5: Verify the pusher reached the homeserver**

Enable push in Settings → Notifications on the device, then:

```bash
curl -H "Authorization: Bearer $TOKEN" \
     https://<homeserver>/_matrix/client/v3/pushers | jq '.pushers[] | {app_id, pushkey, data}'
```

Expected: one pusher with `app_id: "tel.quark.app.ios.dev"`, a base64 `pushkey`, `url` ending `/_matrix/push/v1/notify`, `format: "event_id_only"`, and `default_payload.aps.mutable-content == 1`.

- [ ] **Step 6: Verify a push arrives — the checkpoint**

Force-quit Quark on the device. Send a message from another client.

Expected: a notification reading **"Notification"** — the `loc-key` placeholder. That is the correct and desired result at this stage: it proves homeserver → Sygnal → APNs → device works end to end, with no extension involved. Everything after this task is about replacing that string.

If nothing arrives, check Sygnal's logs for `rejected` — a rejected pushkey there is the base64/hex footgun, not a device problem:

```
docker logs --tail 100 sygnal 2>&1 | grep -i "reject\|error"
```

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/apns.rs src-tauri/src/commands.rs src-tauri/gen/apple/Sources/
git commit -m "feat(ios): register the APNs pusher from the device token"
```

---

## Task 5: Share credentials with the extension through the app group

The NSE runs in its own process and cannot read the app's keychain — the `keyring` crate cannot set a keychain access group, and `secrets.rs` does not. So the app writes a small blob into the shared container instead.

**Files:**
- Modify: `src-tauri/gen/apple/Sources/quark/main.mm`
- Modify: `src-tauri/gen/apple/Sources/quark/bindings/bindings.h`
- Modify: `src-tauri/src/secrets.rs`

- [ ] **Step 1: Expose the container path to Rust**

In `main.mm`:

```objc
extern "C" const char *quark_app_group_path(void) {
    NSURL *url = [NSFileManager.defaultManager
        containerURLForSecurityApplicationGroupIdentifier:@"group.tel.quark.app"];
    if (url == nil) { return NULL; }   // entitlement missing or not provisioned
    return strdup(url.path.UTF8String); // leaked once per call; called rarely
}
```

Declare it in `bindings.h` as `const char *quark_app_group_path(void);`, and declare both native helpers on the Rust side so `secrets.rs` can call them:

```rust
#[cfg(target_os = "ios")]
extern "C" {
    fn quark_app_group_path() -> *const std::os::raw::c_char;
    fn quark_protect_until_first_unlock(path: *const std::os::raw::c_char) -> bool;
}

/// The shared container, or `None` when the app-group entitlement is missing
/// or unprovisioned — which is a signing problem, not a runtime one.
#[cfg(target_os = "ios")]
fn app_group_dir() -> Option<std::path::PathBuf> {
    // SAFETY: returns either NULL or a NUL-terminated string that outlives the call.
    let raw = unsafe { quark_app_group_path() };
    if raw.is_null() {
        tracing::warn!("App group container unavailable; NSE credentials cannot be shared");
        return None;
    }
    let path = unsafe { std::ffi::CStr::from_ptr(raw) }.to_str().ok()?;
    Some(std::path::PathBuf::from(path))
}
```

- [ ] **Step 2: Write the blob when a session is established**

In `secrets.rs`, beside the existing keychain write:

```rust
/// Credentials the notification service extension needs to resolve an event.
///
/// The NSE is a separate process and cannot read the app's keychain, so this
/// is the only channel. Kept to the minimum the extension actually uses: it
/// makes one authenticated GET and renders the result.
#[cfg(target_os = "ios")]
#[derive(serde::Serialize)]
struct NseCredentials {
    homeserver_url: String,
    access_token: String,
}

#[cfg(target_os = "ios")]
pub fn write_nse_credentials(homeserver_url: &str, access_token: &str) -> Result<(), String> {
    let dir = app_group_dir().ok_or("App group container unavailable")?;
    let path = dir.join("nse-credentials.json");
    let body = serde_json::to_vec(&NseCredentials {
        homeserver_url: homeserver_url.to_owned(),
        access_token: access_token.to_owned(),
    })
    .map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    set_protection_until_first_unlock(&path)
}
```

- [ ] **Step 3: Set the file protection class — do not skip this**

The default protection class makes a file unreadable while the device is locked, which is precisely when pushes arrive. Get this wrong and the extension fails every notification on a locked phone and works perfectly in every hand test.

In `main.mm`:

```objc
// NSFileProtectionCompleteUntilFirstUserAuthentication: readable after the
// first unlock following a boot, including while the device is locked. The
// stricter NSFileProtectionComplete would make the NSE fail exactly when it
// is needed.
extern "C" bool quark_protect_until_first_unlock(const char *path) {
    NSString *p = [NSString stringWithUTF8String:path];
    NSError *err = nil;
    BOOL ok = [NSFileManager.defaultManager
        setAttributes:@{NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication}
         ofItemAtPath:p
                error:&err];
    if (!ok) { NSLog(@"[quark] could not set file protection: %@", err); }
    return ok;
}
```

Declare it in `bindings.h`, then in `secrets.rs`:

```rust
#[cfg(target_os = "ios")]
fn set_protection_until_first_unlock(path: &std::path::Path) -> Result<(), String> {
    let c_path = std::ffi::CString::new(path.as_os_str().as_encoded_bytes())
        .map_err(|e| format!("Path is not a valid C string: {e}"))?;
    // SAFETY: c_path is NUL-terminated and outlives the call.
    let ok = unsafe { quark_protect_until_first_unlock(c_path.as_ptr()) };
    if ok {
        Ok(())
    } else {
        Err("Could not set the NSE credential file's protection class".to_owned())
    }
}
```

Returning `Err` rather than warning is deliberate: a credential blob the extension cannot read on a locked device is worse than no blob at all, because it fails invisibly.

- [ ] **Step 4: Delete the blob on logout**

Wherever `forget_local_registrations` is called on the logout path, remove `nse-credentials.json` too. An access token left in a shared container after logout is a real leak, not a tidiness issue.

- [ ] **Step 5: Verify**

Log in on the device, then from Xcode's container inspector (Devices → app → Download Container) confirm `nse-credentials.json` exists and holds the right homeserver. Log out; confirm it is gone.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/secrets.rs src-tauri/gen/apple/Sources/
git commit -m "feat(ios): share NSE credentials through the app group container"
```

---

## Task 6: The notification service extension

**Files:**
- Create: `src-tauri/gen/apple/QuarkNSE/NotificationService.swift`
- Create: `src-tauri/gen/apple/QuarkNSE/Info.plist`
- Create: `src-tauri/gen/apple/QuarkNSE/QuarkNSE.entitlements`
- Modify: `src-tauri/gen/apple/project.yml`

- [ ] **Step 1: Add the target to `project.yml`**

```yaml
  QuarkNSE:
    type: app-extension
    platform: iOS
    sources:
      - path: QuarkNSE
    info:
      path: QuarkNSE/Info.plist
      properties:
        CFBundleDisplayName: QuarkNSE
        NSExtension:
          NSExtensionPointIdentifier: com.apple.usernotifications.service
          NSExtensionPrincipalClass: $(PRODUCT_MODULE_NAME).NotificationService
    entitlements:
      path: QuarkNSE/QuarkNSE.entitlements
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: tel.quark.app.nse
        DEVELOPMENT_TEAM: STY28WCV84
```

And add it to the app target so it is embedded:

```yaml
    dependencies:
      - target: QuarkNSE
        embed: true
```

`QuarkNSE.entitlements` carries the app group **only** — an extension must not declare `aps-environment`.

- [ ] **Step 2: Write the extension**

```swift
import UserNotifications

/// Turns the metadata push into something worth reading.
///
/// The pusher sends `event_id_only`, so all that arrives is a room id and an
/// event id — deliberately, since anything more would mean message content
/// passing through our gateway. Resolving it costs one authenticated request.
///
/// No decryption here: encrypted rooms render a fixed string until the Rust
/// NSE crate lands. Everything in this file is best-effort — any failure
/// delivers the original content rather than nothing.
class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var fallback: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler:
                                 @escaping (UNNotificationContent) -> Void) {
        self.handler = contentHandler
        let content = request.content.mutableCopy() as! UNMutableNotificationContent
        self.fallback = content

        guard
            let roomId = request.content.userInfo["room_id"] as? String,
            let eventId = request.content.userInfo["event_id"] as? String,
            let creds = Credentials.load()
        else { return contentHandler(content) }

        Task {
            guard let event = try? await creds.context(roomId: roomId, eventId: eventId) else {
                return contentHandler(content)
            }
            content.title = event.roomName ?? roomId
            content.subtitle = event.senderName ?? ""
            content.body = event.isEncrypted ? "Encrypted message" : (event.body ?? "")
            content.threadIdentifier = roomId   // groups per room, as the app does
            contentHandler(content)
        }
    }

    /// ~30s wall clock, then iOS delivers whatever we last set. Hand back the
    /// unmodified content rather than a half-filled one.
    override func serviceExtensionTimeWillExpire() {
        if let handler = handler, let fallback = fallback { handler(fallback) }
    }
}
```

- [ ] **Step 3: Implement the `/context` fetch**

Same file or a sibling. The endpoint returns the event and enough room state to name the room and sender in one round trip:

```
GET {homeserver}/_matrix/client/v3/rooms/{roomId}/context/{eventId}?limit=0
Authorization: Bearer {access_token}
```

Read `event.sender`, `event.type`, `event.content.body`, and scan `state[]` for `m.room.name` and the sender's `m.room.member` `displayname`. `type == "m.room.encrypted"` sets `isEncrypted`.

Percent-encode `roomId` and `eventId` — both contain `!`, `$` and `:`, and an unencoded room id produces a 404 that looks like a permissions problem.

- [ ] **Step 4: Verify**

Force-quit the app, send a plaintext message from another client.

Expected: the notification names the sender and room. Send from an encrypted room: `"Encrypted message"` with the room named correctly.

**Then lock the device and repeat.** This is the step that catches a wrong file-protection class in Task 5 — it is the only way that bug shows up.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/gen/apple/QuarkNSE src-tauri/gen/apple/project.yml
git commit -m "feat(ios): render push notifications in a service extension"
```

---

## Task 7: Docs, version bump, release entitlements

- [ ] **Step 1: Update `DESIGN.md`**

In § Push notifications, the paragraph explaining `TRANSPORT_AVAILABLE` says iOS "is push-capable but has no transport until the APNs phase, and advertising a toggle there would strand the user on waiting". Rewrite for what shipped. Add the NSE and the app-group credential channel to the architecture description, and note that encrypted rooms render a fixed string pending Phase 4.

Also drop the now-stale *"Mobile targets — defer to future"* line under Not in Scope if it is still there.

- [ ] **Step 2: Production entitlements for release builds**

`aps-environment` must be `production` for TestFlight and the App Store, matched by `app_id` `tel.quark.app.ios.prod` — which `transport_for_build(cfg!(debug_assertions))` already selects. Confirm a release build picks both, together. A debug-signed build registering `.ios.prod`, or the reverse, fails silently at APNs.

- [ ] **Step 3: Bump the version**

Use the `version-bump` skill. Push on iOS is new user-visible behaviour, so **minor** — unless the in-tree version still has no release tag, in which case this rides it rather than minting a new one. At the time of writing `0.18.0` is in tree with only a `v0.18.0-beta.1` tag.

- [ ] **Step 4: Full verification**

```bash
pnpm test && (cd src-tauri && cargo test)
```

Then on the device, per `DESIGN.md`'s verification expectations: notification arrives force-quit; taps into the right room; a mention lands on the Mentions channel; a muted room produces nothing; desktop and Android are unchanged.

- [ ] **Step 5: Close the tracking issue**

Close **#29**. File Phase 4 as its own issue (see below).

---

## Phase 4 — E2EE decryption in the extension (not this branch)

Scope it separately once Phase 3 is proven. What it means:

- A new `quark-nse` Rust crate as a workspace member, building a second staticlib — Tauri produces `libapp.a` for the app target only.
- Moving the matrix-sdk SQLite store into the app group container so both processes can reach it, with a migration off the current path.
- `NotificationClient` with `NotificationProcessSetup::MultipleProcesses`, whose cross-process store lock is the documented fix for the Olm-account corruption separate app/extension processes historically caused (element-ios#3817). `matrix-sdk-ui` 0.9.0 has this.
- **Decide matrix-sdk 0.9 → 0.18 before starting.** Nine releases of breaking changes across `Client`, sliding sync and the event cache — much cheaper before building on the API than after.
- Fitting matrix-sdk + SQLCipher into the 24 MB extension memory budget. This is the real risk, and the reason Phase 3 ships metadata first.
- If iOS ever enters CI: **tauri#15663** (open as of Tauri 2.11.3) strips app-group entitlements from embedded `.appex` files under App Store Connect API-key auth. Local Xcode signing is unaffected.

---

## Risks and known unknowns

- **The delegate injection in Task 2 is unproven.** It is the one thing here with no fallback that is merely inconvenient — if the runtime approach fails and no category works either, the alternative is patching Tauri. Do it first.
- **None of the Swift or ObjC++ in this plan has been compiled.** It was written on Linux, where the iOS toolchain does not exist. Expect to fix signatures.
- **A wrong file-protection class passes every unlocked test.** Task 6 Step 4's locked-device check is not optional.
- **Sandbox/production mismatch fails silently at APNs**, with no error reaching the device. Sygnal's logs are the only place it shows.
- **`push.include_content`** is irrelevant under `event_id_only`, but confirm the homeserver has not disabled push outright (`push.enabled`).
- **Adjacent bug, still unfixed:** `events.rs:372-373` assigns `unread_count: unread.highlight_count` and `highlight_count: unread.notification_count` — swapped relative to `matrix/rooms.rs:297`, which uses `notification_count` for the unread count. Push surfaces badge counts, so this becomes visible. Fix separately; verified still present 2026-08-19.

---

## Self-Review notes (author)

- **Spec coverage.** Every element of `DESIGN.md` § Push notifications that concerns iOS maps to a task: `event_id_only` and `mutable-content` are Global Constraints and verified in Task 4 Step 5; the `app_id` deployment contract is Task 3; the Settings gating is Task 3 Step 5; server-side mute filtering needs no iOS work because it is already in the push rules.
- **Placeholder scan.** One remained on the first pass — a stubbed file-protection call in Task 5 Step 3 — and is now written out in full. The rest of the plan carries real code or, in Task 2's case, a spike with an explicit gate.
- **Task 2 is a spike wearing a task's clothes.** Its code may not survive contact with the device. The gate at the end exists so nothing is built on it until a token has actually appeared.
- **Type consistency.** `on_new_token` / `register_stored_token` / `transport_for_build` / `GATEWAY` are used in Tasks 3 and 4 under the names Task 3 defines. `quark_apns_token` and `quark_apns_failed` match between `apns.rs`, `bindings.h` and `main.mm`.
- **Resolved while writing.** Task 4 Step 1 first reached for a config dir the way the Android cold path does, by being handed one. That was wrong: the iOS delegate callback runs inside the live app, so `push_wake::app_handle()` and the managed `Paths` are both available. Worth knowing generally — Android's push entry points are Tauri-less and iOS's are not, so the two transports do not share a dir-resolution strategy.
