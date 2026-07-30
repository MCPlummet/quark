// Member-list panel visibility — mobile behaviours around #37 (keyboard must
// dismiss when the panel slides over the compose box).
import { describe, it, expect, beforeEach, vi } from "vitest";

import { setComponents } from "./context.js";
import type { AppComponents } from "../../ui/App.js";
import { setMemberListVisible } from "./members.js";
import { AppState } from "../state.js";
import { isMobile, closeDrawer, dismissKeyboard } from "../mobile.js";

vi.mock("../mobile.js", () => ({
  isMobile: vi.fn(() => false),
  closeDrawer: vi.fn(),
  dismissKeyboard: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isMobile).mockReturnValue(false);
  AppState.patch({ memberListVisible: false, activePanel: "timeline" });
  setComponents({ mainLayout: document.createElement("div") } as unknown as AppComponents);
});

describe("setMemberListVisible on mobile (#37)", () => {
  it("dismisses the keyboard and closes the drawer when the panel opens", () => {
    vi.mocked(isMobile).mockReturnValue(true);
    setMemberListVisible(true);
    expect(dismissKeyboard).toHaveBeenCalled();
    expect(closeDrawer).toHaveBeenCalled();
  });

  it("does not touch the keyboard when the panel closes", () => {
    vi.mocked(isMobile).mockReturnValue(true);
    AppState.patch({ memberListVisible: true });
    setMemberListVisible(false);
    expect(dismissKeyboard).not.toHaveBeenCalled();
  });

  it("does not touch the keyboard on desktop", () => {
    setMemberListVisible(true);
    expect(dismissKeyboard).not.toHaveBeenCalled();
  });
});
