// Pseudo-spaces: client-side filtered views over the room list cache.
//
// These appear in the SpaceStrip alongside real Matrix spaces, but their
// contents are computed by applying a predicate to the local room cache
// rather than fetching a space hierarchy from the homeserver. Keeping the
// list and filters in one place avoids growing a switchyard in `selectSpace`
// each time a new pseudo-space is added.

import type { RoomInfo } from "../ipc/types.js";

export type PseudoSpacePosition = "top" | "bottom";

export interface PseudoSpace {
  id: string;
  label: string;
  /** Monochrome glyph rendered in the SpaceStrip. */
  icon: string;
  /** Rendered above (top) or below (bottom) the user's real spaces. */
  position: PseudoSpacePosition;
  filter: (room: RoomInfo, spaceRoomIds: Set<string>) => boolean;
}

// `m.direct` is the user's own declaration of what a DM is, so it is the whole
// test — no member-count corroboration. A bridged DM routinely carries a relay
// or bot alongside the two humans, and `:converttodm` exists precisely to let
// the user override the heuristic; gating on `member_count <= 2` silently threw
// both cases back into Group Rooms.
const isDm = (r: RoomInfo): boolean => r.is_direct;

export const PSEUDO_SPACES: PseudoSpace[] = [
  {
    id: "__home__",
    label: "Home",
    icon: "⌂",
    position: "top",
    filter: (r, spaceRoomIds) => r.is_direct || !spaceRoomIds.has(r.room_id),
  },
  {
    id: "__dms__",
    label: "Direct Messages",
    icon: "✉",
    position: "bottom",
    filter: (r) => isDm(r),
  },
  {
    id: "__groups__",
    label: "Group Rooms",
    icon: "#",
    position: "bottom",
    filter: (r, spaceRoomIds) => !spaceRoomIds.has(r.room_id) && !isDm(r),
  },
];

export const getPseudoSpace = (id: string): PseudoSpace | undefined =>
  PSEUDO_SPACES.find((s) => s.id === id);

export const isPseudoSpace = (id: string): boolean =>
  PSEUDO_SPACES.some((s) => s.id === id);

/** Sort by most recent activity, then unread score, then name. */
export function sortByRecency(rooms: RoomInfo[]): RoomInfo[] {
  return [...rooms].sort((a, b) => {
    const aTs = a.last_activity_ts ?? 0;
    const bTs = b.last_activity_ts ?? 0;
    if (bTs !== aTs) return bTs - aTs;
    const aScore = a.notification_count * 2 + a.unread_count;
    const bScore = b.notification_count * 2 + b.unread_count;
    if (bScore !== aScore) return bScore - aScore;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}
