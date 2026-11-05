// Theme loader — applies theme data from the Tauri backend as CSS custom properties

export interface ThemeMeta {
  name: string;
  author?: string;
  version?: string;
}

export interface ThemeAccent {
  primary?: string;
  secondary?: string;
  error?: string;
  warning?: string;
  success?: string;
  link?: string;
}

export interface ThemeMessages {
  own?: string;
  other?: string;
  system?: string;
  timestamp?: string;
  mention_bg?: string;
  mention_fg?: string;
  reply_border?: string;
  thread_indicator?: string;
}

export interface ThemeRoomlist {
  active_bg?: string;
  active_fg?: string;
  unread?: string;
  mention_badge?: string;
  muted?: string;
}

export interface ThemeReactions {
  background?: string;
  border?: string;
  own_bg?: string;
  count?: string;
}

export interface ThemeTypography {
  font_family?: string;
  font_size?: number;
  line_height?: number;
  message_spacing?: number;
}

export interface ThemeBorders {
  style?: "single" | "double" | "rounded" | "ascii" | "none";
  room_list_width?: string;
}

export interface ThemeEmoji {
  size?: number;
  sticker_max_size?: number;
  reaction_size?: number;
}

export interface ThemePrompt {
  symbol?: string;
  normal_indicator?: string;
  insert_indicator?: string;
  command_indicator?: string;
  visual_indicator?: string;
}

export interface ThemeColors {
  background?: string;
  foreground?: string;
  cursor?: string;
  selection_bg?: string;
  selection_fg?: string;
  border?: string;
  accent?: ThemeAccent;
  messages?: ThemeMessages;
  roomlist?: ThemeRoomlist;
  reactions?: ThemeReactions;
}

/** Matches the TOML structure from the Tauri backend */
export interface Theme {
  meta?: ThemeMeta;
  colors?: ThemeColors;
  typography?: ThemeTypography;
  borders?: ThemeBorders;
  emoji?: ThemeEmoji;
  prompt?: ThemePrompt;
}

// ── Border glyph sets ────────────────────────────────────────────────────────

const BORDER_GLYPHS: Record<
  NonNullable<ThemeBorders["style"]>,
  { h: string; v: string; tl: string; tr: string; bl: string; br: string }
