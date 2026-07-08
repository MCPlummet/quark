// Resolves what submitting the compose box should do, from the field text and
// the pending state. Pure so every submit affordance (Enter, Ctrl/Cmd+Enter,
// the ➤ send button, the staged-image Send button) shares one precedence rule:
// edit > pending image > text.

export type ComposeSubmitPlan =
  | { kind: "none" }
  | { kind: "edit"; body: string }
  | { kind: "image"; caption: string | null }
  | { kind: "text"; body: string };

/**
 * Decide what a compose-box submit means.
 *
 * - An in-progress edit always commits first (edits are text-only in Matrix;
 *   a staged image stays pending and the next submit sends it).
 * - A staged image sends next, with the trimmed field text as its caption —
 *   whitespace-only means no caption.
 * - Otherwise non-empty text sends as a message; an empty submit is a no-op.
 */
export function resolveComposeSubmit(opts: {
  rawValue: string;
  editingEventId: string | null;
  hasPendingImage: boolean;
}): ComposeSubmitPlan {
  const trimmed = opts.rawValue.trim();
  if (opts.editingEventId) {
    return trimmed ? { kind: "edit", body: trimmed } : { kind: "none" };
  }
  if (opts.hasPendingImage) {
    return { kind: "image", caption: trimmed.length > 0 ? trimmed : null };
  }
  if (trimmed) {
    return { kind: "text", body: trimmed };
  }
  return { kind: "none" };
}
