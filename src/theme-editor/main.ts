// quark.tel/theme — a web editor for Quark themes.
//
// State is one CompleteTheme. The URL fragment always carries it as a share
// string (base64url of the canonical TOML), so the address bar is the save
// file: reload, bookmark or send the link and the theme comes with it. The
// fragment never reaches a server.
//
// History: small edits replace the current entry; switching preset or
// importing pushes a new one, so Back undoes them. Edits reach the URL on a
// debounce (see HASH_DEBOUNCE_MS), and at once when a control commits.

import { BUILTIN_THEME_MAP } from "../theme/builtins.js";
import {
  decodeThemeShare,
  encodeThemeShare,
  setField,
  themeSlug,
  themeToToml,
  validateTheme,
  type CompleteTheme,
  type ThemeIssue,
} from "../theme/share.js";
import { ThemeForm } from "./form.js";
import { copyText, downloadText, importTheme, parseThemeToml, themeFileText } from "./io.js";
import { Preview } from "./preview.js";

const PRESETS = BUILTIN_THEME_MAP as Record<string, CompleteTheme>;
const DEFAULT_PRESET = "phosphor";
const BASE = PRESETS[DEFAULT_PRESET];
/** Safari throttles history.replaceState; colour drags fire far faster. */
const HASH_DEBOUNCE_MS = 300;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

// ── State ────────────────────────────────────────────────────────────────────

let theme: CompleteTheme = structuredClone(BASE);
/** The share string last written to, or loaded from, the URL. */
let shareString = "";
/** `theme` has edits the URL doesn't carry yet; flushHash writes them. */
let dirty = false;
let hashTimer: ReturnType<typeof setTimeout> | undefined;

const formEl = $("form");
const form = new ThemeForm(formEl, (path, value) => {
  theme = setField(theme, path, value);
  render();
  scheduleHash();
});
// A finished edit — a colour picked, a slider let go, a field left — goes into
// the URL now. The debounce then only covers a drag in progress, which is the
// only time an edit can still miss its history entry (see loadFromHash).
formEl.addEventListener("change", flushHash);
const preview = new Preview($("stage"), "../demo/?debug");

function currentShare(): string {
  return encodeThemeShare(themeToToml(theme));
}

function linkFor(share: string): string {
  return `${location.href.split("#")[0]}#${share}`;
}

function scheduleHash(): void {
  dirty = true;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(flushHash, HASH_DEBOUNCE_MS);
}

function flushHash(): void {
  clearTimeout(hashTimer);
  hashTimer = undefined;
  if (!dirty) return;
  dirty = false;
  // Encoded here rather than per edit: a colour drag fires dozens a second.
  shareString = currentShare();
  if (location.hash.slice(1) !== shareString) {
    history.replaceState(null, "", `#${shareString}`);
  }
}

/** Replace the whole theme, as a new history entry (preset, import). */
function replaceTheme(next: CompleteTheme): void {
  flushHash(); // the entry we're leaving keeps the latest edits
  theme = next;
  dirty = false;
  shareString = currentShare();
  history.pushState(null, "", `#${shareString}`);
  form.load(theme);
  render();
}

// ── Rendering ────────────────────────────────────────────────────────────────

const presetSelect = $<HTMLSelectElement>("preset");
const CUSTOM_OPTION = "";

function buildPresetOptions(): void {
  const custom = new Option("(your theme)", CUSTOM_OPTION);
  custom.disabled = true;
  presetSelect.append(custom);
  for (const [key, preset] of Object.entries(PRESETS)) {
    presetSelect.append(new Option(preset.meta.name, key));
  }
}

/** Each preset's canonical TOML → its key, to spot when the theme is one. */
const PRESET_BY_TOML = new Map(Object.entries(PRESETS).map(([key, preset]) => [themeToToml(preset), key]));

