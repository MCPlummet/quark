// Type structure consistency tests.
// These tests validate that the TypeScript interfaces are structurally correct
// by constructing sample objects that match the serde-serialized Rust structs.

import { describe, it, expect } from "vitest";
import type {
  SessionInfo,
  RoomInfo,
  CreateRoomOptions,
  TimelineEvent,
  ReactionGroup,
  EmojiEntry,
  EmojiPack,
  MediaDownload,
  VerificationStatus,
  SpaceChild,
  ThreadRoot,
  GifResult,
  Mapping,
  MapType,
  RcDirective,
  ParsedRc,
  ParseError,
  OptionValue,
} from "./types.js";

// ─── Helper: assert a value satisfies a type ──────────────────────────────────

function assertShape<T>(value: T): T {
  return value;
}

// ─── SessionInfo ──────────────────────────────────────────────────────────────

describe("SessionInfo", () => {
  it("accepts a complete session info object", () => {
    const session = assertShape<SessionInfo>({
      user_id: "@alice:example.com",
      device_id: "ABCDEFGH",
      access_token: "syt_abc123",
      homeserver_url: "https://example.com",
    });
    expect(session.user_id).toBe("@alice:example.com");
    expect(session.device_id).toBe("ABCDEFGH");
    expect(session.access_token).toBe("syt_abc123");
    expect(session.homeserver_url).toBe("https://example.com");
  });
});

// ─── RoomInfo ─────────────────────────────────────────────────────────────────

describe("RoomInfo", () => {
  it("accepts a room with all fields populated", () => {
    const room = assertShape<RoomInfo>({
      room_id: "!abc123:example.com",
      name: "General",
      topic: "A room for everyone",
      avatar_url: "mxc://example.com/avatar123",
      unread_count: 3,
      notification_count: 1,
      is_direct: false,
      is_encrypted: true,
      member_count: 42,
    });
    expect(room.room_id).toBe("!abc123:example.com");
    expect(room.is_encrypted).toBe(true);
    expect(room.member_count).toBe(42);
  });

  it("accepts a room with nullable fields set to null", () => {
    const room = assertShape<RoomInfo>({
      room_id: "!xyz:matrix.org",
      name: null,
      topic: null,
      avatar_url: null,
      unread_count: 0,
      notification_count: 0,
      is_direct: true,
      is_encrypted: false,
      member_count: 2,
    });
    expect(room.name).toBeNull();
    expect(room.topic).toBeNull();
    expect(room.is_direct).toBe(true);
  });
});

// ─── CreateRoomOptions ────────────────────────────────────────────────────────

describe("CreateRoomOptions", () => {
  it("accepts options with all optional fields", () => {
    const opts = assertShape<CreateRoomOptions>({
      name: "My Room",
      topic: "A test room",
      alias: "my-room",
      is_public: false,
      is_direct: false,
      invite: ["@bob:example.com"],
      enable_encryption: true,
    });
    expect(opts.name).toBe("My Room");
    expect(opts.invite).toHaveLength(1);
  });

  it("accepts minimal options", () => {
    const opts = assertShape<CreateRoomOptions>({
      is_public: true,
      is_direct: false,
      invite: [],
      enable_encryption: false,
    });
    expect(opts.is_public).toBe(true);
    expect(opts.invite).toHaveLength(0);
  });
});

// ─── TimelineEvent ────────────────────────────────────────────────────────────

describe("TimelineEvent", () => {
  it("accepts a plain text message", () => {
    const ev = assertShape<TimelineEvent>({
      event_id: "$abc123:example.com",
      sender: "@alice:example.com",
      body: "Hello, world!",
      formatted_body: null,
      timestamp: 1_700_000_000_000,
      msg_type: "m.text",
      is_edit: false,
      relates_to_event_id: null,
      in_reply_to: null,
      thread_root: null,
      media_url: null,
      media_mimetype: null,
      media_width: null,
      media_height: null,
    });
    expect(ev.msg_type).toBe("m.text");
    expect(ev.is_edit).toBe(false);
    expect(ev.body).toBe("Hello, world!");
  });

  it("accepts an image message with media fields", () => {
    const ev = assertShape<TimelineEvent>({
      event_id: "$img456:example.com",
      sender: "@bob:example.com",
      body: "image.png",
      formatted_body: null,
      timestamp: 1_700_000_001_000,
      msg_type: "m.image",
      is_edit: false,
      relates_to_event_id: null,
      in_reply_to: null,
      thread_root: null,
      media_url: "mxc://example.com/image123",
      media_mimetype: "image/png",
      media_width: 800,
      media_height: 600,
    });
    expect(ev.media_url).toBe("mxc://example.com/image123");
    expect(ev.media_width).toBe(800);
  });

  it("accepts an edit event", () => {
    const ev = assertShape<TimelineEvent>({
      event_id: "$edit789:example.com",
      sender: "@alice:example.com",
      body: "* Corrected message",
      formatted_body: null,
      timestamp: 1_700_000_002_000,
      msg_type: "m.text",
      is_edit: true,
      relates_to_event_id: "$abc123:example.com",
      in_reply_to: null,
      thread_root: null,
      media_url: null,
      media_mimetype: null,
      media_width: null,
      media_height: null,
    });
    expect(ev.is_edit).toBe(true);
    expect(ev.relates_to_event_id).toBe("$abc123:example.com");
  });
});

