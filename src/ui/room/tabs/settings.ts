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
  getRoomStateEvents,
} from "../../../ipc/room_settings.js";
import { getRoomNickname } from "../../../ipc/rooms.js";
import { applyLocalRoomMeta, setRoomDirectness, setOwnRoomNickname } from "../../../app/actions.js";
import { commitSelectRow, commitTextRow } from "../../settings/commit_field.js";

const JOIN_RULES: Array<[string, string]> = [
  ["public", "Public — anyone can join"],
  ["invite", "Invite — require invitation"],
  ["knock", "Knock — users request to join"],
  ["private", "Private — closed"],
];

const HISTORY: Array<[string, string]> = [
  ["world_readable", "World readable — anyone can read"],
  ["shared", "Shared — visible since join"],
  ["invited", "Invited — visible since invite"],
  ["joined", "Joined — visible since join"],
];

/** A state event's content field, from the raw events the debug viewer also reads. */
function stateField(
  events: Array<{ event_type: string; state_key: string; content_json: string }>,
  type: string,
  field: string,
): string | null {
  const ev = events.find((e) => e.event_type === type && e.state_key === "");
  if (!ev) return null;
  try {
    const value = (JSON.parse(ev.content_json) as Record<string, unknown>)[field];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export const settingsTab: RoomTab = {
  id: "settings",
  label: "Settings",
  async build(ctx) {
    const { content, controls, room, roomId } = ctx;

    // Every field here saves itself (commit_field.ts): text on Enter or when
    // you leave it, choices as soon as they change. There used to be a [save]
    // per section, and Enter did nothing.
    const how = document.createElement("div");
    how.className = "settings-dialog__hint settings-dialog__hint--lead";
    how.textContent = "Changes save on Enter or when you leave a field · Esc undoes an edit";
    content.appendChild(how);

    // ── Identity ─────────────────────────────────────────────────────────
    content.appendChild(controls.sectionTitle("Identity"));

    content.appendChild(commitTextRow({
      label: "name",
      value: room?.name ?? "",
      placeholder: "Room name",
      ariaLabel: "Room name",
      save: async (v) => {
        await setRoomName(roomId, v.trim());
        // Reflect it in the cache + header now rather than on the next sync.
        applyLocalRoomMeta(roomId, { name: v.trim() });
      },
    }).row);

    content.appendChild(commitTextRow({
      label: "topic",
      value: room?.topic ?? "",
      placeholder: "Room topic",
      ariaLabel: "Room topic",
      save: async (v) => {
        await setRoomTopic(roomId, v.trim());
        applyLocalRoomMeta(roomId, { topic: v.trim() });
      },
    }).row);

    // ── Your name in this room ───────────────────────────────────────────
    // Your own member event's display name: starts as your global name, and
    // can differ per room. Empty puts it back to the global one (`:myroomnick`
    // with no argument does the same).
    content.appendChild(controls.sectionTitle("Your name in this room"));

    const nick = commitTextRow({
      label: "nickname",
      value: "",
      placeholder: "your global display name",
      ariaLabel: "Your nickname in this room",
      save: (v) => setOwnRoomNickname(roomId, v.trim() || null),
    });
    content.appendChild(nick.row);
    void getRoomNickname(roomId)
      .then((current) => nick.setSavedValue(current ?? ""))
      .catch(() => { /* leave it empty; saving still works */ });

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
    // Shows the room's current settings (it used to show defaults, and its
    // [save] wrote both — so saving one could quietly change the other).
    content.appendChild(controls.sectionTitle("Access"));
    const events = await getRoomStateEvents(roomId).catch(() => []);
    const joinRule = stateField(events, "m.room.join_rules", "join_rule") ?? "invite";
    const history = stateField(events, "m.room.history_visibility", "history_visibility") ?? "shared";

    const withCurrent = (options: Array<[string, string]>, current: string): Array<[string, string]> =>
      options.some(([v]) => v === current)
        ? options
        : [...options, [current, current === "restricted" ? "Restricted — members of a space" : current]];

    content.appendChild(commitSelectRow({
      label: "join rule",
      value: joinRule,
      options: withCurrent(JOIN_RULES, joinRule),
      ariaLabel: "Join rule",
      save: (v) => setRoomJoinRule(roomId, v),
    }).row);

    content.appendChild(commitSelectRow({
      label: "history",
      value: history,
      options: withCurrent(HISTORY, history),
      ariaLabel: "History visibility",
      save: (v) => setRoomHistoryVisibility(roomId, v),
    }).row);
  },
};
