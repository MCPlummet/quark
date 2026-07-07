import { invoke } from "../ipc/invoke.js";

/**
 * Open an external URL in the system browser.
 *
 * We route through our own `open_external_url` backend command rather than
 * `plugin:shell|open` directly because the shell plugin's mobile JS surface
 * is broken on iOS and Android — the Swift/Kotlin handlers call
 * `parseArgs(String)` expecting a raw JSON string, but the standard JS
 * invocation sends `{ path, with }`, which fails to decode and silently
 * no-ops every tap. The Rust-side `Shell::open` API serializes the URL
 * correctly, so we wrap it.
 *
 * Falls back to `window.open` only when not running under Tauri (browser
 * dev mode).
 */
export function openExternalUrl(url: string): void {
  if (!(url.startsWith("http://") || url.startsWith("https://"))) return;
  void invoke("open_external_url", { url }).catch((err) => {
    console.warn("open_external_url failed, falling back to window.open:", err);
    window.open(url, "_blank", "noopener,noreferrer");
  });
}
