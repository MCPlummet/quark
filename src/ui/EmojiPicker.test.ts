import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

let mobile = false;
vi.mock("../app/mobile.js", async (importActual) => ({
  ...(await importActual<typeof import("../app/mobile.js")>()),
  isMobile: () => mobile,
  viewportPan: () => 0,
}));

import { EmojiPicker, type EmojiPickerContext } from "./EmojiPicker.js";
import { COMMON_EMOJI, stripVariationSelectors, type CustomEmojiPack } from "./emoji_catalog.js";
import { registerDefaultBindings } from "../app/registry.js";
import { keymapManager } from "../vim/keybindings.js";

// The compose box and reactions open the same picker with different contexts.
// They had drifted apart twice over as two pickers; these tests are what fails
// if the two contexts ever start to list, find or move through emoji
// differently again. Everything that is allowed to differ is in the context.

const PACKS: CustomEmojiPack[] = [
  {
    id: "blobs",
    name: "Blobs",
    emojis: [
      { shortcode: "partyblob", url: "mxc://x/party", body: "Party blob" },
      { shortcode: "blobcat", url: "mxc://x/cat", body: "Blob cat", imageUrl: "data:image/png;base64,Q0FU" },
    ],
  },
];

type Kind = "compose" | "reaction";

function context(kind: Kind): EmojiPickerContext {
  if (kind === "compose") {
    return {
      label: "Emoji picker",
      onEmoji: vi.fn(),
      media: { onStickerTab: vi.fn(), onSticker: vi.fn(), onGif: vi.fn() },
    };
  }
  const anchor = document.createElement("div");
  document.body.appendChild(anchor);
  return {
    label: "Add reaction",
    onEmoji: vi.fn(),
    text: { label: "react with", onText: vi.fn() },
    anchor,
  };
}

let picker: EmojiPicker;

beforeAll(() => {
  registerDefaultBindings();
});

beforeEach(() => {
  mobile = false;
  picker = new EmojiPicker();
  document.body.appendChild(picker.getElement());
  picker.setCustomPacks(PACKS);
});

afterEach(() => {
  picker.hide();
  document.body.replaceChildren();
  keymapManager.resetSequence();
});

const root = () => picker.getElement();
const search = () => root().querySelector<HTMLInputElement>(".emoji-picker__search")!;
const visibleGrid = () =>
  [...root().querySelectorAll<HTMLElement>(".emoji-picker__grid")].find((g) => g.style.display !== "none")!;
/** The emoji ids the visible grid shows, in order (none when no match). */
const cellIds = () =>
  [...(visibleGrid()?.querySelectorAll<HTMLElement>(".emoji-picker__cell") ?? [])].map((c) => c.dataset.emojiId!);
const focusedId = () => (document.activeElement as HTMLElement | null)?.dataset.emojiId ?? null;
const categoryIds = () =>
  [...root().querySelectorAll<HTMLElement>(".emoji-picker__category-btn")].map((b) => b.dataset.sectionId!);
const headers = () =>
  [...root().querySelectorAll<HTMLElement>(".emoji-picker__section-header")].map((h) => h.textContent);

/** Dispatch a keydown at whatever has focus, as a real key press would. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(ev);
  return ev;
}

function type(text: string): void {
  search().value = text;
  search().dispatchEvent(new Event("input", { bubbles: true }));
}

/** Open in `kind`, run `probe`, close; for comparing the two contexts. */
function inContext<T>(kind: Kind, probe: (ctx: EmojiPickerContext) => T): T {
  const ctx = context(kind);
  picker.open(ctx);
  const result = probe(ctx);
  picker.hide();
  return result;
}

const bothContexts = <T>(probe: (ctx: EmojiPickerContext) => T): [T, T] => [
  inContext("compose", probe),
  inContext("reaction", probe),
];

