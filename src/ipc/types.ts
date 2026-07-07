// Shared IPC type definitions — mirror the serde-serialized Rust structs.
// Keep field names in snake_case to match Tauri's default serialization.

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  user_id: string;
  device_id: string;
  access_token: string;
  homeserver_url: string;
}

/** Own user profile — matches matrix::client::OwnProfile */
export interface OwnProfile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

/** Serializable room info — matches matrix::rooms::RoomInfo */
export interface RoomInfo {
  room_id: string;
  name: string | null;
  topic: string | null;
  avatar_url: string | null;
  unread_count: number;
  notification_count: number;
  is_direct: boolean;
  is_encrypted: boolean;
  member_count: number;
  /** Timestamp (ms since Unix epoch) of the most recent event. Used for recency sorting. */
  last_activity_ts?: number | null;
}

/** Options for creating a room — matches matrix::rooms::CreateRoomOptions */
export interface CreateRoomOptions {
  name?: string | null;
  topic?: string | null;
  alias?: string | null;
  is_public: boolean;
  is_direct: boolean;
  invite: string[];
  enable_encryption: boolean;
}

// ─── Members ──────────────────────────────────────────────────────────────────

/** Power level categories */
export type MemberPowerLevel = "admin" | "mod" | "member";

/** A single room member — matches matrix::rooms::RoomMember */
export interface RoomMember {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  power_level: MemberPowerLevel;
  presence: "online" | "unavailable" | "offline" | null;
}

