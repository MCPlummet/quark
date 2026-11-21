// The Emoji tab (#12): a room's — or a space's — emoji/sticker packs, each in
// a PackEditor. Registered in both the room dialog and space settings; a
// space's packs apply in every room of the space.

import { createRoomPack, getRoomPacks } from "../../ipc/index.js";
import type { RoomPacks } from "../../ipc/types.js";
import type { RoomTab } from "../room/types.js";
import { commitTextRow, errorText } from "../settings/commit_field.js";
import { PackEditor } from "./PackEditor.js";

export const packsTab: RoomTab = {
  id: "emoji",
  label: "Emoji",
  async build(ctx) {
    const { content, controls, roomId } = ctx;
    const subject = ctx.subject ?? "room";
    const { section, loading } = controls.loadingSection(content);
    loading.textContent = "Loading packs…";

    let packs: RoomPacks;
    try {
      packs = await getRoomPacks(roomId);
    } catch (err) {
      loading.textContent = `Failed to load packs: ${errorText(err)}`;
      return;
    }

    section.replaceChildren(controls.sectionTitle("Emoji & sticker packs"));
    const hint = document.createElement("div");
    hint.className = "settings-dialog__hint settings-dialog__hint--lead";
    hint.textContent = subject === "space"
      ? "Everyone can use these in every room of this space. Favorite a pack to use it everywhere else too."
      : "Everyone can use these in this room. Favorite a pack to use it in every room.";
    section.appendChild(hint);

    if (packs.packs.length === 0 && !packs.can_edit) {
      const empty = document.createElement("div");
      empty.className = "settings-dialog__row";
      empty.textContent = `This ${subject} has no packs.`;
      section.appendChild(empty);
      return;
    }

    for (const pack of packs.packs) {
      const editor = new PackEditor({
        location: { kind: "room", room_id: roomId, state_key: pack.state_key ?? "" },
        pack,
        canEdit: packs.can_edit,
        favoritable: true,
        // A deleted pack leaves the list; anything else redraws in place.
        onChange: (next) => {
          if (next === null) ctx.refresh();
        },
      });
      section.appendChild(editor.getElement());
    }

    if (packs.can_edit) {
      const wrap = document.createElement("div");
      wrap.className = "packs-tab__new";
      wrap.appendChild(commitTextRow({
        label: "new pack",
        value: "",
        placeholder: "Name, then Enter",
        ariaLabel: "New pack name",
        // Creating a pack is a state event every member sees: only on Enter,
        // never from a name left in the field when focus moves or the dialog
        // closes.
        commitOnBlur: false,
        save: async (name) => {
          if (!name.trim()) throw new Error("Give the pack a name");
          await createRoomPack(roomId, name.trim());
          ctx.refresh();
        },
      }).row);
      section.appendChild(wrap);
    }
  },
};
