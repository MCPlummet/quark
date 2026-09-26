import { describe, it, expect, beforeEach, vi } from "vitest";

const showError = vi.fn();
vi.mock("../ui/NotificationToast.js", () => ({ showError: (m: string) => showError(m) }));
// The real reader invokes the backend; every test injects its own.
vi.mock("../ipc/media.js", () => ({ readDroppedFile: vi.fn() }));

import { handleDropEvent, type FileDropDeps } from "./file_drop.js";
import { AppState } from "./state.js";

function deps(read: (p: string) => Promise<File>) {
  const onFiles = vi.fn<(files: File[]) => void>();
  const setActive = vi.fn<(active: boolean) => void>();
  const d: FileDropDeps = { onFiles, setActive, read };
  return { d, onFiles, setActive };
}

const fileFor = async (p: string) => new File(["x"], p.split("/").pop()!, { type: "text/plain" });

beforeEach(() => {
  vi.clearAllMocks();
  AppState.set("currentRoomId", "!room:x");
});

describe("handleDropEvent (#83)", () => {
  it("lights the composer while a drag is over the window, and clears it on leave", async () => {
    const { d, setActive } = deps(fileFor);
    await handleDropEvent({ type: "enter", paths: ["/a"] }, d);
    await handleDropEvent({ type: "leave" }, d);
    expect(setActive.mock.calls).toEqual([[true], [false]]);
  });

  it("does not light up with no room open", async () => {
    AppState.set("currentRoomId", null);
    const { d, setActive } = deps(fileFor);
    await handleDropEvent({ type: "enter", paths: ["/a"] }, d);
    expect(setActive).toHaveBeenCalledWith(false);
  });

  it("reads every dropped path and hands the files on together, in order", async () => {
    const { d, onFiles, setActive } = deps(fileFor);
    await handleDropEvent({ type: "drop", paths: ["/tmp/a.txt", "/tmp/b.txt"] }, d);
    expect(setActive).toHaveBeenCalledWith(false);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0].map((f) => f.name)).toEqual(["a.txt", "b.txt"]);
  });

  // A folder in the drop, or a file that vanished, must not sink the rest.
  it("reports a path it cannot read and still attaches the others", async () => {
    const read = (p: string) =>
      p.endsWith("dir") ? Promise.reject(new Error("Folders can't be attached")) : fileFor(p);
    const { d, onFiles } = deps(read);
    await handleDropEvent({ type: "drop", paths: ["/tmp/dir", "/tmp/ok.txt"] }, d);
    expect(showError).toHaveBeenCalledWith("Can't attach dir: Folders can't be attached");
    expect(onFiles.mock.calls[0][0].map((f) => f.name)).toEqual(["ok.txt"]);
  });

  it("says why a drop with no room open did nothing, and reads nothing", async () => {
    AppState.set("currentRoomId", null);
    const read = vi.fn(fileFor);
    const { d, onFiles } = deps(read);
    await handleDropEvent({ type: "drop", paths: ["/tmp/a.txt"] }, d);
    expect(read).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("Open a room to attach files");
  });
});
