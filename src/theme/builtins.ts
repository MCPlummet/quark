// Built-in themes embedded at compile time.
// These are converted from the TOML files in /themes/ so they work in both
// dev (mock IPC) and production without needing file system access.

import type { Theme } from "./loader.js";

export const BUILTIN_THEME_MAP: Record<string, Theme> = {
  phosphor: {
    meta: { name: "Phosphor", author: "quark", version: "1.0" },
    colors: {
      background: "#0a0a0a", foreground: "#b0b0b0", cursor: "#00ff41",
      selection_bg: "#1a3a1a", selection_fg: "#00ff41", border: "#333333",
      accent: { primary: "#00ff41", secondary: "#00aaff", error: "#ff3333", warning: "#ffaa00", success: "#00ff41", link: "#00aaff" },
      messages: { own: "#00ff41", other: "#b0b0b0", system: "#555555", timestamp: "#444444", mention_bg: "#1a1a00", mention_fg: "#ffaa00", reply_border: "#00aaff", thread_indicator: "#00aaff" },
      roomlist: { active_bg: "#1a1a1a", active_fg: "#00ff41", unread: "#ffffff", mention_badge: "#ff3333", muted: "#444444" },
      reactions: { background: "#0a0a0a", border: "#333333", own_bg: "#1a3a1a", count: "#888888" },
    },
    typography: { font_family: "JetBrains Mono, Fira Code, monospace", font_size: 14, line_height: 1.5, message_spacing: 4 },
    borders: { style: "rounded", room_list_width: "25%" },
    emoji: { size: 32, sticker_max_size: 256, reaction_size: 20 },
    prompt: { normal_indicator: "NOR", insert_indicator: "INS", command_indicator: "CMD", visual_indicator: "VIS" },
  },
  amber: {
    meta: { name: "Amber", author: "quark", version: "1.0" },
    colors: {
      background: "#0d0900", foreground: "#c8820a", cursor: "#ffb000",
      selection_bg: "#2e1f00", selection_fg: "#ffb000", border: "#3d2800",
      accent: { primary: "#ffb000", secondary: "#e07b00", error: "#ff4422", warning: "#ffd040", success: "#c8a000", link: "#e07b00" },
      messages: { own: "#ffb000", other: "#c8820a", system: "#5a3d00", timestamp: "#4a3000", mention_bg: "#1f1200", mention_fg: "#ffd040", reply_border: "#e07b00", thread_indicator: "#e07b00" },
      roomlist: { active_bg: "#1a1000", active_fg: "#ffb000", unread: "#ffd040", mention_badge: "#ff4422", muted: "#4a3000" },
      reactions: { background: "#0d0900", border: "#3d2800", own_bg: "#2e1f00", count: "#7a5500" },
    },
    typography: { font_family: "JetBrains Mono, Fira Code, monospace", font_size: 14, line_height: 1.5, message_spacing: 4 },
    borders: { style: "rounded", room_list_width: "25%" },
    emoji: { size: 32, sticker_max_size: 256, reaction_size: 20 },
    prompt: { normal_indicator: "NOR", insert_indicator: "INS", command_indicator: "CMD", visual_indicator: "VIS" },
  },
  dracula: {
    meta: { name: "Dracula", author: "quark", version: "1.0" },
    colors: {
      background: "#282a36", foreground: "#f8f8f2", cursor: "#bd93f9",
      selection_bg: "#44475a", selection_fg: "#f8f8f2", border: "#44475a",
      accent: { primary: "#bd93f9", secondary: "#8be9fd", error: "#ff5555", warning: "#ffb86c", success: "#50fa7b", link: "#8be9fd" },
      messages: { own: "#50fa7b", other: "#f8f8f2", system: "#6272a4", timestamp: "#44475a", mention_bg: "#3a2e4a", mention_fg: "#ff79c6", reply_border: "#8be9fd", thread_indicator: "#8be9fd" },
      roomlist: { active_bg: "#44475a", active_fg: "#bd93f9", unread: "#f8f8f2", mention_badge: "#ff5555", muted: "#6272a4" },
      reactions: { background: "#282a36", border: "#6272a4", own_bg: "#3a2e4a", count: "#6272a4" },
    },
    typography: { font_family: "JetBrains Mono, Fira Code, monospace", font_size: 14, line_height: 1.5, message_spacing: 4 },
    borders: { style: "rounded", room_list_width: "25%" },
    emoji: { size: 32, sticker_max_size: 256, reaction_size: 20 },
    prompt: { normal_indicator: "NOR", insert_indicator: "INS", command_indicator: "CMD", visual_indicator: "VIS" },
  },
  nord: {
    meta: { name: "Nord", author: "quark", version: "1.0" },
    colors: {
      background: "#2e3440", foreground: "#d8dee9", cursor: "#88c0d0",
      selection_bg: "#3b4252", selection_fg: "#eceff4", border: "#3b4252",
      accent: { primary: "#88c0d0", secondary: "#81a1c1", error: "#bf616a", warning: "#ebcb8b", success: "#a3be8c", link: "#5e81ac" },
      messages: { own: "#a3be8c", other: "#d8dee9", system: "#4c566a", timestamp: "#434c5e", mention_bg: "#3b3f4e", mention_fg: "#ebcb8b", reply_border: "#81a1c1", thread_indicator: "#81a1c1" },
      roomlist: { active_bg: "#3b4252", active_fg: "#88c0d0", unread: "#eceff4", mention_badge: "#bf616a", muted: "#4c566a" },
      reactions: { background: "#2e3440", border: "#434c5e", own_bg: "#3a4a3a", count: "#4c566a" },
    },
    typography: { font_family: "JetBrains Mono, Fira Code, monospace", font_size: 14, line_height: 1.5, message_spacing: 4 },
    borders: { style: "rounded", room_list_width: "25%" },
    emoji: { size: 32, sticker_max_size: 256, reaction_size: 20 },
    prompt: { normal_indicator: "NOR", insert_indicator: "INS", command_indicator: "CMD", visual_indicator: "VIS" },
  },
  "solarized-dark": {
    meta: { name: "Solarized Dark", author: "quark", version: "1.0" },
    colors: {
      background: "#002b36", foreground: "#839496", cursor: "#268bd2",
      selection_bg: "#073642", selection_fg: "#93a1a1", border: "#073642",
      accent: { primary: "#268bd2", secondary: "#2aa198", error: "#dc322f", warning: "#b58900", success: "#859900", link: "#268bd2" },
      messages: { own: "#859900", other: "#839496", system: "#586e75", timestamp: "#073642", mention_bg: "#072832", mention_fg: "#b58900", reply_border: "#2aa198", thread_indicator: "#2aa198" },
      roomlist: { active_bg: "#073642", active_fg: "#268bd2", unread: "#93a1a1", mention_badge: "#dc322f", muted: "#586e75" },
      reactions: { background: "#002b36", border: "#586e75", own_bg: "#072e28", count: "#586e75" },
    },
    typography: { font_family: "Fira Code, JetBrains Mono, monospace", font_size: 14, line_height: 1.5, message_spacing: 4 },
    borders: { style: "rounded", room_list_width: "25%" },
    emoji: { size: 32, sticker_max_size: 256, reaction_size: 20 },
    prompt: { normal_indicator: "NOR", insert_indicator: "INS", command_indicator: "CMD", visual_indicator: "VIS" },
  },
  "solarized-light": {
    meta: { name: "Solarized Light", author: "quark", version: "1.0" },
    colors: {
      background: "#fdf6e3", foreground: "#657b83", cursor: "#268bd2",
      selection_bg: "#eee8d5", selection_fg: "#586e75", border: "#d3cdb5",
      accent: { primary: "#268bd2", secondary: "#2aa198", error: "#dc322f", warning: "#b58900", success: "#859900", link: "#268bd2" },
      messages: { own: "#859900", other: "#657b83", system: "#93a1a1", timestamp: "#b9b2a0", mention_bg: "#f5f0da", mention_fg: "#b58900", reply_border: "#2aa198", thread_indicator: "#2aa198" },
      roomlist: { active_bg: "#eee8d5", active_fg: "#268bd2", unread: "#073642", mention_badge: "#dc322f", muted: "#93a1a1" },
      reactions: { background: "#fdf6e3", border: "#d3cdb5", own_bg: "#e8f0d8", count: "#93a1a1" },
    },
    typography: { font_family: "Fira Code, JetBrains Mono, monospace", font_size: 14, line_height: 1.5, message_spacing: 4 },
    borders: { style: "rounded", room_list_width: "25%" },
    emoji: { size: 32, sticker_max_size: 256, reaction_size: 20 },
    prompt: { normal_indicator: "NOR", insert_indicator: "INS", command_indicator: "CMD", visual_indicator: "VIS" },
  },
  "catppuccin-mocha": {
    meta: { name: "Catppuccin Mocha", author: "quark", version: "1.0" },
    colors: {
      background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#cba6f7",
      selection_bg: "#313244", selection_fg: "#cdd6f4", border: "#45475a",
      accent: { primary: "#cba6f7", secondary: "#89b4fa", error: "#f38ba8", warning: "#f9e2af", success: "#a6e3a1", link: "#89b4fa" },
      messages: { own: "#a6e3a1", other: "#cdd6f4", system: "#585b70", timestamp: "#45475a", mention_bg: "#2a2040", mention_fg: "#f9e2af", reply_border: "#89b4fa", thread_indicator: "#89b4fa" },
      roomlist: { active_bg: "#313244", active_fg: "#cba6f7", unread: "#cdd6f4", mention_badge: "#f38ba8", muted: "#585b70" },
      reactions: { background: "#1e1e2e", border: "#45475a", own_bg: "#2a2e3a", count: "#585b70" },
    },
    typography: { font_family: "JetBrains Mono, Fira Code, monospace", font_size: 14, line_height: 1.5, message_spacing: 4 },
    borders: { style: "rounded", room_list_width: "25%" },
    emoji: { size: 32, sticker_max_size: 256, reaction_size: 20 },
    prompt: { normal_indicator: "NOR", insert_indicator: "INS", command_indicator: "CMD", visual_indicator: "VIS" },
  },
  "catppuccin-latte": {
    meta: { name: "Catppuccin Latte", author: "quark", version: "1.0" },
    colors: {
      background: "#eff1f5", foreground: "#4c4f69", cursor: "#8839ef",
      selection_bg: "#dce0e8", selection_fg: "#4c4f69", border: "#bcc0cc",
      accent: { primary: "#8839ef", secondary: "#1e66f5", error: "#d20f39", warning: "#df8e1d", success: "#40a02b", link: "#1e66f5" },
      messages: { own: "#40a02b", other: "#4c4f69", system: "#8c8fa1", timestamp: "#bcc0cc", mention_bg: "#e8e5f5", mention_fg: "#df8e1d", reply_border: "#1e66f5", thread_indicator: "#1e66f5" },
      roomlist: { active_bg: "#dce0e8", active_fg: "#8839ef", unread: "#4c4f69", mention_badge: "#d20f39", muted: "#8c8fa1" },
      reactions: { background: "#eff1f5", border: "#bcc0cc", own_bg: "#e2eedd", count: "#8c8fa1" },
    },
    typography: { font_family: "JetBrains Mono, Fira Code, monospace", font_size: 14, line_height: 1.5, message_spacing: 4 },
    borders: { style: "rounded", room_list_width: "25%" },
    emoji: { size: 32, sticker_max_size: 256, reaction_size: 20 },
    prompt: { normal_indicator: "NOR", insert_indicator: "INS", command_indicator: "CMD", visual_indicator: "VIS" },
  },
  "gruvbox-dark": {
    meta: { name: "Gruvbox Dark", author: "quark", version: "1.0" },
    colors: {
      background: "#282828", foreground: "#ebdbb2", cursor: "#fabd2f",
      selection_bg: "#3c3836", selection_fg: "#ebdbb2", border: "#504945",
      accent: { primary: "#fabd2f", secondary: "#83a598", error: "#fb4934", warning: "#fe8019", success: "#b8bb26", link: "#83a598" },
      messages: { own: "#b8bb26", other: "#ebdbb2", system: "#7c6f64", timestamp: "#504945", mention_bg: "#32302f", mention_fg: "#fabd2f", reply_border: "#83a598", thread_indicator: "#83a598" },
      roomlist: { active_bg: "#3c3836", active_fg: "#fabd2f", unread: "#fbf1c7", mention_badge: "#fb4934", muted: "#7c6f64" },
      reactions: { background: "#282828", border: "#504945", own_bg: "#32382a", count: "#7c6f64" },
    },
    typography: { font_family: "JetBrains Mono, Fira Code, monospace", font_size: 14, line_height: 1.5, message_spacing: 4 },
    borders: { style: "rounded", room_list_width: "25%" },
    emoji: { size: 32, sticker_max_size: 256, reaction_size: 20 },
    prompt: { normal_indicator: "NOR", insert_indicator: "INS", command_indicator: "CMD", visual_indicator: "VIS" },
  },
  "high-contrast": {
    meta: { name: "High Contrast", author: "quark", version: "1.0" },
    colors: {
      background: "#000000", foreground: "#ffffff", cursor: "#ffff00",
      selection_bg: "#0000cc", selection_fg: "#ffffff", border: "#ffffff",
      accent: { primary: "#ffff00", secondary: "#00ffff", error: "#ff0000", warning: "#ff8800", success: "#00ff00", link: "#00ffff" },
      messages: { own: "#00ff00", other: "#ffffff", system: "#aaaaaa", timestamp: "#888888", mention_bg: "#330000", mention_fg: "#ff8800", reply_border: "#00ffff", thread_indicator: "#00ffff" },
      roomlist: { active_bg: "#0000aa", active_fg: "#ffff00", unread: "#ffffff", mention_badge: "#ff0000", muted: "#888888" },
      reactions: { background: "#000000", border: "#ffffff", own_bg: "#003300", count: "#cccccc" },
    },
    typography: { font_family: "JetBrains Mono, Fira Code, monospace", font_size: 16, line_height: 1.6, message_spacing: 6 },
    borders: { style: "rounded", room_list_width: "25%" },
    emoji: { size: 32, sticker_max_size: 256, reaction_size: 20 },
    prompt: { normal_indicator: "NOR", insert_indicator: "INS", command_indicator: "CMD", visual_indicator: "VIS" },
  },
};

/**
 * The built-in theme called `name`, if there is one. Looked up as an own key:
 * the map is a plain object, so `constructor` or `toString` would otherwise
 * find Object.prototype's and hand a function to `applyTheme`.
 */
export function builtinTheme(name: string): Theme | undefined {
  return Object.prototype.hasOwnProperty.call(BUILTIN_THEME_MAP, name) ? BUILTIN_THEME_MAP[name] : undefined;
}
