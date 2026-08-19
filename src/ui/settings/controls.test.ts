// src/ui/settings/controls.test.ts
import { describe, it, expect, vi } from "vitest";
import { makeControls } from "./controls.js";
import type { ToggleSectionSpec, ToggleState } from "./controls.js";

vi.mock("../NotificationToast.js", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

describe("SettingsControls", () => {
  it("checkbox reflects initial state and fires onChange", () => {
    const c = makeControls();
    let v = false;
    const row = c.checkbox("Enable", true, (next) => { v = next; });
    const input = row.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input.checked).toBe(true);
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(v).toBe(false);
  });

  it("selectRow renders options and reports selection", () => {
    const c = makeControls();
    let picked = "a";
    const row = c.selectRow("Mode", "a", [["a", "Alpha"], ["b", "Beta"]], (next) => { picked = next; });
    const sel = row.querySelector("select") as HTMLSelectElement;
    expect(sel.value).toBe("a");
    sel.value = "b";
    sel.dispatchEvent(new Event("change"));
    expect(picked).toBe("b");
  });

  it("sectionTitle uses the settings class", () => {
    const c = makeControls();
    expect(c.sectionTitle("X").className).toContain("settings-dialog__section-title");
  });
});

describe("toggleSection", () => {
  interface Fake extends ToggleState {
    detail: string;
  }

  const spec = (over: Partial<ToggleSectionSpec<Fake>> = {}): ToggleSectionSpec<Fake> => ({
    title: "Push notifications",
    label: "Let your homeserver wake the app",
    get: async () => ({ supported: true, enabled: false, detail: "off" }),
    set: async () => {},
    status: (s) => `state: ${s.detail}`,
    hint: () => "needs a distributor",
    failureLabel: "Push",
    ...over,
  });

  const checkbox = (el: HTMLElement) =>
    el.querySelector("input[type=checkbox]") as HTMLInputElement;

  it("renders nothing on a platform that does not support it", async () => {
    const c = makeControls();
    const section = await c.toggleSection(spec({
      get: async () => ({ supported: false, enabled: false, detail: "n/a" }),
    }));
    expect(section).toBeNull();
  });

  it("renders the title, toggle, status and hint", async () => {
    const c = makeControls();
    const section = (await c.toggleSection(spec({
      get: async () => ({ supported: true, enabled: true, detail: "registered" }),
    })))!;

    expect(section.textContent).toContain("Push notifications");
    expect(section.textContent).toContain("state: registered");
    expect(section.textContent).toContain("needs a distributor");
    expect(checkbox(section).checked).toBe(true);
  });

  // These switches carry homeserver- and OS-side effects, so they must land
  // when flipped — waiting for [save] is what let a stale draft undo them.
  it("applies the flip immediately and repaints from the backend", async () => {
    const c = makeControls();
    let enabled = false;
    const section = (await c.toggleSection(spec({
      get: async () => ({ supported: true, enabled, detail: enabled ? "on" : "off" }),
      set: async (v) => { enabled = v; },
    })))!;

    const input = checkbox(section);
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(section.textContent).toContain("state: on"));

    expect(enabled).toBe(true);
  });

  // The hint used to be painted once, which was safe only while it depended on
  // nothing that changes. `pushHint` now branches on readiness and on how many
  // distributors are installed, so a stale hint contradicts the status line
  // directly above it — "waiting for org.ntfy" under a hint still telling the
  // user to pick one.
  it("repaints a state-dependent hint, not just the status", async () => {
    const c = makeControls();
    let enabled = false;
    const section = (await c.toggleSection(spec({
      get: async () => ({ supported: true, enabled, detail: enabled ? "on" : "off" }),
      set: async (v) => { enabled = v; },
      hint: (s) => (s.enabled ? "receiving pushes" : "push is off"),
    })))!;

    expect(section.textContent).toContain("push is off");

    const input = checkbox(section);
    input.checked = true;
    input.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(section.textContent).toContain("state: on"));
    expect(section.textContent).toContain("receiving pushes");
    expect(section.textContent).not.toContain("push is off");
  });

  // An unsupported platform reports `supported: false`; it does not throw. A
  // rejection is therefore a real failure and used to vanish into `catch {}`.
  it("surfaces a failed fetch instead of swallowing it", async () => {
    const { showError } = await import("../NotificationToast.js");
    const c = makeControls();

    const section = await c.toggleSection(spec({
      get: async () => { throw new Error("ipc exploded"); },
    }));

    expect(section).toBeNull();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("ipc exploded"));
  });

  it("surfaces a failed flip", async () => {
    const { showError } = await import("../NotificationToast.js");
    vi.mocked(showError).mockClear();
    const c = makeControls();

    const section = (await c.toggleSection(spec({
      set: async () => { throw new Error("no session"); },
    })))!;
    const input = checkbox(section);
    input.checked = true;
    input.dispatchEvent(new Event("change"));

    await vi.waitFor(() =>
      expect(showError).toHaveBeenCalledWith(expect.stringContaining("no session")));
  });

  it("hosts bespoke controls and hands them a refresh", async () => {
    const c = makeControls();
    let exempt = false;
    const section = (await c.toggleSection(spec({
      get: async () => ({ supported: true, enabled: true, detail: exempt ? "exempt" : "restricted" }),
      extra: (_state, refresh) => {
        const btn = document.createElement("button");
        btn.textContent = "[ allow unrestricted battery ]";
        btn.addEventListener("click", () => {
          exempt = true;
          void refresh().then(() => btn.remove());
        });
        return btn;
      },
    })))!;

    const btn = section.querySelector("button")!;
    btn.click();

    await vi.waitFor(() => expect(section.querySelector("button")).toBeNull());
    expect(section.textContent).toContain("state: exempt");
  });
});
