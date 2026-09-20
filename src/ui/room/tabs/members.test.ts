import { describe, it, expect } from "vitest";
import { canModerate, ownPowerLevel } from "./members";

describe("ownPowerLevel", () => {
  it("reads an explicit override", () => {
    expect(ownPowerLevel("@me:x", { "@me:x": 100 }, 0)).toBe(100);
  });

  it("falls back to the room default", () => {
    expect(ownPowerLevel("@me:x", {}, 25)).toBe(25);
  });

  it("assumes the default when the account is unknown", () => {
    expect(ownPowerLevel(null, { "@me:x": 100 }, 0)).toBe(0);
  });
});

// Matrix requires strictly greater power to kick or ban, and never allows
// acting on yourself — so the buttons are only rendered where the homeserver
// would actually accept the action. Showing one that gets refused is worse than
// showing none: the user cannot tell a permission problem from a bug.
describe("canModerate", () => {
  it("allows a moderator to act on a default-level member", () => {
    expect(canModerate(50, 50, 0, false)).toBe(true);
  });

  it("refuses below the threshold", () => {
    expect(canModerate(25, 50, 0, false)).toBe(false);
  });

  it("refuses against an equal power level", () => {
    expect(canModerate(50, 50, 50, false)).toBe(false);
  });

  it("refuses against a higher power level", () => {
    expect(canModerate(50, 50, 100, false)).toBe(false);
  });

  it("never allows acting on yourself", () => {
    expect(canModerate(100, 50, 0, true)).toBe(false);
  });

  it("offers nothing in a room where everyone sits at the default", () => {
    expect(canModerate(0, 50, 0, false)).toBe(false);
  });
});
