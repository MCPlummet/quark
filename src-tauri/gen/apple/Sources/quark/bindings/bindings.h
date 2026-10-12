#pragma once

#include <stdint.h>

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

        /// The call that removes a room's delivered notifications by thread id.
        void quark_register_notification_cleaner(void (*clear_room)(const char *room_id));

        /// The call that asks APNs for a device token. Rust makes it when push
        /// is enabled, rather than the app registering unconditionally at launch.
        void quark_register_token_requester(void (*request)());

        /// The call that saves a staged file to Photos (target 0) or through
        /// the Files export dialog (target 1). It must answer exactly once per
        /// request, through quark_media_save_finished.
        void quark_register_media_saver(
            void (*save)(const char *path, const char *mime, uint8_t target, uint64_t request));

        /// A save has finished: status 0 saved (detail = where), 1 cancelled,
        /// 2 failed (detail = why). detail may be NULL.
        void quark_media_save_finished(uint64_t request, int32_t status, const char *detail);
    }
}
