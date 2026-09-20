import { describe, it, expect } from "vitest";
import { ACTIONS, actionById, type ActionEntry } from "./registry";
import { parityGaps, paletteOnly, reachability, inPalette } from "./parity";

describe("reachability", () => {
  it("counts a key binding as keyboard reach", () => {
    expect(reachability(actionById("reply")!).keyboard).toBe(true);
  });

  it("counts a : command as keyboard reach", () => {
    expect(reachability(actionById("open-directory")!).keyboard).toBe(true);
  });

  it("counts a context menu as pointer and touch reach", () => {
    const r = reachability(actionById("redact")!);
    expect(r.pointer).toBe(true);
    expect(r.touch).toBe(true);
  });

  // The two surfaces that caused this milestone: the desktop room header is
  // display:none on mobile, and the hover action bar has no hover to respond to.
  it("does not count the room header or hover bar as touch reach", () => {
    const headerOnly = { id: "x", description: "x", chrome: ["room-header"] } as ActionEntry;
    const hoverOnly = { id: "y", description: "y", chrome: ["timeline"] } as ActionEntry;
    expect(reachability(headerOnly).touch).toBe(false);
    expect(reachability(hoverOnly).touch).toBe(false);
    expect(reachability(headerOnly).pointer).toBe(true);
  });

  // …and their mirror image: mobile-only surfaces are not pointer reach.
  it("does not count the mobile top bar or overflow menu as pointer reach", () => {
    const barOnly = { id: "x", description: "x", chrome: ["mobile-top-bar"] } as ActionEntry;
    const overflowOnly = {
      id: "y", description: "y",
      menus: [{ surface: "overflow", label: "Y", group: 1, order: 1 }],
    } as ActionEntry;
    expect(reachability(barOnly).pointer).toBe(false);
    expect(reachability(barOnly).touch).toBe(true);
    expect(reachability(overflowOnly).pointer).toBe(false);
    expect(reachability(overflowOnly).touch).toBe(true);
  });

  it("tracks palette membership separately from real affordances", () => {
    // Otherwise the parity assertion passes vacuously: the palette lists almost
    // everything, and "reachable via the palette" would answer every question.
    const paletteOnlyEntry = actionById("quit")!;
    const r = reachability(paletteOnlyEntry);
    expect(r.palette).toBe(true);
    expect(r.pointer).toBe(false);
  });
});

describe("modality parity", () => {
  // The milestone's claim, as an assertion. A new action that is keyboard-only
  // fails here rather than shipping.
  it("leaves no action unreachable from keyboard, pointer or touch", () => {
    expect(parityGaps()).toEqual([]);
  });

  it("gives every exemption a stated reason", () => {
    for (const entry of ACTIONS) {
      if (entry.parityExempt === undefined) continue;
      expect(entry.parityExempt.length).toBeGreaterThan(20);
    }
  });

  it("catches an action added with no pointer or touch path", () => {
    const keyboardOnly: ActionEntry = {
      id: "hypothetical",
      description: "Something someone added in a hurry",
      bindings: [{ sequence: "Z", context: "global" }],
      palette: false,
    };
    expect(parityGaps([keyboardOnly])).toEqual([
      { id: "hypothetical", missing: ["pointer", "touch"] },
    ]);
  });

  it("accepts an exempted action", () => {
    const exempted: ActionEntry = {
      id: "hypothetical",
      description: "Something with a real reason",
      bindings: [{ sequence: "Z", context: "global" }],
      palette: false,
      parityExempt: "Navigation — the pointer equivalent is clicking the thing.",
    };
    expect(parityGaps([exempted])).toEqual([]);
  });

  // Desktop-only actions have no touch path by definition, not by omission.
  it("does not demand a touch path from a desktop-only action", () => {
    expect(parityGaps().map((g) => g.id)).not.toContain("quit");
    expect(parityGaps().map((g) => g.id)).not.toContain("check-for-updates");
  });
});

describe("palette-only actions", () => {
  // Not a failure — for :version the palette is the proportionate home. Pinned
  // so the set stays a deliberate list rather than quietly absorbing every new
  // action nobody got round to giving a home.
  it("is the set we chose", () => {
    expect(paletteOnly().sort()).toEqual([
      "ban-user",
      "convert-to-dm",
      "convert-to-room",
      "help",
      "invite-user",
      "join-room",
      "kick-user",
      "leave-room",
      "open-debug",
      "open-dm",
      "quit",
      "set-topic",
      "unban-user",
      "upload-file",
    ]);
  });

  it("never includes an action with a real affordance", () => {
    for (const id of paletteOnly()) {
      const r = reachability(actionById(id)!);
      expect(r.pointer && r.touch).toBe(false);
    }
  });

  it("only includes actions the palette actually lists", () => {
    for (const id of paletteOnly()) expect(inPalette(actionById(id)!)).toBe(true);
  });
});
