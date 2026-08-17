// Room Settings Dialog — General, Access, Permissions tabs

import { AppState } from "../app/state.js";
import type { RoomInfo } from "../ipc/types.js";
import type { PowerLevels } from "../ipc/room_settings.js";
import {
  getPowerLevels,
  setPowerLevels,
  setRoomName,
  setRoomTopic,
  setRoomJoinRule,
  setRoomHistoryVisibility,
} from "../ipc/room_settings.js";
import { DialogBase } from "./DialogBase.js";
import { applyLocalRoomMeta, setRoomDirectness } from "../app/actions.js";

type RoomSettingsTab = "general" | "access" | "permissions";

export class RoomSettingsDialog extends DialogBase {
  private _panelEl: HTMLElement;
  private _contentEl: HTMLElement;
  private _activeTab: RoomSettingsTab = "general";
  private _tabEls: Record<RoomSettingsTab, HTMLElement> = {} as Record<RoomSettingsTab, HTMLElement>;

  constructor() {
    // Spaces and rooms share the `settings-dialog` styling.
    super({ prefix: "settings-dialog", ariaLabel: "Room Settings" });
    this._panelEl = this.content;

    // Header
    this.buildHeader("── room settings ──", "Close room settings");

    // Tabs
    const tabs = document.createElement("div");
    tabs.className = "settings-dialog__tabs";
    tabs.setAttribute("role", "tablist");
    this._tabEls.general = this._makeTab("General", "general", tabs);
    this._tabEls.access = this._makeTab("Access", "access", tabs);
    this._tabEls.permissions = this._makeTab("Permissions", "permissions", tabs);
    this._panelEl.appendChild(tabs);

    // Content
    this._contentEl = document.createElement("div");
    this._contentEl.className = "settings-dialog__content";
    this._panelEl.appendChild(this._contentEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "settings-dialog__footer";
    footer.textContent = "Tab switch section · Esc close";
    footer.setAttribute("aria-hidden", "true");
    this._panelEl.appendChild(footer);
  }

  async show(): Promise<void> {
    this.reveal();
    await this._switchTab("general");
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _makeTab(label: string, tab: RoomSettingsTab, parent: HTMLElement): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__tab";
    btn.textContent = label;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => void this._switchTab(tab));
    parent.appendChild(btn);
    return btn;
  }

  private async _switchTab(tab: RoomSettingsTab): Promise<void> {
    this._activeTab = tab;
    for (const [key, el] of Object.entries(this._tabEls)) {
      if (key === tab) {
        el.classList.add("settings-dialog__tab--active");
        el.setAttribute("aria-selected", "true");
      } else {
        el.classList.remove("settings-dialog__tab--active");
        el.setAttribute("aria-selected", "false");
      }
    }
    this._contentEl.innerHTML = "";
    switch (tab) {
      case "general": await this._buildGeneralTab(); break;
      case "access": await this._buildAccessTab(); break;
      case "permissions": await this._buildPermissionsTab(); break;
    }
  }

  // ── Shared helpers (re-use SettingsDialog patterns) ──────────────────────────

  private _makeSection(): HTMLElement {
    const s = document.createElement("div");
    s.className = "settings-dialog__section";
    this._contentEl.appendChild(s);
    return s;
  }

  private _makeTitle(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "settings-dialog__section-title";
    el.textContent = text;
    return el;
  }

  // The following row builders delegate to DialogBase but keep the
  // section-appending signatures the tab builders rely on.

  private _makeTextRow(
    section: HTMLElement,
    label: string,
    value: string,
    placeholder: string,
    onChange: (v: string) => void,
  ): HTMLInputElement {
    const { row, input } = this.makeTextRow(label, value, placeholder, onChange, "room-settings-dialog__wide-input");
    section.appendChild(row);
    return input;
  }

  private _makeSelectRow(
    section: HTMLElement,
    label: string,
    value: string,
    options: [string, string][],
    onChange: (v: string) => void,
  ): void {
    section.appendChild(this.makeSelectRow(label, value, options, onChange));
  }

  private _makeNumberRow(
    section: HTMLElement,
    label: string,
    value: number,
    onChange: (v: number) => void,
  ): void {
    section.appendChild(this.makeNumberRow(label, value, onChange, { min: -100, max: 100, step: 10 }));
  }

