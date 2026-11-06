import { describe, it, expect, beforeEach, vi } from "vitest";
import { RoomList, type RoomEntry } from "./RoomList.js";

describe("RoomList", () => {
  let roomList: RoomList;

  beforeEach(() => {
    roomList = new RoomList();
    document.body.appendChild(roomList.getElement());
  });

  afterEach(() => {
    roomList.getElement().remove();
  });

  describe("setRooms", () => {
    it("renders room names in the DOM", () => {
      const rooms: RoomEntry[] = [
        { id: "!room1:server", name: "General" },
        { id: "!room2:server", name: "Random" },
        { id: "!room3:server", name: "Dev" },
      ];

      roomList.setRooms(rooms);

      const el = roomList.getElement();
      const items = el.querySelectorAll(".room-list__item");
      expect(items).toHaveLength(3);

      const names = Array.from(items).map((item) =>
        item.querySelector(".room-list__item-name")?.textContent
      );
      expect(names).toEqual(["General", "Random", "Dev"]);
    });

    it("clears previous rooms when called again", () => {
      roomList.setRooms([{ id: "!r1:s", name: "Room A" }]);
      roomList.setRooms([
        { id: "!r2:s", name: "Room B" },
        { id: "!r3:s", name: "Room C" },
      ]);

      const items = roomList.getElement().querySelectorAll(".room-list__item");
      expect(items).toHaveLength(2);
      expect(items[0].querySelector(".room-list__item-name")?.textContent).toBe("Room B");
    });

    it("renders room items with correct data-room-id", () => {
      roomList.setRooms([{ id: "!abc:example.com", name: "Alpha" }]);

      const item = roomList.getElement().querySelector<HTMLElement>(".room-list__item");
      expect(item?.dataset.roomId).toBe("!abc:example.com");
    });
  });

  describe("setActiveRoom", () => {
    it("adds active class to the correct room", () => {
      const rooms: RoomEntry[] = [
        { id: "!r1:s", name: "Room 1" },
        { id: "!r2:s", name: "Room 2" },
      ];
      roomList.setRooms(rooms);
      roomList.setActiveRoom("!r2:s");

      const items = roomList.getElement().querySelectorAll<HTMLElement>(".room-list__item");
      expect(items[0].classList.contains("room-list__item--active")).toBe(false);
      expect(items[1].classList.contains("room-list__item--active")).toBe(true);
    });

    it("sets aria-selected on the active room", () => {
      roomList.setRooms([
        { id: "!r1:s", name: "Room 1" },
        { id: "!r2:s", name: "Room 2" },
      ]);
      roomList.setActiveRoom("!r1:s");

      const items = roomList.getElement().querySelectorAll<HTMLElement>(".room-list__item");
      expect(items[0].getAttribute("aria-selected")).toBe("true");
      expect(items[1].getAttribute("aria-selected")).toBe("false");
    });

    it("only one room is active at a time", () => {
      roomList.setRooms([
        { id: "!r1:s", name: "Room 1" },
        { id: "!r2:s", name: "Room 2" },
        { id: "!r3:s", name: "Room 3" },
      ]);

      roomList.setActiveRoom("!r1:s");
      roomList.setActiveRoom("!r3:s");

      const active = roomList
        .getElement()
        .querySelectorAll<HTMLElement>(".room-list__item--active");
      expect(active).toHaveLength(1);
      expect((active[0] as HTMLElement).dataset.roomId).toBe("!r3:s");
    });
  });

  describe("unread indicators", () => {
    it("adds unread class for rooms with unread count", () => {
      roomList.setRooms([
        { id: "!r1:s", name: "Unread Room", unreadCount: 5 },
        { id: "!r2:s", name: "Read Room", unreadCount: 0 },
      ]);

      const items = roomList.getElement().querySelectorAll<HTMLElement>(".room-list__item");
      expect(items[0].classList.contains("room-list__item--unread")).toBe(true);
      expect(items[1].classList.contains("room-list__item--unread")).toBe(false);
    });

    it("shows unread dot badge for rooms with unread messages", () => {
      roomList.setRooms([{ id: "!r1:s", name: "Room", unreadCount: 3 }]);

      const badge = roomList
        .getElement()
        .querySelector(".room-list__item-badge");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe("●");
    });

    it("shows mention count badge for rooms with mentions", () => {
      roomList.setRooms([{ id: "!r1:s", name: "Room", mentionCount: 2, unreadCount: 5 }]);

      const badge = roomList
        .getElement()
        .querySelector(".room-list__item-badge");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe("2");
    });

    it("adds muted class for muted rooms", () => {
      roomList.setRooms([{ id: "!r1:s", name: "Muted", unreadCount: 10, muted: true }]);

      const item = roomList.getElement().querySelector<HTMLElement>(".room-list__item");
      expect(item?.classList.contains("room-list__item--muted")).toBe(true);
      expect(item?.classList.contains("room-list__item--unread")).toBe(false);
    });
  });

  describe("navigation", () => {
    it("calls onSelect handler when a room is clicked", () => {
      const handler = vi.fn();
      roomList.onSelect(handler);
      roomList.setRooms([{ id: "!r1:s", name: "Room 1" }]);

      const item = roomList.getElement().querySelector<HTMLElement>(".room-list__item");
      item?.click();

      expect(handler).toHaveBeenCalledWith("!r1:s");
    });

    it("updates active room on click", () => {
      roomList.setRooms([
        { id: "!r1:s", name: "Room 1" },
        { id: "!r2:s", name: "Room 2" },
      ]);

      const items = roomList.getElement().querySelectorAll<HTMLElement>(".room-list__item");
      items[1].click();

      expect(items[1].classList.contains("room-list__item--active")).toBe(true);
    });

    it("fires onSelect with Enter key on a focused item", () => {
      const handler = vi.fn();
      roomList.onSelect(handler);
      roomList.setRooms([{ id: "!r1:s", name: "Room 1" }]);

      const item = roomList.getElement().querySelector<HTMLElement>(".room-list__item");
      item?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(handler).toHaveBeenCalledWith("!r1:s");
    });
  });

  describe("space sections", () => {
    const sections = () => [
      { label: "", spaceId: "!work:s", rooms: [{ id: "!a:s", name: "a" }, { id: "!b:s", name: "b" }, { id: "!c:s", name: "c" }] },
      { label: "Ops", spaceId: "!ops:s", rooms: [{ id: "!d:s", name: "d" }] },
    ];

    it("marks rows of a space's section as orderable, and pseudo-space rows not", () => {
      roomList.setSections(sections());
      const row = roomList.getElement().querySelector<HTMLElement>('[data-room-id="!a:s"]');
      expect(row?.dataset.section).toBe("!work:s");
      roomList.setRooms([{ id: "!x:s", name: "x" }]);
      expect(roomList.getElement().querySelector<HTMLElement>(".room-list__item")?.dataset.section).toBeUndefined();
    });

    it("finds the section a room is listed in", () => {
      roomList.setSections(sections());
      expect(roomList.getSectionFor("!b:s")).toEqual({ spaceId: "!work:s", roomIds: ["!a:s", "!b:s", "!c:s"] });
      expect(roomList.getSectionFor("!d:s")?.spaceId).toBe("!ops:s");
      roomList.setRooms([{ id: "!x:s", name: "x" }]);
      expect(roomList.getSectionFor("!x:s")).toBeNull();
    });

    it("re-orders a section in place, keeping keyboard focus on the moved room", () => {
      roomList.setSections(sections());
      roomList.focusRoom("!c:s");
      roomList.applySectionOrder("!work:s", ["!c:s", "!a:s", "!b:s"]);
      const ids = Array.from(roomList.getElement().querySelectorAll<HTMLElement>(".room-list__item")).map((e) => e.dataset.roomId);
      expect(ids).toEqual(["!c:s", "!a:s", "!b:s", "!d:s"]);
      expect(roomList.getFocusedRoomId()).toBe("!c:s");
    });

    it("keeps badges and muting changed since render when it re-orders", () => {
      roomList.setSections([
        { label: "", spaceId: "!work:s", rooms: [{ id: "!a:s", name: "a", unreadCount: 4 }, { id: "!b:s", name: "b" }] },
      ]);
      roomList.updateRoomBadge("!a:s", 0, 0);
      roomList.updateRoomMuted("!b:s", true);
      roomList.applySectionOrder("!work:s", ["!b:s", "!a:s"]);
      const a = roomList.getElement().querySelector('[data-room-id="!a:s"]')!;
      const b = roomList.getElement().querySelector('[data-room-id="!b:s"]')!;
      expect(a.querySelector(".room-list__item-badge")).toBeNull();
      expect(a.classList.contains("room-list__item--unread")).toBe(false);
      expect(b.classList.contains("room-list__item--muted")).toBe(true);
    });

    it("ignores an order that doesn't match the section's rooms", () => {
      roomList.setSections(sections());
      roomList.applySectionOrder("!work:s", ["!c:s", "!a:s"]);
      expect(roomList.getSectionFor("!a:s")?.roomIds).toEqual(["!a:s", "!b:s", "!c:s"]);
    });
  });

  describe("the + button", () => {
    it("opens the create menu without bubbling to the header", () => {
      const onCreate = vi.fn();
      const onHeader = vi.fn();
      roomList.onCreateClick(onCreate);
      roomList.getHeaderElement().addEventListener("click", onHeader);
      roomList.getHeaderElement().querySelector<HTMLButtonElement>(".room-list__header-btn")!.click();
      expect(onCreate).toHaveBeenCalledTimes(1);
      // On mobile a header click closes the drawer — this one must not.
      expect(onHeader).not.toHaveBeenCalled();
    });
  });
});
