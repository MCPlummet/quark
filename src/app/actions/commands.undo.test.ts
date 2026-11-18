import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeCommand } from "./commands.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";
import type { AppComponents } from "../../ui/App.js";

// #117: vim's `:u` / `:undo` and `:red` / `:redo` act on the compose box.

const input = { undo: vi.fn(() => true), redo: vi.fn(() => true) };

const run = (raw: string): Promise<void> => {
  const [name, ...args] = raw.replace(/^:/, "").split(/\s+/);
  return executeCommand({ name, args, raw });
};

beforeEach(() => {
  vi.clearAllMocks();
  setComponents({ input } as unknown as AppComponents);
  AppState.patch({ loggedIn: true, currentRoomId: "!room:x" });
});

describe(":undo / :redo", () => {
  it.each([":u", ":undo"])("%s undoes the last change to the draft", async (cmd) => {
    await run(cmd);
    expect(input.undo).toHaveBeenCalledOnce();
  });

  it.each([":red", ":redo"])("%s redoes it", async (cmd) => {
    await run(cmd);
    expect(input.redo).toHaveBeenCalledOnce();
  });
});