  private _makeSaveButton(label: string, onClick: () => Promise<void>): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__btn";
    btn.textContent = `[${label}]`;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "[saving...]";
      try {
        await onClick();
        btn.textContent = "[saved!]";
      } catch (err) {
        btn.textContent = "[error]";
        console.error("Room settings save error:", err);
      }
      setTimeout(() => {
        btn.textContent = `[${label}]`;
        btn.disabled = false;
      }, 2000);
    });
    return btn;
  }

  private _currentRoom(): RoomInfo | undefined {
    const state = AppState.snapshot;
    return state.roomListCache.find((r) => r.room_id === state.currentRoomId);
  }

  private _currentRoomId(): string | null {
    return AppState.snapshot.currentRoomId;
  }

  // ── General tab ───────────────────────────────────────────────────────────────

  private async _buildGeneralTab(): Promise<void> {
    const room = this._currentRoom();
    const roomId = this._currentRoomId();
    if (!roomId) {
      this._makeSection().appendChild(this._makeTitle("No room selected."));
      return;
    }

    const section = this._makeSection();
    section.appendChild(this._makeTitle("Identity"));

    let draft = { name: room?.name ?? "", topic: room?.topic ?? "" };

    this._makeTextRow(section, "name", draft.name, "Room name", (v) => { draft = { ...draft, name: v }; });
    this._makeTextRow(section, "topic", draft.topic, "Room topic", (v) => { draft = { ...draft, topic: v }; });

    const infoSection = this._makeSection();
    infoSection.appendChild(this._makeTitle("Room Info"));
    const addInfo = (label: string, value: string): HTMLElement => {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const lbl = document.createElement("span");
      lbl.className = "settings-dialog__label";
      lbl.textContent = label;
      const val = document.createElement("span");
      val.className = "settings-dialog__value settings-dialog__value--muted";
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      infoSection.appendChild(row);
      return val;
    };
    addInfo("room id", roomId);
    addInfo("members", String(room?.member_count ?? "?"));
    addInfo("encrypted", room?.is_encrypted ? "yes" : "no");
    const directValueEl = addInfo("direct", room?.is_direct ? "yes" : "no");

    this._buildConversionSection(roomId, room?.is_direct ?? false, directValueEl);

    const actions = this._makeSection();
    actions.className += " settings-dialog__actions";
    actions.appendChild(this._makeSaveButton("save", async () => {
      const tasks: Promise<void>[] = [];
      if (draft.name !== (room?.name ?? "")) {
        tasks.push(setRoomName(roomId, draft.name));
      }
      if (draft.topic !== (room?.topic ?? "")) {
        tasks.push(setRoomTopic(roomId, draft.topic));
      }
      await Promise.all(tasks);
      // Reflect the change in the cache + header immediately (don't wait for the
      // next sync round-trip).
      if (tasks.length > 0) {
        applyLocalRoomMeta(roomId, { name: draft.name, topic: draft.topic });
      }
    }));
  }

  /**
   * "Conversation Type" — the `:converttodm` / `:converttoroom` pair as a single
   * contextual button, since only one of the two ever applies to a given room.
   * Updates in place (label, hint, and the "direct" info row) rather than
   * rebuilding the tab, so the button keeps focus across a conversion.
   */
  private _buildConversionSection(
    roomId: string,
    initialIsDirect: boolean,
    directValueEl: HTMLElement,
  ): void {
    const section = this._makeSection();
    section.appendChild(this._makeTitle("Conversation Type"));

    let isDirect = initialIsDirect;

    const hint = document.createElement("div");
    hint.className = "settings-dialog__hint";
    section.appendChild(hint);

    const row = document.createElement("div");
    row.className = "settings-dialog__row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__btn";
    row.appendChild(btn);
    section.appendChild(row);

    const render = (): void => {
      hint.textContent = isDirect
        ? "Listed under Direct Messages. Converting back files it under Group Rooms."
        : "Listed under Group Rooms. Converting marks it a DM with the other members.";
      btn.textContent = isDirect ? "[convert to room]" : "[convert to dm]";
      directValueEl.textContent = isDirect ? "yes" : "no";
    };
    render();

    btn.addEventListener("click", async () => {
      const target = !isDirect;
      btn.disabled = true;
      btn.textContent = target ? "[converting to dm...]" : "[converting to room...]";
      try {
        isDirect = await setRoomDirectness(roomId, target);
        render();
      } catch (err) {
        btn.textContent = "[error]";
        console.error("Room conversion error:", err);
        setTimeout(render, 2000);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ── Access tab ────────────────────────────────────────────────────────────────

  private async _buildAccessTab(): Promise<void> {
    const roomId = this._currentRoomId();
    if (!roomId) {
      this._makeSection().appendChild(this._makeTitle("No room selected."));
      return;
    }

    const section = this._makeSection();
    section.appendChild(this._makeTitle("Joining"));

    let joinRule = "invite";
    let historyVis = "shared";

    this._makeSelectRow(section, "join rule", joinRule,
      [
        ["public",  "Public — anyone can join"],
        ["invite",  "Invite — require invitation"],
        ["knock",   "Knock — users request to join"],
        ["private", "Private — closed"],
      ],
      (v) => { joinRule = v; },
    );

    const histSection = this._makeSection();
    histSection.appendChild(this._makeTitle("History Visibility"));

    this._makeSelectRow(histSection, "history", historyVis,
      [
        ["world_readable", "World readable — anyone can read"],
        ["shared",         "Shared — visible since join"],
        ["invited",        "Invited — visible since invite"],
        ["joined",         "Joined — visible since join"],
      ],
      (v) => { historyVis = v; },
    );

    const note = document.createElement("div");
    note.className = "settings-dialog__row";
    note.style.fontSize = "calc(var(--font-size) - 2px)";
    note.style.color = "var(--roomlist-muted)";
    note.textContent = "Note: current state not shown — values reflect defaults until fetched.";
    histSection.appendChild(note);

    const actions = this._makeSection();
    actions.className += " settings-dialog__actions";
    actions.appendChild(this._makeSaveButton("save", async () => {
      await Promise.all([
        setRoomJoinRule(roomId, joinRule),
        setRoomHistoryVisibility(roomId, historyVis),
      ]);
    }));
  }

  // ── Permissions tab ───────────────────────────────────────────────────────────

  private async _buildPermissionsTab(): Promise<void> {
    const roomId = this._currentRoomId();
    if (!roomId) {
      this._makeSection().appendChild(this._makeTitle("No room selected."));
      return;
    }

    const loadingSection = this._makeSection();
    const loadingEl = document.createElement("div");
    loadingEl.className = "settings-dialog__row";
    loadingEl.textContent = "Loading power levels…";
    loadingSection.appendChild(loadingEl);

    let pl: PowerLevels;
    try {
      pl = await getPowerLevels(roomId);
    } catch (err) {
      loadingEl.textContent = `Failed to load power levels: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    loadingSection.innerHTML = "";
    loadingSection.appendChild(this._makeTitle("Default Levels"));

    let draft: PowerLevels = { ...pl, events: { ...pl.events }, users: { ...pl.users } };

    this._makeNumberRow(loadingSection, "events default", draft.events_default, (v) => { draft = { ...draft, events_default: v }; });
    this._makeNumberRow(loadingSection, "state default", draft.state_default, (v) => { draft = { ...draft, state_default: v }; });
    this._makeNumberRow(loadingSection, "users default", draft.users_default, (v) => { draft = { ...draft, users_default: v }; });

    const modSection = this._makeSection();
    modSection.appendChild(this._makeTitle("Moderation Levels"));
    this._makeNumberRow(modSection, "kick", draft.kick, (v) => { draft = { ...draft, kick: v }; });
    this._makeNumberRow(modSection, "ban", draft.ban, (v) => { draft = { ...draft, ban: v }; });
    this._makeNumberRow(modSection, "invite", draft.invite, (v) => { draft = { ...draft, invite: v }; });
    this._makeNumberRow(modSection, "redact", draft.redact, (v) => { draft = { ...draft, redact: v }; });

    // Per-user overrides
    const userSection = this._makeSection();
    userSection.appendChild(this._makeTitle("User Overrides"));

    const renderUserRows = (): void => {
      // Remove old rows (keep the title)
      while (userSection.children.length > 1) {
        userSection.removeChild(userSection.lastChild!);
      }
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
        removeBtn.addEventListener("click", () => {
          const users = { ...draft.users };
          delete users[userId];
          draft = { ...draft, users };
          renderUserRows();
        });
        row.appendChild(uidEl);
        row.appendChild(levelInput);
        row.appendChild(removeBtn);
        userSection.appendChild(row);
      }

      // Add-user row
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
      addBtn.addEventListener("click", () => {
        const uid = addInput.value.trim();
        const level = parseInt(addLevelInput.value, 10);
        if (!uid || isNaN(level)) return;
        draft = { ...draft, users: { ...draft.users, [uid]: level } };
        addInput.value = "";
        renderUserRows();
      });
      addRow.appendChild(addInput);
      addRow.appendChild(addLevelInput);
      addRow.appendChild(addBtn);
      userSection.appendChild(addRow);
    };

    renderUserRows();

    const actions = this._makeSection();
    actions.className += " settings-dialog__actions";
    actions.appendChild(this._makeSaveButton("save", () => setPowerLevels(roomId, draft)));
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────────

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const tabs: RoomSettingsTab[] = ["general", "access", "permissions"];
      const idx = tabs.indexOf(this._activeTab);
      void this._switchTab(tabs[(idx + 1) % tabs.length]);
      return;
    }

    if (this.isEscape(e)) {
      e.preventDefault();
      this.hide();
      return;
    }

    this.routeKey(e);
  }
}
