// Space settings → General tab: name and topic (self-saving), and the facts.
// Moved from SpaceSettingsDialog._buildGeneralTab with its behaviour intact.

import type { RoomTab } from "../../room/types.js";
import { setRoomName, setRoomTopic } from "../../../ipc/room_settings.js";
import { commitTextRow } from "../../settings/commit_field.js";
import { applyLocalRoomMeta } from "../../../app/actions.js";

export const spaceGeneralTab: RoomTab = {
  id: "general",
  label: "General",
  build(ctx) {
    const { content, controls, roomId: spaceId, room: spaceInfo } = ctx;

    const section = document.createElement("div");
    section.className = "settings-dialog__section";
    section.appendChild(controls.sectionTitle("Space Identity"));
    // Saves itself on Enter or when you leave the field (commit_field.ts).
    section.appendChild(commitTextRow({
      label: "name",
      value: spaceInfo?.name ?? "",
      placeholder: "Space name",
      ariaLabel: "Space name",
      save: async (v) => {
        await setRoomName(spaceId, v.trim());
        applyLocalRoomMeta(spaceId, { name: v.trim() });
      },
    }).row);
    section.appendChild(commitTextRow({
      label: "topic",
      value: spaceInfo?.topic ?? "",
      placeholder: "Space description",
      ariaLabel: "Space description",
      save: async (v) => {
        await setRoomTopic(spaceId, v.trim());
        applyLocalRoomMeta(spaceId, { topic: v.trim() });
      },
    }).row);
    content.appendChild(section);

    const info = document.createElement("div");
    info.className = "settings-dialog__section";
    info.appendChild(controls.sectionTitle("Space Info"));
    for (const [label, value] of [["space id", spaceId], ["members", String(spaceInfo?.member_count ?? "?")]]) {
      const row = controls.readRow(label, value);
      row.querySelector(".settings-dialog__value")?.classList.add("settings-dialog__value--muted");
      info.appendChild(row);
    }
    content.appendChild(info);
  },
};
