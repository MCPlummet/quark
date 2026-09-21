// Room dialog → Settings tab.
//
// The editable half of what RoomSettingsDialog's General and Access tabs held,
// merged: identity, conversation type and access are all "things you change
// about this room", and splitting them across two tabs made the user hunt.
// The read-only facts they duplicated now live on the Info tab.

import type { RoomTab } from "../types.js";
import {
  setRoomName,
  setRoomTopic,
  setRoomJoinRule,
  setRoomHistoryVisibility,
} from "../../../ipc/room_settings.js";
import { applyLocalRoomMeta, setRoomDirectness } from "../../../app/actions.js";

export const settingsTab: RoomTab = {
  id: "settings",
  label: "Settings",
  build(ctx) {
    const { content, controls, room, roomId } = ctx;

    // ── Identity ─────────────────────────────────────────────────────────
    content.appendChild(controls.sectionTitle("Identity"));

    const initial = { name: room?.name ?? "", topic: room?.topic ?? "" };
    let draft = { ...initial };

    content.appendChild(
      controls.textRow("name", draft.name, "Room name", (v) => { draft = { ...draft, name: v }; }),
    );
    content.appendChild(
      controls.textRow("topic", draft.topic, "Room topic", (v) => { draft = { ...draft, topic: v }; }),
    );

    const identityActions = document.createElement("div");
    identityActions.className = "settings-dialog__actions";
    identityActions.appendChild(controls.saveButton(async () => {
      const tasks: Promise<void>[] = [];
      if (draft.name !== initial.name) tasks.push(setRoomName(roomId, draft.name));
      if (draft.topic !== initial.topic) tasks.push(setRoomTopic(roomId, draft.topic));
      await Promise.all(tasks);
      // Reflect the change in the cache + header immediately rather than
      // waiting for the next sync round-trip.
      if (tasks.length > 0) {
        applyLocalRoomMeta(roomId, { name: draft.name, topic: draft.topic });
      }
    }));
    content.appendChild(identityActions);

    // ── Conversation type ────────────────────────────────────────────────
    // The `:converttodm` / `:converttoroom` pair as a single contextual button,
    // since only one of the two ever applies. Updates in place rather than
    // rebuilding the tab, so the button keeps focus across a conversion.
    content.appendChild(controls.sectionTitle("Conversation type"));

    let isDirect = room?.is_direct ?? false;

    const hint = document.createElement("div");
    hint.className = "settings-dialog__hint";
    content.appendChild(hint);

    const convertRow = document.createElement("div");
    convertRow.className = "settings-dialog__row";
    const convertBtn = document.createElement("button");
    convertBtn.type = "button";
    convertBtn.className = "settings-dialog__btn";
    convertRow.appendChild(convertBtn);
    content.appendChild(convertRow);

    const renderConvert = (): void => {
      hint.textContent = isDirect
        ? "Listed under Direct Messages. Converting back files it under Group Rooms."
        : "Listed under Group Rooms. Converting marks it a DM with the other members.";
      convertBtn.textContent = isDirect ? "[convert to room]" : "[convert to dm]";
    };
    renderConvert();

    convertBtn.addEventListener("click", async () => {
      const target = !isDirect;
      convertBtn.disabled = true;
      convertBtn.textContent = target ? "[converting to dm...]" : "[converting to room...]";
      try {
        isDirect = await setRoomDirectness(roomId, target);
        renderConvert();
      } catch (err) {
        convertBtn.textContent = "[error]";
        console.error("Room conversion error:", err);
        setTimeout(renderConvert, 2000);
      } finally {
        convertBtn.disabled = false;
      }
    });

    // ── Access ───────────────────────────────────────────────────────────
    content.appendChild(controls.sectionTitle("Access"));

    let joinRule = "invite";
    let historyVis = "shared";

    content.appendChild(controls.selectRow("join rule", joinRule, [
      ["public", "Public — anyone can join"],
      ["invite", "Invite — require invitation"],
      ["knock", "Knock — users request to join"],
      ["private", "Private — closed"],
    ], (v) => { joinRule = v; }));

    content.appendChild(controls.selectRow("history", historyVis, [
      ["world_readable", "World readable — anyone can read"],
      ["shared", "Shared — visible since join"],
      ["invited", "Invited — visible since invite"],
      ["joined", "Joined — visible since join"],
    ], (v) => { historyVis = v; }));

    const note = document.createElement("div");
    note.className = "settings-dialog__hint";
    note.textContent = "Note: current state not shown — values reflect defaults until fetched.";
    content.appendChild(note);

    const accessActions = document.createElement("div");
    accessActions.className = "settings-dialog__actions";
    accessActions.appendChild(controls.saveButton(async () => {
      await Promise.all([
        setRoomJoinRule(roomId, joinRule),
        setRoomHistoryVisibility(roomId, historyVis),
      ]);
    }));
    content.appendChild(accessActions);
  },
};