> = {
  single: { h: "─", v: "│", tl: "┌", tr: "┐", bl: "└", br: "┘" },
  double: { h: "═", v: "║", tl: "╔", tr: "╗", bl: "╚", br: "╝" },
  rounded: { h: "─", v: "│", tl: "╭", tr: "╮", bl: "╰", br: "╯" },
  ascii: { h: "-", v: "|", tl: "+", tr: "+", bl: "+", br: "+" },
  none: { h: " ", v: " ", tl: " ", tr: " ", bl: " ", br: " " },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function px(n: number): string {
  return `${n}px`;
}

// ── Cross-fade ───────────────────────────────────────────────────────────────

/** Duration of the theme colour tween. Kept in sync with the
 *  `.theme-tweening` transition in base.css. */
const THEME_TWEEN_MS = 450;

let tweenTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Briefly enable colour transitions so a theme change eases to its new palette
 * instead of snapping. The `.theme-tweening` class on the documentElement turns
 * the transitions on (see base.css); we strip it once the tween has elapsed so
 * it can't bleed into ordinary interaction. Honours prefers-reduced-motion.
 */
function beginThemeTween(root: HTMLElement): void {
  const html = root.ownerDocument?.documentElement;
  if (!html) return;
  if (typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  html.classList.add("theme-tweening");
  if (tweenTimer !== undefined) clearTimeout(tweenTimer);
  tweenTimer = setTimeout(() => {
    html.classList.remove("theme-tweening");
    tweenTimer = undefined;
  }, THEME_TWEEN_MS + 50);
}

// ── Apply ────────────────────────────────────────────────────────────────────

/**
 * Map a theme object to the CSS custom properties it sets. Pure — the single
 * source of truth for how theme fields become CSS, shared by {@link applyTheme}
 * and the quark.tel theme editor's live preview. Only fields explicitly present
 * in the theme produce an entry; the rest fall back to the defaults in vars.css.
 */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  const set = (prop: string, value: string): void => {
    vars[prop] = value;
  };

  const c = theme.colors;
  if (c) {
    if (c.background) set("--bg", c.background);
    if (c.foreground) set("--fg", c.foreground);
    if (c.cursor) set("--cursor", c.cursor);
    if (c.selection_bg) set("--selection-bg", c.selection_bg);
    if (c.selection_fg) set("--selection-fg", c.selection_fg);
    if (c.border) set("--border-color", c.border);

    const a = c.accent;
    if (a) {
      if (a.primary) set("--accent-primary", a.primary);
      if (a.secondary) set("--accent-secondary", a.secondary);
      if (a.error) set("--accent-error", a.error);
      if (a.warning) set("--accent-warning", a.warning);
      if (a.success) set("--accent-success", a.success);
      if (a.link) set("--accent-link", a.link);
    }

    const m = c.messages;
    if (m) {
      if (m.own) set("--msg-own", m.own);
      if (m.other) set("--msg-other", m.other);
      if (m.system) set("--msg-system", m.system);
      if (m.timestamp) set("--msg-timestamp", m.timestamp);
      if (m.mention_bg) set("--msg-mention-bg", m.mention_bg);
      if (m.mention_fg) set("--msg-mention-fg", m.mention_fg);
      if (m.reply_border) set("--msg-reply-border", m.reply_border);
      if (m.thread_indicator) set("--msg-thread-indicator", m.thread_indicator);
    }

    const rl = c.roomlist;
    if (rl) {
      if (rl.active_bg) set("--roomlist-active-bg", rl.active_bg);
      if (rl.active_fg) set("--roomlist-active-fg", rl.active_fg);
      if (rl.unread) set("--roomlist-unread", rl.unread);
      if (rl.mention_badge) set("--roomlist-mention-badge", rl.mention_badge);
      if (rl.muted) set("--roomlist-muted", rl.muted);
    }

    const rx = c.reactions;
    if (rx) {
      if (rx.background) set("--reaction-bg", rx.background);
      if (rx.border) set("--reaction-border", rx.border);
      if (rx.own_bg) set("--reaction-own-bg", rx.own_bg);
      if (rx.count) set("--reaction-count", rx.count);
    }
  }

  const t = theme.typography;
  if (t) {
    if (t.font_family) set("--font-family", t.font_family);
    if (t.font_size != null) set("--font-size", px(t.font_size));
    if (t.line_height != null) set("--line-height", String(t.line_height));
    if (t.message_spacing != null) set("--message-spacing", px(t.message_spacing));
  }

  const b = theme.borders;
  if (b) {
    if (b.room_list_width) set("--room-list-width", b.room_list_width);
    const glyphs = b.style ? BORDER_GLYPHS[b.style] : undefined;
    if (b.style && glyphs) {
      set("--border-style", b.style);
      set("--border-h", `"${glyphs.h}"`);
      set("--border-v", `"${glyphs.v}"`);
      set("--border-tl", `"${glyphs.tl}"`);
      set("--border-tr", `"${glyphs.tr}"`);
      set("--border-bl", `"${glyphs.bl}"`);
      set("--border-br", `"${glyphs.br}"`);
    }
  }

  const e = theme.emoji;
  if (e) {
    if (e.size != null) set("--emoji-size", px(e.size));
    if (e.sticker_max_size != null) set("--sticker-max-size", px(e.sticker_max_size));
    if (e.reaction_size != null) set("--reaction-size", px(e.reaction_size));
  }

  const p = theme.prompt;
  if (p) {
    if (p.symbol) set("--prompt-symbol", `"${p.symbol}"`);
    if (p.normal_indicator) set("--mode-normal", `"${p.normal_indicator}"`);
    if (p.insert_indicator) set("--mode-insert", `"${p.insert_indicator}"`);
    if (p.command_indicator) set("--mode-command", `"${p.command_indicator}"`);
    if (p.visual_indicator) set("--mode-visual", `"${p.visual_indicator}"`);
  }

  return vars;
}

/**
 * Apply a theme object (from the Tauri backend) as CSS custom properties on
 * the :root element.  Only properties that are explicitly present in the theme
 * object are written — the rest fall back to the defaults in vars.css.
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  // Ease the colour change rather than snapping. Must run before the custom
  // properties are rewritten so the transition is armed when values change.
  beginThemeTween(root);

  for (const [prop, value] of Object.entries(themeToCssVars(theme))) {
    root.style.setProperty(prop, value);
  }
}

/**
 * Reset all theme custom properties to empty strings, allowing the defaults
 * in vars.css to take effect again.
 */
export function resetTheme(root: HTMLElement = document.documentElement): void {
  beginThemeTween(root);
  const props = [
    "--bg", "--fg", "--cursor", "--selection-bg", "--selection-fg", "--border-color",
    "--accent-primary", "--accent-secondary", "--accent-error", "--accent-warning",
    "--accent-success", "--accent-link",
    "--msg-own", "--msg-other", "--msg-system", "--msg-timestamp",
    "--msg-mention-bg", "--msg-mention-fg", "--msg-reply-border", "--msg-thread-indicator",
    "--roomlist-active-bg", "--roomlist-active-fg", "--roomlist-unread",
    "--roomlist-mention-badge", "--roomlist-muted",
    "--reaction-bg", "--reaction-border", "--reaction-own-bg", "--reaction-count",
    "--font-family", "--font-size", "--line-height", "--message-spacing",
    "--room-list-width", "--border-style",
    "--border-h", "--border-v", "--border-tl", "--border-tr", "--border-bl", "--border-br",
    "--emoji-size", "--sticker-max-size", "--reaction-size",
    "--prompt-symbol", "--mode-normal", "--mode-insert", "--mode-command", "--mode-visual",
  ];
  for (const prop of props) {
    root.style.removeProperty(prop);
  }
}