describe("one picker, two contexts", () => {
  it("lists the same entries, sections and categories, in the same order", () => {
    const [compose, reaction] = bothContexts(() => ({ cells: cellIds(), headers: headers(), cats: categoryIds() }));
    expect(reaction).toEqual(compose);
    // …and that listing is the shared one: common emoji, custom pack, built-ins.
    expect(compose.cats.slice(0, 3)).toEqual(["common", "pack:blobs", "smileys"]);
    expect(compose.cells.slice(0, COMMON_EMOJI.length)).toEqual(COMMON_EMOJI.map(stripVariationSelectors));
    expect(compose.cells[COMMON_EMOJI.length]).toBe("custom:blobs:partyblob");
  });

  it("finds the same results for the same query", () => {
    for (const q of ["thumbsup", "+1", "party", "heart", "❤", ":joy:", "blob", "red heart", "hooray", "zzzqqq"]) {
      const [compose, reaction] = bothContexts(() => {
        type(q);
        return cellIds();
      });
      expect(reaction, q).toEqual(compose);
    }
  });

  it("moves through the grid the same way, key for key", () => {
    const keys = ["Tab", "l", "l", "j", "j", "]", "j", "h", "[", "k", "G", "gg"];
    const [compose, reaction] = bothContexts(() => {
      const trail: Array<string | null> = [];
      for (const k of keys) {
        if (k === "gg") { press("g"); press("g"); } else press(k);
        trail.push(focusedId());
      }
      return trail;
    });
    expect(reaction).toEqual(compose);
    expect(compose.every((id) => id !== null)).toBe(true);
  });

  it("opens on the search field in both, outside mobile", () => {
    const [compose, reaction] = bothContexts(() => document.activeElement === search());
    expect(compose).toBe(true);
    expect(reaction).toBe(true);
  });

  it("opens as a bottom sheet with no text field focused on mobile, in both", () => {
    mobile = true;
    const [compose, reaction] = bothContexts(() => ({
      sheet: root().classList.contains("emoji-picker--sheet"),
      anchored: root().classList.contains("emoji-picker--anchored"),
      searchFocused: document.activeElement === search(),
      searchShown: search().offsetParent !== null || search().style.display !== "none",
    }));
    expect(compose).toEqual({ sheet: true, anchored: false, searchFocused: false, searchShown: true });
    expect(reaction).toEqual(compose);
  });

  it("offers the sticker and GIF tabs only when the context brings them", () => {
    const tabBar = () => root().querySelector<HTMLElement>(".emoji-picker__tabs")!;
    const [compose, reaction] = bothContexts(() => tabBar().style.display !== "none");
    expect(compose).toBe(true);
    expect(reaction).toBe(false);
  });

  it("hands a pick to the context that opened it, after closing", () => {
    for (const kind of ["compose", "reaction"] as const) {
      const ctx = context(kind);
      picker.open(ctx);
      type("joy");
      press("Enter");
      expect(picker.isVisible()).toBe(false);
      expect(ctx.onEmoji).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ glyph: "😂" }));
    }
  });

  it("names the overlay for its context", () => {
    const [compose, reaction] = bothContexts(() => root().getAttribute("aria-label"));
    expect(compose).toBe("Emoji picker");
    expect(reaction).toBe("Add reaction");
  });
});

describe("free text", () => {
  it("is offered for a query nothing matches only where the context accepts it", () => {
    const reaction = context("reaction");
    picker.open(reaction);
    type("lgtmzz");
    expect(root().querySelector(".emoji-picker__empty")!.textContent).toContain("react with “lgtmzz”");
    press("Enter");
    expect(reaction.text!.onText).toHaveBeenCalledExactlyOnceWith("lgtmzz");
    expect(reaction.onEmoji).not.toHaveBeenCalled();

    const compose = context("compose");
    picker.open(compose);
    type("lgtmzz");
    expect(root().querySelector(".emoji-picker__empty")!.textContent).toBe("No emoji match");
    press("Enter");
    expect(compose.onEmoji).not.toHaveBeenCalled();
    expect(picker.isVisible()).toBe(true);
  });

  it("Enter reacts with an emoticon as typed", () => {
    for (const emoticon of [":/", ":D", ":-P"]) {
      const reaction = context("reaction");
      picker.open(reaction);
      type(emoticon);
      press("Enter");
      expect(reaction.text!.onText, emoticon).toHaveBeenCalledExactlyOnceWith(emoticon);
      expect(reaction.onEmoji, emoticon).not.toHaveBeenCalled();
    }
  });

  it("Shift-Enter submits the query as typed even when it matches", () => {
    const reaction = context("reaction");
    picker.open(reaction);
    type("lol");
    press("Enter", { shiftKey: true });
    expect(reaction.text!.onText).toHaveBeenCalledExactlyOnceWith("lol");
    expect(reaction.onEmoji).not.toHaveBeenCalled();
  });
});

