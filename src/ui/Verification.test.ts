import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Verification, type SasEmoji } from "./Verification.js";

const EMOJI: SasEmoji[] = [
  { emoji: "🐶", description: "Dog" },
  { emoji: "🍕", description: "Pizza" },
];

describe("Verification", () => {
  let verification: Verification;

  beforeEach(() => {
    verification = new Verification();
    document.body.appendChild(verification.getElement());
  });

  afterEach(() => {
    verification.hide();
    verification.getElement().remove();
  });

  function emojiCells(): NodeListOf<Element> {
    return verification.getElement().querySelectorAll(".verification-dialog__emoji-cell");
  }

  it("renders the SAS emoji grid in comparing state", () => {
    verification.show();
    verification.setSasEmoji(EMOJI);
    verification.setState("comparing");
    expect(emojiCells()).toHaveLength(2);
  });

  it("clears stale emoji when a new incoming request arrives after a failure", () => {
    // First attempt: emoji shown, then verification fails.
    verification.show();
    verification.setSasEmoji(EMOJI);
    verification.setState("comparing");
    verification.setState("failed");
    verification.hide();

    // Second attempt: incoming popup must not show the old emoji.
    verification.setIncomingRequest("@alice:example.org", "DEVICE2");
    verification.setState("incoming");
    verification.show();
    expect(emojiCells()).toHaveLength(0);
  });

  const button = (mod: string): HTMLButtonElement =>
    verification.getElement().querySelector(`.verification-dialog__btn--${mod}`) as HTMLButtonElement;

  it("offers Cancel (no Esc on touch devices) while waiting and after confirming", () => {
    verification.show();
    for (const state of ["waiting", "confirmed"] as const) {
      verification.setState(state);
      expect(button("deny").style.display).toBe("");
      expect(button("deny").textContent).toBe("[ Cancel ]");
      expect(button("confirm").style.display).toBe("none");
    }
  });

  it("drops the emoji when the flow ends", () => {
    verification.show();
    verification.setSasEmoji(EMOJI);
    verification.setState("comparing");
    verification.setState("cancelled");
    expect(emojiCells()).toHaveLength(0);
  });

  it("setMessage overrides the status line until the next state", () => {
    verification.setState("cancelled");
    verification.setMessage("Verification was cancelled on the other device.");
    const status = verification.getElement().querySelector(".verification-dialog__status");
    expect(status?.textContent).toBe("Verification was cancelled on the other device.");
    verification.setState("waiting");
    expect(status?.textContent).toBe("Waiting for other device…");
  });

  it("setBusy disables only the confirm button", () => {
    verification.setState("incoming");
    verification.setBusy(true);
    expect(button("confirm").disabled).toBe(true);
    expect(button("deny").disabled).toBe(false);
    verification.setBusy(false);
    expect(button("confirm").disabled).toBe(false);
  });

  it("clears stale emoji when starting a new outbound flow", () => {
    verification.show();
    verification.setSasEmoji(EMOJI);
    verification.setState("comparing");
    verification.setState("cancelled");
    verification.hide();

    verification.setState("waiting");
    verification.show();
    expect(emojiCells()).toHaveLength(0);
  });
});
