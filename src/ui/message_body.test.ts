import { describe, it, expect } from "vitest";
import { isEmojiOnly, renderMessageText } from "./message_body.js";
import { Timeline, type MessageData } from "./Timeline.js";

const EMOTE = '<img data-mx-emoticon src="mxc://x/y" alt=":blob:" title=":blob:">';

function rendered(body: string, html?: string): HTMLElement {
  const el = document.createElement("div");
  renderMessageText(el, body, html);
  return el;
}

describe("isEmojiOnly", () => {
  it.each([
    ["one emoji", "😀"],
    ["several, with spaces", "😀 🎉  🐉"],
    ["skin tones and ZWJ sequences", "👍🏽 👩‍💻 🏳️‍🌈"],
    ["flags", "🇳🇿🇯🇵"],
    ["a keycap", "1️⃣"],
    ["a subdivision flag", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"],
    ["text-default symbols asked for as emoji", "❤️ ☺️ ©️"],
    ["a text-default symbol with a skin tone", "☝🏽"],
  ])("is true for %s", (_, body) => {
    expect(isEmojiOnly(rendered(body))).toBe(true);
  });

  it.each([
    ["plain text", "hello"],
    ["text with an emoji", "nice 😀"],
    ["digits", "123"],
    ["whitespace only", "   "],
    ["a link", "https://example.org"],
    // Extended_Pictographic, but drawn as text without U+FE0F.
    ["©", "©"],
    ["™", "™"],
    ["text-style symbols", "‼ ↔ ☺ ®"],
  ])("is false for %s", (_, body) => {
    expect(isEmojiOnly(rendered(body))).toBe(false);
  });

  it("counts custom emoji in formatted bodies", () => {
    expect(isEmojiOnly(rendered(":blob:", EMOTE))).toBe(true);
    expect(isEmojiOnly(rendered(":blob: 😀", `<p>${EMOTE} 😀<br>${EMOTE}</p>`))).toBe(true);
  });

  it("is false when formatted text, a mention or a spoiler is involved", () => {
    expect(isEmojiOnly(rendered(":blob: hi", `${EMOTE} hi`))).toBe(false);
    expect(isEmojiOnly(rendered("😀", "<strong>😀</strong>"))).toBe(false);
    expect(isEmojiOnly(rendered("@a 😀", '<a href="https://matrix.to/#/@a:x">a</a> 😀'))).toBe(false);
    expect(isEmojiOnly(rendered("😀", "<span data-mx-spoiler>😀</span>"))).toBe(false);
  });
});

describe("renderMessageText", () => {
  it("marks emoji-only bodies, and clears the mark when re-rendered with text", () => {
    const el = rendered("🎉🎉");
    expect(el.classList.contains("message-body--emoji-only")).toBe(true);

    renderMessageText(el, "party 🎉");
    expect(el.classList.contains("message-body--emoji-only")).toBe(false);
    expect(el.textContent).toBe("party 🎉");
  });
});

describe("Timeline emoji-only messages", () => {
  const msg = (overrides: Partial<MessageData>): MessageData => ({
    id: "e1",
    senderName: "Alice",
    timestamp: "2024-01-01T12:00:00Z",
    body: "",
    ...overrides,
  });

  it("marks a message on first render and follows edits", () => {
    const timeline = new Timeline();
    document.body.appendChild(timeline.getElement());
    try {
      timeline.setMessages([msg({ body: "😀" })]);
      const body = () => timeline.getElement().querySelector(".message__body")!;
      expect(body().classList.contains("message-body--emoji-only")).toBe(true);

      timeline.updateMessageBody("e1", "😀 ok");
      expect(body().classList.contains("message-body--emoji-only")).toBe(false);

      timeline.updateMessageBody("e1", ":blob:", EMOTE);
      expect(body().classList.contains("message-body--emoji-only")).toBe(true);
      // The edit marker is appended after the check and doesn't undo it.
      expect(body().querySelector(".message__edited-marker")).not.toBeNull();
    } finally {
      timeline.getElement().remove();
    }
  });
});
