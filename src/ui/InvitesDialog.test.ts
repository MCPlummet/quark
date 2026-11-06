import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InvitesDialog, inviteMeta, inviteTitle } from "./InvitesDialog.js";
import type { InviteInfo } from "../ipc/types.js";

function invite(over: Partial<InviteInfo> = {}): InviteInfo {
  return {
    room_id: "!r:x", name: "rust", topic: null, avatar_url: null, canonical_alias: null,
    inviter_id: "@carol:x", inviter_name: "Carol", is_direct: false, is_space: false, is_encrypted: false,
    ...over,
  };
}

describe("invite labels", () => {
  it("names a nameless DM after its inviter", () => {
    expect(inviteTitle(invite({ name: null, is_direct: true }))).toBe("Carol");
    expect(inviteTitle(invite({ name: null, is_direct: true, inviter_name: null }))).toBe("@carol:x");
  });

  it("falls back to the address, then the room ID", () => {
    expect(inviteTitle(invite({ name: null, canonical_alias: "#r:x" }))).toBe("#r:x");
    expect(inviteTitle(invite({ name: null }))).toBe("!r:x");
  });

  it("says who invited you", () => {
    expect(inviteMeta(invite())).toBe("invited by Carol (@carol:x)");
    expect(inviteMeta(invite({ canonical_alias: "#rust:x" }))).toBe("invited by Carol (@carol:x) · #rust:x");
    expect(inviteMeta(invite({ is_direct: true, is_encrypted: true }))).toBe(
      "direct message from Carol (@carol:x) · encrypted",
    );
  });
});

describe("InvitesDialog", () => {
  let dialog: InvitesDialog;
  let onAccept: ReturnType<typeof vi.fn>;
  let onDecline: ReturnType<typeof vi.fn>;
  const rows = () => Array.from(dialog.getElement().querySelectorAll<HTMLElement>(".invites-dialog__item"));
  const key = (k: string) =>
    dialog.getElement().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

  beforeEach(() => {
    dialog = new InvitesDialog();
    document.body.appendChild(dialog.getElement());
    onAccept = vi.fn(async () => true);
    onDecline = vi.fn(async () => true);
    dialog.onAccept(onAccept);
    dialog.onDecline(onDecline);
    dialog.setInvites([
      invite({ room_id: "!a:x", name: "alpha" }),
      invite({ room_id: "!b:x", name: "beta", is_space: true }),
    ]);
    dialog.show();
  });

  afterEach(() => {
    dialog.hide();
    dialog.getElement().remove();
  });

  it("lists every invite, tagging spaces and DMs", () => {
    expect(rows().map((r) => r.dataset.roomId)).toEqual(["!a:x", "!b:x"]);
    expect(rows()[1].querySelector(".invites-dialog__tag")?.textContent).toBe("space");
  });

  it("says so when there are none", () => {
    dialog.setInvites([]);
    expect(dialog.getElement().textContent).toContain("No pending invites.");
  });

  it("accepts the focused invite on Enter and closes", async () => {
    key("ArrowDown");
    key("Enter");
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledWith("!b:x"));
    await vi.waitFor(() => expect(dialog.isVisible()).toBe(false));
  });

  it("declines on x and stays open", async () => {
    key("x");
    await vi.waitFor(() => expect(onDecline).toHaveBeenCalledWith("!a:x"));
    expect(dialog.isVisible()).toBe(true);
  });

  it("answers from the row's buttons", async () => {
    rows()[1].querySelector<HTMLButtonElement>(".invites-dialog__decline")!.click();
    await vi.waitFor(() => expect(onDecline).toHaveBeenCalledWith("!b:x"));
  });

  it("stays open, and the row usable again, when accepting fails", async () => {
    onAccept.mockResolvedValueOnce(false);
    key("Enter");
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(rows()[0].querySelector<HTMLButtonElement>(".invites-dialog__accept")!.disabled).toBe(false),
    );
    expect(dialog.isVisible()).toBe(true);
  });

  it("ignores a second answer while the first is in flight", async () => {
    let resolve!: (v: boolean) => void;
    onDecline.mockImplementationOnce(() => new Promise<boolean>((r) => { resolve = r; }));
    key("x");
    key("x");
    key("Enter");
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
    resolve(true);
  });

  it("keeps focus on the same invite when the list changes underneath", () => {
    key("ArrowDown"); // focus beta
    dialog.setInvites([
      invite({ room_id: "!new:x", name: "aardvark" }),
      invite({ room_id: "!a:x", name: "alpha" }),
      invite({ room_id: "!b:x", name: "beta" }),
    ]);
    const focused = rows().find((r) => r.classList.contains("room-dir-dialog__item--focused"));
    expect(focused?.dataset.roomId).toBe("!b:x");
  });
});
