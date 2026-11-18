// Mock backend for emoji/sticker packs (#12): an in-memory store the write
// commands change and `get_emoji_packs` / `get_sticker_packs` read, so the
// `pnpm dev` build shows an edit in the pickers the way the real backend does.
// Mirrors src-tauri/src/matrix/packs.rs and emoji.rs closely enough to drive
// the UI; it is not a second implementation to test the backend against.

import type {
  EditableImage,
  EditablePack,
  EmojiPack,
  FavoritePack,
  NewPackImage,
  PackLocation,
  RoomPacks,
} from "./types.js";

interface MockImage {
  url: string;
  body?: string;
  usage?: string[];
  info?: unknown;
}

interface MockPack {
  pack: { display_name?: string; avatar_url?: string; usage?: string[] };
  images: Record<string, MockImage>;
}

export interface MockPacksContext {
  /** Space ID → child room IDs. */
  spaceChildren: Record<string, string[]>;
  roomName(roomId: string): string | null;
}

const svg = (glyph: string): string =>
  `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='28'>${glyph}</text></svg>`;

let user: MockPack;
let rooms: Map<string, Map<string, MockPack>>;
let favorites: Map<string, Set<string>>;

/** Put the store back to its seed (tests). */
export function _resetMockPacks(): void {
  user = {
    pack: { display_name: "Mock Emoji", usage: ["emoticon"] },
    images: {
      partyblob: { url: svg("🎉"), body: "Party blob" },
      blobcat: { url: svg("🐱"), body: "Blob cat" },
      blobwave: { url: svg("👋"), body: "Blob wave" },
    },
  };
  rooms = new Map<string, Map<string, MockPack>>([
    ["!general:matrix.org", new Map<string, MockPack>([["", {
      pack: { display_name: "Mock Stickers", usage: ["sticker"] },
      images: {
        wave: { url: "mxc://matrix.org/mock-wave", body: "Wave" },
        thumbsup: { url: "mxc://matrix.org/mock-thumbsup", body: "Thumbs Up" },
        heart: { url: "mxc://matrix.org/mock-heart", body: "Heart" },
      },
    }]])],
    ["!space1:matrix.org", new Map<string, MockPack>([["", {
      pack: { display_name: "Work Emoji" },
      images: { workblob: { url: svg("💼"), body: "Work blob" } },
    }]])],
  ]);
  // The sticker pack is a favorite, so stickers show in every room as before.
  favorites = new Map([["!general:matrix.org", new Set([""])]]);
}
_resetMockPacks();

const VALID = /^[A-Za-z0-9_+-]+$/;

function slug(name: string, keepPlus: boolean): string {
  const ok = keepPlus ? /[a-z0-9_+-]/ : /[a-z0-9_-]/;
  let out = "";
  for (const c of name.toLowerCase()) {
    const ch = ok.test(c) ? c : "_";
    if (ch === "_" && out.endsWith("_")) continue;
    out += ch;
  }
  return out.replace(/^_+|_+$/g, "");
}

function unique(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

function shortcodeFromFilename(filename: string, taken: Set<string>): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return unique(slug(stem, true) || "emoji", taken);
}

function packAt(location: PackLocation, create = false): MockPack {
  if (location.kind === "user") return user;
  let byKey = rooms.get(location.room_id);
  if (!byKey) {
    if (!create) throw new Error("No such pack");
    byKey = new Map();
    rooms.set(location.room_id, byKey);
  }
  let pack = byKey.get(location.state_key);
  if (!pack) {
    if (!create) throw new Error("No such pack");
    pack = { pack: {}, images: {} };
    byKey.set(location.state_key, pack);
  }
  return pack;
}

function image(pack: MockPack, shortcode: string): MockImage {
  const img = pack.images[shortcode];
  if (!img) throw new Error(`:${shortcode}: is not in this pack`);
  return img;
}

function isFavorite(roomId: string, stateKey: string): boolean {
  return favorites.get(roomId)?.has(stateKey) ?? false;
}

