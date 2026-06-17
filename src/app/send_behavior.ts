// Resolves how the compose box's Enter key behaves and whether the dedicated
// send button is shown, from the `general.send_key_behavior` preference and the
// current platform. See GeneralConfig.send_key_behavior.

import { AppState } from "./state.js";
import { isMobile } from "./mobile.js";

/**
 * Whether pressing Enter (without Shift) sends the message.
 *  - "enter":   always sends.
 *  - "newline": never sends (Enter inserts a newline; send via the button or
 *               Ctrl/Cmd+Enter).
 *  - "auto":    sends on desktop, inserts a newline on mobile.
 */
export function effectiveSendOnEnter(): boolean {
  switch (AppState.get("sendKeyBehavior")) {
    case "enter": return true;
    case "newline": return false;
    case "auto":
    default: return !isMobile();
  }
}

/**
 * Whether to show the dedicated send button. Always shown on mobile (touch needs
 * a tap target), and on desktop only when Enter does not send — so "newline"
 * mode always has a visible way to send.
 */
export function shouldShowSendButton(): boolean {
  return isMobile() || !effectiveSendOnEnter();
}
