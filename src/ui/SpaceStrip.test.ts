import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SpaceStrip } from "./SpaceStrip.js";

const SPACE_ICON = "data:image/png;base64,SPACE";
const OWN_AVATAR = "data:image/png;base64,OWN";
const SPACE_ID = "!s:server";

describe("SpaceStrip", () => {
  let strip: SpaceStrip;

  beforeEach(() => {
    strip = new SpaceStrip();
    document.body.appendChild(strip.getElement());
  });
  afterEach(() => strip.getElement().remove());

  const itemEl = () =>
    strip.getElement().querySelector<HTMLElement>(
      `[data-space-id="${CSS.escape(SPACE_ID)}"]`,
    );
  const iconSrc = () => itemEl()?.querySelector("img")?.src;

  describe("resolved avatars survive re-renders", () => {
    beforeEach(() => {
      strip.setSpaces([{ id: SPACE_ID, name: "Space" }]);
      strip.updateSpaceAvatar(SPACE_ID, SPACE_ICON);
    });

    it("renders the resolved avatar", () => {
      expect(iconSrc()).toBe(SPACE_ICON);
    });

    // The original bug: _loadOwnProfile() re-renders the whole strip when the
    // user's own avatar download lands, racing the space avatar downloads.
    it("keeps the icon when the own-profile avatar resolves afterwards", () => {
      strip.setOwnProfile("C", OWN_AVATAR);
      expect(iconSrc()).toBe(SPACE_ICON);
    });

    it("keeps the icon across a refreshRooms() setSpaces() call", () => {
      strip.setSpaces([{ id: SPACE_ID, name: "Space" }]);
      expect(iconSrc()).toBe(SPACE_ICON);
    });

    it("reports the avatar as resolved so callers skip re-downloading", () => {
      expect(strip.hasResolvedAvatar(SPACE_ID)).toBe(true);
      expect(strip.hasResolvedAvatar("!other:server")).toBe(false);
    });

    it("forgets avatars for spaces that go away", () => {
      strip.setSpaces([{ id: "!other:server", name: "Other" }]);
      expect(strip.hasResolvedAvatar(SPACE_ID)).toBe(false);
    });
  });

  it("shows the letter fallback until an avatar resolves", () => {
    strip.setSpaces([{ id: SPACE_ID, name: "Space" }]);
    expect(itemEl()?.textContent).toBe("S");
    expect(iconSrc()).toBeUndefined();
  });

  it("falls back to the letter if the image fails to decode", () => {
    strip.setSpaces([{ id: SPACE_ID, name: "Space" }]);
    strip.updateSpaceAvatar(SPACE_ID, "data:image/png;base64,BROKEN");
    itemEl()?.querySelector("img")?.dispatchEvent(new Event("error"));
    expect(itemEl()?.textContent).toBe("S");
  });

  it("keeps an avatar that resolves while the item is off-DOM", () => {
    // A render can land between the download starting and finishing.
    strip.updateSpaceAvatar(SPACE_ID, SPACE_ICON);
    strip.setSpaces([{ id: SPACE_ID, name: "Space" }]);
    expect(iconSrc()).toBe(SPACE_ICON);
  });
});
