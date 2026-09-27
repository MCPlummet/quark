import { describe, it, expect, beforeEach, vi } from "vitest";
import { Input, isFileUriList, looksLikeFileListText } from "./Input.js";
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

  describe("staged attachments", () => {
    // jsdom doesn't implement object URLs — stub so image thumbnails can render.
    beforeEach(() => {
      vi.stubGlobal("URL", {
        ...URL,
        createObjectURL: vi.fn(() => "blob:mock"),
        revokeObjectURL: vi.fn(),
      });
      attached = [];
      // Stand-in for the app's `attachFiles`: record what the composer handed
      // over, and stage every file the way the app does.
      input.onAttachFiles((files) => {
        attached.push(files);
        for (const f of files) input.stageAttachment(f, f.name || null);
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    let attached: File[][] = [];
    const blob = () => new Blob(["x"], { type: "image/png" });
    const field = () => input.getElement().querySelector<HTMLTextAreaElement>(".input-bar__field");

    const tray = () => input.getElement().querySelector<HTMLElement>(".attach-tray");
    const items = () => [...input.getElement().querySelectorAll<HTMLElement>(".attach-tray__item")];
    const pdf = () => new File(["%PDF-1.4"], "notes.pdf", { type: "application/pdf" });
    const mp4 = () => new File(["v"], "clip.mp4", { type: "video/mp4" });

    it("shows the tray and reports what is staged", () => {
      expect(input.hasStagedAttachments()).toBe(false);
      expect(tray()?.style.display).toBe("none");
      input.stageAttachment(blob());

      expect(input.hasStagedAttachments()).toBe(true);
      expect(tray()?.style.display).not.toBe("none");
    });

    it("stages every kind of file, in the order added", () => {
      input.stageAttachment(blob(), "cat.png");
      input.stageAttachment(pdf(), "notes.pdf");
      input.stageAttachment(mp4(), "clip.mp4");

      expect(input.stagedAttachments().map((a) => [a.filename, a.kind])).toEqual([
        ["cat.png", "image"],
        ["notes.pdf", "file"],
        ["clip.mp4", "video"],
      ]);
      const [img, file, video] = items();
      expect(img.querySelector("img.attach-tray__thumb")).not.toBeNull();
      // Non-images are a chip: glyph, name, human size.
      expect(file.querySelector(".attach-tray__name")?.textContent).toBe("notes.pdf");
      expect(file.querySelector(".attach-tray__size")?.textContent).toBe("8 B");
      expect(video.classList.contains("attach-tray__item--video")).toBe(true);
    });

    it("labels one attachment by name and a batch by count", () => {
      const label = () => input.getElement().querySelector(".attach-tray__label")?.textContent;
      input.stageAttachment(blob(), "cat.png");
      expect(label()).toContain("cat.png");
      input.stageAttachment(pdf(), "notes.pdf");
      expect(label()).toContain("2 attachments");
    });

    it("switches the placeholder to a caption hint while anything is staged", () => {
      input.setMode(Mode.Insert);
      input.stageAttachment(pdf(), "notes.pdf");
      expect(field()?.placeholder).toBe("Add a caption…");

      // Re-entering Insert must keep the hint.
      input.setMode(Mode.Insert);
      expect(field()?.placeholder).toBe("Add a caption…");
    });

    it("takeStagedAttachments hands back everything in order and empties the tray", () => {
      const b = blob();
      const f = pdf();
      input.stageAttachment(b, "cat.png");
      input.stageAttachment(f, "notes.pdf");

      const taken = input.takeStagedAttachments();
      expect(taken.map((a) => a.file)).toEqual([b, f]);
      expect(input.hasStagedAttachments()).toBe(false);
      expect(tray()?.style.display).toBe("none");
      expect(items()).toHaveLength(0);
      expect(field()?.placeholder).toBe("…");
      expect(input.takeStagedAttachments()).toEqual([]);
    });

    it("keeps filename null for a pasted image with no name", () => {
      input.stageAttachment(blob());
      expect(input.takeStagedAttachments()[0].filename).toBeNull();
    });

    it("the × on an item removes only that item", () => {
      input.stageAttachment(blob(), "cat.png");
      input.stageAttachment(pdf(), "notes.pdf");
      input.stageAttachment(mp4(), "clip.mp4");

      items()[1].querySelector<HTMLButtonElement>(".attach-tray__remove")!.click();

      expect(input.stagedAttachments().map((a) => a.filename)).toEqual(["cat.png", "clip.mp4"]);
      expect(items()).toHaveLength(2);
    });

    it("removing the last item hides the tray", () => {
      const a = input.stageAttachment(pdf(), "notes.pdf");
      expect(input.removeStagedAttachment(a.id)).toBe(true);
      expect(input.removeStagedAttachment(a.id)).toBe(false);
      expect(tray()?.style.display).toBe("none");
    });

    it("discardStagedAttachments clears the whole tray and reports whether it did anything", () => {
      expect(input.discardStagedAttachments()).toBe(false);

      input.stageAttachment(blob());
      input.stageAttachment(pdf());
      expect(input.discardStagedAttachments()).toBe(true);
      expect(input.hasStagedAttachments()).toBe(false);
      expect(tray()?.style.display).toBe("none");
    });

    it("puts restored attachments back ahead of anything staged since", () => {
      const first = input.stageAttachment(pdf(), "first.pdf");
      const taken = input.takeStagedAttachments();
      expect(taken).toEqual([first]);
      input.stageAttachment(mp4(), "later.mp4");

      input.restoreStagedAttachments(taken);
      expect(input.stagedAttachments().map((a) => a.filename)).toEqual(["first.pdf", "later.mp4"]);
      expect(items().map((el) => el.querySelector(".attach-tray__name")?.textContent)).toEqual([
        "first.pdf",
        "later.mp4",
      ]);
    });

    it("revokes an image thumbnail's object URL when the item goes", () => {
      const a = input.stageAttachment(blob(), "cat.png");
      input.removeStagedAttachment(a.id);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    });

    it("a paste event with an image in clipboard items stages it", () => {
      // jsdom lacks a usable DataTransfer/ClipboardEvent, so stub clipboardData.
      const evt = new Event("paste", { bubbles: true }) as unknown as ClipboardEvent;
      Object.defineProperty(evt, "clipboardData", {
        value: {
          items: [{ type: "image/png", getAsFile: () => blob() }],
          files: [],
        },
      });
      field()?.dispatchEvent(evt);

      expect(input.hasStagedAttachments()).toBe(true);
    });

    // #83: every branch filtered on `image/`, so a PDF fell through to the
    // browser's default text paste and vanished — even though the attach button
    // beside it has sent those as m.file all along.
    it("hands a pasted non-image file to the attach handler", () => {
      const pdf = new File(["%PDF"], "notes.pdf", { type: "application/pdf" });

      const evt = new Event("paste", { bubbles: true, cancelable: true }) as unknown as ClipboardEvent;
      Object.defineProperty(evt, "clipboardData", {
        value: { items: [{ type: "application/pdf", getAsFile: () => pdf }], files: [] },
      });
      field()?.dispatchEvent(evt);

      expect(attached).toHaveLength(1);
      expect(attached[0].map((f) => f.name)).toEqual(["notes.pdf"]);
      expect(evt.defaultPrevented).toBe(true);
    });

    // Copying several files in a file manager puts all of them on the
    // clipboard; the handler used to return after the first.
    it("hands over every file on the clipboard, not just the first", () => {
      const a = new File(["a"], "a.txt", { type: "text/plain" });
      const b = new File(["b"], "b.zip", { type: "application/zip" });
      const evt = new Event("paste", { bubbles: true }) as unknown as ClipboardEvent;
      Object.defineProperty(evt, "clipboardData", {
        value: {
          items: [
            { type: "text/plain", getAsFile: () => a },
            { type: "text/plain", getAsFile: () => null }, // a string flavour
            { type: "application/zip", getAsFile: () => b },
          ],
          files: [],
        },
      });
      field()?.dispatchEvent(evt);

      expect(attached[0].map((f) => f.name)).toEqual(["a.txt", "b.zip"]);
    });

    it("falls back to clipboardData.files when items carry none", () => {
      const a = new File(["a"], "a.txt", { type: "text/plain" });
      const evt = new Event("paste", { bubbles: true }) as unknown as ClipboardEvent;
      Object.defineProperty(evt, "clipboardData", { value: { items: [], files: [a] } });
      field()?.dispatchEvent(evt);

      expect(attached[0]).toEqual([a]);
    });

    // An engine that hands back an untyped File for an image clipboard target
    // would otherwise send the picture as a nameless `m.file`.
    it("keeps the clipboard item's image type when the file has none", () => {
      const untyped = new File(["x"], "", { type: "" });
      const evt = new Event("paste", { bubbles: true }) as unknown as ClipboardEvent;
      Object.defineProperty(evt, "clipboardData", {
        value: { items: [{ type: "image/bmp", getAsFile: () => untyped }], files: [] },
      });
      field()?.dispatchEvent(evt);

      expect(attached[0][0].type).toBe("image/bmp");
      expect(input.hasStagedAttachments()).toBe(true);
    });

    it("keeps a pasted image file's own name instead of inventing one", () => {
      const png = new File(["x"], "screenshot.png", { type: "image/png" });
      const evt = new Event("paste", { bubbles: true }) as unknown as ClipboardEvent;
      Object.defineProperty(evt, "clipboardData", {
        value: { items: [{ type: "image/png", getAsFile: () => png }], files: [] },
      });
      field()?.dispatchEvent(evt);

      expect(input.takeStagedAttachments()[0]?.filename).toBe("screenshot.png");
    });

    // The async clipboard fallback (Linux/WebKitGTK) cannot call
    // `preventDefault()` — whether there is an image to paste is not known
    // until the read resolves. So the clipboard's *text* flavour gets typed
    // into the composer at the same moment the image stages, and has to be
    // taken back out.
    describe("async clipboard fallback", () => {
      /** Drive a paste with no synchronous file, holding the clipboard read open. */
      function pasteWithClipboardImage() {
        let resolveRead!: (items: unknown[]) => void;
        const read = vi.fn(() => new Promise((res) => { resolveRead = res as typeof resolveRead; }));
        Object.defineProperty(navigator, "clipboard", {
          value: { read },
          configurable: true,
        });

        const evt = new Event("paste", { bubbles: true }) as unknown as ClipboardEvent;
        Object.defineProperty(evt, "clipboardData", { value: { items: [], files: [] } });
        field()?.dispatchEvent(evt);

        const deliverImage = async () => {
          resolveRead([
            {
              types: ["image/png"],
              getType: async () => new Blob(["x"], { type: "image/png" }),
            },
          ]);
          // The read, then getType, then the staging — three hops.
          await new Promise((r) => setTimeout(r, 0));
          await new Promise((r) => setTimeout(r, 0));
        };
        return { deliverImage };
      }

      /** Let the post-paste snapshot (a `setTimeout(…, 0)`) land. */
      const settle = () => new Promise((r) => setTimeout(r, 0));

      it("removes the text the default paste inserted once an image arrives", async () => {
        const f = field()!;
        f.value = "hello";
        f.selectionStart = f.selectionEnd = 5;

        const { deliverImage } = pasteWithClipboardImage();
        f.value = "hello https://example.org/img.png"; // the default paste
        await settle();
        await deliverImage();

        expect(f.value).toBe("hello");
        expect(input.hasStagedAttachments()).toBe(true);
      });

      // `clipboard.read()` can sit behind a permission prompt, so the window is
      // not always a microtask. Restoring a stale snapshot wholesale would take
      // the user's sentence with it.
      it("leaves the field alone if the user typed while the read was pending", async () => {
        const f = field()!;
        f.value = "hello";

        const { deliverImage } = pasteWithClipboardImage();
        f.value = "hello https://example.org/img.png";
        await settle();
        f.value = "hello https://example.org/img.png and more"; // user kept typing
        await deliverImage();

        expect(f.value).toBe("hello https://example.org/img.png and more");
        // The image still stages — only the undo stands down.
        expect(input.hasStagedAttachments()).toBe(true);
      });

      // An image on the clipboard does not make the text beside it a stand-in
      // for the image. A rich selection copied out of a browser or a spreadsheet
      // carries text/plain *and* image/png, and the undo used to fire on the
      // image alone — deleting a paste the user had asked for.
      it("keeps pasted prose that merely shares the clipboard with an image", async () => {
        const f = field()!;
        f.value = "";

        const { deliverImage } = pasteWithClipboardImage();
        f.value = "Q1 revenue was up 12%";
        await settle();
        await deliverImage();

        expect(f.value).toBe("Q1 revenue was up 12%");
        // The image still stages — only the undo stands down.
        expect(input.hasStagedAttachments()).toBe(true);
      });

      it("keeps a pasted single word", async () => {
        const f = field()!;
        f.value = "";

        const { deliverImage } = pasteWithClipboardImage();
        f.value = "changelog";
        await settle();
        await deliverImage();

        expect(f.value).toBe("changelog");
      });

      it("removes a pasted file path, which is a stand-in like a URL", async () => {
        const f = field()!;
        f.value = "";

        const { deliverImage } = pasteWithClipboardImage();
        f.value = "/home/u/Pictures/shot.png";
        await settle();
        await deliverImage();

        expect(f.value).toBe("");
        expect(input.hasStagedAttachments()).toBe(true);
      });

      it("disturbs nothing when the paste inserted no text", async () => {
        const f = field()!;
        f.value = "hello";

        const { deliverImage } = pasteWithClipboardImage();
        await settle();
        await deliverImage();

        expect(f.value).toBe("hello");
        expect(input.hasStagedAttachments()).toBe(true);
      });
    });

    // A file-manager copy (Dolphin, Nautilus) reaches WebKitGTK only as text —
    // the files' URIs or paths — which the page cannot open. The backend reads
    // the list off the OS clipboard instead.
    describe("files copied in a file manager", () => {
      const copiedPng = () => new File(["x"], "shot.png", { type: "image/png" });
      const copiedPdf = () => new File(["%PDF"], "doc.pdf", { type: "application/pdf" });
      const flush = async () => {
        for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
      };

      function paste(data: Record<string, string>) {
        const evt = new Event("paste", { bubbles: true, cancelable: true }) as unknown as ClipboardEvent;
        Object.defineProperty(evt, "clipboardData", {
          value: { items: [], files: [], getData: (t: string) => data[t] ?? "" },
        });
        field()!.dispatchEvent(evt);
        return evt;
      }

      beforeEach(() => {
        // No async image path in these: the file list is the whole story.
        Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      });

      it("intercepts a file:// URI list and attaches what the backend read", async () => {
        const reader = vi.fn(async () => ({ files: [copiedPng(), copiedPdf()], listed: true }));
        input.setClipboardFileReader(reader);

        const evt = paste({
          "text/plain": "file:///home/u/shot.png\nfile:///home/u/doc.pdf",
          "text/uri-list": "file:///home/u/shot.png\r\nfile:///home/u/doc.pdf\r\n",
        });
        expect(evt.defaultPrevented).toBe(true);
        await flush();

        expect(reader).toHaveBeenCalledTimes(1);
        expect(attached[0].map((f) => f.name)).toEqual(["shot.png", "doc.pdf"]);
        expect(field()!.value).toBe("");
      });

      it("intercepts on the text flavour alone when there is no uri-list", async () => {
        input.setClipboardFileReader(async () => ({ files: [copiedPdf()], listed: true }));
        const evt = paste({ "text/plain": "file:///home/u/doc.pdf" });
        expect(evt.defaultPrevented).toBe(true);
        await flush();
        expect(attached[0].map((f) => f.name)).toEqual(["doc.pdf"]);
      });

      it("pastes the URI text after all when the OS clipboard holds no file list", async () => {
        input.setClipboardFileReader(async () => ({ files: [], listed: false }));
        const f = field()!;
        f.value = "see ";
        f.selectionStart = f.selectionEnd = 4;

        paste({ "text/plain": "file:///tmp/x.log" });
        await flush();

        expect(attached).toHaveLength(0);
        expect(f.value).toBe("see file:///tmp/x.log");
      });

      it("pastes nothing when the list held only things that can't attach", async () => {
        // The reader has already reported the folder; the URI is not a message.
        input.setClipboardFileReader(async () => ({ files: [], listed: true }));
        paste({ "text/plain": "file:///home/u/Pictures" });
        await flush();

        expect(attached).toHaveLength(0);
        expect(field()!.value).toBe("");
      });

      it("leaves an ordinary text paste alone and never asks the backend", async () => {
        const reader = vi.fn(async () => ({ files: [], listed: false }));
        input.setClipboardFileReader(reader);
        const evt = paste({ "text/plain": "hello there", "text/uri-list": "" });
        await flush();

        expect(evt.defaultPrevented).toBe(false);
        expect(reader).not.toHaveBeenCalled();
      });

      it("does not treat a copied web link as a file list", async () => {
        const reader = vi.fn(async () => ({ files: [], listed: false }));
        input.setClipboardFileReader(reader);
        const evt = paste({ "text/plain": "https://e.com/a.png", "text/uri-list": "https://e.com/a.png" });
        await flush();

        expect(evt.defaultPrevented).toBe(false);
        expect(reader).not.toHaveBeenCalled();
      });

      // Nautilus offers the list's plain text as bare paths. Those are also
      // what a user copies out of a terminal, so the paste goes ahead and is
      // only taken back out if the clipboard really held files.
      it("takes pasted paths back out when they were a file-manager copy", async () => {
        input.setClipboardFileReader(async () => ({ files: [copiedPng()], listed: true }));
        const f = field()!;
        f.value = "";

        const evt = paste({ "text/plain": "/home/u/My Pictures/shot.png" });
        expect(evt.defaultPrevented).toBe(false);
        f.value = "/home/u/My Pictures/shot.png"; // the default paste
        await flush();

        expect(attached[0].map((x) => x.name)).toEqual(["shot.png"]);
        expect(f.value).toBe("");
      });

      it("keeps pasted paths that were only text", async () => {
        input.setClipboardFileReader(async () => ({ files: [], listed: false }));
        const f = field()!;
        paste({ "text/plain": "/etc/hosts" });
        f.value = "/etc/hosts";
        await flush();

        expect(attached).toHaveLength(0);
        expect(f.value).toBe("/etc/hosts");
      });

      it("asks the backend when the engine exposed nothing at all", async () => {
        const reader = vi.fn(async () => ({ files: [copiedPdf()], listed: true }));
        input.setClipboardFileReader(reader);
        paste({});
        await flush();

        expect(reader).toHaveBeenCalledTimes(1);
        expect(attached[0].map((x) => x.name)).toEqual(["doc.pdf"]);
      });

      it("pastes the text when the backend read fails", async () => {
        input.setClipboardFileReader(async () => { throw new Error("no clipboard"); });
        paste({ "text/plain": "file:///tmp/a.txt" });
        await flush();
        expect(field()!.value).toBe("file:///tmp/a.txt");
      });
    });

    it("isFileUriList / looksLikeFileListText", () => {
      expect(isFileUriList("file:///a\r\nfile:///b\r\n")).toBe(true);
      expect(isFileUriList("# comment\nfile:///a")).toBe(true);
      expect(isFileUriList("file:///a\nhttps://e.com")).toBe(false);
      expect(isFileUriList("")).toBe(false);
      expect(looksLikeFileListText("/home/u/a b.png\n/home/u/c.png")).toBe(true);
      expect(looksLikeFileListText("hello /home")).toBe(false);
    });

    it("the tray's Send button routes through the send-click handler", () => {
      const onSend = vi.fn();
      input.onSendClick(onSend);
      input.stageAttachment(blob());

      const sendBtn = input.getElement().querySelector<HTMLButtonElement>(".attach-tray__btn--send");
      sendBtn?.click();
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    it("the tray's Cancel button clears everything without sending", () => {
      const onSend = vi.fn();
      input.onSendClick(onSend);
      input.stageAttachment(blob());
      input.stageAttachment(pdf());

      const cancelBtn = input.getElement().querySelector<HTMLButtonElement>(".attach-tray__btn--cancel");
      cancelBtn?.click();
      expect(onSend).not.toHaveBeenCalled();
      expect(input.hasStagedAttachments()).toBe(false);
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
    const rowCount = () => region().querySelectorAll(".attach-progress__row").length;

    it("mounts a hidden progress region above the compose bar", () => {
      expect(region()).not.toBeNull();
      expect(region().style.display).toBe("none");
      expect(rowCount()).toBe(0);
      // Ahead of the attachment tray and the bar itself, so the composer reads
      // top-down in the order things happened.
      const children = [...input.getElement().children];
      expect(children.indexOf(region())).toBeLessThan(
        children.indexOf(input.getElement().querySelector(".attach-tray")!),
      );
    });

    it("shows a named row while an attachment is in flight", () => {
      input.startAttachmentProgress("cat.png");

      expect(region().style.display).not.toBe("none");
      expect(rowCount()).toBe(1);
      expect(region().querySelector(".attach-progress__name")?.textContent).toBe("cat.png");
    });

    it("clears the region once the attachment finishes", () => {
      vi.useFakeTimers();
      try {
        const row = input.startAttachmentProgress("cat.png");
        row.succeed();
        vi.advanceTimersByTime(2000);

        expect(rowCount()).toBe(0);
        expect(region().style.display).toBe("none");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
