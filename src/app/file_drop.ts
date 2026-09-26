// Dropping files onto the window to attach them (#83).
//
// Tauri takes OS file drops itself: `dragDropEnabled` defaults to true, and
// with it wry answers the drop as handled before the webview's HTML5 `drop`
// event can carry a `File`. That is the path used here, rather than turning the
// native handler off for DOM events — which would disable it app-wide, and
// WebKitGTK's HTML5 external-file DnD is the less reliable of the two. The
// native event carries filesystem paths only; `readDroppedFile` turns each into
// a `File`, and from there a drop is the same as a paste or a pick
// (`attachFiles`).
//
// The drop lands anywhere in the window, not only on the composer — the whole
// room is the target, as in other chat clients — and the composer lights up
// while a drag is over the window to show where the files will go.

import { AppState } from "./state.js";
import { isTauri } from "../ipc/mock.js";
import { readDroppedFile } from "../ipc/media.js";
import { showError } from "../ui/NotificationToast.js";

/** The subset of Tauri's `DragDropEvent` this module reads. */
export type DropPayload =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

export interface FileDropDeps {
  /** Hand the read files on — `attachFiles` in the app. */
  onFiles(files: File[]): void;
  /** Show or clear the composer's drop highlight. */
  setActive(active: boolean): void;
  /** Read one dropped path. Injected so tests need no backend. */
  read?(path: string): Promise<File>;
}

/** Whether a drop right now has somewhere to go. */
function canAccept(): boolean {
  return AppState.get("currentRoomId") !== null;
}

/**
 * React to one native drag-drop event. Exported for tests; the listener in
 * {@link setupFileDrop} is a thin wrapper around it.
 */
export async function handleDropEvent(payload: DropPayload, deps: FileDropDeps): Promise<void> {
  switch (payload.type) {
    case "enter":
      deps.setActive(canAccept() && payload.paths.length > 0);
      return;
    case "over":
      return;
    case "leave":
      deps.setActive(false);
      return;
    case "drop": {
      deps.setActive(false);
      if (payload.paths.length === 0) return;
      if (!canAccept()) {
        showError("Open a room to attach files");
        return;
      }
      const read = deps.read ?? readDroppedFile;
      const results = await Promise.allSettled(payload.paths.map((p) => read(p)));
      const files: File[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          files.push(r.value);
        } else {
          const name = payload.paths[i].split(/[\\/]/).pop() || payload.paths[i];
          const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
          showError(`Can't attach ${name}: ${reason}`);
        }
      });
      if (files.length > 0) deps.onFiles(files);
      return;
    }
  }
}

/**
 * Listen for native file drops on this webview. A no-op outside Tauri (the mock
 * dev server has no native drops) and wherever the platform never emits them
 * (the mobile builds). Returns the unlisten function.
 */
export async function setupFileDrop(deps: FileDropDeps): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    return await getCurrentWebview().onDragDropEvent((event) => {
      void handleDropEvent(event.payload as DropPayload, deps);
    });
  } catch (err) {
    console.warn("[drop] native drag-drop unavailable:", err);
    return () => {};
  }
}
