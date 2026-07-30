// ModalManager mirrors "any modal open" onto <body> as `quark-modal-open`, so
// CSS can hide the layout tier's scrollbars while a dialog covers it (#32).
import { describe, it, expect, afterEach } from "vitest";

import { modalManager, type Modal } from "./ModalManager.js";

interface StubModal extends Modal {
  visible: boolean;
}

function makeModal(): StubModal {
  const el = document.createElement("div");
  const m: StubModal = {
    visible: true,
    getElement: () => el,
    isVisible: () => m.visible,
    hide: () => {
      m.visible = false;
      modalManager.remove(m);
    },
  };
  return m;
}

const bodyFlag = (): boolean => document.body.classList.contains("quark-modal-open");

const opened: StubModal[] = [];
function open(): StubModal {
  const m = makeModal();
  opened.push(m);
  modalManager.push(m);
  return m;
}

afterEach(() => {
  // modalManager is a process-wide singleton — always unregister what we pushed.
  for (const m of opened.splice(0)) modalManager.remove(m);
});

describe("modalManager quark-modal-open body class (#32)", () => {
  it("sets the class when a modal opens and clears it on remove", () => {
    expect(bodyFlag()).toBe(false);
    const m = open();
    expect(bodyFlag()).toBe(true);
    modalManager.remove(m);
    expect(bodyFlag()).toBe(false);
  });

  it("keeps the class until the last open modal is gone", () => {
    const a = open();
    open();
    modalManager.remove(a);
    expect(bodyFlag()).toBe(true);
  });

  it("clears the class when closeTopMost dismisses the only modal", () => {
    open();
    expect(bodyFlag()).toBe(true);
    expect(modalManager.closeTopMost()).toBe(true);
    expect(bodyFlag()).toBe(false);
  });
});
