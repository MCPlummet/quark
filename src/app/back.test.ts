import { afterEach, describe, expect, it, vi } from "vitest";

import { setupBackButton } from "./back.js";
import type { AppComponents } from "../ui/App.js";

const components = {} as AppComponents;

describe("setupBackButton", () => {
  afterEach(() => vi.restoreAllMocks());

  it("seeds a history entry for the back press in a top-level page", () => {
    const push = vi.spyOn(history, "pushState");
    setupBackButton(components);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("leaves the history alone inside an iframe, which shares the host page's", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const push = vi.spyOn(history, "pushState");
    const listen = vi.spyOn(window, "addEventListener");
    setupBackButton(components);
    expect(push).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalledWith("popstate", expect.anything());
  });
});
