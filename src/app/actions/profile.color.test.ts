// Opening someone's profile asks about their color again (#45), so a change
// they made shows without waiting out the day an answer is trusted.
import { describe, it, expect, beforeEach, vi } from "vitest";

import { setComponents } from "./context.js";
import type { AppComponents } from "../../ui/App.js";
import { AppState } from "../state.js";
import { showOtherUserProfile } from "./profile.js";
import { refetchUserColor, watchUserColor } from "../user_colors.js";

vi.mock("../user_colors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../user_colors.js")>()),
  refetchUserColor: vi.fn(),
  watchUserColor: vi.fn(() => () => {}),
}));

const show = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  AppState.patch({ ownUserId: "@me:x" });
  setComponents({ profileDialog: { show } } as unknown as AppComponents);
});

describe("showOtherUserProfile color (#45)", () => {
  it("asks about their color again and follows it while open", async () => {
    await showOtherUserProfile("@axius:x", "Axius");
    expect(refetchUserColor).toHaveBeenCalledWith("@axius:x");
    const color = show.mock.calls[0][0].color;
    const onChange = vi.fn();
    color.watch(onChange);
    expect(watchUserColor).toHaveBeenCalledWith("@axius:x", onChange);
  });

  it("asks nothing for your own profile", async () => {
    await showOtherUserProfile("@me:x", "Me");
    expect(refetchUserColor).not.toHaveBeenCalled();
    expect(show.mock.calls[0][0].color).toBeUndefined();
  });
});
