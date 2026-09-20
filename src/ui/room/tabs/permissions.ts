// Room dialog → Permissions tab.
//
// Ported from RoomSettingsDialog with its behaviour intact: default levels,
// moderation levels, and per-user overrides with add/remove, all saved as one
// power-levels event.

import type { RoomTab } from "../types.js";
import type { PowerLevels } from "../../../ipc/room_settings.js";
import { getPowerLevels, setPowerLevels } from "../../../ipc/room_settings.js";

export const permissionsTab: RoomTab = {
  id: "permissions",
  label: "Permissions",
  async build(ctx) {
    const { content, controls, roomId } = ctx;

    const loading = document.createElement("div");
    loading.className = "settings-dialog__row";
    loading.textContent = "Loading power levels…";
    content.appendChild(loading);

    let pl: PowerLevels;
    try {
      pl = await getPowerLevels(roomId);
    } catch (err) {
      loading.textContent =
        `Failed to load power levels: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    loading.remove();

    let draft: PowerLevels = { ...pl, events: { ...pl.events }, users: { ...pl.users } };

    content.appendChild(controls.sectionTitle("Default levels"));
    for (const [label, key] of [
      ["events default", "events_default"],
      ["state default", "state_default"],
      ["users default", "users_default"],
    ] as const) {
      content.appendChild(
        controls.numberRow(label, draft[key], -100, 100, (v) => { draft = { ...draft, [key]: v }; }),
      );
    }

    content.appendChild(controls.sectionTitle("Moderation levels"));
    for (const [label, key] of [
      ["kick", "kick"],
      ["ban", "ban"],
      ["invite", "invite"],
      ["redact", "redact"],
    ] as const) {
      content.appendChild(
        controls.numberRow(label, draft[key], -100, 100, (v) => { draft = { ...draft, [key]: v }; }),
      );
    }

    // ── Per-user overrides ───────────────────────────────────────────────
    const userSection = document.createElement("div");
    content.appendChild(controls.sectionTitle("User overrides"));
    content.appendChild(userSection);

    const renderUserRows = (): void => {
      userSection.innerHTML = "";

      for (const [userId, level] of Object.entries(draft.users)) {
        const row = document.createElement("div");
        row.className = "settings-dialog__row room-settings-dialog__user-row";

        const uidEl = document.createElement("span");
        uidEl.className = "settings-dialog__label room-settings-dialog__user-id";
        uidEl.textContent = userId;

        const levelInput = document.createElement("input");
        levelInput.type = "number";
        levelInput.className = "settings-dialog__number-input";
        levelInput.value = String(level);
        levelInput.min = "0";
        levelInput.max = "100";
        levelInput.step = "10";
        levelInput.addEventListener("change", () => {
          const v = parseInt(levelInput.value, 10);
          if (!isNaN(v)) draft = { ...draft, users: { ...draft.users, [userId]: v } };
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "settings-dialog__btn settings-dialog__btn--danger";
        removeBtn.textContent = "[−]";
        removeBtn.setAttribute("aria-label", `Remove override for ${userId}`);
        removeBtn.addEventListener("click", () => {
          const users = { ...draft.users };
          delete users[userId];
          draft = { ...draft, users };
          renderUserRows();
        });

        row.append(uidEl, levelInput, removeBtn);
        userSection.appendChild(row);
      }

      const addRow = document.createElement("div");
      addRow.className = "settings-dialog__row";

      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.className = "settings-dialog__text-input";
      addInput.placeholder = "@user:server.org";
      addInput.style.width = "180px";

      const addLevelInput = document.createElement("input");
      addLevelInput.type = "number";
      addLevelInput.className = "settings-dialog__number-input";
      addLevelInput.value = "50";
      addLevelInput.min = "0";
      addLevelInput.max = "100";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "settings-dialog__btn";
      addBtn.textContent = "[+]";
      addBtn.setAttribute("aria-label", "Add a user override");
      addBtn.addEventListener("click", () => {
        const uid = addInput.value.trim();
        const level = parseInt(addLevelInput.value, 10);
        if (!uid || isNaN(level)) return;
        draft = { ...draft, users: { ...draft.users, [uid]: level } };
        addInput.value = "";
        renderUserRows();
      });

      addRow.append(addInput, addLevelInput, addBtn);
      userSection.appendChild(addRow);
    };

    renderUserRows();

    const actions = document.createElement("div");
    actions.className = "settings-dialog__actions";
    actions.appendChild(controls.saveButton(() => setPowerLevels(roomId, draft)));
    content.appendChild(actions);
  },
};
