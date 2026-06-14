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

  it("setProgress accumulates chunk lengths into a climbing percentage", () => {
    const b = new UpdateBanner();
    const progress = b.getElement().querySelector<HTMLElement>(".update-banner__progress")!;
    b.show(info);
    b.setProgress(25, 100);
    expect(progress.textContent).toBe("Downloading… 25%");
    b.setProgress(25, 100);
    expect(progress.textContent).toBe("Downloading… 50%");
    b.setProgress(50, 100);
    expect(progress.textContent).toBe("Downloading… 100%");
  });

  it("setProgress shows an indeterminate state when total is null", () => {
    const b = new UpdateBanner();
    const progress = b.getElement().querySelector<HTMLElement>(".update-banner__progress")!;
    b.show(info);
    b.setProgress(1024, null);
    expect(progress.textContent).toBe("Downloading…");
  });

  it("show() resets the accumulator so a re-shown banner starts at 0", () => {
    const b = new UpdateBanner();
    const progress = b.getElement().querySelector<HTMLElement>(".update-banner__progress")!;
    b.show(info);
    b.setProgress(60, 100);
    b.show(info);
    b.setProgress(10, 100);
    expect(progress.textContent).toBe("Downloading… 10%");
  });

  it("resetAfterError re-enables install and clears progress without hiding", () => {
    const b = new UpdateBanner();
    const install = b.getElement().querySelector<HTMLButtonElement>(".update-banner__install")!;
    const progress = b.getElement().querySelector<HTMLElement>(".update-banner__progress")!;
    b.show(info);
    b.setProgress(50, 100);
    expect(install.disabled).toBe(true);
    b.resetAfterError();
    expect(install.disabled).toBe(false);
    expect(progress.textContent).toBe("");
    expect(b.getElement().classList.contains("update-banner--visible")).toBe(true);
  });
});
