// Lightweight inline markdown → Matrix HTML (org.matrix.custom.html) for the
// compose box (#54). Deliberately small and chat-oriented (Discord-style
// conventions) rather than a full CommonMark implementation:
//
//   **bold**      → <strong>
//   *italic*      → <em>
//   __underline__ → <u>
//   ~~strike~~    → <del>
//   ||spoiler||   → <span data-mx-spoiler> (MSC2010, rendered blur-until-click)
//   `code`        → <code> (content is literal — not parsed or emoji-replaced)
//   [text](url)   → <a href="url"> (http/https/mailto/matrix only; the label is
//                   parsed, the URL is literal)
//
// Newlines become <br>: other clients render formatted_body as ordinary HTML,
// where a bare newline collapses to a space.
//
// We use `*` (not `_`) for italic and require double underscores for underline,
// so snake_case identifiers aren't mangled. Custom emoji shortcodes are
// resolved to <img data-mx-emoticon> (MSC2545) and pass through formatting
// untouched.

export interface MarkdownOptions {
  /** Resolve a custom-emoji shortcode to an mxc URL, or undefined if not custom. */
  resolveEmoji?: (shortcode: string) => string | undefined;
}

const SHORTCODE_RE = /:([a-zA-Z0-9_+-]+):/g;

// Sentinel that brackets a resolved-emoji placeholder. A NUL byte never appears
// in user text, isn't a regex metacharacter, and is left untouched by the HTML
// escaper — so staged emoji survive inline formatting and escaping intact.
const PH = String.fromCharCode(0);

interface InlineRule {
  /** Capture group 1 is the inner content; later groups go to `render`. */
  re: RegExp;
  render: (inner: string, match: RegExpExecArray) => string;
  /** Content is literal: escaped but not recursively parsed (inline code). */
  raw?: boolean;
}

/**
 * `[label](url)`. The scheme is part of the pattern rather than checked after a
 * match, so a link with any other scheme (`javascript:`, a relative path) never
 * matches and stays literal text — there is no half-rendered state. One level
 * of balanced parentheses is allowed in the URL, for the Wikipedia-style
 * `…/Foo_(bar)`; whitespace ends it, as in CommonMark. The NUL of a staged
 * custom-emoji placeholder ends it too, so a `:shortcode:` that happens to sit in
 * a URL can never splice an `<img>` into an `href`.
 */
const LINK_RE =
  /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:|matrix:)(?:[^()\s\x00]|\([^()\s\x00]*\))+)\)/;

const RULES: InlineRule[] = [
  { re: /`([^`\n]+?)`/, render: (s) => `<code>${s}</code>`, raw: true },
  { re: LINK_RE, render: (s, m) => `<a href="${escapeAttr(m[2])}">${s}</a>` },
  { re: /\|\|([\s\S]+?)\|\|/, render: (s) => `<span data-mx-spoiler>${s}</span>` },
  { re: /\*\*([\s\S]+?)\*\*/, render: (s) => `<strong>${s}</strong>` },
  { re: /__([\s\S]+?)__/, render: (s) => `<u>${s}</u>` },
  { re: /~~([\s\S]+?)~~/, render: (s) => `<del>${s}</del>` },
  { re: /\*([\s\S]+?)\*/, render: (s) => `<em>${s}</em>` },
];

const escapeText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, "&quot;");

/**
 * Convert compose-box markdown to a Matrix HTML formatted_body, with custom
 * emoji shortcodes resolved to images. Returns `undefined` when the text has
 * no formatting and no custom emoji, signalling a plain-text message.
 */
export function markdownToHtml(text: string, opts: MarkdownOptions = {}): string | undefined {
  // 1. Swap resolvable custom emoji out for placeholders so formatting doesn't
  //    touch them and their shortcode text isn't escaped.
  const emojiHtml: string[] = [];
  const staged = text.replace(SHORTCODE_RE, (full, shortcode: string) => {
    const mxc = opts.resolveEmoji?.(shortcode);
    if (!mxc) return full;
    const idx = emojiHtml.length;
    emojiHtml.push(
      `<img data-mx-emoticon src="${mxc}" alt=":${shortcode}:" title=":${shortcode}:">`,
    );
    return `${PH}${idx}${PH}`;
  });

  // 2. Render inline markdown, tracking whether anything actually matched.
  let formatted = false;
  const html = renderInline(staged, () => {
    formatted = true;
  });

  if (emojiHtml.length === 0 && !formatted) return undefined;

  // 3. Restore emoji placeholders as raw HTML, and turn newlines into <br> —
  //    the plain body keeps its line breaks, and the formatted one has to say
  //    the same thing to a client that doesn't render it pre-wrapped.
  return html
    .replace(new RegExp(`${PH}(\\d+)${PH}`, "g"), (_full, i: string) => emojiHtml[Number(i)] ?? "")
    .replace(/\r?\n/g, "<br>");
}

function renderInline(text: string, onMatch: () => void): string {
  // Pick the earliest match across all rules; on a tie, the longest marker
  // wins so `**` beats `*` and `||` beats a stray `|`.
  let best: { index: number; len: number; rule: InlineRule; match: RegExpExecArray } | null = null;
  for (const rule of RULES) {
    const m = new RegExp(rule.re.source).exec(text);
    if (!m) continue;
    if (
      best === null ||
      m.index < best.index ||
      (m.index === best.index && m[0].length > best.len)
    ) {
      best = { index: m.index, len: m[0].length, rule, match: m };
    }
  }

  if (!best) return escapeText(text);

  onMatch();
  const before = text.slice(0, best.index);
  const after = text.slice(best.index + best.len);
  const inner = best.match[1];
  const innerHtml = best.rule.raw ? escapeText(inner) : renderInline(inner, onMatch);
  return escapeText(before) + best.rule.render(innerHtml, best.match) + renderInline(after, onMatch);
}
