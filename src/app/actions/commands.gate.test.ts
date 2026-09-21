import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeCommand } from "./commands.js";
import { AppState } from "../state.js";
import { openDebugViewer } from "./dialogs.js";
import { showError } from "../../ui/NotificationToast.js";

// executeCommand checks a command's registry `requires` up front, which replaced
// six hand-written copies of "No room selected". The gate is right for the bare
// `:debug`, which dumps the open room's state — but `:debug cache` reports on the
// app-wide event cache and has no room to be scoped to, and started failing with
// "No room selected" once the requirement was declared.

vi.mock("./dialogs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dialogs.js")>();
  return { ...actual, openDebugViewer: vi.fn(async () => {}), openDebugViewerForEvent: vi.fn(async () => {}) };
});

vi.mock("../../ui/NotificationToast.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/NotificationToast.js")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn(), showToast: vi.fn() };
});

const run = (raw: string): Promise<void> => {
  const [name, ...args] = raw.replace(/^:/, "").split(/\s+/);
  return executeCommand({ name, args, raw });
};

beforeEach(() => {
  vi.clearAllMocks();
  AppState.patch({ loggedIn: true, currentRoomId: null });
});

describe("the room requirement gate", () => {
  it("lets :debug cache run with no room open", async () => {
    await run(":debug cache");
    expect(openDebugViewer).toHaveBeenCalledWith({ kind: "cache" });
    expect(showError).not.toHaveBeenCalled();
  });

  it("still refuses a bare :debug with no room open", async () => {
    await run(":debug");
    expect(openDebugViewer).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("No room selected");
  });

  it("opens the room's state for a bare :debug with a room open", async () => {
    AppState.set("currentRoomId", "!room:x");
    await run(":debug");
    expect(openDebugViewer).toHaveBeenCalledWith();
    expect(showError).not.toHaveBeenCalled();
  });

  // The escape is one named subcommand, not "any argument gets you past".
  it("does not let an unrelated argument past the gate", async () => {
    await run(":debug nonsense");
    expect(openDebugViewer).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("No room selected");
  });
});
