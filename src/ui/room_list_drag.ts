// Mouse drag-to-reorder for the room list's space sections.
//
// Pointer events rather than HTML5 drag-and-drop: Tauri's window-level file
// drop handling (see app/file_drop.ts) intercepts native drag events on some
// platforms, and a native drag ghost of a text row looks nothing like the
// terminal UI anyway. Mouse only — on touch a vertical drag is a scroll (and a
// horizontal one the drawer), so touch reorders through the long-press menu.
//
// Only rows in an orderable section (`data-section`, set by RoomList for
// sections that list a space's children) can be dragged, and only within their
// own section: moving a room between spaces is a different operation.

/** Pixels the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 6;
/** Distance from the scroller's edge within which a drag scrolls it. */
const EDGE_SCROLL_PX = 28;

export interface RoomDragOptions {
  /** The scrolling list container holding the `.room-list__item` rows. */
  container: HTMLElement;
  /** Called on a drop that changes the order. `beforeRoomId` null = last. */
  onDrop: (sectionKey: string, roomId: string, beforeRoomId: string | null) => void;
}

/** Where a drop at `clientY` lands among `rows`: the row it goes before, or null for the end. */
export function dropTarget(rows: HTMLElement[], clientY: number): HTMLElement | null {
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return row;
  }
  return null;
}

/**
 * The section's room order after moving `roomId` before `beforeRoomId` (or to
 * the end), or null when that is where it already is.
 */
export function reorderedIds(ids: string[], roomId: string, beforeRoomId: string | null): string[] | null {
  if (!ids.includes(roomId) || roomId === beforeRoomId) return null;
  const without = ids.filter((id) => id !== roomId);
  const at = beforeRoomId === null ? without.length : without.indexOf(beforeRoomId);
  if (at < 0) return null;
  const next = [...without.slice(0, at), roomId, ...without.slice(at)];
  return next.every((id, i) => id === ids[i]) ? null : next;
}

/** Wire drag reordering onto a room list. Returns a detach function. */
export function attachRoomDrag(opts: RoomDragOptions): () => void {
  const { container } = opts;

  let pressed: { row: HTMLElement; section: string; startY: number; pointerId: number } | null = null;
  let dragging = false;
  /** Escape ended the drag while the button is still down: the release must
   *  still be swallowed, or it would open the room. */
  let cancelled = false;
  let marked: { row: HTMLElement | null; cls: string } | null = null;

  const sectionRows = (section: string): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(".room-list__item[data-section]"))
      .filter((el) => el.dataset.section === section);

  const clearMark = (): void => {
    if (marked?.row) marked.row.classList.remove(marked.cls);
    marked = null;
  };

  const mark = (row: HTMLElement | null, cls: string): void => {
    if (marked?.row === row && marked?.cls === cls) return;
    clearMark();
    if (row) row.classList.add(cls);
    marked = { row, cls };
  };

  const finish = (): void => {
    clearMark();
    pressed?.row.classList.remove("room-list__item--dragging");
    document.body.classList.remove("quark-room-dragging");
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", onCancel, true);
    document.removeEventListener("keydown", onKey, true);
    pressed = null;
    dragging = false;
    cancelled = false;
  };

  /** Drop the drag visuals but keep tracking the press until it is released. */
  const abandon = (): void => {
    clearMark();
    pressed?.row.classList.remove("room-list__item--dragging");
    document.body.classList.remove("quark-room-dragging");
    dragging = false;
    cancelled = true;
  };

  // A drag ends with a click on the row it started on; that click must not
  // also open the room. Armed at the release, so it covers exactly the click
  // that release produces.
  const swallowNextClick = (): void => {
    const swallow = (e: Event): void => {
      e.stopPropagation();
      e.preventDefault();
    };
    container.addEventListener("click", swallow, { capture: true, once: true });
    // If no click follows (pointer released elsewhere), stop waiting for one.
    setTimeout(() => container.removeEventListener("click", swallow, { capture: true }), 0);
  };

  function onMove(e: PointerEvent): void {
    if (!pressed || e.pointerId !== pressed.pointerId || cancelled) return;
    if (!dragging) {
      if (Math.abs(e.clientY - pressed.startY) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      pressed.row.classList.add("room-list__item--dragging");
      document.body.classList.add("quark-room-dragging");
    }
    e.preventDefault();

    const box = container.getBoundingClientRect();
    if (e.clientY < box.top + EDGE_SCROLL_PX) container.scrollTop -= 8;
    else if (e.clientY > box.bottom - EDGE_SCROLL_PX) container.scrollTop += 8;

    const rows = sectionRows(pressed.section);
    const before = dropTarget(rows, e.clientY);
    if (before) mark(before, "room-list__item--drop-before");
    else mark(rows[rows.length - 1] ?? null, "room-list__item--drop-after");
  }

  function onUp(e: PointerEvent): void {
    if (!pressed || e.pointerId !== pressed.pointerId) return;
    if (cancelled) {
      swallowNextClick();
      finish();
      return;
    }
    if (dragging) {
      const rows = sectionRows(pressed.section);
      const before = dropTarget(rows, e.clientY);
      const roomId = pressed.row.dataset.roomId;
      const section = pressed.section;
      swallowNextClick();
      finish();
      if (roomId) opts.onDrop(section, roomId, before?.dataset.roomId ?? null);
      return;
    }
    finish();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape" && dragging) {
      e.preventDefault();
      e.stopPropagation();
      abandon();
    }
  }

  // The browser took the pointer (a native drag or selection began): no
  // release is coming, so stop tracking rather than drop on the next one.
  function onCancel(e: PointerEvent): void {
    if (pressed && e.pointerId === pressed.pointerId) finish();
  }

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.pointerType !== "mouse") return;
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>(".room-list__item[data-section]");
    if (!row || !container.contains(row) || !row.dataset.section) return;
    if (pressed) finish();
    pressed = { row, section: row.dataset.section, startY: e.clientY, pointerId: e.pointerId };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
    document.addEventListener("keydown", onKey, true);
  };

  container.addEventListener("pointerdown", onDown);
  return () => {
    container.removeEventListener("pointerdown", onDown);
    finish();
  };
}
