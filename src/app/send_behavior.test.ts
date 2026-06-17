import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppState } from "./state.js";
import { effectiveSendOnEnter, shouldShowSendButton } from "./send_behavior.js";

// isMobile() reads module state set by initMobile(); mock it so platform can be
// driven directly.
const h = vi.hoisted(() => ({ mobile: false }));
vi.mock("./mobile.js", () => ({ isMobile: () => h.mobile }));

beforeEach(() => {
  h.mobile = false;
  AppState.set("sendKeyBehavior", "auto");
});

describe("effectiveSendOnEnter", () => {
  it("auto → sends on desktop", () => {
    AppState.set("sendKeyBehavior", "auto");
    h.mobile = false;
    expect(effectiveSendOnEnter()).toBe(true);
  });

  it("auto → inserts a newline on mobile", () => {
    AppState.set("sendKeyBehavior", "auto");
    h.mobile = true;
    expect(effectiveSendOnEnter()).toBe(false);
  });

  it("enter → always sends, even on mobile", () => {
    AppState.set("sendKeyBehavior", "enter");
    h.mobile = true;
    expect(effectiveSendOnEnter()).toBe(true);
  });

  it("newline → never sends, even on desktop", () => {
    AppState.set("sendKeyBehavior", "newline");
    h.mobile = false;
    expect(effectiveSendOnEnter()).toBe(false);
  });
});

describe("shouldShowSendButton", () => {
  it("hidden on desktop in auto mode", () => {
    AppState.set("sendKeyBehavior", "auto");
    h.mobile = false;
    expect(shouldShowSendButton()).toBe(false);
  });

  it("shown on mobile (touch needs a tap target)", () => {
    AppState.set("sendKeyBehavior", "auto");
    h.mobile = true;
    expect(shouldShowSendButton()).toBe(true);
  });

  it("shown on desktop when Enter won't send (newline mode)", () => {
    AppState.set("sendKeyBehavior", "newline");
    h.mobile = false;
    expect(shouldShowSendButton()).toBe(true);
  });

  it("hidden on desktop in enter mode", () => {
    AppState.set("sendKeyBehavior", "enter");
    h.mobile = false;
    expect(shouldShowSendButton()).toBe(false);
  });
});