// ─── ReactionGroup ────────────────────────────────────────────────────────────

describe("ReactionGroup", () => {
  it("accepts a reaction group with own reaction", () => {
    const group = assertShape<ReactionGroup>({
      key: "👍",
      count: 3,
      senders: ["@alice:example.com", "@bob:example.com", "@carol:example.com"],
      own: true,
      own_event_id: "$reaction123:example.com",
    });
    expect(group.key).toBe("👍");
    expect(group.count).toBe(3);
    expect(group.own).toBe(true);
  });

  it("accepts a reaction group without own reaction", () => {
    const group = assertShape<ReactionGroup>({
      key: "❤️",
      count: 1,
      senders: ["@bob:example.com"],
      own: false,
      own_event_id: null,
    });
    expect(group.own_event_id).toBeNull();
  });
});

// ─── EmojiEntry / EmojiPack ───────────────────────────────────────────────────

describe("EmojiPack", () => {
  it("accepts a complete emoji pack", () => {
    const entry = assertShape<EmojiEntry>({
      shortcode: "blobcat",
      url: "mxc://example.com/blobcat",
      body: "A cute blob cat",
      usage: ["emoticon"],
    });
    expect(entry.shortcode).toBe("blobcat");

    const pack = assertShape<EmojiPack>({
      pack_id: "pack_001",
      display_name: "Blob Cats",
      avatar_url: "mxc://example.com/pack_avatar",
      source: "room",
      room_id: "!emoji:example.com",
      emojis: [entry],
    });
    expect(pack.source).toBe("room");
    expect(pack.emojis).toHaveLength(1);
  });

  it("accepts a user-scoped pack with null fields", () => {
    const pack = assertShape<EmojiPack>({
      pack_id: "user_default",
      display_name: null,
      avatar_url: null,
      source: "user",
      room_id: null,
      emojis: [],
    });
    expect(pack.room_id).toBeNull();
    expect(pack.emojis).toHaveLength(0);
  });
});

// ─── MediaDownload ────────────────────────────────────────────────────────────

describe("MediaDownload", () => {
  it("accepts a media download result", () => {
    const dl = assertShape<MediaDownload>({
      data_base64: "iVBORw0KGgo=",
      mime_type: "image/png",
      filename: "image.png",
    });
    expect(dl.mime_type).toBe("image/png");
    expect(dl.filename).toBe("image.png");
  });

  it("accepts a download with null filename", () => {
    const dl = assertShape<MediaDownload>({
      data_base64: "AAAA",
      mime_type: "application/octet-stream",
      filename: null,
    });
    expect(dl.filename).toBeNull();
  });
});

// ─── VerificationStatus ───────────────────────────────────────────────────────

describe("VerificationStatus", () => {
  it("accepts a verified device status", () => {
    const status = assertShape<VerificationStatus>({
      user_id: "@alice:example.com",
      device_id: "DEVXYZ",
      display_name: "Element Desktop",
      is_verified: true,
      is_cross_signed: true,
      trust_level: "cross-signed",
    });
    expect(status.trust_level).toBe("cross-signed");
  });

  it("accepts an unverified device status", () => {
    const status = assertShape<VerificationStatus>({
      user_id: "@bob:example.com",
      device_id: "DEVABC",
      display_name: null,
      is_verified: false,
      is_cross_signed: false,
      trust_level: "unverified",
    });
    expect(status.is_verified).toBe(false);
  });
});

// ─── SpaceChild ───────────────────────────────────────────────────────────────

describe("SpaceChild", () => {
  it("accepts a space child room", () => {
    const child = assertShape<SpaceChild>({
      room_id: "!room:example.com",
      name: "General",
      topic: "Chat here",
      avatar_url: null,
      is_space: false,
      member_count: 10,
      order: "a",
      canonical_alias: "#general:example.com",
    });
    expect(child.is_space).toBe(false);
    expect(child.order).toBe("a");
  });

  it("accepts a sub-space", () => {
    const child = assertShape<SpaceChild>({
      room_id: "!space:example.com",
      name: "Projects",
      topic: null,
      avatar_url: null,
      is_space: true,
      member_count: null,
      order: null,
      canonical_alias: null,
    });
    expect(child.is_space).toBe(true);
    expect(child.member_count).toBeNull();
  });
});