function editable(pack: MockPack, roomId: string | null, stateKey: string | null): EditablePack {
  const images: EditableImage[] = Object.entries(pack.images)
    .map(([shortcode, img]) => ({
      shortcode,
      url: img.url,
      body: img.body ?? null,
      usage: (img.usage as EditableImage["usage"]) ?? null,
    }))
    .sort((a, b) => a.shortcode.localeCompare(b.shortcode));
  return {
    room_id: roomId,
    state_key: stateKey,
    display_name: pack.pack.display_name ?? null,
    avatar_url: pack.pack.avatar_url ?? null,
    usage: (pack.pack.usage as EditablePack["usage"]) ?? null,
    images,
    favorited: roomId !== null && stateKey !== null && isFavorite(roomId, stateKey),
    read_only: false,
  };
}

function editableAt(location: PackLocation): EditablePack {
  const pack = packAt(location);
  return location.kind === "user"
    ? editable(pack, null, null)
    : editable(pack, location.room_id, location.state_key);
}

function roomPacks(roomId: string): Array<[string, MockPack]> {
  return [...(rooms.get(roomId) ?? new Map<string, MockPack>()).entries()]
    .filter(([, p]) => Object.keys(p.images).length > 0 || Object.keys(p.pack).length > 0)
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
}

function toEmojiPack(pack: MockPack, id: string, scope: EmojiPack["scope"], roomId: string | null, stateKey: string | null): EmojiPack {
  const packUsage = pack.pack.usage ?? ["emoticon", "sticker"];
  return {
    pack_id: id,
    display_name: pack.pack.display_name ?? null,
    avatar_url: pack.pack.avatar_url ?? null,
    source: scope === "user" ? "user" : "room",
    room_id: roomId,
    state_key: stateKey,
    favorited: roomId !== null && stateKey !== null && isFavorite(roomId, stateKey),
    scope,
    emojis: Object.entries(pack.images).map(([shortcode, img]) => ({
      shortcode,
      url: img.url,
      body: img.body ?? null,
      usage: img.usage ?? packUsage,
    })),
  };
}

function ancestors(ctx: MockPacksContext, roomId: string): string[] {
  const parents = (child: string) =>
    Object.entries(ctx.spaceChildren).filter(([, kids]) => kids.includes(child)).map(([space]) => space).sort();
  const out: string[] = [];
  const seen = new Set([roomId]);
  const queue = [roomId];
  while (queue.length) {
    for (const p of parents(queue.shift()!)) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
        queue.push(p);
      }
    }
  }
  return out;
}

function emojiPacks(ctx: MockPacksContext, roomId: string | null): EmojiPack[] {
  const out: EmojiPack[] = [];
  const listed = new Set<string>();
  const addRoom = (rid: string, scope: EmojiPack["scope"]) => {
    for (const [key, pack] of roomPacks(rid)) {
      if (listed.has(`${rid}\u0000${key}`)) continue;
      listed.add(`${rid}\u0000${key}`);
      out.push(toEmojiPack(pack, key ? `room_${rid}_${key}` : `room_${rid}`, scope, rid, key));
    }
  };
  if (roomId) {
    addRoom(roomId, "room");
    for (const space of ancestors(ctx, roomId)) addRoom(space, "space");
  }
  if (Object.keys(user.images).length > 0) out.push(toEmojiPack(user, "user_default", "user", null, null));
  for (const [rid, keys] of favorites) {
    for (const [key, pack] of roomPacks(rid)) {
      if (keys.has(key) && !listed.has(`${rid}\u0000${key}`)) {
        listed.add(`${rid}\u0000${key}`);
        out.push(toEmojiPack(pack, key ? `room_${rid}_${key}` : `room_${rid}`, "favorite", rid, key));
      }
    }
  }
  return out;
}

/** Returned by `mockPacksInvoke` for a command it does not handle. */
export const NOT_HANDLED = Symbol("not handled");

