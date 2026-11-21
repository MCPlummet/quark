import { describe, it, expect } from "vitest";
import BASE_CSS from "../style/base.css?raw";

// A DialogBase subclass is styled entirely by the rules for its class prefix.
// ConfirmDialog and PasswordPromptDialog shipped with none (#23): unpositioned,
// they rendered in the page flow under the app, behind the dialog that opened
// them — every confirmation and password prompt opened from a dialog was
// unreachable. This guards every dialog, present and future.

const SOURCES = import.meta.glob("./**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Every class prefix a DialogBase subclass passes to `super({ prefix })`. */
function dialogPrefixes(): string[] {
  const found = new Set<string>();
  for (const [file, src] of Object.entries(SOURCES)) {
    if (file.endsWith(".test.ts")) continue;
    for (const m of src.matchAll(/super\(\{\s*prefix:\s*"([a-z-]+)"/g)) found.add(m[1]);
  }
  return [...found].sort();
}

/** The declarations of every rule whose selector list names `.cls` itself. */
function rulesFor(cls: string): string[] {
  const out: string[] = [];
  const css = BASE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(",").map((s) => s.trim());
    if (selectors.includes(`.${cls}`)) out.push(m[2]);
  }
  return out;
}

function zIndex(cls: string): number {
  const values = rulesFor(cls)
    .map((body) => /z-index:\s*(\d+)/.exec(body)?.[1])
    .filter((v): v is string => v !== undefined)
    .map(Number);
  return values.length ? Math.max(...values) : NaN;
}

const PROMPTS = ["confirm-dialog", "password-prompt-dialog"];

describe("dialog stylesheet", () => {
  it("finds the dialogs it guards", () => {
    expect(dialogPrefixes()).toEqual(expect.arrayContaining([...PROMPTS, "settings-dialog"]));
  });

  it.each(dialogPrefixes())("positions .%s as an overlay", (prefix) => {
    const rules = rulesFor(prefix);
    expect(rules.some((r) => /position:\s*fixed/.test(r)), `.${prefix} has no position: fixed rule`).toBe(true);
    expect(Number.isFinite(zIndex(prefix)), `.${prefix} has no z-index`).toBe(true);
  });

  // A prompt is opened from inside another dialog (Settings → Account, the
  // room dialog's Emoji tab), so it has to stack above all of them.
  it.each(PROMPTS)("stacks .%s above every other dialog", (prompt) => {
    const others = dialogPrefixes().filter((p) => !PROMPTS.includes(p)).map(zIndex);
    expect(zIndex(prompt)).toBeGreaterThan(Math.max(...others));
  });
});
