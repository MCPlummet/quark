import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { commitSelectRow, commitTextRow } from "./commit_field.js";

const key = (el: HTMLElement, k: string) => {
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
};
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const status = (row: HTMLElement) => row.querySelector(".settings-dialog__field-status")!;

describe("commitTextRow", () => {
  let save: ReturnType<typeof vi.fn>;
  let field: ReturnType<typeof commitTextRow>;
  let host: HTMLElement;

  beforeEach(() => {
    save = vi.fn(async () => {});
    field = commitTextRow({ label: "nickname", value: "old", placeholder: "", save });
    host = document.createElement("div");
    host.appendChild(field.row);
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  it("saves on Enter, and says so", async () => {
    type(field.control, "new");
    expect(status(field.row).textContent).toContain("Enter to save");
    key(field.control, "Enter");
    await vi.waitFor(() => expect(status(field.row).textContent).toBe("saved"));
    expect(save).toHaveBeenCalledExactlyOnceWith("new");
  });

  it("saves when focus leaves the field", async () => {
    type(field.control, "new");
    field.control.dispatchEvent(new FocusEvent("blur"));
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith("new"));
  });

  it("doesn't save an unchanged value", () => {
    key(field.control, "Enter");
    field.control.dispatchEvent(new FocusEvent("blur"));
    expect(save).not.toHaveBeenCalled();
  });

  it("Esc undoes an edit without letting the dialog close", () => {
    const onHost = vi.fn();
    host.addEventListener("keydown", onHost);
    type(field.control, "oops");
    const ev = key(field.control, "Escape");
    expect(field.control.value).toBe("old");
    expect(ev.defaultPrevented).toBe(true);
    expect(onHost).not.toHaveBeenCalled();
    // Unedited, Esc is the dialog's again.
    key(field.control, "Escape");
    expect(onHost).toHaveBeenCalledTimes(1);
  });

  it("shows the error, keeps the text, and doesn't retry on every blur", async () => {
    save.mockRejectedValueOnce(new Error("M_FORBIDDEN: not allowed"));
    type(field.control, "new");
    key(field.control, "Enter");
    await vi.waitFor(() => expect(status(field.row).textContent).toBe("M_FORBIDDEN: not allowed"));
    expect(field.control.value).toBe("new");
    field.control.dispatchEvent(new FocusEvent("blur"));
    expect(save).toHaveBeenCalledTimes(1);
    // An explicit Enter retries.
    key(field.control, "Enter");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it("takes a late-loading saved value, unless the user is already editing", () => {
    field.setSavedValue("loaded");
    expect(field.control.value).toBe("loaded");
    type(field.control, "typing");
    field.setSavedValue("late");
    expect(field.control.value).toBe("typing");
  });
});

describe("commitSelectRow", () => {
  it("saves on change, and goes back if that fails", async () => {
    const save = vi.fn(async () => {});
    const field = commitSelectRow({ label: "join rule", value: "invite", options: [["invite", "Invite"], ["public", "Public"]], save });
    document.body.appendChild(field.row);
    field.control.value = "public";
    field.control.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(status(field.row).textContent).toBe("saved"));
    expect(save).toHaveBeenCalledWith("public");

    save.mockRejectedValueOnce(new Error("no power"));
    field.control.value = "invite";
    field.control.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(status(field.row).textContent).toBe("no power"));
    expect(field.control.value).toBe("public");
    field.row.remove();
  });
});
