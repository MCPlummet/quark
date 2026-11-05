import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { EmojiPack } from "../../ipc/types.js";

// The two ways into the emoji picker, end to end through the real picker and
// composer with IPC stubbed. The picker had been "unified" before and drifted
// again because each context kept its own copy of the emoji logic; what is
// asserted here is that the contexts now differ only where they must.

const getEmojiPacks = vi.fn<(roomId?: string) => Promise<EmojiPack[]>>();
const ipcSendReaction = vi.fn(async () => "$reaction");
vi.mock("../../ipc/index.js", async (importActual) => ({
  ...(await importActual<typeof import("../../ipc/index.js")>()),
  getEmojiPacks: (roomId?: string) => getEmojiPacks(roomId),
  getThumbnail: vi.fn(async () => ({ data_base64: "VEhVTUI=", mime_type: "image/png", filename: null })),
  sendReaction: (...a: unknown[]) => ipcSendReaction(...(a as [])),
}));
vi.mock("../mobile.js", async (importActual) => ({
  ...(await importActual<typeof import("../mobile.js")>()),
  isMobile: () => false,
  viewportPan: () => 0,
}));
vi.mock("../../ui/NotificationToast.js", () => ({ showError: vi.fn(), showSuccess: vi.fn(), showToast: vi.fn() }));

import { openEmojiPicker, openReactionPicker } from "./emoji_picker.js";
import { setComponents, _shortcodeToMxc } from "./context.js";
import { _resetCustomEmojiCache } from "./custom_emoji.js";
import { AppState } from "../state.js";
import { EmojiPicker, type EmojiPickerContext } from "../../ui/EmojiPicker.js";
import { Input } from "../../ui/Input.js";
import type { AppComponents } from "../../ui/App.js";
import { registerDefaultBindings } from "../registry.js";

const ROOM = "!room:x";

function pack(id: string, shortcodes: string[]): EmojiPack {
  return {
    pack_id: id,
    display_name: id.toUpperCase(),
    avatar_url: null,
    source: "room",
    room_id: ROOM,
    emojis: [
      ...shortcodes.map((s) => ({ shortcode: s, url: `mxc://x/${s}`, body: null, usage: ["emoticon"] })),
      { shortcode: `${id}_sticker`, url: `mxc://x/${id}_sticker`, body: null, usage: ["sticker"] },
    ],
  };
}

let picker: EmojiPicker;
let input: Input;
let message: HTMLElement;

const flush = () => new Promise((r) => setTimeout(r, 0));
const search = () => picker.getElement().querySelector<HTMLInputElement>(".emoji-picker__search")!;
function type(text: string): void {
  search().value = text;
  search().dispatchEvent(new Event("input", { bubbles: true }));
}
function press(key: string, init: KeyboardEventInit = {}): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
}
const listing = () => picker.browser.sections().map((s) => [s.id, s.entries.map((e) => e.id)]);

beforeEach(() => {
  registerDefaultBindings();
  _resetCustomEmojiCache();
  getEmojiPacks.mockReset();
  getEmojiPacks.mockResolvedValue([pack("blobs", ["partyblob", "blobcat"])]);
  ipcSendReaction.mockClear();
  AppState.set("currentRoomId", ROOM);
  AppState.set("currentTimeline", []);

  picker = new EmojiPicker();
  input = new Input();
  message = document.createElement("div");
  document.body.append(picker.getElement(), input.getElement(), message);
  const timeline = { getMessageElementById: (id: string) => (id === "$e" ? message : null) };
  const threadView = { hasMessage: () => false };
  setComponents({ emojiPicker: picker, input, timeline, threadView } as unknown as AppComponents);
});

afterEach(() => {
  picker.hide();
  document.body.replaceChildren();
});

describe("the two contexts", () => {
  // EmojiPickerContext is the whole list of what may differ. A new
  // context-specific behaviour has to be added there, and here, on purpose.
  it("differ only in what a pick does, the media tabs, free text and placement", () => {
    const open = vi.spyOn(picker, "open");
    openEmojiPicker();
    openReactionPicker("$e");
    const [compose, reaction] = open.mock.calls.map(([ctx]) => ctx as EmojiPickerContext);
    expect(Object.keys(compose).sort()).toEqual(["label", "media", "onEmoji"]);
    expect(Object.keys(reaction).sort()).toEqual(["anchor", "label", "onEmoji", "text"]);
    expect(reaction.anchor).toBe(message);
  });

  it("are fed the same custom emoji, so they list the same thing", async () => {
    openEmojiPicker();
    await flush();
    const compose = listing();
    picker.hide();
    openReactionPicker("$e");
    await flush();
    expect(listing()).toEqual(compose);
    expect(compose.map(([id]) => id)).toContain("pack:blobs");
  });

  it("show the room's cached packs at once on a repeat open, in either context", async () => {
    openReactionPicker("$e");
    await flush();
    picker.hide();
    getEmojiPacks.mockReturnValue(new Promise(() => {})); // the reload never lands
    openEmojiPicker();
    expect(listing().map(([id]) => id)).toContain("pack:blobs");
  });

  it("never show another room's packs: a late load for an earlier opening is dropped", async () => {
    let finishA!: (p: EmojiPack[]) => void;
    getEmojiPacks.mockReturnValueOnce(new Promise((r) => { finishA = r; }));
    openEmojiPicker();
    picker.hide();
    AppState.set("currentRoomId", "!other:x");
    getEmojiPacks.mockResolvedValueOnce([pack("other", ["wave"])]);
    openReactionPicker("$e");
    await flush();
    finishA([pack("blobs", ["partyblob"])]);
    await flush();
    const ids = listing().map(([id]) => id);
    expect(ids).toContain("pack:other");
    expect(ids).not.toContain("pack:blobs");
  });
});

describe("compose", () => {
  it("inserts a Unicode pick at the caret", async () => {
    input.setValue("ab");
    input.getFieldElement().setSelectionRange(1, 1);
    openEmojiPicker();
    type("joy");
    press("Enter");
    expect(input.getValue()).toBe("a😂b");
    expect(picker.isVisible()).toBe(false);
  });

  it("inserts a custom pick as its :shortcode:, which the formatter can resolve", async () => {
    openEmojiPicker();
    await flush();
    type("partyblob");
    press("Enter");
    expect(input.getValue()).toBe(":partyblob: ");
    expect(_shortcodeToMxc.get("partyblob")).toBe("mxc://x/partyblob");
  });

  it("does not take free text", () => {
    openEmojiPicker();
    type("nothingmatcheszz");
    press("Enter", { shiftKey: true });
    press("Enter");
    expect(input.getValue()).toBe("");
    expect(picker.isVisible()).toBe(true);
  });
});

describe("reactions", () => {
  it("react with a Unicode pick's glyph", () => {
    openReactionPicker("$e");
    type("joy");
    press("Enter");
    expect(ipcSendReaction).toHaveBeenCalledExactlyOnceWith(ROOM, "$e", "😂");
  });

  it("react with a custom pick's mxc URL", async () => {
    openReactionPicker("$e");
    await flush();
    type("blobcat");
    press("Enter");
    expect(ipcSendReaction).toHaveBeenCalledExactlyOnceWith(ROOM, "$e", "mxc://x/blobcat");
  });

  it("react with free text as typed", () => {
    openReactionPicker("$e");
    type("lgtm!!");
    press("Enter");
    expect(ipcSendReaction).toHaveBeenCalledExactlyOnceWith(ROOM, "$e", "lgtm!!");
  });
});