/** Runs on every edit — keep it to one TOML serialization. */
function render(): void {
  preview.setTheme(theme);

  const toml = themeToToml(theme);
  const slug = themeSlug(theme.meta.name);
  $("title-name").textContent = slug;
  $("preview-title").textContent = `quark — ${theme.meta.name}`;
  $("toml-filename").textContent = `${slug}.toml`;
  $("toml-out").textContent = themeFileText(theme, toml);
  document.title = `${theme.meta.name} · Quark theme editor`;
  presetSelect.value = PRESET_BY_TOML.get(toml) ?? CUSTOM_OPTION;

  // Should always be empty — controls commit only valid values and imports
  // are completed — but it costs microseconds, and it is what would catch a
  // control that started committing values quark can't load.
  const problems = validateTheme(theme);
  const badge = $("valid-badge");
  badge.textContent = problems.length ? `✗ ${problems.length} problem(s)` : "✓ loads in quark";
  badge.classList.toggle("te-valid-bad", problems.length > 0);
}

// ── Report banner ────────────────────────────────────────────────────────────

function showReport(title: string, issues: ThemeIssue[] = [], tone: "warn" | "error" = "warn"): void {
  const box = $("report");
  box.dataset.tone = tone;
  $("report-title").textContent = title;
  const list = $("report-list");
  list.replaceChildren(
    ...issues.map((issue) => {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = issue.path;
      li.append(code, ` ${issue.message}`);
      return li;
    }),
  );
  box.hidden = false;
}

function hideReport(): void {
  $("report").hidden = true;
}

/**
 * Summarise what an import had to change. Bad values and unknown keys are
 * listed one by one — the user typed those. Missing fields are folded into
 * one line per table: a partial theme can leave out dozens.
 */
function reportImport(issues: ThemeIssue[], what: string): void {
  if (!issues.length) {
    hideReport();
    return;
  }
  // A missing name isn't filled in from the base (it gets a placeholder; see
  // completeTheme), so it keeps its own line.
  const folds = (i: ThemeIssue) => i.kind === "missing" && i.path !== "meta.name";
  const listed = issues.filter((i) => !folds(i));
  const missing = new Map<string, string[]>();
  for (const { path } of issues.filter(folds)) {
    const table = path.slice(0, path.lastIndexOf("."));
    missing.set(table, [...(missing.get(table) ?? []), path.slice(table.length + 1)]);
  }
  const folded = [...missing].map(([table, keys]) => ({
    path: `[${table}]`,
    kind: "missing" as const,
    message: `${keys.join(", ")} missing — filled in from ${BASE.meta.name}`,
  }));
  const n = issues.length;
  showReport(`${what} — ${n} setting${n === 1 ? "" : "s"} adjusted to load in quark:`, [...listed, ...folded]);
}

// ── Loading from the URL ─────────────────────────────────────────────────────

/**
 * Load the theme the URL fragment carries (the default when there is none).
 * Skipped when the fragment is the one this page wrote, unless `force`d.
 */
function loadFromHash(force = false): void {
  const hash = location.hash.slice(1);
  if (hash === shareString && !force && !dirty) return;
  // Edits still waiting on the debounce belonged to the entry we just left,
  // and replaceState can only write the one we're on now, so they go. The
  // flush on `change` keeps that to an edit that was still mid-drag.
  clearTimeout(hashTimer);
  hashTimer = undefined;
  dirty = false;
  if (!hash) {
    theme = structuredClone(BASE);
    shareString = "";
    hideReport();
  } else {
    try {
      const result = parseThemeToml(decodeThemeShare(hash), BASE);
      theme = result.theme;
      reportImport(result.issues, "Loaded from the link");
    } catch (err) {
      theme = structuredClone(BASE);
      showReport(
        `Couldn't read the theme in this link (${(err as Error).message}) — showing ${BASE.meta.name} instead.`,
        [],
        "error",
      );
    }
    shareString = hash;
  }
  form.load(theme);
  render();
}