/** A single user's latest public read position — matches Rust `ReadReceiptInfo`. */
export interface ReadReceiptInfo {
  user_id: string;
  event_id: string;
  /** When the receipt was sent (ms since epoch), if known. */
  ts: number | null;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

/** A page of timeline events with a cursor for loading older messages. */
export interface TimelinePage {
  events: TimelineEvent[];
  /** Token to pass as `before` to fetch the previous (older) page. Null at the start of history. */
  prev_batch: string | null;
}

/** A page served from the event cache (cache-backed live path) — matches matrix::timeline::CachedTimelinePage */
export interface CachedTimelinePage {
  events: TimelineEvent[];
  /** True once back-pagination has reached the start of the room's history. */
  reached_start: boolean;
}

/** Events surrounding a specific event — matches matrix::timeline::EventContextPage */
export interface EventContextPage {
  events: TimelineEvent[];
  target_event_id: string;
  /** Token for paginating to older messages from this context window. */
  prev_batch: string | null;
  /** Token for paginating to newer messages. Null when at the live end. */
  next_batch: string | null;
}

/** A page of newer events from forward pagination — matches matrix::timeline::TimelineForwardPage */
export interface TimelineForwardPage {
  events: TimelineEvent[];
  /** Token to pass as `after` to fetch the next (newer) page. Null at the live tail. */
  next_batch: string | null;
}

/** Serializable timeline event — matches matrix::timeline::TimelineEvent */
export interface TimelineEvent {
  event_id: string;
  sender: string;
  body: string;
  formatted_body: string | null;
  timestamp: number;
  msg_type: string;
  is_edit: boolean;
  relates_to_event_id: string | null;
  in_reply_to: string | null;
  thread_root: string | null;
  media_url: string | null;
  media_mimetype: string | null;
  media_width: number | null;
  media_height: number | null;
  /** Media caption (MSC2530) for image messages; absent when the body is just a filename. */
  caption?: string | null;
  /** JSON-serialized EncryptedFile for E2EE media; absent for plain media. */
  media_encryption_info?: string | null;
  /** mxc:// URL for the video thumbnail image (from VideoInfo.thumbnail_source). */
  media_thumbnail_url?: string | null;
  /** JSON-serialized EncryptedFile for E2EE video thumbnails. */
  media_thumbnail_encryption_info?: string | null;
  reactions?: ReactionGroup[];
  /** Frontend-only: set by _applyEdits when this original event has been replaced by at least one edit. */
  was_edited?: boolean;
  /** Frontend-only: the body before any edits were applied (set by _applyEdits). */
  original_body?: string;
}

// ─── Search ───────────────────────────────────────────────────────────────────

/** A single message search result, normalized across all search tiers. */
export interface SearchResult {
  eventId: string;
  sender: string;
  /** ms since the UNIX epoch */
  timestamp: number;
  body: string;
}

/** Summary returned by the streaming server-side search command. */
export interface SearchSummary {
  scanned: number;
  matched: number;
  reached_start: boolean;
  canceled: boolean;
}

// ─── URL Preview ──────────────────────────────────────────────────────────────

/** OpenGraph-like metadata returned by get_url_preview — matches commands::UrlPreview */
export interface UrlPreview {
  title: string | null;
  description: string | null;
  /** mxc:// URL for the preview image */
  image_url: string | null;
  site_name: string | null;
}

// ─── Reactions ────────────────────────────────────────────────────────────────

/** Aggregated reaction group — matches matrix::reactions::ReactionGroup */
export interface ReactionGroup {
  key: string;
  count: number;
  senders: string[];
  /** Serialized as "own" by the Rust backend (serde rename). */
  own: boolean;
  own_event_id: string | null;
}

// ─── Emoji ────────────────────────────────────────────────────────────────────

/** A single emoji entry — matches matrix::emoji::EmojiEntry */
export interface EmojiEntry {
  shortcode: string;
  url: string;
  body: string | null;
  /** Usage tags: ["emoticon"], ["sticker"], or both */
  usage: string[];
}

/** An emoji/sticker pack — matches matrix::emoji::EmojiPack */
export interface EmojiPack {
  pack_id: string;
  display_name: string | null;
  avatar_url: string | null;
  /** "room" | "user" */
  source: string;
  room_id: string | null;
  emojis: EmojiEntry[];
}

// ─── Media ────────────────────────────────────────────────────────────────────

/** Result of a media download — matches matrix::media::MediaDownload */
export interface MediaDownload {
  data_base64: string;
  mime_type: string;
  filename: string | null;
}

// ─── Devices / Sessions ───────────────────────────────────────────────────────

/** A user session/device with merged trust status — matches matrix::devices::SessionInfo */
export interface DeviceSessionInfo {
  device_id: string;
  display_name: string | null;
  last_seen_ts: number | null;
  last_seen_ip: string | null;
  is_current: boolean;
  is_verified: boolean;
  is_cross_signed: boolean;
  trust_level: string;
}

// ─── Crypto ───────────────────────────────────────────────────────────────────

/** Verification status for a device — matches matrix::crypto::VerificationStatus */
export interface VerificationStatus {
  user_id: string;
  device_id: string;
  /** Human-readable device name (set at login), or null if none was set. */
  display_name: string | null;
  is_verified: boolean;
  is_cross_signed: boolean;
  trust_level: string;
}

/**
 * Cross-signing key status — matches matrix::crypto::CrossSigningInfo.
 * `is_complete` is true when all three keys (master, self-signing, user-signing)
 * are present locally.
 */
export interface CrossSigningInfo {
  has_master: boolean;
  has_self_signing: boolean;
  has_user_signing: boolean;
  is_complete: boolean;
}

/**
 * Key backup status — matches matrix::crypto::KeyBackupStatus.
 */
export interface KeyBackupStatus {
  enabled: boolean;
  exists_on_server: boolean;
}

/**
 * SAS emoji verification info — matches matrix::crypto::SasInfo.
 * `emoji` is a list of [symbol, description] pairs (up to 7).
 * Available only after key exchange; poll get_sas_info until present.
 */
export interface SasInfo {
  flow_id: string;
  other_user_id: string;
  other_device_id: string;
  /** Each element is [emoji_symbol, description], e.g. ["🐶", "Dog"] */
  emoji: [string, string][];
  /** Three-digit decimal alternative to emoji, or null */
  decimals: [number, number, number] | null;
}

// ─── Spaces ───────────────────────────────────────────────────────────────────

/** A child room/space — matches matrix::spaces::SpaceChild */
export interface SpaceChild {
  room_id: string;
  name: string | null;
  topic: string | null;
  avatar_url: string | null;
  is_space: boolean;
  member_count: number | null;
  order: string | null;
  canonical_alias: string | null;
}

// ─── Threads ──────────────────────────────────────────────────────────────────

/** A thread root message — matches matrix::threads::ThreadRoot */
export interface ThreadRoot {
  event_id: string;
  sender: string;
  body: string;
  timestamp: number;
  reply_count: number;
  latest_reply_timestamp: number | null;
}

// ─── GIF ──────────────────────────────────────────────────────────────────────

/** A GIF result — matches gif::GifResult */
export interface GifResult {
  id: string;
  title: string;
  url: string;
  preview_url: string;
  width: number;
  height: number;
}

// ─── Pinned Messages ──────────────────────────────────────────────────────────

/** A pinned event — matches matrix::rooms::PinnedEventInfo */
export interface PinnedEventInfo {
  event_id: string;
  sender: string;
  body: string;
  formatted_body: string | null;
  timestamp: number;
  /** True when the pinned event couldn't be decrypted; `body` holds the
   *  "🔒 unable to decrypt" placeholder and the row is dimmed. */
  encrypted: boolean;
}

// ─── Home view ────────────────────────────────────────────────────────────────

/** Per-DM payload for the Home view — matches matrix::rooms::HomeDmInfo */
export interface HomeDmInfo {
  room_id: string;
  name: string | null;
  /** The DM partner's user ID (from m.direct), when known. */
  dm_user_id: string | null;
  /** Partner avatar (preferred) or room avatar, as an mxc:// URL. */
  avatar_url: string | null;
  last_activity_ts: number | null;
  last_sender: string | null;
  /** Single-line plain-text snippet; null for UTD events. */
  last_body: string | null;
  last_msg_type: string | null;
  last_is_utd: boolean;
  unread_count: number;
}

// ─── Room Directory ───────────────────────────────────────────────────────────

/** A public room from the room directory — matches matrix::rooms::PublicRoomInfo */
export interface PublicRoomInfo {
  room_id: string;
  name: string | null;
  topic: string | null;
  alias: string | null;
  avatar_url: string | null;
  member_count: number | null;
}

// ─── Room Settings ────────────────────────────────────────────────────────────

/** Power levels for a room — matches matrix::rooms::PowerLevels */
export interface PowerLevels {
  ban: number;
  kick: number;
  invite: number;
  redact: number;
  state_default: number;
  events_default: number;
  users_default: number;
  /** event type string → required power level */
  events: Record<string, number>;
  /** user_id → power level override */
  users: Record<string, number>;
}

// ─── Debug Viewer ─────────────────────────────────────────────────────────────

/** A single raw state event — matches matrix::rooms::RawStateEvent */
export interface RawStateEvent {
  event_type: string;
  state_key: string;
  sender: string;
  content_json: string;
  event_id: string | null;
  origin_server_ts: number | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * A parsed key mapping — matches config::quarkrc::Mapping.
 * map_type is serialized as lowercase via serde rename_all.
 */
export interface Mapping {
  map_type: MapType;
  noremap: boolean;
  key: string;
  action: string;
}

export type MapType =
  | "normal"
  | "insert"
  | "timeline"
  | "roomlist"
  | "picker"
  | "command"
  | "visual";

export interface Unmap {
  map_type: MapType;
  key: string;
}

export type OptionValue =
  | boolean
  | number
  | string;

export interface SetOption {
  name: string;
  value: OptionValue;
}

export interface LetBinding {
  name: string;
  value: string;
}

export interface SourceDirective {
  path: string;
}

export interface ColorschemeDiretive {
  name: string;
}

/** A parsed directive line — matches config::quarkrc::RcDirective (tagged union) */
export type RcDirective =
  | { type: "map"; map_type: MapType; noremap: boolean; key: string; action: string }
  | { type: "unmap"; map_type: MapType; key: string }
  | { type: "set"; name: string; value: OptionValue }
  | { type: "let"; name: string; value: string }
  | { type: "source"; path: string }
  | { type: "colorscheme"; name: string }
  | { type: "comment"; content: string };

export interface ParseError {
  line_number: number;
  line: string;
  message: string;
}

/** Parsed quarkrc file — matches config::quarkrc::ParsedRc */
export interface ParsedRc {
  directives: RcDirective[];
  errors: ParseError[];
}
