import { describe, it, expect } from "vitest";
import { resolveComposeSubmit } from "./compose_submit.js";

describe("resolveComposeSubmit", () => {
  it("is a no-op for an empty composer with nothing pending", () => {
    expect(
      resolveComposeSubmit({ rawValue: "", editingEventId: null, hasStagedAttachments: false }),
    ).toEqual({ kind: "none" });
  });

  it("is a no-op for whitespace-only text", () => {
    expect(
      resolveComposeSubmit({ rawValue: "   \n ", editingEventId: null, hasStagedAttachments: false }),
    ).toEqual({ kind: "none" });
  });

  it("sends non-empty text as a message, trimmed", () => {
    expect(
      resolveComposeSubmit({ rawValue: "  hello  ", editingEventId: null, hasStagedAttachments: false }),
    ).toEqual({ kind: "text", body: "hello" });
  });

  describe("staged attachments", () => {
    it("sends the attachments with no caption when the field is empty", () => {
      expect(
        resolveComposeSubmit({ rawValue: "", editingEventId: null, hasStagedAttachments: true }),
      ).toEqual({ kind: "attachments", caption: null });
    });

    it("treats a whitespace-only field as no caption", () => {
      expect(
        resolveComposeSubmit({ rawValue: "  \n ", editingEventId: null, hasStagedAttachments: true }),
      ).toEqual({ kind: "attachments", caption: null });
    });

    it("uses trimmed field text as the caption", () => {
      expect(
        resolveComposeSubmit({ rawValue: "  a cat  ", editingEventId: null, hasStagedAttachments: true }),
      ).toEqual({ kind: "attachments", caption: "a cat" });
    });
  });

  describe("edit precedence", () => {
    it("commits the edit even when attachments are staged", () => {
      expect(
        resolveComposeSubmit({ rawValue: "fixed text", editingEventId: "$e1", hasStagedAttachments: true }),
      ).toEqual({ kind: "edit", body: "fixed text" });
    });

    it("is a no-op when editing with an empty body (does not send the attachments)", () => {
      expect(
        resolveComposeSubmit({ rawValue: "  ", editingEventId: "$e1", hasStagedAttachments: true }),
      ).toEqual({ kind: "none" });
    });

    it("commits an edit with nothing staged", () => {
      expect(
        resolveComposeSubmit({ rawValue: "edited", editingEventId: "$e1", hasStagedAttachments: false }),
      ).toEqual({ kind: "edit", body: "edited" });
    });
  });
});
