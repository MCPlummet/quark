import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Space settings on the room dialog's tab host (#12): General, Children, and
// the Emoji tab for the space's packs.

const ipc = vi.hoisted(() => ({
  getRoomPacks: vi.fn(async () => ({ can_edit: true, packs: [] })),
}));
vi.mock("../ipc/index.js", async (orig) => ({ ...(await orig<object>()), ...ipc }));
vi.mock("../ipc/spaces.js", async (orig) => ({ ...(await orig<object>()), getSpaceChildren: vi.fn(async () => []) }));
vi.mock("../ipc/room_settings.js", async (orig) => ({
  ...(await orig<object>()),
  setRoomName: vi.fn(),
  setRoomTopic: vi.fn(),
}));

const { SpaceSettingsDialog } = await import("./SpaceSettingsDialog.js");

type Dialog = InstanceType<typeof SpaceSettingsDialog>;
let d: Dialog;

const tabs = (): HTMLElement[] => [...d.getElement().querySelectorAll<HTMLElement>(".settings-dialog__tab")];
const active = (): string =>
  d.getElement().querySelector(".settings-dialog__tab--active")?.textContent ?? "";

beforeEach(() => {
  ipc.getRoomPacks.mockClear();
  d = new SpaceSettingsDialog();
  document.body.appendChild(d.getElement());
});

afterEach(() => d.getElement().remove());

describe("SpaceSettingsDialog", () => {
  it("has General, Children and Emoji tabs", async () => {
    await d.show("!space:x");
    expect(tabs().map((t) => t.textContent)).toEqual(["General", "Children", "Emoji"]);
    expect(active()).toBe("General");
  });

  it("cycles tabs with Tab", async () => {
    await d.show("!space:x");
    d.getElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(active()).toBe("Children");
  });

  it("loads the space's packs on the Emoji tab", async () => {
    await d.show("!space:x");
    tabs().find((t) => t.textContent === "Emoji")!.click();
    await vi.waitFor(() => expect(ipc.getRoomPacks).toHaveBeenCalledWith("!space:x"));
  });
});
