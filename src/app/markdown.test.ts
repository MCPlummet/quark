import { describe, it, expect } from "vitest";
import { markdownToHtml } from "./markdown.js";

describe("markdownToHtml", () => {
  it("returns undefined for plain text with no formatting", () => {
    expect(markdownToHtml("just a normal message")).toBeUndefined();
  });

  it("renders bold, italic, underline, strikethrough", () => {
    expect(markdownToHtml("a **b** c")).toBe("a <strong>b</strong> c");
    expect(markdownToHtml("a *b* c")).toBe("a <em>b</em> c");
    expect(markdownToHtml("a __b__ c")).toBe("a <u>b</u> c");
    expect(markdownToHtml("a ~~b~~ c")).toBe("a <del>b</del> c");
  });

  it("renders spoilers as data-mx-spoiler spans", () => {
    expect(markdownToHtml("psst ||secret||")).toBe('psst <span data-mx-spoiler>secret</span>');
  });

  it("treats inline code as literal and escapes it", () => {
    expect(markdownToHtml("run `a < b && c`")).toBe("run <code>a &lt; b &amp;&amp; c</code>");
  });

  it("does not parse markers inside inline code", () => {
    expect(markdownToHtml("`**not bold**`")).toBe("<code>**not bold**</code>");
  });

  it("prefers the longer delimiter (** over *)", () => {
    expect(markdownToHtml("**bold**")).toBe("<strong>bold</strong>");
  });

  it("nests formatting", () => {
    expect(markdownToHtml("**bold and ~~struck~~**")).toBe(
      "<strong>bold and <del>struck</del></strong>",
    );
  });

  it("leaves snake_case identifiers untouched", () => {
    expect(markdownToHtml("call send_video_now please")).toBeUndefined();
  });

  it("escapes HTML in plain segments", () => {
    expect(markdownToHtml("a < b & **c**")).toBe("a &lt; b &amp; <strong>c</strong>");
  });

  it("resolves custom emoji to mx-emoticon images and keeps formatting", () => {
    const resolveEmoji = (sc: string) => (sc === "party" ? "mxc://e/party" : undefined);
    expect(markdownToHtml("**yay** :party:", { resolveEmoji })).toBe(
      '<strong>yay</strong> <img data-mx-emoticon src="mxc://e/party" alt=":party:" title=":party:">',
    );
  });

  it("returns undefined when an emoji shortcode is unknown and there is no formatting", () => {
    expect(markdownToHtml("hi :unknown:", { resolveEmoji: () => undefined })).toBeUndefined();
  });

  describe("links (#115)", () => {
    it("renders [text](url) as an anchor", () => {
      expect(markdownToHtml("[link](https://www.google.com)")).toBe(
        '<a href="https://www.google.com">link</a>',
      );
    });

    it("renders a link mid-sentence and parses formatting in the label", () => {
      expect(markdownToHtml("see [**docs**](https://e.com/a) now")).toBe(
        'see <a href="https://e.com/a"><strong>docs</strong></a> now',
      );
    });

    it("keeps the URL literal: markers and underscores in it are not formatting", () => {
      expect(markdownToHtml("[x](https://e.com/a__b__c*d*)")).toBe(
        '<a href="https://e.com/a__b__c*d*">x</a>',
      );
    });

    it("escapes the URL for an attribute", () => {
      expect(markdownToHtml('[q](https://e.com/?a=1&b="2")')).toBe(
        '<a href="https://e.com/?a=1&amp;b=&quot;2&quot;">q</a>',
      );
    });

    it("allows one level of balanced parentheses in the URL", () => {
      expect(markdownToHtml("[w](https://en.wikipedia.org/wiki/Foo_(bar))")).toBe(
        '<a href="https://en.wikipedia.org/wiki/Foo_(bar)">w</a>',
      );
    });

    it("accepts mailto: and matrix: links", () => {
      expect(markdownToHtml("[me](mailto:a@b.c)")).toBe('<a href="mailto:a@b.c">me</a>');
      expect(markdownToHtml("[room](matrix:r/quark:e.org)")).toBe(
        '<a href="matrix:r/quark:e.org">room</a>',
      );
    });

    it("leaves unsafe or relative targets as literal text", () => {
      expect(markdownToHtml("[x](javascript:alert(1))")).toBeUndefined();
      expect(markdownToHtml("[x](/relative)")).toBeUndefined();
      expect(markdownToHtml("[x](https://has space.com)")).toBeUndefined();
    });

    it("does not splice a custom emoji into an href", () => {
      const resolveEmoji = (sc: string) => (sc === "party" ? "mxc://e/party" : undefined);
      const html = markdownToHtml("[x](https://e.com/:party:)", { resolveEmoji });
      expect(html).not.toContain("<a");
      expect(html).toContain("data-mx-emoticon");
    });
  });

  it("turns newlines into <br> in a formatted body", () => {
    expect(markdownToHtml("**a**\nb\r\nc")).toBe("<strong>a</strong><br>b<br>c");
  });

  it("leaves a multi-line message with no formatting as plain text", () => {
    expect(markdownToHtml("a\nb")).toBeUndefined();
  });

  describe("block quotes (#118)", () => {
    it("renders a quote followed by text without stray <br>", () => {
      expect(markdownToHtml("> quoted text\n\nnormal text")).toBe(
        "<blockquote>quoted text</blockquote>normal text",
      );
    });

    it("groups consecutive quote lines, accepting a bare >", () => {
      expect(markdownToHtml("> a\n>b\n> c")).toBe("<blockquote>a<br>b<br>c</blockquote>");
    });

    it("parses inline markdown inside the quote", () => {
      expect(markdownToHtml("> **bold** `x`")).toBe(
        "<blockquote><strong>bold</strong> <code>x</code></blockquote>",
      );
    });

    it("keeps text before a quote and single-newline adjacency", () => {
      expect(markdownToHtml("intro\n> q\nafter")).toBe(
        "intro<blockquote>q</blockquote>after",
      );
    });

    it("escapes HTML inside the quote", () => {
      expect(markdownToHtml("> <b>")).toBe("<blockquote>&lt;b&gt;</blockquote>");
    });

    it("does not treat > mid-line as a quote", () => {
      expect(markdownToHtml("a > b")).toBeUndefined();
    });

    it("leaves > lines inside a fenced block literal", () => {
      const out = markdownToHtml("```\n> not a quote\n```");
      expect(out === undefined || !out.includes("<blockquote>")).toBe(true);
    });
  });
});
