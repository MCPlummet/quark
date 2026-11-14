import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { UserColorUpdate } from "../ipc/user_colors.js";

// The backend's pushed answers (`quark://user-color`): `push` delivers one to
// the store's listener, and `listening` is when that listener is attached —
// at once unless a test holds it back.
const events = vi.hoisted(() => ({
  handler: null as ((u: UserColorUpdate) => void) | null,
  listening: Promise.resolve() as Promise<void>,
}));
vi.mock("../ipc/user_colors.js", () => ({
  listenUserColors: async (cb: (u: UserColorUpdate) => void) => {
    await events.listening;
    events.handler = cb;
    return () => {
      if (events.handler === cb) events.handler = null;
    };
  },
}));
const push = (user_id: string, color: string | null) => {
  if (!events.handler) throw new Error("no listener attached");
  events.handler({ user_id, color });
};

import {
  initUserColors,
  localUserColor,
  paintUserColor,
  publishedUserColor,
  receiveUserColor,
  refetchUserColor,
  resetUserColors,
  resolveUserColor,
  setLocalUserColor,
  setUserColorToggles,
  watchUserColor,
} from "./user_colors.js";
import type { UserColorsConfig } from "../ipc/app_config.js";

const root = document.documentElement;

const config = (over: Partial<UserColorsConfig> = {}): UserColorsConfig => ({
  name: true,
  avatar: false,
  border: false,
  overrides: {},
  ...over,
});

