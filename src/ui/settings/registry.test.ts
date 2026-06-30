import { describe, it, expect } from "vitest";
import { visibleTabs } from "./registry.js";
import type { SettingsTab } from "./types.js";

const tab = (id: string, mobileHidden = false): SettingsTab =>
  ({ id, label: id, mobileHidden, build() {} });

describe("visibleTabs", () => {
  const tabs = [tab("a"), tab("b", true), tab("c")];
  it("keeps mobileHidden tabs on desktop", () => {
    expect(visibleTabs(tabs, false).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
  it("drops mobileHidden tabs on mobile", () => {
    expect(visibleTabs(tabs, true).map((t) => t.id)).toEqual(["a", "c"]);
  });
});