describe("search field", () => {
  // The compose picker routed every key — typed into its search field or not —
  // through the grid's keymap, so `l` in "smile" jumped focus into the grid
  // and `o` picked whatever emoji was focused.
  it("owns its typing: keys the grid binds are not navigation there", () => {
    picker.open(context("compose"));
    for (const k of ["j", "k", "h", "l", "o", "g", "G", "[", "]", "/", "m"]) {
      const ev = press(k);
      expect(ev.defaultPrevented, k).toBe(false);
      expect(document.activeElement, k).toBe(search());
    }
    expect(picker.isVisible()).toBe(true);
  });

  it("marks the first result while typing, and Enter picks it", () => {
    const ctx = context("compose");
    picker.open(ctx);
    type("tada");
    const first = visibleGrid().querySelector(".emoji-picker__cell")!;
    expect(first.classList.contains("emoji-picker__cell--default")).toBe(true);
    press("Enter");
    expect(ctx.onEmoji).toHaveBeenCalledWith(expect.objectContaining({ shortcode: "tada" }));
  });

  it("Enter with no query picks nothing", () => {
    const ctx = context("compose");
    picker.open(ctx);
    press("Enter");
    expect(ctx.onEmoji).not.toHaveBeenCalled();
    expect(picker.isVisible()).toBe(true);
  });

  it("Tab or ArrowDown moves into the grid; up off its top row comes back", () => {
    picker.open(context("reaction"));
    press("ArrowDown");
    expect(focusedId()).toBe(stripVariationSelectors(COMMON_EMOJI[0]));
    press("k");
    expect(document.activeElement).toBe(search());
    press("Tab");
    expect(focusedId()).not.toBeNull();
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(search());
  });

  // The Enter that commits a conversion (kusa → 草) reached the field as an
  // Enter and picked a result, or sent the half-typed text as a reaction.
  it("leaves the keys of an input method's composition alone", () => {
    const ctx = context("reaction");
    picker.open(ctx);
    type("kusa");
    press("Enter", { isComposing: true });
    press("Enter", { keyCode: 229 }); // WebKit's committing Enter
    press("Escape", { isComposing: true }); // cancels the conversion, not the picker
    expect(ctx.onEmoji).not.toHaveBeenCalled();
    expect(ctx.text!.onText).not.toHaveBeenCalled();
    expect(picker.isVisible()).toBe(true);
    press("Enter");
    expect(ctx.text!.onText).toHaveBeenCalledExactlyOnceWith("kusa");
  });

  it("Escape closes from the field and from the grid", () => {
    picker.open(context("reaction"));
    press("Escape");
    expect(picker.isVisible()).toBe(false);
    picker.open(context("compose"));
    press("Tab");
    press("Escape");
    expect(picker.isVisible()).toBe(false);
  });
});

