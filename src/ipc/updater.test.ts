import { describe, it, expect, beforeEach } from "vitest";
import { setForceMock } from "./invoke.js";
import { updateCheck, updateInstall } from "./updater.js";

describe("updater IPC (mock mode)", () => {
  beforeEach(() => setForceMock(true));

  it("updateCheck returns null when up to date", async () => {
    await expect(updateCheck()).resolves.toBeNull();
  });

  it("updateInstall resolves without throwing", async () => {
    await expect(updateInstall()).resolves.toBeUndefined();
  });
});
