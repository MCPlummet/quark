import { describe, it, expect, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner.js";
import type { UpdateInfo } from "../ipc/index.js";

const info: UpdateInfo = { version: "0.15.0", current_version: "0.14.0", notes: null, date: null };

describe("UpdateBanner", () => {
  it("is hidden until show() is called", () => {
    const b = new UpdateBanner();
    expect(b.getElement().classList.contains("update-banner--visible")).toBe(false);
  });

  it("show() reveals the banner and renders the version", () => {
    const b = new UpdateBanner();
    b.show(info);
    expect(b.getElement().classList.contains("update-banner--visible")).toBe(true);
    expect(b.getElement().textContent).toContain("0.15.0");
  });

  it("install button fires onInstall", () => {
    const b = new UpdateBanner();
    const cb = vi.fn();
    b.onInstall(cb);
    b.show(info);
    b.getElement().querySelector<HTMLButtonElement>(".update-banner__install")!.click();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dismiss button fires onDismiss with the version and hides", () => {
    const b = new UpdateBanner();
    const cb = vi.fn();
    b.onDismiss(cb);
    b.show(info);
    b.getElement().querySelector<HTMLButtonElement>(".update-banner__dismiss")!.click();
    expect(cb).toHaveBeenCalledWith("0.15.0");
    expect(b.getElement().classList.contains("update-banner--visible")).toBe(false);
  });
});
