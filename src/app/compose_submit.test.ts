import { describe, it, expect } from "vitest";
import { resolveComposeSubmit } from "./compose_submit.js";

describe("resolveComposeSubmit", () => {
  it("is a no-op for an empty composer with nothing pending", () => {
    expect(
      resolveComposeSubmit({ rawValue: "", editingEventId: null, hasPendingImage: false }),
    ).toEqual({ kind: "none" });
  });

  it("is a no-op for whitespace-only text", () => {
    expect(
      resolveComposeSubmit({ rawValue: "   \n ", editingEventId: null, hasPendingImage: false }),
    ).toEqual({ kind: "none" });
  });

  it("sends non-empty text as a message, trimmed", () => {
    expect(
      resolveComposeSubmit({ rawValue: "  hello  ", editingEventId: null, hasPendingImage: false }),
    ).toEqual({ kind: "text", body: "hello" });
  });

  describe("pending image", () => {
    it("sends the image with no caption when the field is empty", () => {
      expect(
        resolveComposeSubmit({ rawValue: "", editingEventId: null, hasPendingImage: true }),
      ).toEqual({ kind: "image", caption: null });
    });

    it("treats a whitespace-only field as no caption", () => {
      expect(
        resolveComposeSubmit({ rawValue: "  \n ", editingEventId: null, hasPendingImage: true }),
      ).toEqual({ kind: "image", caption: null });
    });

    it("uses trimmed field text as the caption", () => {
      expect(
        resolveComposeSubmit({ rawValue: "  a cat  ", editingEventId: null, hasPendingImage: true }),
      ).toEqual({ kind: "image", caption: "a cat" });
    });
  });

  describe("edit precedence", () => {
    it("commits the edit even when an image is pending", () => {
      expect(
        resolveComposeSubmit({ rawValue: "fixed text", editingEventId: "$e1", hasPendingImage: true }),
      ).toEqual({ kind: "edit", body: "fixed text" });
    });

    it("is a no-op when editing with an empty body (does not send the image)", () => {
      expect(
        resolveComposeSubmit({ rawValue: "  ", editingEventId: "$e1", hasPendingImage: true }),
      ).toEqual({ kind: "none" });
    });

    it("commits an edit with no image pending", () => {
      expect(
        resolveComposeSubmit({ rawValue: "edited", editingEventId: "$e1", hasPendingImage: false }),
      ).toEqual({ kind: "edit", body: "edited" });
    });
  });
});
