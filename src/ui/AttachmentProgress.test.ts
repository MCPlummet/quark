import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AttachmentProgressList, formatBytes, renderBar } from "./AttachmentProgress.js";

describe("formatBytes", () => {
  it("keeps small sizes in bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("scales up with one decimal below 10 units", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("drops the decimal once the number is wide", () => {
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB");
  });
});

describe("renderBar", () => {
  it("renders an empty and a full bar", () => {
    expect(renderBar(0)).toBe("[░░░░░░░░░░░░]");
    expect(renderBar(1)).toBe("[████████████]");
  });

  it("clamps out-of-range fractions", () => {
    expect(renderBar(-1)).toBe(renderBar(0));
    expect(renderBar(4)).toBe(renderBar(1));
  });

  it("fills proportionally", () => {
    expect(renderBar(0.5)).toBe("[██████░░░░░░]");
  });
});

describe("AttachmentProgressList", () => {
  let list: AttachmentProgressList;
  let el: HTMLElement;

  const row = () => el.querySelector<HTMLElement>(".attach-progress__row");
  const status = () => el.querySelector<HTMLElement>(".attach-progress__status")?.textContent ?? "";
  const cancelBtn = () => el.querySelector<HTMLButtonElement>(".attach-progress__cancel");

  beforeEach(() => {
    vi.useFakeTimers();
    list = new AttachmentProgressList();
    el = list.getElement();
    document.body.appendChild(el);
  });

  afterEach(() => {
    list.clear();
    el.remove();
    vi.useRealTimers();
  });

  it("is hidden and inactive until an attachment starts", () => {
    expect(el.style.display).toBe("none");
    expect(list.isActive()).toBe(false);
    expect(row()).toBeNull();
  });

  it("shows a named row when an attachment starts", () => {
    list.start("cat.png");

    expect(el.style.display).not.toBe("none");
    expect(list.isActive()).toBe(true);
    expect(el.querySelector(".attach-progress__name")?.textContent).toBe("cat.png");
    expect(status()).toBe("reading…");
  });

  it("animates the spinner while in flight", () => {
    list.start("cat.png");
    const icon = el.querySelector<HTMLElement>(".attach-progress__icon")!;
    const first = icon.textContent;

    vi.advanceTimersByTime(100);

    expect(icon.textContent).not.toBe(first);
  });

  it("renders real byte progress as a bar plus percentage", () => {
    const h = list.start("clip.mp4");
    h.setPhase("uploading");
    h.setProgress(512 * 1024, 1024 * 1024);

    expect(status()).toBe("uploading [██████░░░░░░] 50% · 512 KB/1.0 MB");
  });

  it("falls back to the phase label when no total is known", () => {
    const h = list.start("clip.mp4");
    h.setPhase("uploading");
    h.setProgress(1024, 0);

    expect(status()).toBe("uploading…");
  });

  it("drops back to indeterminate on request", () => {
    const h = list.start("clip.mp4");
    h.setPhase("uploading");
    h.setProgress(10, 100);
    h.setIndeterminate();

    expect(status()).toBe("uploading…");
  });

  it("ticks briefly on success, then removes the row", () => {
    const h = list.start("cat.png");
    h.succeed();

    expect(el.querySelector(".attach-progress__row--success")).not.toBeNull();
    expect(status()).toBe("sent");
    expect(cancelBtn()?.style.display).toBe("none");

    vi.advanceTimersByTime(2000);

    expect(row()).toBeNull();
    expect(el.style.display).toBe("none");
    expect(list.isActive()).toBe(false);
  });

  it("surfaces a failure in place of the spinner and keeps it readable", () => {
    const h = list.start("cat.png");
    h.fail("Failed to upload media: 413 Payload Too Large");

    const failed = el.querySelector<HTMLElement>(".attach-progress__row--error");
    expect(failed).not.toBeNull();
    expect(failed?.querySelector(".attach-progress__icon")?.textContent).toBe("[!]");
    expect(status()).toContain("413 Payload Too Large");
    // The error must not vanish with the success timing.
    vi.advanceTimersByTime(2000);
    expect(el.querySelector(".attach-progress__row--error")).not.toBeNull();
  });

  it("clears a failed row once the user dismisses it", () => {
    const h = list.start("cat.png");
    h.fail("boom");

    cancelBtn()!.click();

    expect(row()).toBeNull();
    expect(el.style.display).toBe("none");
  });

  it("clears a failed row on its own eventually", () => {
    const h = list.start("cat.png");
    h.fail("boom");

    vi.advanceTimersByTime(11000);

    expect(row()).toBeNull();
  });

  it("ignores updates after a terminal state", () => {
    const h = list.start("cat.png");
    h.fail("boom");
    h.setPhase("uploading");
    h.setProgress(1, 2);

    expect(status()).toBe("boom");
  });

  it("only offers cancel when the caller can honour it", () => {
    list.start("cat.png");
    expect(cancelBtn()?.style.display).toBe("none");

    list.clear();
    list.start("dog.png", () => {});
    expect(cancelBtn()?.style.display).not.toBe("none");
  });

  it("calls back and removes the row when cancelled", () => {
    const onCancel = vi.fn();
    list.start("cat.png", onCancel);

    cancelBtn()!.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(row()).toBeNull();
    expect(list.isActive()).toBe(false);
  });

  it("hides the cancel affordance once the send can no longer be stopped", () => {
    const h = list.start("cat.png", () => {});
    h.setCancellable(false);

    expect(cancelBtn()?.style.display).toBe("none");
  });

  it("keeps concurrent attachments in their own rows", () => {
    const a = list.start("a.png");
    const b = list.start("b.png");
    a.setPhase("uploading");
    a.setProgress(1, 4);
    b.setPhase("sending");

    const statuses = [...el.querySelectorAll(".attach-progress__status")].map((s) => s.textContent);
    expect(statuses[0]).toContain("25%");
    expect(statuses[1]).toBe("sending…");

    a.dismiss();
    expect(el.querySelectorAll(".attach-progress__row")).toHaveLength(1);
    expect(el.style.display).not.toBe("none");
  });
});