describe("grid keys", () => {
  it("moves by sections: down from the common row lands in the custom pack", () => {
    picker.open(context("compose"));
    press("Tab");
    // 12 common emoji, 7 columns: two rows. j twice leaves the section.
    press("j");
    expect(focusedId()).toBe(stripVariationSelectors(COMMON_EMOJI[7]));
    press("j");
    expect(focusedId()).toBe("custom:blobs:partyblob");
  });

  it("[ and ] jump between categories; / returns to the search field", () => {
    picker.open(context("reaction"));
    press("Tab");
    press("]");
    expect(focusedId()).toBe("custom:blobs:partyblob");
    press("]");
    expect(focusedId()).toBe(stripVariationSelectors("😀"));
    press("[");
    expect(focusedId()).toBe("custom:blobs:partyblob");
    press("/");
    expect(document.activeElement).toBe(search());
  });

  it("honours a pmap rebinding in either context", () => {
    keymapManager.pmap("n", "nav-right");
    keymapManager.pmap("}", "picker-next-section");
    try {
      const [compose, reaction] = bothContexts(() => {
        press("Tab");
        press("n");
        const afterN = focusedId();
        press("}");
        return [afterN, focusedId()];
      });
      expect(compose).toEqual([stripVariationSelectors(COMMON_EMOJI[1]), "custom:blobs:partyblob"]);
      expect(reaction).toEqual(compose);
    } finally {
      keymapManager.unmap("picker", "n");
      keymapManager.unmap("picker", "}");
    }
  });

  it("Enter on a focused cell picks it", () => {
    const ctx = context("reaction");
    picker.open(ctx);
    press("Tab");
    press("l");
    press("Enter");
    expect(ctx.onEmoji).toHaveBeenCalledWith(expect.objectContaining({ id: stripVariationSelectors(COMMON_EMOJI[1]) }));
  });

  // A `<leader>` mapping makes Space the start of a sequence; the keymap then
  // cancelled the button activation Space relied on.
  it("Space picks the focused emoji, even with a <leader> mapping", () => {
    keymapManager.nmap("<leader>f", "open-search");
    try {
      const ctx = context("reaction");
      picker.open(ctx);
      press("Tab");
      press("l");
      const ev = press(" ");
      expect(ev.defaultPrevented).toBe(true);
      expect(ctx.onEmoji).toHaveBeenCalledWith(expect.objectContaining({ id: stripVariationSelectors(COMMON_EMOJI[1]) }));
    } finally {
      keymapManager.unmap("global", "<leader>f");
    }
  });

  // `[` is AltGr+8 on a German Windows layout (reported as Ctrl+Alt) and
  // Option+5 on a German Mac; dropping every modified key lost them.
  it("[ and ] typed with AltGr or Option still change category; chords do nothing", () => {
    picker.open(context("compose"));
    press("Tab");
    press("]", { ctrlKey: true, altKey: true });
    expect(focusedId()).toBe("custom:blobs:partyblob");
    press("[", { ctrlKey: true, altKey: true });
    expect(focusedId()).toBe(stripVariationSelectors(COMMON_EMOJI[0]));
    expect(picker.isVisible()).toBe(true); // AltGr+[ is not Ctrl-[
    press("]", { altKey: true });
    expect(focusedId()).toBe("custom:blobs:partyblob");
    press("[", { ctrlKey: true, altKey: true });
    // A real chord is not its bare key: Ctrl-k is not `k` (up, to the search field).
    press("k", { ctrlKey: true });
    expect(focusedId()).toBe(stripVariationSelectors(COMMON_EMOJI[0]));
    press("[", { ctrlKey: true });
    expect(picker.isVisible()).toBe(false);
  });

  it("Tab from the grid moves to the next tab in compose, back to search for reactions", () => {
    const compose = context("compose");
    picker.open(compose);
    press("Tab");
    press("Tab");
    expect(compose.media!.onStickerTab).toHaveBeenCalled();
    picker.hide();

    picker.open(context("reaction"));
    press("Tab");
    press("Tab");
    expect(document.activeElement).toBe(search());
  });
});

describe("pointer and touch", () => {
  it("a click or tap on a cell picks it", () => {
    const ctx = context("reaction");
    picker.open(ctx);
    visibleGrid().querySelector<HTMLElement>('[data-emoji-id="custom:blobs:blobcat"]')!.click();
    expect(ctx.onEmoji).toHaveBeenCalledWith(expect.objectContaining({ shortcode: "blobcat", url: "mxc://x/cat" }));
  });

  it("a category button clears the search and marks its category", () => {
    picker.open(context("compose"));
    type("joy");
    root().querySelector<HTMLElement>('[data-section-id="nature"].emoji-picker__category-btn')!.click();
    expect(search().value).toBe("");
    expect(cellIds().length).toBeGreaterThan(1000);
    const active = root().querySelector(".emoji-picker__category-btn--active") as HTMLElement;
    expect(active.dataset.sectionId).toBe("nature");
  });

  // It used to scroll without moving the grid's focus index, so the next key
  // acted on whatever was focused before: Enter reacted with 👍.
  it("a category button focuses its first emoji, so the next key acts from there", () => {
    const ctx = context("reaction");
    picker.open(ctx);
    const btn = root().querySelector<HTMLElement>('[data-section-id="nature"].emoji-picker__category-btn')!;
    btn.focus(); // Chromium focuses a clicked button
    btn.click();
    const first = picker.browser.sections().find((s) => s.id === "nature")!.entries[0];
    expect(focusedId()).toBe(first.id);
    press("Enter");
    expect(ctx.onEmoji).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: first.id }));
  });
});

