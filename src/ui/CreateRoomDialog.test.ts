import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CreateRoomDialog, aliasLocalpart, parseInviteList, suggestAlias, type CreateRoomRequest } from "./CreateRoomDialog.js";

describe("form helpers", () => {
  it("splits an invite list on commas and spaces, deduping", () => {
    expect(parseInviteList("@a:x, @b:x  @a:x")).toEqual({ ids: ["@a:x", "@b:x"], invalid: [] });
    expect(parseInviteList("bob, @c:x").invalid).toEqual(["bob"]);
    expect(parseInviteList("  ")).toEqual({ ids: [], invalid: [] });
  });

  it("reads an address typed bare or whole", () => {
    expect(aliasLocalpart("dev")).toBe("dev");
    expect(aliasLocalpart("#dev:example.org")).toBe("dev");
    expect(aliasLocalpart("  ")).toBe("");
  });

  it("suggests an address from a name", () => {
    expect(suggestAlias("Book Club!")).toBe("book-club");
    expect(suggestAlias("  dev  talk ")).toBe("dev-talk");
  });
});

describe("CreateRoomDialog", () => {
  let dialog: CreateRoomDialog;
  let onCreate: ReturnType<typeof vi.fn>;
  const el = () => dialog.getElement();
  const input = (label: string) => el().querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const select = (label: string) => el().querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const accessValues = () => Array.from(select("Who can join").options).map((o) => o.value);
  const create = () => el().querySelector<HTMLButtonElement>(".create-room-dialog__create")!.click();
  const type = (label: string, value: string) => {
    const i = input(label);
    i.value = value;
    i.dispatchEvent(new Event("input"));
  };
  const spaces = [{ id: "!work:x", name: "Work" }, { id: "!play:x", name: "Play" }];

  beforeEach(() => {
    dialog = new CreateRoomDialog();
    document.body.appendChild(el());
    onCreate = vi.fn(async (_req: CreateRoomRequest) => true);
    dialog.onCreate(onCreate);
  });

  afterEach(() => {
    dialog.hide();
    el().remove();
  });

  it("defaults to a private, encrypted room outside any space", async () => {
    dialog.show({ spaces, serverName: "x" });
    type("Name", "general");
    create();
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toEqual({
      kind: "room", name: "general", topic: "", alias: "", access: "private",
      parentSpaceId: null, encrypted: true, invite: [],
    });
  });

  it("in a space, defaults to letting that space's members join", async () => {
    dialog.show({ spaces, serverName: "x", parentSpaceId: "!work:x" });
    expect(select("Create in space").value).toBe("!work:x");
    expect(accessValues()).toEqual(["private", "space", "public"]);
    expect(select("Who can join").value).toBe("space");
  });

  it("offers space-member access only with a parent space", () => {
    dialog.show({ spaces, serverName: "x", parentSpaceId: "!work:x" });
    const parent = select("Create in space");
    parent.value = "";
    parent.dispatchEvent(new Event("change"));
    expect(accessValues()).toEqual(["private", "public"]);
    expect(select("Who can join").value).toBe("private");
  });

  it("turns encryption off for a public room, unless the user chose", () => {
    dialog.show({ spaces, serverName: "x" });
    const access = select("Who can join");
    const encrypt = el().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    access.value = "public";
    access.dispatchEvent(new Event("change"));
    expect(encrypt.checked).toBe(false);
    encrypt.checked = true;
    encrypt.dispatchEvent(new Event("change"));
    access.value = "private";
    access.dispatchEvent(new Event("change"));
    access.value = "public";
    access.dispatchEvent(new Event("change"));
    expect(encrypt.checked).toBe(true);
  });

  it("gives a public room the suggested address when none is typed", async () => {
    dialog.show({ spaces, serverName: "x" });
    type("Name", "Book Club");
    const access = select("Who can join");
    access.value = "public";
    access.dispatchEvent(new Event("change"));
    create();
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ alias: "book-club", access: "public", encrypted: false });
  });

  it("creates an unencrypted space", async () => {
    dialog.show({ spaces, serverName: "x", kind: "space" });
    expect(el().textContent).toContain("new space");
    type("Name", "Guild");
    create();
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ kind: "space", encrypted: false });
  });

  it("refuses to submit without a name, or with a bad invite", () => {
    dialog.show({ spaces, serverName: "x" });
    create();
    expect(el().querySelector(".create-room-dialog__error")?.textContent).toMatch(/name is required/i);
    type("Name", "dev");
    type("Invite users", "bob");
    create();
    expect(el().querySelector(".create-room-dialog__error")?.textContent).toContain("bob");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows a failure inline and stays open", async () => {
    onCreate.mockRejectedValueOnce(new Error("Failed to create room: M_ROOM_IN_USE"));
    dialog.show({ spaces, serverName: "x" });
    type("Name", "dev");
    create();
    await vi.waitFor(() =>
      expect(el().querySelector(".create-room-dialog__error")?.textContent).toContain("M_ROOM_IN_USE"),
    );
    expect(dialog.isVisible()).toBe(true);
  });

  it("closes once created", async () => {
    dialog.show({ spaces, serverName: "x", name: "prefilled" });
    expect(input("Name").value).toBe("prefilled");
    create();
    await vi.waitFor(() => expect(dialog.isVisible()).toBe(false));
  });
});
