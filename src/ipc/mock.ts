// Mock IPC layer for browser-only dev mode (no Tauri backend)
// Provides fake data so the UI renders and can be interacted with

import type { RoomInfo, TimelineEvent, EmojiPack, GifResult, RoomMember } from "./types.js";

export interface CacheStats {
  total_size_bytes: number;
  entry_count: number;
  max_size_bytes: number;
  usage_percent: number;
}

const _now = Date.now();
const MOCK_ROOMS: RoomInfo[] = [
  { room_id: "!general:matrix.org", name: "general", topic: "General discussion", avatar_url: null, unread_count: 3, notification_count: 1, is_direct: false, is_encrypted: true, member_count: 42, last_activity_ts: _now - 5 * 60_000 },
  { room_id: "!dev:matrix.org", name: "dev", topic: "Development talk", avatar_url: null, unread_count: 0, notification_count: 0, is_direct: false, is_encrypted: true, member_count: 18, last_activity_ts: _now - 2 * 60 * 60_000 },
  { room_id: "!random:matrix.org", name: "random", topic: "Off-topic banter", avatar_url: null, unread_count: 12, notification_count: 0, is_direct: false, is_encrypted: false, member_count: 35, last_activity_ts: _now - 30 * 60_000 },
  { room_id: "!dm-alice:matrix.org", name: "Alice", topic: null, avatar_url: null, unread_count: 1, notification_count: 0, is_direct: true, is_encrypted: true, member_count: 2, last_activity_ts: _now - 10 * 60_000 },
  { room_id: "!dm-bob:matrix.org", name: "Bob", topic: null, avatar_url: null, unread_count: 0, notification_count: 0, is_direct: true, is_encrypted: true, member_count: 2, last_activity_ts: _now - 3 * 60 * 60_000 },
];

let msgCounter = 100;

// Deterministic SVG avatar per sender (colored initial square)
const AVATAR_COLORS: Record<string, string> = {
  "@alice:matrix.org": "#00ff41",
  "@bob:matrix.org":   "#00aaff",
  "@carol:matrix.org": "#ff4466",
  "@dave:matrix.org":  "#ffaa00",
  "@you:matrix.org":   "#aa44ff",
};

