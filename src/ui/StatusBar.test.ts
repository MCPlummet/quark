import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StatusBar } from "./StatusBar.js";

describe("StatusBar", () => {
  let bar: StatusBar;
  const q = <T extends Element = HTMLElement>(sel: string) => bar.getElement().querySelector<T & HTMLElement>(sel);

  beforeEach(() => {
    bar = new StatusBar();
    document.body.appendChild(bar.getElement());
  });

  afterEach(() => {
    bar.getElement().remove();
  });

  it("puts you and the controls on top, and the status on its own line below", () => {
    const rows = Array.from(bar.getElement().children).map((el) => el.className);
    expect(rows).toEqual(["status-bar__main", "status-bar__line"]);
    const top = Array.from(q(".status-bar__main")!.children).map(
      (el) => Array.from(el.classList).find((c) => /^status-bar__[a-z]+$/.test(c) && c !== "status-bar__btn"),
    );
    expect(top).toEqual(["status-bar__profile", "status-bar__invites", "status-bar__search", "status-bar__settings"]);
    expect(q(".status-bar__line .status-bar__status")).not.toBeNull();
  });

  it("shows your name beside the avatar, as part of the profile button", () => {
    bar.setOwnName("Cyrillus");
    expect(q(".status-bar__profile .status-bar__name")?.textContent).toBe("Cyrillus");
  });

  it("draws its control icons as SVG, not font glyphs", () => {
    for (const sel of [".status-bar__invites", ".status-bar__search", ".status-bar__settings"]) {
      expect(q(sel)?.querySelector("svg.icon"), sel).not.toBeNull();
    }
  });

  describe("buttons", () => {
    it.each([
      ["profile", ".status-bar__profile", (b: StatusBar, f: () => void) => b.onProfileClick(f)],
      ["invites", ".status-bar__invites", (b: StatusBar, f: () => void) => b.onInvitesClick(f)],
      ["search", ".status-bar__search", (b: StatusBar, f: () => void) => b.onSearchClick(f)],
      ["settings", ".status-bar__settings", (b: StatusBar, f: () => void) => b.onSettingsClick(f)],
    ])("the %s button calls its handler", (_name, sel, wire) => {
      const handler = vi.fn();
      wire(bar, handler);
      q<HTMLButtonElement>(sel)!.click();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("setConnected", () => {
    it("starts offline", () => {
      expect(bar.isConnected()).toBe(false);
      expect(q(".status-bar__conn-dot")?.classList.contains("status-bar__conn-dot--offline")).toBe(true);
    });

    it("draws the connection as the dot on your avatar", () => {
      bar.setConnected(true);
      const dot = q(".status-bar__profile .status-bar__conn-dot");
      expect(dot?.classList.contains("status-bar__conn-dot--online")).toBe(true);
      expect(dot?.classList.contains("status-bar__conn-dot--offline")).toBe(false);
      expect(q(".status-bar__profile")?.getAttribute("aria-label")).toContain("connected");
    });

    it("marks the whole bar offline when the connection drops", () => {
      bar.setConnected(true);
      bar.setConnected(false);
      expect(bar.getElement().classList.contains("status-bar--offline")).toBe(true);
      expect(q(".status-bar__profile")?.getAttribute("aria-label")).toContain("offline");
    });
  });

  describe("setOwnProfile", () => {
    it("shows the initial until an avatar resolves", () => {
      bar.setOwnProfile("cyrillus", null);
      expect(q(".status-bar__profile-initial")?.textContent).toBe("C");
      expect(q(".status-bar__profile img")).toBeNull();
    });

    it("shows the avatar and keeps the connection dot", () => {
      bar.setConnected(true);
      bar.setOwnProfile("c", "data:image/png;base64,AAA");
      expect(q<HTMLImageElement>(".status-bar__profile img")?.src).toBe("data:image/png;base64,AAA");
      expect(q(".status-bar__profile .status-bar__conn-dot--online")).not.toBeNull();
    });

    it("falls back to the initial if the avatar fails to decode", () => {
      bar.setOwnProfile("quark", "data:image/png;base64,BROKEN");
      q(".status-bar__profile img")!.dispatchEvent(new Event("error"));
      expect(q(".status-bar__profile-initial")?.textContent).toBe("Q");
    });
  });

  describe("setInviteCount", () => {
    it("shows nothing and stays dim with no invites", () => {
      bar.setInviteCount(0);
      expect(q(".status-bar__count")?.textContent).toBe("");
      expect(q(".status-bar__invites")?.classList.contains("status-bar__invites--pending")).toBe(false);
    });

    it("shows the count and lights up with invites waiting", () => {
      bar.setInviteCount(3);
      expect(q(".status-bar__count")?.textContent).toBe("3");
      expect(q(".status-bar__invites")?.classList.contains("status-bar__invites--pending")).toBe(true);
      expect(q(".status-bar__invites")?.getAttribute("aria-label")).toBe("Invites — 3 pending invites");
    });
  });

  describe("status message", () => {
    it("shows the placeholder when unset", () => {
      bar.setStatusMessage("");
      expect(q(".status-bar__status")?.textContent).toBe("set status…");
      expect(bar.getStatusMessage()).toBe("");
    });

    it("commits an edit on Enter", () => {
      const onSet = vi.fn();
      bar.onSetStatus(onSet);
      bar.beginEdit();
      const input = q<HTMLInputElement>(".status-bar__status-input")!;
      input.value = "  hacking  ";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect(onSet).toHaveBeenCalledWith("hacking");
      expect(q(".status-bar__status")?.textContent).toBe("hacking");
    });

    it("still saves when removing the input fires blur mid-commit", () => {
      // Chromium fires blur synchronously while a focused input is removed.
      const onSet = vi.fn();
      bar.onSetStatus(onSet);
      bar.beginEdit();
      const input = q<HTMLInputElement>(".status-bar__status-input")!;
      const realReplace = input.replaceWith.bind(input);
      input.replaceWith = (...nodes: (string | Node)[]) => {
        input.dispatchEvent(new FocusEvent("blur"));
        realReplace(...nodes);
      };
      input.value = "busy";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect(onSet).toHaveBeenCalledWith("busy");
      expect(q(".status-bar__status")?.textContent).toBe("busy");
    });

    it("cancels an edit on Escape", () => {
      bar.setStatusMessage("busy");
      const onSet = vi.fn();
      bar.onSetStatus(onSet);
      bar.beginEdit();
      q<HTMLInputElement>(".status-bar__status-input")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(onSet).not.toHaveBeenCalled();
      expect(q(".status-bar__status")?.textContent).toBe("busy");
    });
  });
});