// ─── ThreadRoot ───────────────────────────────────────────────────────────────

describe("ThreadRoot", () => {
  it("accepts a thread root with replies", () => {
    const root = assertShape<ThreadRoot>({
      event_id: "$thread001:example.com",
      sender: "@alice:example.com",
      body: "Let's discuss this topic",
      timestamp: 1_700_000_000_000,
      reply_count: 5,
      latest_reply_timestamp: 1_700_000_010_000,
    });
    expect(root.reply_count).toBe(5);
    expect(root.latest_reply_timestamp).toBe(1_700_000_010_000);
  });

  it("accepts a thread root with no replies yet", () => {
    const root = assertShape<ThreadRoot>({
      event_id: "$thread002:example.com",
      sender: "@bob:example.com",
      body: "Anyone?",
      timestamp: 1_700_000_000_000,
      reply_count: 0,
      latest_reply_timestamp: null,
    });
    expect(root.reply_count).toBe(0);
    expect(root.latest_reply_timestamp).toBeNull();
  });
});

// ─── GifResult ────────────────────────────────────────────────────────────────

describe("GifResult", () => {
  it("accepts a GIF result", () => {
    const gif = assertShape<GifResult>({
      id: "klipy_12345",
      title: "Funny cat GIF",
      url: "https://media.klipy.com/abc.gif",
      preview_url: "https://media.klipy.com/abc_small.gif",
      width: 480,
      height: 270,
    });
    expect(gif.width).toBe(480);
    expect(gif.preview_url).toContain("klipy.com");
  });
});

// ─── Mapping / MapType ────────────────────────────────────────────────────────

describe("Mapping", () => {
  it("accepts a normal mode mapping", () => {
    const m = assertShape<Mapping>({
      map_type: "normal" as MapType,
      noremap: false,
      key: "gg",
      action: "jump-top",
    });
    expect(m.map_type).toBe("normal");
    expect(m.key).toBe("gg");
  });

  it("accepts all valid MapType values", () => {
    const types: MapType[] = [
      "normal",
      "insert",
      "timeline",
      "roomlist",
      "picker",
      "command",
      "visual",
    ];
    expect(types).toHaveLength(7);
    types.forEach((t) => {
      const m = assertShape<Mapping>({ map_type: t, noremap: false, key: "x", action: "noop" });
      expect(m.map_type).toBe(t);
    });
  });
});

// ─── RcDirective (tagged union) ───────────────────────────────────────────────

describe("RcDirective", () => {
  it("accepts a map directive", () => {
    const d = assertShape<RcDirective>({
      type: "map",
      map_type: "normal",
      noremap: false,
      key: "j",
      action: "nav-down",
    });
    expect(d.type).toBe("map");
  });

  it("accepts a set directive", () => {
    const d = assertShape<RcDirective>({
      type: "set",
      name: "scrolloff",
      value: 5 as OptionValue,
    });
    expect(d.type).toBe("set");
  });

  it("accepts a let directive", () => {
    const d = assertShape<RcDirective>({
      type: "let",
      name: "mapleader",
      value: " ",
    });
    expect(d.type).toBe("let");
  });

  it("accepts a comment directive", () => {
    const d = assertShape<RcDirective>({
      type: "comment",
      content: "This is a comment",
    });
    expect(d.type).toBe("comment");
  });

  it("accepts a colorscheme directive", () => {
    const d = assertShape<RcDirective>({
      type: "colorscheme",
      name: "phosphor",
    });
    expect(d.type).toBe("colorscheme");
  });
});

// ─── ParsedRc ─────────────────────────────────────────────────────────────────

describe("ParsedRc", () => {
  it("accepts a successfully parsed rc file", () => {
    const rc = assertShape<ParsedRc>({
      directives: [
        { type: "map", map_type: "normal", noremap: false, key: "j", action: "nav-down" },
        { type: "set", name: "scrolloff", value: 5 },
      ],
      errors: [],
    });
    expect(rc.directives).toHaveLength(2);
    expect(rc.errors).toHaveLength(0);
  });

  it("accepts a parse result with errors", () => {
    const error = assertShape<ParseError>({
      line_number: 7,
      line: "badcommand foo",
      message: "Unknown directive: 'badcommand'",
    });
    const rc = assertShape<ParsedRc>({
      directives: [],
      errors: [error],
    });
    expect(rc.errors[0].line_number).toBe(7);
  });
});