/** Let the store's setTimeout(0) batch flush, then its promise settle. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await Promise.resolve();
}

function el(): HTMLElement {
  const e = document.createElement("div");
  document.body.appendChild(e);
  return e;
}

describe("user colors store", () => {
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    events.listening = Promise.resolve();
    resetUserColors();
    document.body.innerHTML = "";
    root.style.removeProperty("--bg");
    root.style.setProperty("--bg", "#0a0a0a");
    request = vi.fn().mockResolvedValue({});
  });

  it("override beats published, none when neither", () => {
    initUserColors({ config: config({ overrides: { "@a:x": "#00AAFF" } }), request });
    receiveUserColor("@a:x", "#ff4466");
    receiveUserColor("@b:x", "#ffaa00");
    expect(resolveUserColor("@a:x")).toBe("#00aaff");
    expect(resolveUserColor("@b:x")).toBe("#ffaa00");
    expect(resolveUserColor("@c:x")).toBeNull();
    expect(localUserColor("@a:x")).toBe("#00aaff");
    expect(publishedUserColor("@a:x")).toBe("#ff4466");
    expect(publishedUserColor("@c:x")).toBeUndefined();
  });

  it("paints --user-color and data-user-color, and unpaints when the color goes away", () => {
    initUserColors({ config: config(), request });
    receiveUserColor("@a:x", "#ff4466");
    const e = el();
    paintUserColor(e, "@a:x");
    expect(e.style.getPropertyValue("--user-color")).toBe("#ff4466");
    expect(e.hasAttribute("data-user-color")).toBe(true);
    receiveUserColor("@a:x", null);
    expect(e.style.getPropertyValue("--user-color")).toBe("");
    expect(e.hasAttribute("data-user-color")).toBe(false);
  });

  it("repaints when a local override is set and cleared", () => {
    initUserColors({ config: config(), request });
    receiveUserColor("@a:x", "#ff4466");
    const e = el();
    paintUserColor(e, "@a:x");
    setLocalUserColor("@a:x", "#00ff41");
    expect(e.style.getPropertyValue("--user-color")).toBe("#00ff41");
    setLocalUserColor("@a:x", null);
    expect(e.style.getPropertyValue("--user-color")).toBe("#ff4466");
  });

  it("never paints an invalid color", () => {
    initUserColors({ config: config({ overrides: { "@b:x": "url(x)" } }), request });
    receiveUserColor("@a:x", "url(x)");
    const a = el();
    const b = el();
    paintUserColor(a, "@a:x");
    paintUserColor(b, "@b:x");
    expect(a.hasAttribute("data-user-color")).toBe(false);
    expect(b.hasAttribute("data-user-color")).toBe(false);
    expect(publishedUserColor("@a:x")).toBeNull();
  });

  it("applies default toggles as root classes", () => {
    initUserColors({ config: config(), request });
    expect(root.classList.contains("uc-name")).toBe(true);
    expect(root.classList.contains("uc-any")).toBe(true);
    expect(root.classList.contains("uc-avatar")).toBe(false);
    expect(root.classList.contains("uc-border")).toBe(false);
    setUserColorToggles({ name: false, avatar: true, border: true });
    expect(root.classList.contains("uc-name")).toBe(false);
    expect(root.classList.contains("uc-avatar")).toBe(true);
    expect(root.classList.contains("uc-border")).toBe(true);
  });

  it("all toggles off removes uc-any and makes no requests", async () => {
    initUserColors({ config: config({ name: false }), request });
    expect(root.classList.contains("uc-any")).toBe(false);
    paintUserColor(el(), "@a:x");
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it("batches and dedupes requests", async () => {
    initUserColors({ config: config(), request });
    for (let i = 0; i < 100; i++) paintUserColor(el(), "@a:x");
    paintUserColor(el(), "@b:x");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toEqual(["@a:x", "@b:x"]);
    // Painted again later in the session: still no second request.
    paintUserColor(el(), "@a:x");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  describe("asking again", () => {
    // Only Date is faked: the store's setTimeout(0) batching stays real.
    const T0 = Date.UTC(2026, 10, 13, 12);
    const MIN = 60_000;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
    });
    afterEach(() => vi.useRealTimers());

    it("re-asks about a sender still unknown five minutes on", async () => {
      // A lookup that failed (offline, 429, 5xx) answers nothing; the backend
      // backs off, and a sender painted after that is asked about again.
      initUserColors({ config: config(), request });
      paintUserColor(el(), "@a:x");
      await flush();
      vi.setSystemTime(T0 + 4 * MIN);
      paintUserColor(el(), "@a:x");
      await flush();
      expect(request).toHaveBeenCalledTimes(1);
      vi.setSystemTime(T0 + 5 * MIN);
      paintUserColor(el(), "@a:x");
      await flush();
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[1][0]).toEqual(["@a:x"]);
    });

    it("re-asks about a known sender only once the answer is a day old", async () => {
      request.mockResolvedValue({ "@a:x": "#ff4466" });
      initUserColors({ config: config(), request });
      paintUserColor(el(), "@a:x");
      await flush();
      vi.setSystemTime(T0 + 60 * MIN);
      paintUserColor(el(), "@a:x");
      await flush();
      expect(request).toHaveBeenCalledTimes(1);
      vi.setSystemTime(T0 + 24 * 60 * MIN);
      paintUserColor(el(), "@a:x");
      await flush();
      expect(request).toHaveBeenCalledTimes(2);
    });
  });

  it("applies what the request returns", async () => {
    request.mockResolvedValue({ "@a:x": "#FF4466" });
    initUserColors({ config: config(), request });
    const e = el();
    paintUserColor(e, "@a:x");
    await flush();
    expect(e.style.getPropertyValue("--user-color")).toBe("#ff4466");
  });

  it("asks for nothing before init", async () => {
    paintUserColor(el(), "@a:x");
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it("requests painted senders when a toggle turns on from all-off", async () => {
    initUserColors({ config: config({ name: false }), request });
    paintUserColor(el(), "@a:x");
    await flush();
    expect(request).not.toHaveBeenCalled();
    setUserColorToggles({ name: false, avatar: true, border: false });
    await flush();
    expect(request).toHaveBeenCalledWith(["@a:x"]);
  });

  it("marks low contrast against the theme background", () => {
    initUserColors({ config: config(), request });
    receiveUserColor("@dim:x", "#0b0b0b");
    receiveUserColor("@ok:x", "#00ff41");
    const dim = el();
    const ok = el();
    paintUserColor(dim, "@dim:x");
    paintUserColor(ok, "@ok:x");
    expect(dim.classList.contains("user-color--low-contrast")).toBe(true);
    expect(ok.classList.contains("user-color--low-contrast")).toBe(false);
  });

  it("re-evaluates contrast when the theme changes", () => {
    initUserColors({ config: config(), request });
    receiveUserColor("@dim:x", "#0b0b0b");
    receiveUserColor("@yellow:x", "#ffff00");
    const dim = el();
    const yellow = el();
    paintUserColor(dim, "@dim:x");
    paintUserColor(yellow, "@yellow:x");
    root.style.setProperty("--bg", "#ffffff");
    root.dispatchEvent(new CustomEvent("quark:theme-applied"));
    expect(dim.classList.contains("user-color--low-contrast")).toBe(false);
    expect(yellow.classList.contains("user-color--low-contrast")).toBe(true);
  });

  it("reset forgets the previous account's colors", async () => {
    initUserColors({ config: config({ overrides: { "@b:x": "#00ff41" } }), request });
    receiveUserColor("@a:x", "#ff4466");
    paintUserColor(el(), "@c:x");
    resetUserColors();
    expect(root.classList.contains("uc-any")).toBe(false);
    initUserColors({ config: config(), request });
    expect(resolveUserColor("@a:x")).toBeNull();
    expect(publishedUserColor("@a:x")).toBeUndefined();
    expect(localUserColor("@b:x")).toBeNull();
    // A sender asked about before the reset is asked about again.
    paintUserColor(el(), "@c:x");
    await flush();
    expect(request.mock.calls[request.mock.calls.length - 1]?.[0]).toEqual(["@c:x"]);
  });

  describe("reply vs. pushed answers", () => {
    // The reply carries what the backend had cached (possibly a day old), and
    // the fresh lookup it starts is pushed separately; nothing orders the two.
    it("a pushed answer isn't overwritten by the stale reply that lands after it", async () => {
      let answer!: (v: Record<string, string | null>) => void;
      request.mockReturnValue(new Promise((r) => { answer = r; }));
      initUserColors({ config: config(), request });
      const a = el();
      const b = el();
      paintUserColor(a, "@a:x");
      paintUserColor(b, "@b:x");
      await flush();
      push("@a:x", "#870909");
      answer({ "@a:x": null, "@b:x": "#ffaa00" });
      await flush();
      expect(publishedUserColor("@a:x")).toBe("#870909");
      expect(a.style.getPropertyValue("--user-color")).toBe("#870909");
      // Nothing newer was pushed for @b, so the reply stands for them.
      expect(publishedUserColor("@b:x")).toBe("#ffaa00");
    });

    it("a reply applies over a push that came before the request was sent", async () => {
      initUserColors({ config: config(), request });
      await flush();
      push("@a:x", "#111111");
      request.mockResolvedValue({ "@a:x": "#222222" });
      refetchUserColor("@a:x");
      await flush();
      expect(publishedUserColor("@a:x")).toBe("#222222");
    });

    it("an answer you saved yourself isn't overwritten by an older reply", async () => {
      let answer!: (v: Record<string, string | null>) => void;
      request.mockReturnValue(new Promise((r) => { answer = r; }));
      initUserColors({ config: config(), request });
      paintUserColor(el(), "@me:x");
      await flush();
      receiveUserColor("@me:x", "#00ff41");
      answer({ "@me:x": "#ff0000" });
      await flush();
      expect(publishedUserColor("@me:x")).toBe("#00ff41");
    });

    it("asks nothing until pushed answers are being listened for", async () => {
      let attach!: () => void;
      events.listening = new Promise((r) => { attach = r; });
      initUserColors({ config: config(), request });
      paintUserColor(el(), "@a:x");
      await flush();
      // Asking now could start a lookup whose answer is pushed to nobody.
      expect(request).not.toHaveBeenCalled();
      attach();
      await flush();
      await flush();
      expect(request).toHaveBeenCalledWith(["@a:x"]);
      push("@a:x", "#870909");
      expect(publishedUserColor("@a:x")).toBe("#870909");
    });
  });

  describe("refetching (profile opened)", () => {
    it("asks again at once, even when the answer is fresh", async () => {
      request.mockResolvedValue({ "@a:x": null });
      initUserColors({ config: config(), request });
      paintUserColor(el(), "@a:x");
      await flush();
      expect(request).toHaveBeenCalledTimes(1);
      refetchUserColor("@a:x");
      await flush();
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[1]).toEqual([["@a:x"], { force: true }]);
      // A paint right after doesn't ask a third time.
      paintUserColor(el(), "@a:x");
      await flush();
      expect(request).toHaveBeenCalledTimes(2);
    });

    it("asks nothing while every treatment is off, or before init", async () => {
      refetchUserColor("@a:x");
      await flush();
      initUserColors({ config: config({ name: false }), request });
      refetchUserColor("@a:x");
      await flush();
      expect(request).not.toHaveBeenCalled();
    });
  });

  it("watchers hear changes to that user's published color until they stop", async () => {
    initUserColors({ config: config(), request });
    await flush();
    const seen: (string | null | undefined)[] = [];
    const stop = watchUserColor("@a:x", (c) => seen.push(c));
    receiveUserColor("@b:x", "#ffaa00");
    receiveUserColor("@a:x", "#FF4466");
    receiveUserColor("@a:x", "#ff4466"); // unchanged: not repeated
    push("@a:x", null);
    stop();
    receiveUserColor("@a:x", "#00ff41");
    expect(seen).toEqual(["#ff4466", null]);
  });

  it("drops answers that arrive after a reset", async () => {
    let answer!: (v: Record<string, string | null>) => void;
    request.mockReturnValue(new Promise((r) => { answer = r; }));
    initUserColors({ config: config(), request });
    paintUserColor(el(), "@a:x");
    await flush();
    resetUserColors();
    answer({ "@a:x": "#ff4466" });
    await flush();
    expect(publishedUserColor("@a:x")).toBeUndefined();
  });
});
