import { describe, it, expect, beforeEach } from "vitest";
import { setForceMock } from "./invoke.js";
import { updateCheck, updateInstall } from "./updater.js";
import { getAppConfig } from "./app_config.js";

describe("updater IPC (mock mode)", () => {
  beforeEach(() => setForceMock(true));

  it("updateCheck returns null when up to date", async () => {
    await expect(updateCheck()).resolves.toBeNull();
  });

  it("updateInstall resolves without throwing", async () => {
    await expect(updateInstall()).resolves.toBeUndefined();
  });

  // Guards against the mock get_app_config drifting from the real AppConfig
  // shape: the Settings General tab reads draft.updater.channel unguarded, so a
  // missing updater section breaks the dialog in browser dev mode.
  it("mock app config includes a well-formed updater section", async () => {
    const cfg = await getAppConfig();
    expect(cfg.updater).toEqual({ channel: "stable", auto_check: true });
  });
});
