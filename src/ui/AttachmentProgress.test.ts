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

  // getElement() is a layout-free wrapper: the styled, hideable stack and the
  // screen-reader announcer live inside it.
  const stack = () => el.querySelector<HTMLElement>(".attach-progress")!;
  const announced = () => el.querySelector<HTMLElement>(".sr-only")?.textContent ?? "";
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
    expect(stack().style.display).toBe("none");
    expect(list.isActive()).toBe(false);
    expect(row()).toBeNull();
  });

  it("shows a named row when an attachment starts", () => {
    list.start("cat.png");

    expect(stack().style.display).not.toBe("none");
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
    expect(stack().style.display).toBe("none");
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
    expect(stack().style.display).toBe("none");
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

  describe("scoped to the room the attachment is going to", () => {
    it("hides a row when the user switches away, and brings it back", () => {
      list.setActiveRoom("!general:x");
      const h = list.start("clip.mp4", undefined, "!general:x");
      h.setPhase("uploading");

      list.setActiveRoom("!random:x");
      expect(row()!.style.display).toBe("none");
      expect(stack().style.display).toBe("none");
      // The upload is still running — it was hidden, not cancelled.
      expect(list.isActive()).toBe(true);

      list.setActiveRoom("!general:x");
      expect(row()!.style.display).not.toBe("none");
      expect(stack().style.display).not.toBe("none");
    });

    it("does not park a failed row in the room the user switched to", () => {
      // The whole symptom: a red `[!] clip.mp4 — <reason>` row lingers for ten
      // seconds, and used to do so in whichever room came next.
      list.setActiveRoom("!general:x");
      const h = list.start("clip.mp4", undefined, "!general:x");
      list.setActiveRoom("!random:x");
      h.fail("413 Payload Too Large");

      expect(stack().style.display).toBe("none");

      // …and it is still there, unread, on the way back.
      list.setActiveRoom("!general:x");
      expect(el.querySelector(".attach-progress__row--error")).not.toBeNull();
      expect(status()).toContain("413 Payload Too Large");
    });

    it("shows only the current room's rows when several are in flight", () => {
      list.setActiveRoom("!general:x");
      list.start("here.png", undefined, "!general:x");
      list.start("elsewhere.png", undefined, "!random:x");

      const visible = [...el.querySelectorAll<HTMLElement>(".attach-progress__row")]
        .filter((r) => r.style.display !== "none")
        .map((r) => r.querySelector(".attach-progress__name")?.textContent);
      expect(visible).toEqual(["here.png"]);
    });

    it("hides every scoped row when no room is open", () => {
      list.setActiveRoom("!general:x");
      list.start("clip.mp4", undefined, "!general:x");

      list.setActiveRoom(null);

      expect(stack().style.display).toBe("none");
    });
  });

  describe("screen-reader announcements", () => {
    it("announces phase changes but not progress ticks", () => {
      const h = list.start("clip.mp4");
      expect(announced()).toBe("clip.mp4: reading");

      h.setPhase("uploading");
      expect(announced()).toBe("clip.mp4: uploading");

      // ~100 of these land per upload; none of them may re-announce the row.
      h.setProgress(1, 100);
      h.setProgress(31, 100);
      h.setIndeterminate();
      expect(announced()).toBe("clip.mp4: uploading");

      h.setPhase("sending");
      expect(announced()).toBe("clip.mp4: sending");
    });

    it("announces the terminal state", () => {
      const h = list.start("cat.png");
      h.succeed();
      expect(announced()).toBe("cat.png: sent");

      const f = list.start("dog.png");
      f.fail("413 Payload Too Large");
      expect(announced()).toBe("dog.png: 413 Payload Too Large");
    });

    it("stays quiet for a room the user is not looking at", () => {
      list.setActiveRoom("!general:x");
      const h = list.start("clip.mp4", undefined, "!general:x");
      list.setActiveRoom("!random:x");

      h.setPhase("uploading");
      h.fail("boom");

      expect(announced()).toBe("clip.mp4: reading");
    });

    it("keeps the live region mounted while the stack is hidden", () => {
      // A live region that is `display: none` while idle announces nothing when
      // it comes back, which is why it sits outside the hideable stack.
      expect(stack().style.display).toBe("none");
      expect(el.querySelector(".sr-only")).not.toBeNull();
      expect(el.querySelector(".attach-progress .sr-only")).toBeNull();
    });
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
    expect(stack().style.display).not.toBe("none");
  });
});
