// ResizeHandle — drag handle for resizing panels by updating CSS custom properties

/**
 * Attach a drag-to-resize handle to the right edge of a panel element.
 * Updates the given CSS variable on drag.
 *
 * @param panel      The panel element to attach the handle to
 * @param cssVar     CSS custom property name to update (e.g. "--room-list-width")
 * @param side       "right" (drag from right edge to resize) or "left" (drag from left)
 * @param minPx      Minimum size in pixels (default 120)
 * @param maxPx      Maximum size in pixels (default 600)
 */
export function attachResizeHandle(
  panel: HTMLElement,
  cssVar: string,
  side: "right" | "left",
  minPx = 120,
  maxPx = 600
): void {
  const handle = document.createElement("div");
  handle.className = "resize-handle";
  if (side === "right") {
    handle.style.right = "0";
    handle.style.left = "auto";
  } else {
    handle.style.left = "0";
    handle.style.right = "auto";
  }
  panel.appendChild(handle);

  let startX = 0;
  let startWidth = 0;
  let dragging = false;

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const delta = side === "right" ? e.clientX - startX : startX - e.clientX;
    const newWidth = Math.min(maxPx, Math.max(minPx, startWidth + delta));
    document.documentElement.style.setProperty(cssVar, `${newWidth}px`);
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("resize-handle--dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    // Use the panel's actual rendered width as the drag-start baseline. The panel
    // stretches to fill the grid track sized by `cssVar`, so its offsetWidth equals
    // the variable's value. Reading the variable back via getComputedStyle is
    // fragile (it can resolve to an empty/unparseable string — notably under
    // WebKitGTK — yielding a wrong baseline that snaps the panel to its min width
    // on the first drag).
    startWidth = panel.offsetWidth;
    handle.classList.add("resize-handle--dragging");
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}
