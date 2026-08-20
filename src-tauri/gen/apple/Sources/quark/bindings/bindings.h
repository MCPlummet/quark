#pragma once

// Symbols implemented in Rust and called from main.mm.
//
// Everything crosses in this direction, including things Rust needs *from*
// Foundation: the crate also builds as a cdylib, which links with no main.mm
// present, so a Rust `extern "C"` block naming an ObjC symbol breaks the build
// before the staticlib the app uses is ever linked. Hence quark_register_app_group
// takes a function pointer rather than Rust calling one by name.
namespace ffi {
    extern "C" {
        void start_app();

        /// APNs issued a device token, base64-encoded.
        void quark_apns_token(const char *token_base64);

        /// APNs declined to issue one.
        void quark_apns_failed(const char *reason);

        /// The app group container's path (or NULL if unprovisioned), and the
        /// call that sets a file's data-protection class within it.
        void quark_register_app_group(const char *path, bool (*protect)(const char *));

        /// The user tapped a pushed notification for this room.
        void quark_notification_tapped(const char *room_id);
    }
}