describe("sticker tab", () => {
  const sticker = (id: string, name: string) => ({ id, name, url: `https://x/${id}.png`, packName: "Pack" });
  const focusedSticker = () => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? null;

  function openStickers(): EmojiPickerContext {
    const ctx = context("compose");
    ctx.media!.initialTab = "sticker";
    picker.open(ctx);
    return ctx;
  }

  // It opens on the previous room's stickers while the room's load; the load
  // replaced the cell that had focus, and focus fell out of the picker.
  it("keeps keyboard focus in the picker when the room's stickers arrive", () => {
    picker.setStickers([sticker("a", "Alpha"), sticker("b", "Beta")]);
    openStickers();
    expect(focusedSticker()).toBe("Alpha");
    press("l");
    expect(focusedSticker()).toBe("Beta");
    picker.setStickers([sticker("c", "Gamma"), sticker("b", "Beta")]);
    expect(focusedSticker()).toBe("Beta"); // still listed: still focused
    picker.setStickers([sticker("z", "Zeta")]);
    expect(focusedSticker()).toBe("Zeta");
    picker.setStickers([]);
    expect(document.activeElement).toBe(root());
    press("Escape");
    expect(picker.isVisible()).toBe(false);
  });

  it("routes its keys like the emoji tab: Space picks, an IME's Enter does not", () => {
    picker.setStickers([sticker("a", "Alpha"), sticker("b", "Beta")]);
    const ctx = openStickers();
    press("/");
    root().querySelector<HTMLInputElement>(".sticker-picker__search")!.value = "be";
    press("Enter", { isComposing: true });
    expect(ctx.media!.onSticker).not.toHaveBeenCalled();
    press("Tab");
    expect(focusedSticker()).toBe("Alpha");
    press(" ");
    expect(ctx.media!.onSticker).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "a" }));
  });
});

describe("custom emoji", () => {
  it("shows a pack image once it resolves", () => {
    picker.open(context("compose"));
    const cell = () => visibleGrid().querySelector<HTMLElement>('[data-emoji-id="custom:blobs:partyblob"]')!;
    expect(cell().classList.contains("emoji-picker__cell--pending")).toBe(true);
    picker.setCustomImage("mxc://x/party", "data:image/png;base64,UEFSVFk=");
    const img = cell().querySelector("img")!;
    expect(img.getAttribute("src")).toBe("data:image/png;base64,UEFSVFk=");
    expect(img.hidden).toBe(false);
    expect(cell().classList.contains("emoji-picker__cell--pending")).toBe(false);
    // The pack's category icon is its first emoji.
    const icon = root().querySelector('[data-section-id="pack:blobs"] img') as HTMLImageElement;
    expect(icon.getAttribute("src")).toBe("data:image/png;base64,UEFSVFk=");
  });

  it("keeps the grid when the same packs come back from a reload", () => {
    picker.open(context("compose"));
    const before = visibleGrid().firstElementChild;
    picker.setCustomPacks(PACKS.map((p) => ({ ...p, emojis: p.emojis.map((e) => ({ ...e })) })));
    expect(visibleGrid().firstElementChild).toBe(before);
  });

  it("rebuilds when the room's packs differ", () => {
    picker.open(context("compose"));
    picker.setCustomPacks([]);
    expect(categoryIds()).not.toContain("pack:blobs");
  });

  // The common emoji are listed twice under one id; restoring focus by id
  // alone jumped from 😂 in Smileys to its copy at the top.
  it("keeps focus on the same emoji in the same section across a rebuild", () => {
    picker.open(context("compose"));
    const joy = stripVariationSelectors("😂");
    const copies = () => [...visibleGrid().querySelectorAll<HTMLElement>(`[data-emoji-id="${joy}"]`)];
    expect(copies()).toHaveLength(2);
    copies()[1].focus();
    picker.setCustomPacks([]);
    expect(document.activeElement).toBe(copies()[1]);
  });

  it("shows a resolved image in search results too", () => {
    picker.open(context("compose"));
    type("partyblob");
    picker.setCustomImage("mxc://x/party", "data:image/png;base64,UEFSVFk=");
    const img = visibleGrid().querySelector<HTMLImageElement>('[data-emoji-id="custom:blobs:partyblob"] img')!;
    expect(img.getAttribute("src")).toBe("data:image/png;base64,UEFSVFk=");
  });
});

describe("placement", () => {
  it("sits beside an anchor on desktop and docks by the compose bar without one", () => {
    picker.open(context("reaction"));
    expect(root().classList.contains("emoji-picker--anchored")).toBe(true);
    expect(root().style.top).not.toBe("");
    picker.hide();
    picker.open(context("compose"));
    expect(root().classList.contains("emoji-picker--anchored")).toBe(false);
    expect(root().style.top).toBe("");
  });
});