// Back/Forward between presets and imports, or a new link pasted into the
// address bar of this tab.
window.addEventListener("popstate", () => loadFromHash());
window.addEventListener("hashchange", () => loadFromHash());

// ── Toolbar ──────────────────────────────────────────────────────────────────

presetSelect.addEventListener("change", () => {
  const preset = PRESETS[presetSelect.value];
  if (!preset) return;
  hideReport();
  replaceTheme(structuredClone(preset));
});

function flash(button: HTMLElement, text: string): void {
  const original = button.dataset.label ?? button.textContent ?? "";
  button.dataset.label = original;
  button.textContent = text;
  setTimeout(() => (button.textContent = original), 1400);
}

$("copy-link").addEventListener("click", (e) => {
  const button = e.currentTarget as HTMLElement;
  dirty = true; // write it even untouched: the link has to carry the theme
  flushHash();
  copyText(linkFor(shareString)).then(
    () => flash(button, "✓ copied"),
    () => flash(button, "✗ copy failed"),
  );
});

$("copy-toml").addEventListener("click", (e) => {
  const button = e.currentTarget as HTMLElement;
  copyText(themeFileText(theme)).then(
    () => flash(button, "✓ copied"),
    () => flash(button, "✗ failed"),
  );
});

$("download").addEventListener("click", () => {
  downloadText(themeFileText(theme), `${themeSlug(theme.meta.name)}.toml`);
});

$("report-close").addEventListener("click", hideReport);

// ── Import dialog ────────────────────────────────────────────────────────────

const dialog = $<HTMLDialogElement>("import-dialog");
const importText = $<HTMLTextAreaElement>("import-text");
const importError = $("import-error");

function importFrom(text: string, what: string): boolean {
  try {
    const result = importTheme(text, BASE);
    replaceTheme(result.theme);
    reportImport(result.issues, what);
    return true;
  } catch (err) {
    importError.textContent = (err as Error).message;
    importError.hidden = false;
    return false;
  }
}

$("import-btn").addEventListener("click", () => {
  importError.hidden = true;
  dialog.showModal();
  importText.focus();
  importText.select();
});

$("import-go").addEventListener("click", (e) => {
  e.preventDefault();
  if (importFrom(importText.value, "Imported")) {
    importText.value = "";
    dialog.close();
  }
});

importText.addEventListener("input", () => (importError.hidden = true));

// Esc closes a modal <dialog> natively; Ctrl+[ is the terminal Esc.
dialog.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "[") {
    e.preventDefault();
    dialog.close();
  }
});
// Clicking the backdrop (the dialog element itself, outside its content).
// The press has to start there too: a drag that selects text in the textarea
// and is released outside the box also clicks the dialog, and must not throw
// the paste away.
let pressedOnBackdrop = false;
dialog.addEventListener("pointerdown", (e) => (pressedOnBackdrop = e.target === dialog));
dialog.addEventListener("click", (e) => {
  if (e.target === dialog && pressedOnBackdrop) dialog.close();
  pressedOnBackdrop = false;
});

async function importFile(file: File): Promise<void> {
  const text = await file.text();
  if (importFrom(text, `Imported ${file.name}`)) {
    if (dialog.open) dialog.close();
  } else if (!dialog.open) {
    // Dropped onto the page: surface the error in the banner instead.
    showReport(`Couldn't import ${file.name}: ${importError.textContent}`, [], "error");
  }
}

const fileInput = $<HTMLInputElement>("import-file");
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void importFile(file);
});

// Drop a .toml anywhere on the page.
let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
document.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add("te-dropping");
});
document.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove("te-dropping");
  }
});
document.addEventListener("dragover", (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("te-dropping");
  const file = e.dataTransfer?.files[0];
  if (file) void importFile(file);
});

// ── Boot ─────────────────────────────────────────────────────────────────────

buildPresetOptions();
// With no fragment this starts from the default and leaves the URL clean
// until the first edit.
loadFromHash(true);
