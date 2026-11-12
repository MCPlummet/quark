import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SpaceStrip } from "./SpaceStrip.js";

const SPACE_ICON = "data:image/png;base64,SPACE";
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

  it("holds spaces only — profile, settings and search live on the status line", () => {
    strip.setSpaces([{ id: SPACE_ID, name: "Space" }]);
    const el = strip.getElement();
    expect(el.querySelector(".space-strip__profile-btn")).toBeNull();
    expect(el.querySelector(".space-strip__settings-btn")).toBeNull();
    expect(el.querySelector(".space-strip__search-btn")).toBeNull();
  });

  it("ends the space list with a + that creates a space", () => {
    const onCreate = vi.fn();
    strip.onCreateSpaceClick(onCreate);
    strip.setSpaces([{ id: SPACE_ID, name: "Space" }]);
    const add = strip.getElement().querySelector<HTMLElement>(".space-strip__add")!;
    expect(add.querySelector("svg.icon")).not.toBeNull();
    // Directly after the last space, before the closing rule.
    expect(add.previousElementSibling).toBe(itemEl());
    expect(add.nextElementSibling?.classList.contains("space-strip__divider")).toBe(true);
    add.click();
    add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onCreate).toHaveBeenCalledTimes(2);
  });

  it("shows the + even with no spaces yet", () => {
    strip.setSpaces([]);
    expect(strip.getElement().querySelector(".space-strip__add")).not.toBeNull();
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
  describe("badges", () => {
    const badgeEl = (id = SPACE_ID) =>
      strip.getElement().querySelector<HTMLElement>(
        `[data-space-id="${CSS.escape(id)}"] .space-strip__badge`,
      );
    /** The letter fallback, read without the badge's own text. */
    const glyph = () =>
      [...(itemEl()?.childNodes ?? [])]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("");

    beforeEach(() => strip.setSpaces([{ id: SPACE_ID, name: "Work" }]));

    it("shows a dot for unread", () => {
      strip.setBadges(new Map([[SPACE_ID, { unread: true, mentions: 0 }]]));
      expect(badgeEl()?.classList.contains("space-strip__badge--unread")).toBe(true);
      expect(itemEl()?.getAttribute("aria-label")).toBe("Work, unread");
    });

    it("shows the mention count instead of the dot", () => {
      strip.setBadges(new Map([[SPACE_ID, { unread: true, mentions: 3 }]]));
      expect(badgeEl()?.classList.contains("space-strip__badge--mention")).toBe(true);
      expect(badgeEl()?.classList.contains("space-strip__badge--unread")).toBe(false);
      expect(badgeEl()?.textContent).toBe("3");
      expect(itemEl()?.getAttribute("aria-label")).toBe("Work, 3 mentions");
    });

    it("uses the singular for one mention", () => {
      strip.setBadges(new Map([[SPACE_ID, { unread: false, mentions: 1 }]]));
      expect(itemEl()?.getAttribute("aria-label")).toBe("Work, 1 mention");
    });

    it("caps the count at 99+", () => {
      strip.setBadges(new Map([[SPACE_ID, { unread: false, mentions: 120 }]]));
      expect(badgeEl()?.textContent).toBe("99+");
    });

    it("clears a badge when the space leaves the map", () => {
      strip.setBadges(new Map([[SPACE_ID, { unread: true, mentions: 0 }]]));
      strip.setBadges(new Map());
      expect(badgeEl()).toBeNull();
      expect(itemEl()?.getAttribute("aria-label")).toBe("Work");
    });

    it("badges pseudo-spaces", () => {
      strip.setBadges(new Map([["__dms__", { unread: true, mentions: 0 }]]));
      expect(badgeEl("__dms__")).not.toBeNull();
      const dms = strip.getElement().querySelector('[data-space-id="__dms__"]');
      expect(dms?.getAttribute("aria-label")).toBe("Direct Messages, unread");
    });

    it("survives setSpaces() re-render", () => {
      strip.setBadges(new Map([[SPACE_ID, { unread: false, mentions: 2 }]]));
      strip.setSpaces([{ id: SPACE_ID, name: "Work" }]);
      expect(badgeEl()?.textContent).toBe("2");
    });

    it("survives an avatar resolving", () => {
      strip.setBadges(new Map([[SPACE_ID, { unread: false, mentions: 2 }]]));
      strip.updateSpaceAvatar(SPACE_ID, SPACE_ICON);
      expect(iconSrc()).toBe(SPACE_ICON);
      expect(badgeEl()?.textContent).toBe("2");
    });

    it("survives the image failing and falling back to the letter", () => {
      strip.updateSpaceAvatar(SPACE_ID, "data:image/png;base64,BROKEN");
      strip.setBadges(new Map([[SPACE_ID, { unread: false, mentions: 3 }]]));
      itemEl()?.querySelector("img")?.dispatchEvent(new Event("error"));
      expect(badgeEl()?.textContent).toBe("3");
      expect(glyph()).toBe("W");
    });

    it("keeps the letter label clean when an avatar resolves after a badge", () => {
      strip.setBadges(new Map([[SPACE_ID, { unread: false, mentions: 3 }]]));
      strip.updateSpaceAvatar(SPACE_ID, "data:image/png;base64,BROKEN");
      itemEl()?.querySelector("img")?.dispatchEvent(new Event("error"));
      expect(glyph()).toBe("W");
      expect(badgeEl()?.textContent).toBe("3");
    });
  });
});
