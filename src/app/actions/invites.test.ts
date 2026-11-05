import { describe, it, expect, beforeEach, vi } from "vitest";
import type { InviteInfo } from "../../ipc/types.js";

vi.mock("../../ipc/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/index.js")>();
  return {
    ...actual,
    getInvites: vi.fn(async () => []),
    declineInvite: vi.fn(async () => {}),
  };
});
vi.mock("../../ui/NotificationToast.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/NotificationToast.js")>();
  return { ...actual, showToast: vi.fn() };
});

const { newInvitesMessage, refreshInvites, declineInvite } = await import("./invites.js");
const { getInvites } = await import("../../ipc/index.js");
const { showToast } = await import("../../ui/NotificationToast.js");
const { AppState } = await import("../state.js");

function invite(id: string, over: Partial<InviteInfo> = {}): InviteInfo {
  return {
    room_id: id, name: "rust", topic: null, avatar_url: null, canonical_alias: null,
    inviter_id: "@carol:x", inviter_name: "Carol", is_direct: false, is_space: false, is_encrypted: false,
    ...over,
  };
}

describe("newInvitesMessage", () => {
  it("names the inviter and the room", () => {
    expect(newInvitesMessage([invite("!a")])).toBe("Carol invited you to rust");
    expect(newInvitesMessage([invite("!a", { is_space: true, name: "Guild" })])).toBe(
      "Carol invited you to the space Guild",
    );
    expect(newInvitesMessage([invite("!a", { is_direct: true, name: null })])).toBe("Carol wants to chat");
  });

  it("counts several at once, and says nothing for none", () => {
    expect(newInvitesMessage([invite("!a"), invite("!b")])).toBe("2 new invites");
    expect(newInvitesMessage([])).toBeNull();
  });
});

describe("refreshInvites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores invites, announcing only those that arrive after the first load", async () => {
    vi.mocked(getInvites).mockResolvedValueOnce([invite("!old")]);
    await refreshInvites();
    expect(AppState.get("invites").map((i) => i.room_id)).toEqual(["!old"]);
    // Starting the app must not toast every invite still pending.
    expect(showToast).not.toHaveBeenCalled();

    vi.mocked(getInvites).mockResolvedValueOnce([invite("!old"), invite("!new", { name: "fresh" })]);
    await refreshInvites();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showToast).mock.calls[0][0]).toContain("Carol invited you to fresh");

    vi.mocked(getInvites).mockResolvedValueOnce([invite("!old"), invite("!new", { name: "fresh" })]);
    await refreshInvites();
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("keeps the last list when the read fails", async () => {
    AppState.set("invites", [invite("!kept")]);
    vi.mocked(getInvites).mockRejectedValueOnce(new Error("offline"));
    await refreshInvites();
    expect(AppState.get("invites").map((i) => i.room_id)).toEqual(["!kept"]);
  });
});

describe("answering an invite", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a declined invite gone even if a stale read still lists it", async () => {
    vi.mocked(getInvites).mockResolvedValueOnce([invite("!x")]);
    await refreshInvites();
    expect(await declineInvite("!x")).toBe(true);
    expect(AppState.get("invites")).toEqual([]);
    // A refresh that read the list before the decline landed.
    vi.mocked(getInvites).mockResolvedValueOnce([invite("!x")]);
    await refreshInvites();
    expect(AppState.get("invites")).toEqual([]);
  });
});
