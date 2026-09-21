import { describe, it, expect, beforeEach } from "vitest";
import { AppState } from "../app/state";
import { keymapManager } from "../vim/keybindings";
import { actionById, registerDefaultBindings } from "../app/registry";
import { CommandPalette, invocationFor, scoreMatch } from "./CommandPalette";
import type { RoomInfo } from "../ipc/types";

const room = (id: string, name: string): RoomInfo => ({
  room_id: id,
  name,
  topic: undefined,
  member_count: 2,
  is_encrypted: false,
  is_direct: false,
  unread_count: 0,
  mention_count: 0,
  muted: false,
} as unknown as RoomInfo);

const ROOMS = [
  room("!general:example.org", "general"),
  room("!secops:example.org", "sec-ops"),
  room("!random:example.org", "random"),
];

/** Row text in display order. */
const labels = (p: CommandPalette): string[] =>
  Array.from(
    p.getElement().querySelectorAll<HTMLElement>(".command-palette__name"),
  ).map((el) => el.textContent ?? "");

const sections = (p: CommandPalette): string[] =>
  Array.from(
    p.getElement().querySelectorAll<HTMLElement>(".command-palette__section"),
  ).map((el) => el.textContent ?? "");

const type = (p: CommandPalette, text: string): void => {
  const input = p.getElement().querySelector<HTMLInputElement>(".command-palette__search")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  for (const entry of keymapManager.getEntries()) {
    keymapManager.unmap(entry.context, entry.sequence);
  }
  registerDefaultBindings();
  AppState.set("loggedIn", true);
  AppState.set("roomListCache", ROOMS);
  AppState.set("currentRoomId", "!general:example.org");
  AppState.set("currentSpaceId", null);
});

describe("scoreMatch", () => {
  it("ranks a prefix above a word start above a bare substring", () => {
    expect(scoreMatch("settings", "se")).toBe(3);
    expect(scoreMatch("sec-ops room", "ops")).toBe(2);
    expect(scoreMatch("Browse the directory", "se")).toBe(1);
  });

  it("does not match absent text", () => {
    expect(scoreMatch("settings", "zzz")).toBe(0);
  });

  it("matches everything on an empty query", () => {
    expect(scoreMatch("anything", "")).toBe(1);
  });
});

describe("invocationFor", () => {
  it("dispatches an action with no command behind it", () => {
    expect(invocationFor(actionById("edit-status")!)).toEqual({
      kind: "dispatch", actionId: "edit-status",
    });
  });

  it("runs a command that needs no argument", () => {
    expect(invocationFor(actionById("open-settings")!)).toEqual({
      kind: "run", command: "settings",
    });
  });

  // `[optional]` args still run bare — :search opens the dialog empty.
  it("runs a command whose arguments are all optional", () => {
    expect(invocationFor(actionById("open-search")!)).toEqual({
      kind: "run", command: "search",
    });
  });

  // Typing `:le` focuses :leave, so running it outright would leave the room on
  // one Enter with no prompt. The menus' confirm-wrapped variant is the one the
  // palette invokes instead.
  it("routes a destructive command through its confirm-wrapped variant", () => {
    expect(invocationFor(actionById("leave-room")!)).toEqual({
      kind: "dispatch", actionId: "leave-room-confirm",
    });
  });

  it("prefills the command bar when an argument is required", () => {
    expect(invocationFor(actionById("join-room")!)).toEqual({
      kind: "prefill", line: ":join ",
    });
    expect(invocationFor(actionById("kick-user")!)).toEqual({
      kind: "prefill", line: ":kick ",
    });
  });
});

describe("CommandPalette", () => {
  it("lists rooms and commands together, each under its heading", () => {
    const p = new CommandPalette();
    p.show();
    expect(sections(p)).toEqual(["Rooms", "Actions"]);
    expect(labels(p)).toContain("general");
    expect(labels(p)).toContain(":settings");
  });

  it("drops rooms on a leading colon, with no empty Rooms heading", () => {
    const p = new CommandPalette();
    p.show();
    type(p, ":set");
    expect(sections(p)).toEqual(["Actions"]);
    expect(labels(p)).toContain(":settings");
    expect(labels(p)).not.toContain("sec-ops");
  });

  // ":" narrows to actions, not strictly to `:` commands — a few real actions
  // have no command form and hiding them would be an invisible rule.
  it("keeps command-less actions under a leading colon", () => {
    const p = new CommandPalette();
    p.show();
    type(p, ":member");
    expect(labels(p)).toContain("Toggle the member list");
  });

  it("omits the Commands heading when only rooms match", () => {
    const p = new CommandPalette();
    p.show();
    type(p, "random");
    expect(sections(p)).toEqual(["Rooms"]);
    expect(labels(p)).toEqual(["random"]);
  });

  // The palette must never offer a row the `:` executor would refuse — it uses
  // the same isAvailable predicate.
  it("hides room-scoped commands when no room is open", () => {
    AppState.set("currentRoomId", null);
    const p = new CommandPalette();
    p.show();
    expect(labels(p)).not.toContain(":search");
    expect(labels(p)).toContain(":settings");
  });

  it("hides space-scoped commands when no space is selected", () => {
    const p = new CommandPalette();
    p.show();
    expect(labels(p)).not.toContain(":spacesettings");
  });

  it("excludes itself from its own listing", () => {
    const p = new CommandPalette();
    p.show();
    expect(labels(p)).not.toContain(":open-command-palette");
    const descs = Array.from(
      p.getElement().querySelectorAll<HTMLElement>(".command-palette__desc"),
    ).map((e) => e.textContent ?? "");
    expect(descs.some((d) => d.includes("Search rooms and commands"))).toBe(false);
  });

  it("shows the live keybinding for actions that have one", () => {
    const p = new CommandPalette();
    p.show();
    type(p, "member");
    const hint = p.getElement().querySelector<HTMLElement>(".command-palette__hint");
    expect(hint?.textContent).toBe("m");
  });

  it("reports a room selection", () => {
    const p = new CommandPalette();
    let picked: string | null = null;
    p.onSelectRoom((id) => { picked = id; });
    p.show();
    type(p, "sec-ops");
    p.getElement().querySelector<HTMLElement>(".command-palette__item")!.click();
    expect(picked).toBe("!secops:example.org");
  });

  it("reports an action invocation and closes", () => {
    const p = new CommandPalette();
    const seen: unknown[] = [];
    p.onInvoke((inv) => seen.push(inv));
    p.show();
    type(p, ":join");
    p.getElement().querySelector<HTMLElement>(".command-palette__item")!.click();
    expect(seen).toEqual([{ kind: "prefill", line: ":join " }]);
    expect(p.isVisible()).toBe(false);
  });

  it("reports nothing matching rather than rendering a bare list", () => {
    const p = new CommandPalette();
    p.show();
    type(p, "zzzznope");
    expect(p.getElement().querySelector(".command-palette__empty")).not.toBeNull();
    expect(p.items).toEqual([]);
  });
});
