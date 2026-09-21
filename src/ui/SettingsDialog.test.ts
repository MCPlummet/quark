import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Settings tab builders are async — six of the eight await IPC before appending
// their rows — and _switchTab used to empty one content element they all shared.
// A build suspended at an `await` when the user switched tabs resumed afterwards
// and appended into that same element, which was by then showing a different tab.
// Same defect as the room dialog's (see RoomDialog.test.ts); both now take a
// fresh pane per build from DialogBase.replaceContentPane.

const mocks = vi.hoisted(() => ({ getAppConfig: vi.fn(), setAppConfig: vi.fn() }));

vi.mock("../ipc/app_config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ipc/app_config.js")>();
  return { ...actual, getAppConfig: mocks.getAppConfig, setAppConfig: mocks.setAppConfig };
});

vi.mock("../ipc/updater.js", () => ({ updateSupported: vi.fn(async () => false) }));

const { SettingsDialog } = await import("./SettingsDialog.js");
const { DEFAULT_APP_CONFIG } = await import("../ipc/app_config.js");

type Dialog = InstanceType<typeof SettingsDialog>;

let d: Dialog;

const pane = (dialog: Dialog): HTMLElement =>
  dialog.getElement().querySelector<HTMLElement>(".settings-dialog__content")!;

const tabButton = (dialog: Dialog, label: string): HTMLElement => {
  const btns = Array.from(
    dialog.getElement().querySelectorAll<HTMLElement>(".settings-dialog__tab"),
  );
  const btn = btns.find((b) => b.textContent === label);
  if (!btn) throw new Error(`no ${label} tab; saw: ${btns.map((b) => b.textContent).join(", ")}`);
  return btn;
};

beforeEach(() => {
  mocks.getAppConfig.mockReset().mockResolvedValue(structuredClone(DEFAULT_APP_CONFIG));
  mocks.setAppConfig.mockReset().mockResolvedValue(undefined);
  d = new SettingsDialog();
  document.body.appendChild(d.getElement());
});

afterEach(() => {
  d.getElement().remove();
});

describe("SettingsDialog", () => {
  it("lands on the first tab and builds it", async () => {
    d.show();
    await vi.waitFor(() => expect(pane(d).textContent).toContain("Confirm before redacting"));
  });

  it("does not let a suspended tab build append into the tab that replaced it", async () => {
    let releaseConfig: () => void = () => {};
    mocks.getAppConfig.mockReturnValue(
      new Promise((resolve) => {
        releaseConfig = () => resolve(structuredClone(DEFAULT_APP_CONFIG));
      }),
    );

    d.show();
    await vi.waitFor(() => expect(mocks.getAppConfig).toHaveBeenCalled());
    // The element General's build captured, held so the assertion can wait for
    // that build to finish rather than racing it.
    const captured = pane(d);

    // About is synchronous, so it cannot itself be the one that loses the race.
    tabButton(d, "About").click();
    expect(pane(d).textContent).toContain("Version");

    releaseConfig();
    await vi.waitFor(() => expect(captured.textContent).toContain("Confirm before redacting"));
    expect(captured.isConnected).toBe(false);
    expect(pane(d).textContent).not.toContain("Confirm before redacting");
    expect(pane(d).textContent).toContain("Version");
  });
});
