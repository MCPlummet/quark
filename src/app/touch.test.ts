import { describe, it, expect } from "vitest";
import { panelShut, panelGestureKind, settleOpen } from "./touch.js";

// dir = -1 → drawer (off the left edge, opens with a rightward drag)
// dir = +1 → member list (off the right edge, opens with a leftward drag)
const W = 1000;

describe("panelShut", () => {
  it("drawer (dir -1): a rightward drag opens a closed drawer", () => {
    expect(panelShut(1, -1, 0, W)).toBe(1); // closed, no movement
    expect(panelShut(1, -1, W / 2, W)).toBe(0.5); // half revealed
    expect(panelShut(1, -1, W, W)).toBe(0); // fully open
  });

  it("drawer (dir -1): a leftward drag closes an open drawer", () => {
    expect(panelShut(0, -1, 0, W)).toBe(0); // open, no movement
    expect(panelShut(0, -1, -W / 2, W)).toBe(0.5);
    expect(panelShut(0, -1, -W, W)).toBe(1); // fully closed
  });

  it("member (dir +1): a leftward drag opens a closed panel", () => {
    expect(panelShut(1, 1, 0, W)).toBe(1);
    expect(panelShut(1, 1, -W / 2, W)).toBe(0.5);
    expect(panelShut(1, 1, -W, W)).toBe(0); // fully open
  });

  it("member (dir +1): a rightward drag closes an open panel", () => {
    expect(panelShut(0, 1, W / 2, W)).toBe(0.5);
    expect(panelShut(0, 1, W, W)).toBe(1); // fully closed
  });

  it("clamps to [0, 1]", () => {
    expect(panelShut(1, -1, 5 * W, W)).toBe(0);
    expect(panelShut(0, -1, -5 * W, W)).toBe(1);
  });
});

describe("panelGestureKind", () => {
  it("drawer (dir -1)", () => {
    expect(panelGestureKind(false, -1, 30)).toBe("opening"); // closed, drag right
    expect(panelGestureKind(false, -1, -30)).toBe("none"); // closed, drag left → nothing
    expect(panelGestureKind(true, -1, -30)).toBe("closing"); // open, drag left
    expect(panelGestureKind(true, -1, 30)).toBe("none");
  });

  it("member (dir +1) is mirrored", () => {
    expect(panelGestureKind(false, 1, -30)).toBe("opening"); // closed, drag left
    expect(panelGestureKind(false, 1, 30)).toBe("none"); // closed, drag right → nothing
    expect(panelGestureKind(true, 1, 30)).toBe("closing"); // open, drag right
    expect(panelGestureKind(true, 1, -30)).toBe("none");
  });
});

describe("settleOpen", () => {
  it("opens a closed panel past the halfway point", () => {
    expect(settleOpen(false, 0.6, -1, 0)).toBe(true);
    expect(settleOpen(false, 0.4, -1, 0)).toBe(false);
  });

  it("keeps an open panel open unless dragged back past halfway", () => {
    expect(settleOpen(true, 0.6, -1, 0)).toBe(true);
    expect(settleOpen(true, 0.4, -1, 0)).toBe(false);
  });

  it("a fast fling overrides the position threshold (drawer)", () => {
    // Barely revealed but flung right (opening) → opens.
    expect(settleOpen(false, 0.1, -1, 0.8)).toBe(true);
    // Nearly fully open but flung left (closing) → closes.
    expect(settleOpen(true, 0.9, -1, -0.8)).toBe(false);
  });

  it("a fast fling overrides the position threshold (member, mirrored)", () => {
    // Closed member panel flung left (opening) → opens.
    expect(settleOpen(false, 0.1, 1, -0.8)).toBe(true);
    // Open member panel flung right (closing) → closes.
    expect(settleOpen(true, 0.9, 1, 0.8)).toBe(false);
  });
});
