import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppState, type ActivePanel } from "./state.js";

// AppState is the single source of truth for runtime state and a pub/sub hub.
// It's a singleton, so each test resets the keys it touches up-front. The
// change-emission contract and the focus-traversal math (which honours the
// member-list visibility filter) are the drift-prone bits worth locking.

beforeEach(() => {
  AppState.patch({
    activePanel: "roomlist",
    memberListVisible: false,
    currentRoomId: null,
    replyToEventId: null,
    editingEventId: null,
  });
});

describe("AppState.set / emit", () => {
  it("emits (key, value, prev) to key listeners on change", () => {
    const seen: Array<[string, unknown, unknown]> = [];
    const off = AppState.on("currentRoomId", (k, v, p) => seen.push([k, v, p]));
    AppState.set("currentRoomId", "!room:x");
    off();
    expect(seen).toEqual([["currentRoomId", "!room:x", null]]);
  });

  it("does NOT emit when the value is unchanged (reference equality)", () => {
    AppState.set("currentRoomId", "!same:x");
    const listener = vi.fn();
    const off = AppState.on("currentRoomId", listener);
    AppState.set("currentRoomId", "!same:x");
    off();
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribing stops further notifications", () => {
    const listener = vi.fn();
    const off = AppState.on("editingEventId", listener);
    AppState.set("editingEventId", "a");
    off();
    AppState.set("editingEventId", "b");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("onAny fires for every changed key", () => {
    const keys: string[] = [];
    const off = AppState.onAny((k) => keys.push(k));
    AppState.set("currentRoomId", "!r:x");
    AppState.set("replyToEventId", "$e");
    off();
    expect(keys).toEqual(["currentRoomId", "replyToEventId"]);
  });

  it("patch applies multiple keys, emitting per changed key", () => {
    const off = AppState.onAny(() => {});
    AppState.patch({ currentRoomId: "!r:y", memberListVisible: true });
    off();
    expect(AppState.get("currentRoomId")).toBe("!r:y");
    expect(AppState.get("memberListVisible")).toBe(true);
  });
});

describe("AppState focus traversal", () => {
  // PANEL_ORDER is spaces → roomlist → timeline → members, but "members" is
  // only in the order when the member list is visible.
  it("moves right through the visible panels and stops at the end", () => {
    AppState.set("activePanel", "spaces");
    AppState.moveFocusRight();
    expect(AppState.get("activePanel")).toBe("roomlist");
    AppState.moveFocusRight();
    expect(AppState.get("activePanel")).toBe("timeline");
  });

  it("with the member list hidden, right from timeline stays put (members excluded)", () => {
    AppState.patch({ activePanel: "timeline", memberListVisible: false });
    AppState.moveFocusRight();
    expect(AppState.get("activePanel")).toBe("timeline");
  });

  it("with the member list visible, right from timeline reaches members", () => {
    AppState.patch({ activePanel: "timeline", memberListVisible: true });
    AppState.moveFocusRight();
    expect(AppState.get("activePanel")).toBe("members");
  });

  it("moves left and stops at the first panel", () => {
    AppState.set("activePanel", "timeline");
    AppState.moveFocusLeft();
    expect(AppState.get("activePanel")).toBe("roomlist");
    AppState.moveFocusLeft();
    expect(AppState.get("activePanel")).toBe("spaces");
    AppState.moveFocusLeft();
    expect(AppState.get("activePanel")).toBe("spaces");
  });

  it("focusPanel sets the panel and runs its focusActive callback", () => {
    const focusActive = vi.fn();
    AppState.registerPanelNav("members", { navDown: vi.fn(), navUp: vi.fn(), focusActive });
    AppState.focusPanel("members");
    expect(AppState.get("activePanel")).toBe("members");
    expect(focusActive).toHaveBeenCalledOnce();
  });
});

describe("AppState panel-nav delegation", () => {
  it("navDown/navUp delegate to the active panel's callbacks", () => {
    const navDown = vi.fn();
    const navUp = vi.fn();
    AppState.registerPanelNav("roomlist", { navDown, navUp });
    AppState.set("activePanel", "roomlist");
    AppState.navDown();
    AppState.navUp();
    expect(navDown).toHaveBeenCalledOnce();
    expect(navUp).toHaveBeenCalledOnce();
  });

  it("optional callbacks (jumpTop/select/close) are no-ops when not provided", () => {
    AppState.registerPanelNav("timeline", { navDown: vi.fn(), navUp: vi.fn() });
    AppState.set("activePanel", "timeline");
    expect(() => {
      AppState.jumpTop();
      AppState.jumpBottom();
      AppState.select();
      AppState.close();
    }).not.toThrow();
  });

  // #15 — navDown reports whether the active panel actually moved so the
  // caller can hand focus to the compose box at the timeline's bottom edge.
  it("navDown/navUp return whether the active panel reported movement", () => {
    AppState.registerPanelNav("timeline", { navDown: () => true, navUp: () => false });
    AppState.set("activePanel", "timeline");
    expect(AppState.navDown()).toBe(true);
    expect(AppState.navUp()).toBe(false);
  });

  it("navDown returns false when the panel callback reports nothing", () => {
    AppState.registerPanelNav("roomlist", { navDown: () => {}, navUp: () => {} });
    AppState.set("activePanel", "roomlist");
    expect(AppState.navDown()).toBe(false);
  });
});

describe("AppState user caches", () => {
  it("stores and reads status / presence, defaulting to null", () => {
    expect(AppState.getUserStatus("@new:x")).toBeNull();
    AppState.cacheUserStatus("@a:x", "afk");
    AppState.cacheUserPresence("@a:x", "online");
    expect(AppState.getUserStatus("@a:x")).toBe("afk");
    expect(AppState.getUserPresence("@a:x")).toBe("online");
    expect(AppState.getUserPresence("@unknown:x")).toBeNull();
  });
});
