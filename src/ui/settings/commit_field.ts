// Form fields that save themselves.
//
// The room and space settings forms used to pair each group of fields with its
// own [save] button — three in the room's Settings tab alone — and Enter in a
// field did nothing. Typing a new nickname, pressing Enter (or the [save]
// nearest the field, which belonged to the section above) and closing the
// dialog saved nothing and said nothing.
//
// A field here commits its own value: a text field on Enter or when focus
// leaves it, a select as soon as it changes. Esc in a text field that has been
// edited puts the saved value back instead of closing the dialog; in an
// unedited one it closes the dialog as before. Each field says what is
// happening — unsaved, saving, saved, or the error — on a line under itself.

export interface CommitFieldSpec {
  label: string;
  /** The value as saved. */
  value: string;
  ariaLabel?: string;
  /** Persist a new value. Throw to report failure; the message is shown. */
  save: (value: string) => Promise<void>;
}

export interface CommitTextSpec extends CommitFieldSpec {
  placeholder: string;
}

export interface CommitSelectSpec extends CommitFieldSpec {
  options: Array<[value: string, label: string]>;
}

export interface CommitField<E extends HTMLElement> {
  /** The field and its status line; append this. */
  row: HTMLElement;
  control: E;
  /** Replace the saved value — e.g. once it has loaded — unless the user is mid-edit. */
  setSavedValue(value: string): void;
}

/** How long "saved" stays up. */
const SAVED_FLASH_MS = 2000;

type StatusKind = "dirty" | "saving" | "saved" | "error" | null;

function makeShell(label: string): { row: HTMLElement; line: HTMLElement; status: (kind: StatusKind, text?: string) => void } {
  const row = document.createElement("div");
  row.className = "settings-dialog__field";
  const line = document.createElement("div");
  line.className = "settings-dialog__row";
  const lbl = document.createElement("span");
  lbl.className = "settings-dialog__label";
  lbl.textContent = label;
  line.appendChild(lbl);
  row.appendChild(line);

  const statusEl = document.createElement("div");
  statusEl.className = "settings-dialog__field-status";
  statusEl.setAttribute("aria-live", "polite");
  row.appendChild(statusEl);

  let flash: ReturnType<typeof setTimeout> | null = null;
  const status = (kind: StatusKind, text = ""): void => {
    if (flash) clearTimeout(flash);
    flash = null;
    statusEl.className = "settings-dialog__field-status" + (kind ? ` settings-dialog__field-status--${kind}` : "");
    statusEl.textContent = text;
    if (kind === "saved") {
      flash = setTimeout(() => status(null), SAVED_FLASH_MS);
    }
  };
  return { row, line, status };
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A text field that saves on Enter or when focus leaves it. */
export function commitTextRow(spec: CommitTextSpec): CommitField<HTMLInputElement> {
  const { row, line, status } = makeShell(spec.label);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-dialog__text-input";
  input.value = spec.value;
  input.placeholder = spec.placeholder;
  if (spec.ariaLabel) input.setAttribute("aria-label", spec.ariaLabel);
  // Enter commits, so say so — on a soft keyboard too.
  input.enterKeyHint = "done";
  line.appendChild(input);

  let saved = spec.value;
  let saving = false;
  /** The last value that failed, so leaving the field doesn't retry it in a loop. */
  let failed: string | null = null;

  const showDirty = (): void => {
    if (saving) return;
    if (input.value !== saved) status("dirty", "unsaved — Enter to save, Esc to undo");
    else status(null);
  };

  const commit = async (fromBlur: boolean): Promise<void> => {
    const value = input.value;
    if (saving || value === saved) return;
    if (fromBlur && value === failed) return;
    saving = true;
    status("saving", "saving…");
    try {
      await spec.save(value);
      saved = value;
      failed = null;
      saving = false;
      if (input.value === saved) status("saved", "saved");
      else showDirty();
    } catch (err) {
      failed = value;
      saving = false;
      status("error", errorText(err));
    }
  };

  input.addEventListener("input", () => {
    if (input.value !== failed) failed = null;
    showDirty();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void commit(false);
    } else if (e.key === "Escape" && input.value !== saved) {
      // Undo the edit; a second Esc (now unedited) closes the dialog.
      e.preventDefault();
      e.stopPropagation();
      input.value = saved;
      failed = null;
      status(null);
    }
  });
  input.addEventListener("blur", () => void commit(true));

  return {
    row,
    control: input,
    setSavedValue(value: string): void {
      const editing = input.value !== saved;
      saved = value;
      if (!editing) input.value = value;
      showDirty();
    },
  };
}

/** A select that saves as soon as it changes, and goes back if that fails. */
export function commitSelectRow(spec: CommitSelectSpec): CommitField<HTMLSelectElement> {
  const { row, line, status } = makeShell(spec.label);
  const select = document.createElement("select");
  select.className = "settings-dialog__select";
  if (spec.ariaLabel) select.setAttribute("aria-label", spec.ariaLabel);
  for (const [value, label] of spec.options) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.value = spec.value;
  line.appendChild(select);

  let saved = spec.value;
  select.addEventListener("change", async () => {
    const value = select.value;
    if (value === saved) return;
    select.disabled = true;
    status("saving", "saving…");
    try {
      await spec.save(value);
      saved = value;
      status("saved", "saved");
    } catch (err) {
      select.value = saved;
      status("error", errorText(err));
    } finally {
      select.disabled = false;
    }
  });

  return {
    row,
    control: select,
    setSavedValue(value: string): void {
      saved = value;
      select.value = value;
    },
  };
}
