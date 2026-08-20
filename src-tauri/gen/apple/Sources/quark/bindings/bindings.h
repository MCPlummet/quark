#pragma once

// Symbols implemented in Rust and called from main.mm. The traffic in the other
// direction — quark_app_group_path and quark_protect_until_first_unlock, which
// main.mm defines and secrets.rs calls — needs no declaration here; Rust names
// those in its own `extern "C"` block and the linker joins them at final link.
namespace ffi {
    extern "C" {
        void start_app();

        /// APNs issued a device token, base64-encoded.
        void quark_apns_token(const char *token_base64);

        /// APNs declined to issue one.
        void quark_apns_failed(const char *reason);
    }
}
