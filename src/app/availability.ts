// Bridges app state to the registry's requirement predicates.
//
// Kept out of registry.ts so that module stays importable without pulling in
// AppState and the mobile controller — the parity test (#104) and the palette
// need the vocabulary, not the runtime.
//
// Every surface that offers actions builds its context here rather than writing
// its own `if (!AppState.get("currentRoomId"))` check, which is how the old
// executor ended up with six subtly different "No room selected" branches.

import { AppState } from "./state.js";
import { isMobile } from "./mobile.js";
import type { AvailabilityContext } from "./registry.js";

/**
 * Snapshot the state the requirement predicates read.
 *
 * Message selection is not in AppState — it lives on the Timeline component —
 * so callers that offer message actions pass it through `overrides`. Callers
 * that don't (the `:` executor; no command requires a selected message) get a
 * context with no selection, which correctly reports message actions as
 * unavailable rather than silently passing.
 */
export function currentAvailability(
  overrides: Partial<AvailabilityContext> = {},
): AvailabilityContext {
  return {
    loggedIn: AppState.get("loggedIn"),
    roomId: AppState.get("currentRoomId"),
    spaceId: AppState.get("currentSpaceId"),
    selectedMessageId: null,
    selectedMessageIsOwn: false,
    isMobile: isMobile(),
    ...overrides,
  };
}
