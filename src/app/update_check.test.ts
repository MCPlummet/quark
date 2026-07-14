import { describe, it, expect, beforeEach, vi } from "vitest";
import { runUpdateCheck, maybeCheckForUpdates } from "./update_check.js";
import { updateCheck, updateSupported } from "../ipc/index.js";
import { showToast } from "../ui/NotificationToast.js";
import type { AppComponents } from "../ui/App.js";

// Update-check orchestration on immutable installs (#28): a Nix/Flatpak/Snap
// Quark can't self-update, so checks are skipped entirely — silently on the
// auto path, with a package-manager hint on the manual `:update` path.

vi.mock("../ipc/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ipc/index.js")>();
  return {
    ...actual,
    updateSupported: vi.fn(async () => true),
    updateCheck: vi.fn(async () => null),
    getAppConfig: vi.fn(async () => ({ updater: { channel: "stable", auto_check: true } })),
  };
});

vi.mock("../ui/NotificationToast.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/NotificationToast.js")>();
  return { ...actual, showToast: vi.fn(), showError: vi.fn() };
});

const updateBanner = { show: vi.fn() };
const components = { updateBanner } as unknown as AppComponents;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateSupported).mockResolvedValue(true);
  vi.mocked(updateCheck).mockResolvedValue(null);
});

describe("runUpdateCheck on immutable installs", () => {
  it("manual check shows a package-manager hint and skips the feed", async () => {
    vi.mocked(updateSupported).mockResolvedValue(false);
    await runUpdateCheck(components, true);
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/package manager/i), "info");
    expect(updateCheck).not.toHaveBeenCalled();
  });

  it("auto check stays silent and skips the feed", async () => {
    vi.mocked(updateSupported).mockResolvedValue(false);
    await maybeCheckForUpdates(components);
    expect(showToast).not.toHaveBeenCalled();
    expect(updateCheck).not.toHaveBeenCalled();
    expect(updateBanner.show).not.toHaveBeenCalled();
  });
});

describe("runUpdateCheck on supported installs", () => {
  it("still surfaces an available update in the banner", async () => {
    const info = { version: "9.9.9", current_version: "0.17.0", notes: null, date: null };
    vi.mocked(updateCheck).mockResolvedValue(info);
    await runUpdateCheck(components, false);
    expect(updateBanner.show).toHaveBeenCalledExactlyOnceWith(info);
  });
});