export function mockPacksInvoke(
  cmd: string,
  args: Record<string, unknown> | undefined,
  ctx: MockPacksContext,
): unknown {
  const a = args ?? {};
  const location = a.location as PackLocation;
  switch (cmd) {
    case "get_emoji_packs":
      return emojiPacks(ctx, (a.roomId as string | undefined) ?? null);
    case "get_sticker_packs":
      return emojiPacks(ctx, (a.roomId as string | undefined) ?? null)
        .map((p) => ({ ...p, emojis: p.emojis.filter((e) => e.usage.includes("sticker")) }))
        .filter((p) => p.emojis.length > 0);
    case "get_user_pack":
      return editable(user, null, null);
    case "get_room_packs": {
      const rid = a.roomId as string;
      return { can_edit: true, packs: roomPacks(rid).map(([key, p]) => editable(p, rid, key)) } satisfies RoomPacks;
    }
    case "get_favorite_packs": {
      const out: FavoritePack[] = [];
      for (const [rid, keys] of favorites) {
        for (const key of keys) {
          const pack = rooms.get(rid)?.get(key);
          out.push({
            room_id: rid,
            state_key: key,
            room_name: ctx.roomName(rid),
            joined: ctx.roomName(rid) !== null,
            display_name: pack?.pack.display_name ?? null,
            avatar_url: pack?.pack.avatar_url ?? null,
            image_count: pack ? Object.keys(pack.images).length : 0,
          });
        }
      }
      return out;
    }
    case "upload_pack_media": {
      const mime = a.mimetype as string;
      if (!mime.startsWith("image/")) throw new Error(`${mime} is not an image`);
      return `data:${mime};base64,${a.dataBase64 as string}`;
    }
    case "add_pack_images": {
      const pack = packAt(location, location.kind === "room");
      const taken = new Set(Object.keys(pack.images));
      const added: string[] = [];
      for (const img of a.images as NewPackImage[]) {
        const code = shortcodeFromFilename(img.filename, taken);
        taken.add(code);
        added.push(code);
        pack.images[code] = { url: img.url, ...(img.body ? { body: img.body } : {}), ...(img.info ? { info: img.info } : {}) };
      }
      return { pack: editableAt(location), added };
    }
    case "rename_pack_image": {
      const pack = packAt(location);
      const from = a.from as string;
      const to = a.to as string;
      if (!VALID.test(to)) throw new Error(`"${to}" can't be a shortcode: use letters, digits, _, + and - only`);
      const img = image(pack, from);
      if (from !== to) {
        if (pack.images[to]) throw new Error(`:${to}: is already in this pack`);
        delete pack.images[from];
        pack.images[to] = img;
      }
      return editableAt(location);
    }
    case "set_pack_image_usage": {
      const img = image(packAt(location), a.shortcode as string);
      const usage = a.usage as string[] | null;
      if (usage) img.usage = usage;
      else delete img.usage;
      return editableAt(location);
    }
    case "set_pack_image_body": {
      const img = image(packAt(location), a.shortcode as string);
      const body = a.body as string | null;
      if (body) img.body = body;
      else delete img.body;
      return editableAt(location);
    }
    case "remove_pack_image": {
      const pack = packAt(location);
      image(pack, a.shortcode as string);
      delete pack.images[a.shortcode as string];
      return editableAt(location);
    }
    case "set_pack_meta": {
      const meta = packAt(location, location.kind === "room").pack;
      const patch = a.patch as { display_name?: string; avatar_url?: string; usage?: string[] };
      for (const key of ["display_name", "avatar_url"] as const) {
        if (patch[key] === undefined) continue;
        if (patch[key]) meta[key] = patch[key];
        else delete meta[key];
      }
      if (patch.usage !== undefined) {
        if (patch.usage.length) meta.usage = patch.usage;
        else delete meta.usage;
      }
      return editableAt(location);
    }
    case "create_room_pack": {
      const rid = a.roomId as string;
      const name = (a.displayName as string).trim();
      const key = unique(slug(name, false) || "pack", new Set(roomPacks(rid).map(([k]) => k)));
      const pack = packAt({ kind: "room", room_id: rid, state_key: key }, true);
      if (name) pack.pack.display_name = name;
      return editable(pack, rid, key);
    }
    case "delete_room_pack": {
      rooms.get(a.roomId as string)?.delete(a.stateKey as string);
      favorites.get(a.roomId as string)?.delete(a.stateKey as string);
      return null;
    }
    case "set_pack_favorite": {
      const rid = a.roomId as string;
      const key = a.stateKey as string;
      if (a.favorite) {
        if (!favorites.has(rid)) favorites.set(rid, new Set());
        favorites.get(rid)!.add(key);
      } else {
        favorites.get(rid)?.delete(key);
        if (favorites.get(rid)?.size === 0) favorites.delete(rid);
      }
      return null;
    }
    default:
      return NOT_HANDLED;
  }
}
