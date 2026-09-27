import { describe, it, expect, beforeEach } from "vitest";
import { RoomHeader } from "./RoomHeader.js";

describe("RoomHeader", () => {
  let header: RoomHeader;

  beforeEach(() => {
    header = new RoomHeader();
    document.body.appendChild(header.getElement());
  });

  afterEach(() => {
    header.getElement().remove();
  });

  describe("initial state", () => {
    it("renders the header element", () => {
      expect(header.getElement().className).toBe("room-header");
    });

    it("shows — as default room name", () => {
      const nameEl = header.getElement().querySelector(".room-header__name");
      expect(nameEl?.textContent).toBe("—");
    });
  });

  describe("setRoom", () => {
    it("updates the room name", () => {
      header.setRoom("#general:matrix.org");

      const nameEl = header.getElement().querySelector(".room-header__name");
      expect(nameEl?.textContent).toBe("#general:matrix.org");
    });

    it("updates topic when provided", () => {
      header.setRoom("General", "Chat about anything");

      const topicEl = header.getElement().querySelector(".room-header__topic");
      expect(topicEl?.textContent).toBe("Chat about anything");
    });

    it("hides topic when no topic provided", () => {
      header.setRoom("General");

      const topicEl = header.getElement().querySelector<HTMLElement>(".room-header__topic");
      expect(topicEl?.style.display).toBe("none");
    });

    it("shows topic again after previously hidden", () => {
      header.setRoom("General");
      header.setRoom("General", "A new topic");

      const topicEl = header.getElement().querySelector<HTMLElement>(".room-header__topic");
      expect(topicEl?.style.display).not.toBe("none");
      expect(topicEl?.textContent).toBe("A new topic");
    });

    it("updates member count", () => {
      header.setRoom("General", undefined, 42);

      const membersEl = header.getElement().querySelector(".room-header__members");
      expect(membersEl?.textContent).toBe("42 members");
    });

    it("shows singular form for 1 member", () => {
      header.setRoom("DM", undefined, 1);

      const membersEl = header.getElement().querySelector(".room-header__members");
      expect(membersEl?.textContent).toBe("1 member");
    });

    it("clears member count when not provided", () => {
      header.setRoom("General", undefined, 10);
      header.setRoom("General");

      const membersEl = header.getElement().querySelector(".room-header__members");
      expect(membersEl?.textContent).toBe("");
    });

    it("shows encrypted status when encrypted is true", () => {
      header.setRoom("General", undefined, undefined, true);

      const encEl = header.getElement().querySelector(".room-header__encryption");
      expect(encEl?.textContent).toContain("encrypted");
      expect(encEl?.classList.contains("room-header__encryption--on")).toBe(true);
    });

    it("shows unencrypted status when encrypted is false", () => {
      header.setRoom("General", undefined, undefined, false);

      const encEl = header.getElement().querySelector(".room-header__encryption");
      expect(encEl?.classList.contains("room-header__encryption--off")).toBe(true);
    });

    it("defaults to unencrypted when encrypted is not provided", () => {
      header.setRoom("General");

      const encEl = header.getElement().querySelector(".room-header__encryption");
      expect(encEl?.classList.contains("room-header__encryption--off")).toBe(true);
    });

    it("uses — for empty room name", () => {
      header.setRoom("");

      const nameEl = header.getElement().querySelector(".room-header__name");
      expect(nameEl?.textContent).toBe("—");
    });
  });

  describe("missing optional fields", () => {
    it("handles all optional fields absent gracefully", () => {
      expect(() => header.setRoom("Room")).not.toThrow();
    });

    it("handles undefined topic gracefully", () => {
      header.setRoom("Room", undefined);

      const topicEl = header.getElement().querySelector<HTMLElement>(".room-header__topic");
      expect(topicEl?.textContent).toBe("");
    });
  });

  describe("search button", () => {
    function searchBtn(): HTMLButtonElement {
      return header.getElement().querySelector<HTMLButtonElement>(".room-header__search-btn")!;
    }

    it("renders a search button in the header", () => {
      const btn = searchBtn();
      expect(btn).not.toBeNull();
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.textContent).toBe("search");
      expect(btn.querySelector("svg.icon")).not.toBeNull();
    });

    it("fires the handler when clicked", () => {
      let called = false;
      header.setSearchHandler(() => { called = true; });

      searchBtn().click();

      expect(called).toBe(true);
    });

    it("does not throw when clicked with no handler registered", () => {
      expect(() => searchBtn().click()).not.toThrow();
    });
  });
});