function mockAvatar(sender: string): string {
  const color = AVATAR_COLORS[sender] ?? "#888888";
  const initial = sender.startsWith("@") ? sender[1].toUpperCase() : sender[0].toUpperCase();
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`,
    `<rect width="24" height="24" rx="3" fill="${color}" opacity="0.15"/>`,
    `<rect width="24" height="24" rx="3" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.7"/>`,
    `<text x="12" y="17" text-anchor="middle" font-family="monospace" font-size="13" font-weight="bold" fill="${color}">${initial}</text>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function mockEvent(sender: string, body: string, minutesAgo: number): TimelineEvent {
  return {
    event_id: `$evt${msgCounter++}`,
    sender,
    body,
    formatted_body: null,
    timestamp: Date.now() - minutesAgo * 60000,
    msg_type: "m.text",
    is_edit: false,
    relates_to_event_id: null,
    in_reply_to: null,
    thread_root: null,
    media_url: null,
    media_mimetype: null,
    media_width: null,
    media_height: null,
    // Non-spec field used by mock layer only — picked up in timelineEventToMessage
    _mock_avatar_url: mockAvatar(sender),
  } as TimelineEvent & { _mock_avatar_url: string };
}

// Build the mock timeline. We capture event IDs from specific events so replies
// can reference them by ID.
const _aliceThemeEvent = mockEvent("@alice:matrix.org", "I just pushed the new theme system :partyblob:", 31);
const _carolQuestionEvent = mockEvent("@carol:matrix.org", "Can we get a catppuccin variant too?", 20);

const MOCK_TIMELINE: TimelineEvent[] = [
  // Alice sends three messages in a row — middle one has reactions, tests inline reaction layout
  mockEvent("@alice:matrix.org", "hey everyone, check this out", 32),
  { ..._aliceThemeEvent,
    reactions: [
      { key: "🎉", count: 4, own: false, senders: [], own_event_id: null },
      { key: "🚀", count: 2, own: true, senders: ["@you:matrix.org"], own_event_id: "$mock-rxn1" },
    ] },
  mockEvent("@alice:matrix.org", "also shipping the notification system today", 30),

  mockEvent("@bob:matrix.org", "nice! the phosphor theme looks great", 25),
  // Bob replies to Alice's theme push — tests reply bubble break in a consecutive group
  { ...mockEvent("@bob:matrix.org", "the vim keybindings feel really natural too", 24),
    in_reply_to: _aliceThemeEvent.event_id },

  _carolQuestionEvent,

  // Alice again — two messages, second has reactions (tests bottom-corner treatment)
  mockEvent("@alice:matrix.org", "already done — try :theme catppuccin-mocha", 18),
  { ...mockEvent("@alice:matrix.org", "eight built-in themes total now", 17),
    reactions: [
      { key: "👍", count: 3, own: true, senders: ["@you:matrix.org"], own_event_id: "$mock-rxn2" },
    ] },

  // Carol replies to her own question — tests same-sender reply bubble break
  { ...mockEvent("@carol:matrix.org", "actually catppuccin latte too please!", 15),
    in_reply_to: _carolQuestionEvent.event_id },

  { ...mockEvent("@carol:matrix.org", "agreed, dd to redact is *chef's kiss*", 12),
    reactions: [
      { key: "😄", count: 2, own: false, senders: [], own_event_id: null },
      { key: "💯", count: 1, own: false, senders: [], own_event_id: null },
    ] },

  mockEvent("@dave:matrix.org", "just joined, this client looks amazing", 8),
  mockEvent("@alice:matrix.org", "welcome! try :help to see available commands", 5),
  mockEvent("@bob:matrix.org", "anyone working on the sticker packs?", 2),
];

const MOCK_MEMBERS: RoomMember[] = [
  { user_id: "@alice:matrix.org", display_name: "Alice", avatar_url: null, power_level: "admin", presence: "online" },
  { user_id: "@bob:matrix.org",   display_name: "Bob",   avatar_url: null, power_level: "mod",   presence: "online" },
  { user_id: "@carol:matrix.org", display_name: "Carol", avatar_url: null, power_level: "member", presence: "unavailable" },
  { user_id: "@dave:matrix.org",  display_name: "Dave",  avatar_url: null, power_level: "member", presence: "offline" },
  { user_id: "@you:matrix.org",   display_name: "you",   avatar_url: null, power_level: "member", presence: "online" },
  { user_id: "@eve:matrix.org",   display_name: "Eve",   avatar_url: null, power_level: "member", presence: "offline" },
  { user_id: "@frank:matrix.org", display_name: "Frank", avatar_url: null, power_level: "member", presence: "offline" },
];

// Check if we're running inside Tauri
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ── Mock event bus ──────────────────────────────────────────────────────────
// A tiny pub/sub so mock-mode commands can simulate backend-pushed Tauri events
// (e.g. streaming search hits) for browser dev mode. Mirrors the subset of the
// Tauri event API that the frontend uses.
type MockEventListener = (payload: unknown) => void;
const _mockListeners = new Map<string, Set<MockEventListener>>();

/** Subscribe to a mock event. Returns an unlisten function. */
export function mockListen(event: string, cb: MockEventListener): () => void {
  let set = _mockListeners.get(event);
  if (!set) {
    set = new Set();
    _mockListeners.set(event, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}

/** Emit a mock event to all current listeners. */
function mockEmit(event: string, payload: unknown): void {
  const set = _mockListeners.get(event);
  if (!set) return;
  for (const cb of [...set]) cb(payload);
}

// Mock invoke that returns fake data
export async function mockInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  // Simulate a small network delay
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));

  switch (cmd) {
    case "login":
      // Backend now persists the session in the keyring and returns nothing.
      return null;
    case "restore_session":
      // No saved session in mock mode → fall through to the login screen.
      return "NoSession";
    case "clear_session":
    case "logout":
      return null;
    case "verification_prompt_target":
      return null; // mock: never prompt
    case "log_verification_prompt_choice":
      return null;
    case "get_rooms":
      return MOCK_ROOMS;
    case "get_timeline":
      return { events: MOCK_TIMELINE, prev_batch: null };
    case "open_room_timeline":
      return { events: MOCK_TIMELINE, reached_start: true };
    case "load_older_timeline":
      // Mock has no deeper history; report the start of the room reached.
      return { events: [], reached_start: true };
    case "get_message_revisions": {
      // Return a couple of fake revision events for mock mode
      const origId = args?.eventId as string ?? "";
      const orig = MOCK_TIMELINE.find((e) => e.event_id === origId);
      if (!orig) return [];
      return [
        { ...orig, event_id: `${origId}:rev1`, body: `${orig.body} (first edit)`, is_edit: true, relates_to_event_id: origId, timestamp: orig.timestamp + 60_000 },
        { ...orig, event_id: `${origId}:rev2`, body: `${orig.body} (final edit)`, is_edit: true, relates_to_event_id: origId, timestamp: orig.timestamp + 120_000 },
      ];
    }
    case "get_event_context": {
      const targetId = args?.eventId as string ?? "";
      const idx = MOCK_TIMELINE.findIndex((e) => e.event_id === targetId);
      const start = Math.max(0, idx - 10);
      const end = Math.min(MOCK_TIMELINE.length, idx + 11);
      return {
        events: MOCK_TIMELINE.slice(start, end),
        target_event_id: targetId,
        prev_batch: start > 0 ? `mock-prev-${start}` : null,
        next_batch: end < MOCK_TIMELINE.length ? `mock-next-${end}` : null,
      };
    }
    case "paginate_forward": {
      // Mock token format: "mock-next-<index>" — index is the next event to return
      const after = args?.after as string ?? "";
      const m = /^mock-next-(\d+)$/.exec(after);
      const startIdx = m ? parseInt(m[1], 10) : MOCK_TIMELINE.length;
      const endIdx = Math.min(MOCK_TIMELINE.length, startIdx + 10);
      return {
        events: MOCK_TIMELINE.slice(startIdx, endIdx),
        next_batch: endIdx < MOCK_TIMELINE.length ? `mock-next-${endIdx}` : null,
      };
    }
    case "get_room_members":
      return MOCK_MEMBERS;
    case "get_room_receipts": {
      // Mock: spread a few members' read positions across the last two messages —
      // three on the newest (to exercise the "2 avatars + …" overflow) and one
      // on the previous message — so the feature is visible in browser/dev mode.
      if (MOCK_TIMELINE.length === 0) return [];
      const last = MOCK_TIMELINE[MOCK_TIMELINE.length - 1].event_id;
      const prev = MOCK_TIMELINE[Math.max(0, MOCK_TIMELINE.length - 2)].event_id;
      const now = Date.now();
      return [
        { user_id: "@alice:matrix.org", event_id: last, ts: now - 1000 },
        { user_id: "@bob:matrix.org", event_id: last, ts: now - 2000 },
        { user_id: "@carol:matrix.org", event_id: last, ts: now - 3000 },
        { user_id: "@dave:matrix.org", event_id: prev, ts: now - 60000 },
      ];
    }
    case "send_message": {
      const body = args?.body as string ?? "";
      const ev = mockEvent("@you:matrix.org", body, 0);
      if (args?.inReplyTo) ev.in_reply_to = args.inReplyTo as string;
      MOCK_TIMELINE.push(ev);
      return ev.event_id;
    }
    case "send_thread_reply": {
      const body = args?.body as string ?? "";
      const ev = mockEvent("@you:matrix.org", body, 0);
      ev.thread_root = args?.threadRootEventId as string ?? null;
      return ev.event_id;
    }
    case "create_room": {
      const opts = args?.options as { name?: string; invite?: string[]; is_direct?: boolean } | undefined;
      const roomId = `!mock-${Date.now()}:matrix.org`;
      const inviteUser = opts?.invite?.[0];
      const name = opts?.name ?? (inviteUser ? inviteUser.slice(1, inviteUser.indexOf(":")) : "New Room");
      MOCK_ROOMS.push({
        room_id: roomId,
        name,
        topic: null,
        avatar_url: null,
        unread_count: 0,
        notification_count: 0,
        is_direct: opts?.is_direct ?? false,
        is_encrypted: true,
        member_count: opts?.is_direct ? 2 : 1,
        last_activity_ts: Date.now(),
      });
      return roomId;
    }
    case "join_room":
    case "leave_room":
    case "mark_room_read":
    case "send_reaction":
    case "edit_message":
    case "redact_message":
    case "start_sync":
    case "invite_user":
    case "kick_user":
    case "ban_user":
    case "unban_user":
    case "set_display_name":
      return null;
    case "get_user_spaces":
      return [
        { room_id: "!space1:matrix.org", name: "Work", avatar_url: null, is_space: true, topic: null, member_count: 5, order: null, canonical_alias: null },
        { room_id: "!space2:matrix.org", name: "Gaming", avatar_url: null, is_space: true, topic: null, member_count: 10, order: null, canonical_alias: null },
      ];
    case "get_space_hierarchy":
      return [
        { room_id: "!general:matrix.org", name: "general", avatar_url: null, is_space: false, topic: "General discussion", member_count: 42, order: "1", canonical_alias: null },
        { room_id: "!dev:matrix.org", name: "dev", avatar_url: null, is_space: false, topic: "Development talk", member_count: 18, order: "2", canonical_alias: null },
      ];
    case "get_space_children":
      return MOCK_ROOMS.slice(0, 2).map((r, i) => ({ room_id: r.room_id, name: r.name, avatar_url: r.avatar_url, is_space: false, topic: r.topic, member_count: r.member_count, order: String(i + 1), canonical_alias: null }));
    case "load_quarkrc":
      // No rc file in mock mode — return empty parsed result
      return { directives: [], errors: [] };
    case "load_theme":
      // Return a minimal theme object so :theme commands don't crash in debug mode
      return {
        name: (args?.name as string) ?? "mock",
        colors: {},
      };
    case "list_custom_themes":
      // No custom themes in mock/dev mode
      return [];
    case "get_cache_stats":
      return { total_size_bytes: 15728640, entry_count: 42, max_size_bytes: 209715200, usage_percent: 7.5 } as CacheStats;
    case "get_emoji_packs":
      return [
        {
          pack_id: "mock-custom",
          display_name: "Mock Emoji",
          avatar_url: null,
          source: "user",
          room_id: null,
          emojis: [
            { shortcode: "partyblob", url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='28'>🎉</text></svg>", body: "Party blob", usage: ["emoticon"] },
            { shortcode: "blobcat", url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='28'>🐱</text></svg>", body: "Blob cat", usage: ["emoticon"] },
            { shortcode: "blobwave", url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='28'>👋</text></svg>", body: "Blob wave", usage: ["emoticon"] },
          ],
        },
      ] as EmojiPack[];
    case "get_sticker_packs":
      return [
        {
          pack_id: "mock-sticker-pack",
          display_name: "Mock Stickers",
          avatar_url: null,
          source: "user",
          room_id: null,
          emojis: [
            { shortcode: "wave", url: "mxc://matrix.org/mock-wave", usage: ["sticker"], body: "Wave" },
            { shortcode: "thumbsup", url: "mxc://matrix.org/mock-thumbsup", usage: ["sticker"], body: "Thumbs Up" },
            { shortcode: "heart", url: "mxc://matrix.org/mock-heart", usage: ["sticker"], body: "Heart" },
          ],
        },
      ] as EmojiPack[];
    case "search_gifs": {
      const query = ((args?.query as string) ?? "").toLowerCase();
      // Placeholder SVG thumbnails so the grid actually renders in dev mode
      const makeSvg = (label: string, color: string) =>
        `data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">` +
          `<rect width="160" height="90" fill="${color}" opacity="0.15"/>` +
          `<rect width="160" height="90" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.6"/>` +
          `<text x="80" y="50" text-anchor="middle" font-family="monospace" font-size="11" fill="${color}">${label}</text>` +
          `<text x="80" y="70" text-anchor="middle" font-family="monospace" font-size="9" fill="${color}" opacity="0.6">GIF</text>` +
          `</svg>`,
        )}`;
      const MOCK_GIFS: GifResult[] = [
        { id: "gif1", title: "Happy Dance", url: "https://example.com/gifs/dance.gif",     preview_url: makeSvg("happy dance", "#00ff41"),  width: 480, height: 270 },
        { id: "gif2", title: "Thumbs Up",   url: "https://example.com/gifs/thumbsup.gif",  preview_url: makeSvg("thumbs up",   "#00aaff"),  width: 320, height: 240 },
        { id: "gif3", title: "Cat Typing",  url: "https://example.com/gifs/cattype.gif",   preview_url: makeSvg("cat typing",  "#ff4466"),  width: 480, height: 320 },
        { id: "gif4", title: "Mind Blown",  url: "https://example.com/gifs/mindblown.gif", preview_url: makeSvg("mind blown",  "#ffaa00"),  width: 400, height: 300 },
        { id: "gif5", title: "Applause",    url: "https://example.com/gifs/applause.gif",  preview_url: makeSvg("applause",    "#aa44ff"),  width: 480, height: 270 },
        { id: "gif6", title: "Facepalm",    url: "https://example.com/gifs/facepalm.gif",  preview_url: makeSvg("facepalm",    "#888888"),  width: 360, height: 240 },
      ];
      if (query) {
        return MOCK_GIFS.filter((g) => g.title.toLowerCase().includes(query));
      }
      return MOCK_GIFS;
    }
    case "search_room_cache": {
      const q = ((args?.query as string) ?? "").toLowerCase();
      if (!q) return [] as TimelineEvent[];
      return MOCK_TIMELINE.filter(
        (e) => e.body && e.body.toLowerCase().includes(q),
      ) as TimelineEvent[];
    }
    case "search_room_messages": {
      // Mock streaming search: emit each match as a hit event (the dialog has
      // already subscribed before awaiting this call), then return a summary.
      const q = ((args?.query as string) ?? "").toLowerCase();
      const roomId = (args?.roomId as string) ?? "";
      const hits = q
        ? MOCK_TIMELINE.filter((e) => e.body && e.body.toLowerCase().includes(q))
        : [];
      for (const event of hits) {
        mockEmit("quark://search/hit", { room_id: roomId, event });
      }
      const oldestTs = MOCK_TIMELINE.reduce(
        (min, e) => Math.min(min, e.timestamp),
        Number.POSITIVE_INFINITY,
      );
      mockEmit("quark://search/progress", {
        scanned: MOCK_TIMELINE.length,
        oldest_ts: Number.isFinite(oldestTs) ? oldestTs : null,
      });
      return {
        scanned: MOCK_TIMELINE.length,
        matched: hits.length,
        reached_start: true,
        canceled: false,
      };
    }
    case "cancel_room_search":
      return null;
    case "get_room_scan_total":
      // Pretend a prior full scan recorded the timeline length as the total.
      return MOCK_TIMELINE.length;
    case "send_gif": {
      const title = (args?.title as string) ?? "GIF";
      MOCK_TIMELINE.push({
        ...mockEvent("@you:matrix.org", `[GIF: ${title}]`, 0),
        msg_type: "m.image",
        media_url: (args?.gifUrl as string) ?? "",
        media_mimetype: "image/gif",
      } as TimelineEvent);
      return "$mock-gif-event-id";
    }
    case "send_pasted_image": {
      const filename = (args?.filename as string) ?? "pasted-image.png";
      MOCK_TIMELINE.push({
        ...mockEvent("@you:matrix.org", `[Image: ${filename}]`, 0),
        msg_type: "m.image",
        media_url: "",
        media_mimetype: (args?.mimeType as string) ?? "image/png",
      } as TimelineEvent);
      return "$mock-paste-event-id";
    }
    case "send_file": {
      const filename = (args?.filename as string) ?? "file";
      MOCK_TIMELINE.push({
        ...mockEvent("@you:matrix.org", `[File: ${filename}]`, 0),
        msg_type: "m.file",
        media_url: "",
        media_mimetype: (args?.mimeType as string) ?? "application/octet-stream",
      } as TimelineEvent);
      return "$mock-file-event-id";
    }
    case "send_video": {
      const filename = (args?.filename as string) ?? "video.mp4";
      MOCK_TIMELINE.push({
        ...mockEvent("@you:matrix.org", `[Video: ${filename}]`, 0),
        msg_type: "m.video",
        media_url: "",
        media_mimetype: (args?.mimeType as string) ?? "video/mp4",
        media_width: (args?.width as number) ?? null,
        media_height: (args?.height as number) ?? null,
      } as TimelineEvent);
      return "$mock-video-event-id";
    }
    case "send_sticker":
      return "$mock-sticker-event-id";
    case "get_own_profile":
      return { user_id: "@you:matrix.org", display_name: "You", avatar_url: null };
    case "set_presence_status":
      return;
    case "get_presence_status":
      return {
        user_id: (args?.userId as string) ?? "@you:matrix.org",
        presence: "online",
        status_msg: "mock status — working on quark",
      };
    case "get_notification_config":
      return { enabled: true, show_body: true, show_sender: true, mute_rooms: [], quiet_hours: null, background_sync: false };
    case "get_background_sync_state":
      return { supported: false, enabled: false, running: false, battery_exempt: false };
    case "set_avatar":
      return "mxc://matrix.org/mock-avatar-upload";
    case "get_home_data": {
      const dm = (i: number, name: string, body: string, minsAgo: number, unread = 0, utd = false) => ({
        room_id: `!dm-${name.toLowerCase()}:matrix.org`,
        name,
        dm_user_id: `@${name.toLowerCase()}:matrix.org`,
        avatar_url: null,
        last_activity_ts: _now - minsAgo * 60_000,
        last_sender: `@${name.toLowerCase()}:matrix.org`,
        last_body: utd ? null : body,
        last_msg_type: utd ? "m.room.encrypted" : "m.text",
        last_is_utd: utd,
        unread_count: unread,
      });
      return [
        dm(0, "Alice", "did you see the new release? the home screen is wild", 4, 2),
        dm(1, "Bob", "ok ok I'll push the fix tonight", 22),
        dm(2, "Carol", "🎉🎉🎉", 51, 1),
        dm(3, "Dave", "", 95, 0, true),
        dm(4, "Erin", "lunch tomorrow? that ramen place near the station", 240),
        dm(5, "Frank", "thanks again for the help with the keyboard config!", 1440),
      ].slice(0, (args?.limit as number) ?? 12);
    }
    case "set_background_sync":
    case "request_battery_exemption":
      return null;

    // ─── Crypto ──────────────────────────────────────────────────────────
    case "get_verification_status":
      return { user_id: "@you:matrix.org", device_id: "MOCKDEVICE", display_name: "Quark (mock)", is_verified: true, is_cross_signed: false, trust_level: "self-verified" };
    case "get_cross_signing_status":
      return { has_master: false, has_self_signing: false, has_user_signing: false, is_complete: false };
    case "bootstrap_cross_signing":
      // Simulate server needing UIAA if no password supplied
      if (!args?.password) throw new Error("UIAA_REQUIRED");
      return null;
    case "get_user_devices":
      return [
        { user_id: args?.userId as string ?? "@alice:matrix.org", device_id: "ALICEPHONE", display_name: "Element iOS", is_verified: false, is_cross_signed: false, trust_level: "unverified" },
        { user_id: args?.userId as string ?? "@alice:matrix.org", device_id: "ALICEDESKTOP", display_name: null, is_verified: true, is_cross_signed: false, trust_level: "self-verified" },
      ];
    case "start_sas_verification":
      return "mock-flow-id-" + Date.now();
    case "accept_verification_request":
    case "accept_sas_verification":
    case "confirm_sas_verification":
    case "cancel_sas_verification":
      return null;
    case "get_sas_info": {
      // Simulate emojis becoming available after a short delay
      const MOCK_EMOJIS: [string, string][] = [
        ["🐶", "Dog"], ["🌙", "Moon"], ["🎩", "Hat"],
        ["🌹", "Rose"], ["🏠", "House"], ["🐧", "Penguin"], ["🎉", "Party"],
      ];
      return {
        flow_id: args?.flowId as string ?? "mock-flow-id",
        other_user_id: args?.userId as string ?? "@alice:matrix.org",
        other_device_id: "ALICEPHONE",
        emoji: MOCK_EMOJIS,
        decimals: null,
      };
    }

    case "get_pinned_events":
      return [
        { event_id: "$pin1:matrix.org", sender: "@alice:matrix.org", body: "Check out the new release notes!", formatted_body: null, timestamp: Date.now() - 24 * 60 * 60_000, encrypted: false },
        { event_id: "$pin2:matrix.org", sender: "@bob:matrix.org", body: "Server maintenance scheduled for Sunday 02:00 UTC.", formatted_body: null, timestamp: Date.now() - 3 * 24 * 60 * 60_000, encrypted: false },
        { event_id: "$pin3:matrix.org", sender: "@alice:matrix.org", body: "Welcome to #general! Please read the rules in #announcements.", formatted_body: null, timestamp: Date.now() - 7 * 24 * 60 * 60_000, encrypted: false },
      ];
    case "search_room_directory": {
      const filterStr = ((args?.filter as string | null) ?? "").toLowerCase();
      const rooms = [
        { room_id: "!pub1:matrix.org", name: "Matrix HQ", topic: "The official Matrix headquarters room", alias: "#matrix:matrix.org", avatar_url: null, member_count: 12500 },
        { room_id: "!pub2:matrix.org", name: "Open Source Developers", topic: "For FOSS contributors and enthusiasts", alias: "#opensource:matrix.org", avatar_url: null, member_count: 3800 },
        { room_id: "!pub3:matrix.org", name: "Gaming Lounge", topic: "All things gaming", alias: "#gaming:matrix.org", avatar_url: null, member_count: 950 },
        { room_id: "!pub4:matrix.org", name: "Linux & BSD", topic: "Linux, BSD and unix-like system discussion", alias: "#linux:matrix.org", avatar_url: null, member_count: 2100 },
        { room_id: "!pub5:matrix.org", name: "Privacy & Security", topic: "Privacy tools and best practices", alias: "#privacy:matrix.org", avatar_url: null, member_count: 4400 },
      ];
      return filterStr
        ? rooms.filter((r) => (r.name + " " + (r.topic ?? "")).toLowerCase().includes(filterStr))
        : rooms;
    }
    case "get_app_config":
      return {
        general: { theme: "phosphor", notifications: true, confirm_redact: true, icon_radius: "50%", vim_mode: true, send_read_receipts: true, show_read_receipts: true, prompt_session_verification: true },
        sync: { sliding_sync: true, timeline_limit: 50 },
        media: { auto_load_images: true, inline_video: true, max_image_width: 600, max_image_height: 400, sticker_max_size: 256, cache_size_mb: 500 },
        gif: { provider: "tenor", api_key: "", rating: "pg", cache_results: true },
        emoji: { shortcode_autocomplete: true, autocomplete_min_chars: 2 },
        home: { dm_limit: 12 },
        cache: { image_memory_mb: 150, timeline_rooms: 30 },
        updater: { channel: "stable", auto_check: true },
      };
    case "get_event_cache_size":
      return 487654321;
    case "get_event_cache_diagnostics":
      return {
        store_main_bytes: 471859200,
        store_wal_bytes: 15795121,
        store_total_bytes: 487654321,
        rooms_total: 3,
        rooms_with_cached_events: 1,
        total_cached_events: 42,
      };
    case "get_room_cache_diagnostics":
      return {
        cached_events: 42,
        estimated_bytes: 137216,
        oldest_ts: Date.now() - 86400000,
        newest_ts: Date.now() - 60000,
      };
    case "set_app_config":
    case "set_notification_config":
    case "clear_media_cache":
    case "set_cache_size_limit":
    case "clear_event_cache":
    case "mute_room":
    case "unmute_room":
    case "init_notification_channels":
    case "clear_room_notifications":
      return null;
    case "take_pending_notification_action":
      return null;

    // ─── Room Settings ────────────────────────────────────────────────────
    case "get_power_levels":
      return {
        ban: 50, kick: 50, invite: 50, redact: 50,
        state_default: 50, events_default: 0, users_default: 0,
        events: { "m.room.name": 50, "m.room.topic": 50, "m.room.avatar": 50 },
        users: { "@alice:matrix.org": 100, "@bob:matrix.org": 50 },
      };
    case "set_power_levels":
    case "set_room_name":
    case "set_room_topic":
    case "set_room_join_rule":
    case "set_room_history_visibility":
      return null;

    // ─── Debug Viewer ─────────────────────────────────────────────────────
    case "get_room_state_events": {
      const roomId = (args?.roomId as string) ?? "!general:matrix.org";
      return [
        { event_type: "m.room.create", state_key: "", sender: "@alice:matrix.org", content_json: JSON.stringify({ creator: "@alice:matrix.org", room_version: "10" }, null, 2), event_id: "$create:matrix.org", origin_server_ts: Date.now() - 86400_000 * 30 },
        { event_type: "m.room.name", state_key: "", sender: "@alice:matrix.org", content_json: JSON.stringify({ name: "general" }, null, 2), event_id: "$name:matrix.org", origin_server_ts: Date.now() - 86400_000 * 29 },
        { event_type: "m.room.topic", state_key: "", sender: "@alice:matrix.org", content_json: JSON.stringify({ topic: "General discussion" }, null, 2), event_id: "$topic:matrix.org", origin_server_ts: Date.now() - 86400_000 * 28 },
        { event_type: "m.room.join_rules", state_key: "", sender: "@alice:matrix.org", content_json: JSON.stringify({ join_rule: "invite" }, null, 2), event_id: "$joinrules:matrix.org", origin_server_ts: Date.now() - 86400_000 * 27 },
        { event_type: "m.room.history_visibility", state_key: "", sender: "@alice:matrix.org", content_json: JSON.stringify({ history_visibility: "shared" }, null, 2), event_id: "$hv:matrix.org", origin_server_ts: Date.now() - 86400_000 * 26 },
        { event_type: "m.room.power_levels", state_key: "", sender: "@alice:matrix.org", content_json: JSON.stringify({ ban: 50, kick: 50, invite: 50, events_default: 0, users_default: 0 }, null, 2), event_id: "$pl:matrix.org", origin_server_ts: Date.now() - 86400_000 * 25 },
        { event_type: "m.room.encryption", state_key: "", sender: "@alice:matrix.org", content_json: JSON.stringify({ algorithm: "m.megolm.v1.aes-sha2" }, null, 2), event_id: "$enc:matrix.org", origin_server_ts: Date.now() - 86400_000 * 24 },
        { event_type: "m.room.member", state_key: "@alice:matrix.org", sender: "@alice:matrix.org", content_json: JSON.stringify({ membership: "join", displayname: "Alice" }, null, 2), event_id: "$member-alice:matrix.org", origin_server_ts: Date.now() - 86400_000 * 30 },
      ];
    }
    case "get_raw_event": {
      const eventId = (args?.eventId as string) ?? "$mock";
      const ev = MOCK_TIMELINE.find((e) => e.event_id === eventId) ?? MOCK_TIMELINE[0];
      return JSON.stringify({
        event_id: ev.event_id,
        type: "m.room.message",
        sender: ev.sender,
        origin_server_ts: ev.timestamp,
        content: {
          msgtype: ev.msg_type ?? "m.text",
          body: ev.body,
          ...(ev.formatted_body ? { formatted_body: ev.formatted_body, format: "org.matrix.custom.html" } : {}),
        },
        unsigned: { age: Date.now() - ev.timestamp },
      }, null, 2);
    }
    case "save_media_to_temp":
      return `/tmp/quark-mock-video.mp4`;
    case "serve_media":
      return `http://127.0.0.1:0/mock/quark-media-mock.mp4`;
    case "get_platform":
      return "linux";
    case "save_media_with_dialog":
      console.log("[mock] save_media_with_dialog", args);
      return (args?.suggestedFilename as string)
        ? `/tmp/quark-mock-downloads/${args?.suggestedFilename as string}`
        : "/tmp/quark-mock-save.bin";
    case "open_media_externally":
      console.log("[mock] open_media_externally", args);
      return null;

    case "download_media": {
      // Return a placeholder SVG so emoji/sticker previews render in mock mode.
      const label = ((args?.mxcUrl as string) ?? "").split("/").pop()?.slice(0, 8) ?? "media";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
        `<rect width="64" height="64" rx="8" fill="#00ff41" opacity="0.15"/>` +
        `<rect width="64" height="64" rx="8" fill="none" stroke="#00ff41" stroke-width="1.5" opacity="0.6"/>` +
        `<text x="32" y="38" text-anchor="middle" font-family="monospace" font-size="9" fill="#00ff41">${label}</text>` +
        `</svg>`;
      return { data_base64: btoa(svg), mime_type: "image/svg+xml", filename: null };
    }

    case "get_url_preview":
      return null;

    case "open_external_url": {
      const url = args?.url as string | undefined;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      return null;
    }

    // ─── Updater ──────────────────────────────────────────────────────────
    case "update_check":
      // Mock dev mode is always "up to date".
      return null;
    case "update_install":
      return undefined;

    default:
      console.warn(`[mock] unhandled command: ${cmd}`, args);
      return null;
  }
}
