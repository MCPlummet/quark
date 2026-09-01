import { describe, it, expect, beforeEach, vi } from "vitest";
import { Input } from "./Input.js";
import { Mode } from "../vim/mode.js";

describe("Input", () => {
  let input: Input;

  beforeEach(() => {
    input = new Input();
    document.body.appendChild(input.getElement());
  });

  afterEach(() => {
    input.getElement().remove();
  });

  describe("setMode", () => {
    it("shows NOR label in Normal mode", () => {
      input.setMode(Mode.Normal);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.textContent).toBe("NOR");
    });

    it("shows INS label in Insert mode", () => {
      input.setMode(Mode.Insert);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.textContent).toBe("INS");
    });

    it("shows CMD label in Command mode", () => {
      input.setMode(Mode.Command);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.textContent).toBe("CMD");
    });

    it("shows VIS label in Visual mode", () => {
      input.setMode(Mode.Visual);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.textContent).toBe("VIS");
    });

    it("adds insert class in Insert mode", () => {
      input.setMode(Mode.Insert);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.classList.contains("input-bar__mode--insert")).toBe(true);
    });

    it("removes previous mode class when mode changes", () => {
      input.setMode(Mode.Insert);
      input.setMode(Mode.Normal);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.classList.contains("input-bar__mode--insert")).toBe(false);
    });
  });

  describe("getValue / setValue", () => {
    it("returns empty string by default", () => {
      expect(input.getValue()).toBe("");
    });

    it("setValue updates the field value", () => {
      input.setValue("hello there");
      expect(input.getValue()).toBe("hello there");
    });

    it("getValue reflects the current field content", () => {
      const field = input.getElement().querySelector<HTMLInputElement>(".input-bar__field");
      if (field) field.value = "typed text";

      expect(input.getValue()).toBe("typed text");
    });
  });

  describe("command mode", () => {
    it("shows command placeholder in Command mode", () => {
      input.setMode(Mode.Command);

      const field = input.getElement().querySelector<HTMLInputElement>(".input-bar__field");
      expect(field?.placeholder).toBe("command…");
    });

    it("restores default placeholder when leaving command mode", () => {
      input.setMode(Mode.Command);
      input.setMode(Mode.Normal);

      const field = input.getElement().querySelector<HTMLInputElement>(".input-bar__field");
      expect(field?.placeholder).toBe("…");
    });
  });

  describe("onSubmit", () => {
    it("fires handler with current value on Enter", () => {
      const handler = vi.fn();
      input.onSubmit(handler);
      input.setValue("test message");

      const field = input.getElement().querySelector<HTMLInputElement>(".input-bar__field");
      field?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(handler).toHaveBeenCalledWith("test message");
    });

    it("does not fire on Shift+Enter", () => {
      const handler = vi.fn();
      input.onSubmit(handler);

      const field = input.getElement().querySelector<HTMLInputElement>(".input-bar__field");
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })
      );

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("pending image", () => {
    // jsdom doesn't implement object URLs — stub so showImagePreview can run.
    beforeEach(() => {
      vi.stubGlobal("URL", {
        ...URL,
        createObjectURL: vi.fn(() => "blob:mock"),
        revokeObjectURL: vi.fn(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const blob = () => new Blob(["x"], { type: "image/png" });
    const preview = () => input.getElement().querySelector<HTMLElement>(".paste-preview");
    const field = () => input.getElement().querySelector<HTMLTextAreaElement>(".input-bar__field");

    it("shows the preview and reports a pending image", () => {
      expect(input.hasPendingImage()).toBe(false);
      input.showImagePreview(blob());

      expect(input.hasPendingImage()).toBe(true);
      expect(preview()?.style.display).toBe("flex");
    });

    it("labels the preview with the filename when given one", () => {
      input.showImagePreview(blob(), "cat.png");
      const label = input.getElement().querySelector(".paste-preview__label");
      expect(label?.textContent).toContain("cat.png");
    });

    it("switches the placeholder to a caption hint while pending", () => {
      input.setMode(Mode.Insert);
      input.showImagePreview(blob());
      expect(field()?.placeholder).toBe("Add a caption…");

      // Re-entering Insert must keep the hint.
      input.setMode(Mode.Insert);
      expect(field()?.placeholder).toBe("Add a caption…");
    });

    it("takePendingImage returns the blob+filename and clears state", () => {
      const b = blob();
      input.showImagePreview(b, "cat.png");

      const taken = input.takePendingImage();
      expect(taken).toEqual({ blob: b, filename: "cat.png" });
      expect(input.hasPendingImage()).toBe(false);
      expect(preview()?.style.display).toBe("none");
      expect(field()?.placeholder).toBe("…");
      // Second take is empty.
      expect(input.takePendingImage()).toBeNull();
    });

    it("takePendingImage yields filename null for a paste (no name)", () => {
      input.showImagePreview(blob());
      expect(input.takePendingImage()?.filename).toBeNull();
    });

    it("discardPendingImage hides the preview and reports whether it did anything", () => {
      expect(input.discardPendingImage()).toBe(false);

      input.showImagePreview(blob());
      expect(input.discardPendingImage()).toBe(true);
      expect(input.hasPendingImage()).toBe(false);
      expect(preview()?.style.display).toBe("none");
    });

    it("a paste event with an image in clipboard items stages the preview", () => {
      // jsdom lacks a usable DataTransfer/ClipboardEvent, so stub clipboardData.
      const evt = new Event("paste", { bubbles: true }) as unknown as ClipboardEvent;
      Object.defineProperty(evt, "clipboardData", {
        value: {
          items: [{ type: "image/png", getAsFile: () => blob() }],
          files: [],
        },
      });
      field()?.dispatchEvent(evt);

      expect(input.hasPendingImage()).toBe(true);
    });

    it("the preview Send button routes through the send-click handler", () => {
      const onSend = vi.fn();
      input.onSendClick(onSend);
      input.showImagePreview(blob());

      const sendBtn = input.getElement().querySelector<HTMLButtonElement>(".paste-preview__btn--send");
      sendBtn?.click();
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    it("the preview Cancel button discards without sending", () => {
      const onSend = vi.fn();
      input.onSendClick(onSend);
      input.showImagePreview(blob());

      const cancelBtn = input.getElement().querySelector<HTMLButtonElement>(".paste-preview__btn--cancel");
      cancelBtn?.click();
      expect(onSend).not.toHaveBeenCalled();
      expect(input.hasPendingImage()).toBe(false);
    });
  });

  // The mobile compose row is centered by styling `.input-bar__action-btn` into a
  // uniform box (#33), so every control in the cluster has to carry that class —
  // a new button added without it would sit off the shared center line.
  describe("compose-row action buttons", () => {
    function actionButtons(): HTMLButtonElement[] {
      return Array.from(
        input.getElement().querySelectorAll<HTMLButtonElement>(
          ".input-bar__actions .input-bar__action-btn",
        ),
      );
    }

    it("styles every control in the cluster as an action button", () => {
      expect(actionButtons().map((b) => b.getAttribute("aria-label"))).toEqual([
        "Open emoji picker",
        "Open GIF picker",
        "Attach file",
        "Send message",
      ]);
    });

    it("toggles the send button by display alone, leaving the styling class in place", () => {
      // setSendButtonVisible clears the inline display rather than setting one,
      // so the button falls back to the stylesheet's (flex, on mobile) box.
      const send = input.getElement().querySelector<HTMLButtonElement>(".input-bar__send-btn")!;
      expect(send.style.display).toBe("none");

      input.setSendButtonVisible(true);
      expect(send.style.display).toBe("");
      expect(send.classList.contains("input-bar__action-btn")).toBe(true);
    });
  });

  describe("hidden mode indicator", () => {
    function modeEl(): HTMLElement {
      return input.getElement().querySelector<HTMLElement>(".input-bar__mode")!;
    }

    // The indicator carries the compose row's touch-action guard on mobile, where
    // vim is always off (#33). `visibility: hidden` drops an element out of hit
    // testing, so mobile hides it by paint instead (base.css) — which it can only
    // do if the state is a class. An inline style would beat that rule and leave
    // the row's whole left edge handing drags to the viewport pan again.
    it("hides via a class, never an inline visibility, so the stylesheet can override it", () => {
      input.setVimMode(false);
      expect(modeEl().classList.contains("input-bar__mode--hidden")).toBe(true);
      expect(modeEl().style.visibility).toBe("");

      // setMode re-asserts the hidden state while vim is off — same mechanism.
      input.setMode(Mode.Normal);
      expect(modeEl().classList.contains("input-bar__mode--hidden")).toBe(true);
      expect(modeEl().style.visibility).toBe("");
    });

    it("keeps the hidden indicator out of the a11y tree", () => {
      input.setVimMode(false);
      expect(modeEl().getAttribute("aria-hidden")).toBe("true");

      input.setVimMode(true);
      expect(modeEl().classList.contains("input-bar__mode--hidden")).toBe(false);
      expect(modeEl().hasAttribute("aria-hidden")).toBe(false);
    });

    it("marks the bar --no-vim in lockstep, since the mobile geometry keys off it", () => {
      const bar = input.getElement().querySelector(".input-bar")!;

      input.setVimMode(false);
      expect(bar.classList.contains("input-bar--no-vim")).toBe(true);

      input.setVimMode(true);
      expect(bar.classList.contains("input-bar--no-vim")).toBe(false);
    });
  });

  describe("attachment progress (#63)", () => {
    const region = () => input.getElement().querySelector<HTMLElement>(".attach-progress")!;

    it("mounts a hidden progress region above the compose bar", () => {
      expect(region()).not.toBeNull();
      expect(region().style.display).toBe("none");
      expect(input.hasAttachmentProgress()).toBe(false);
      // Ahead of the paste preview and the bar itself, so the composer reads
      // top-down in the order things happened.
      const children = [...input.getElement().children];
      expect(children.indexOf(region())).toBeLessThan(
        children.indexOf(input.getElement().querySelector(".paste-preview")!),
      );
    });

    it("shows a named row while an attachment is in flight", () => {
      input.startAttachmentProgress("cat.png");

      expect(region().style.display).not.toBe("none");
      expect(input.hasAttachmentProgress()).toBe(true);
      expect(region().querySelector(".attach-progress__name")?.textContent).toBe("cat.png");
    });

    it("clears the region once the attachment finishes", () => {
      vi.useFakeTimers();
      try {
        const row = input.startAttachmentProgress("cat.png");
        row.succeed();
        vi.advanceTimersByTime(2000);

        expect(input.hasAttachmentProgress()).toBe(false);
        expect(region().style.display).toBe("none");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
