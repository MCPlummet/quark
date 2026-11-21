// Space settings → Children tab: the rooms and subspaces the space lists.
// Moved from SpaceSettingsDialog._buildChildrenTab with its behaviour intact.

import type { RoomTab } from "../../room/types.js";
import type { SpaceChild } from "../../../ipc/types.js";
import { getSpaceChildren } from "../../../ipc/spaces.js";

export const spaceChildrenTab: RoomTab = {
  id: "children",
  label: "Children",
  async build(ctx) {
    const { content, controls, roomId: spaceId } = ctx;
    const { section, loading } = controls.loadingSection(content);
    loading.textContent = "Loading children…";

    let children: SpaceChild[];
    try {
      children = await getSpaceChildren(spaceId);
    } catch (err) {
      loading.textContent = `Failed to load children: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    section.innerHTML = "";
    section.appendChild(controls.sectionTitle(`Children (${children.length})`));

    if (children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-dialog__row";
      empty.style.color = "var(--roomlist-muted)";
      empty.textContent = "(no children)";
      section.appendChild(empty);
    }

    for (const child of children) {
      const row = document.createElement("div");
      row.className = "settings-dialog__row space-settings-dialog__child-row";

      const typeTag = document.createElement("span");
      typeTag.className = "settings-dialog__label";
      typeTag.textContent = child.is_space ? "[space]" : "[room]";
      typeTag.style.minWidth = "60px";
      typeTag.style.color = child.is_space ? "var(--accent-secondary)" : "var(--roomlist-muted)";

      const nameEl = document.createElement("span");
      nameEl.className = "settings-dialog__value";
      nameEl.textContent = child.name ?? child.room_id;
      if (child.topic) nameEl.title = child.topic;

      const membersEl = document.createElement("span");
      membersEl.className = "settings-dialog__value--muted";
      membersEl.style.marginLeft = "auto";
      membersEl.style.fontSize = "calc(var(--font-size) - 2px)";
      membersEl.textContent = child.member_count != null ? `${child.member_count} members` : "";

      row.append(typeTag, nameEl, membersEl);
      section.appendChild(row);
    }
  },
};
