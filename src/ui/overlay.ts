// The body-mounted overlay layer.
//
// Pickers, dialogs, context menus, toasts and the like mount on <body> rather
// than inside #app so nothing — a panel's overflow, a stacking context, the
// timeline's scroll position — can clip them.
//
// That puts them outside the one element mobile translates to follow the
// visual-viewport pan (#33). Left alone they stay in layout-viewport coordinates
// while the shell moves, so with the keyboard up and the viewport panned a few
// hundred pixels the two shear apart: toasts land off-screen, and the emoji
// picker — anchored 80px above the compose bar it belongs to — floats the whole
// pan away from it. Mounting through here tags them so base.css can give them
// the shell's offset.

// One thing to know when placing an overlay: the layer shares the shell's
// coordinate space, and a client rect does not — `getBoundingClientRect` reports
// layout-viewport space, pan included. An overlay positioned off an anchor rect
// has to subtract `viewportPan()` (app/mobile.ts) or it lands a pan too low.
// DatePicker and the read-receipt tooltip are the two that do this; the context
// menu and the quick-react picker dock as bottom sheets on mobile, which is the
// only place a pan exists, so they never anchor to a rect there.

const OVERLAY_CLASS = "quark-overlay";

/** Mount `el` in the body-level overlay layer. */
export function mountOverlay(el: HTMLElement): void {
  el.classList.add(OVERLAY_CLASS);
  document.body.appendChild(el);
}
