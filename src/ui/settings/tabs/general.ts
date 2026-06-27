// Settings → General tab.
//
// Confirm-redact, input (vim mode + Enter key), appearance, home, sync, read
// receipts, help, security, and updates. Migrated from
// SettingsDialog._buildGeneralTab; behaviour is unchanged — the host now drives
// it through SettingsTabContext (controls/close/dispatch) instead of `this`.

import { getAppConfig, setAppConfig } from "../../../ipc/app_config.js";
import type { AppConfig } from "../../../ipc/app_config.js";
import { applyReadReceiptVisibility } from "../../../app/actions.js";
import { AppState } from "../../../app/state.js";
import type { SettingsTab } from "../types.js";

export const generalTab: SettingsTab = {
  id: "general",
  label: "General",
  async build(ctx) {
    const { content, controls } = ctx;
    const { section, loading } = controls.loadingSection(content);

    let cfg: AppConfig;
    try {
      cfg = await getAppConfig();
    } catch {
      loading.textContent = "Failed to load config.";
      return;
    }

    section.innerHTML = "";
    section.appendChild(controls.sectionTitle("General"));

    let draft = structuredClone(cfg);

    section.appendChild(controls.checkbox(
      "Confirm before redacting messages",
      draft.general.confirm_redact,
      (v) => { draft = { ...draft, general: { ...draft.general, confirm_redact: v } }; },
    ));

    section.appendChild(controls.sectionTitle("Input"));

    section.appendChild(controls.checkbox(
      "Vim mode (modal editing with Normal/Insert/Command modes)",
      draft.general.vim_mode,
      (v) => { draft = { ...draft, general: { ...draft.general, vim_mode: v } }; },
    ));

    section.appendChild(controls.selectRow(
      "Enter key",
      draft.general.send_key_behavior,
      [
        ["auto", "Automatic (sends on desktop, newline on mobile)"],
        ["enter", "Sends the message (Shift+Enter for a newline)"],
        ["newline", "Inserts a newline (send button / Ctrl+Enter)"],
      ],
      (v) => {
        if (v === "auto" || v === "enter" || v === "newline") {
          draft = { ...draft, general: { ...draft.general, send_key_behavior: v } };
        }
      },
    ));

    section.appendChild(controls.sectionTitle("Appearance"));

    section.appendChild(controls.selectRow(
      "Icon shape",
      draft.general.icon_radius ?? "50%",
      [
        ["50%", "Circle"],
        ["8px", "Rounded square"],
        ["0", "Square"],
      ],
      (v) => {
        draft = { ...draft, general: { ...draft.general, icon_radius: v } };
        document.documentElement.style.setProperty("--icon-radius", v);
      },
    ));

    section.appendChild(controls.sectionTitle("Home"));

    section.appendChild(controls.numberRow(
      "Chats on the Home canvas",
      draft.home.dm_limit,
      1, 50,
      (v) => { draft = { ...draft, home: { ...draft.home, dm_limit: v } }; },
    ));

    section.appendChild(controls.sectionTitle("Sync"));

    section.appendChild(controls.checkbox(
      "Use Sliding Sync (MSC4186)",
      draft.sync.sliding_sync,
      (v) => { draft = { ...draft, sync: { ...draft.sync, sliding_sync: v } }; },
    ));

    section.appendChild(controls.numberRow(
      "Timeline messages to load",
      draft.sync.timeline_limit,
      10, 500,
      (v) => { draft = { ...draft, sync: { ...draft.sync, timeline_limit: v } }; },
    ));

    section.appendChild(controls.sectionTitle("Read receipts"));

    section.appendChild(controls.checkbox(
      "Send my read receipts (others see how far you've read)",
      draft.general.send_read_receipts,
      (v) => { draft = { ...draft, general: { ...draft.general, send_read_receipts: v } }; },
    ));

    section.appendChild(controls.checkbox(
      "Show others' read receipts in the timeline",
      draft.general.show_read_receipts,
      (v) => { draft = { ...draft, general: { ...draft.general, show_read_receipts: v } }; },
    ));

    section.appendChild(controls.checkbox(
      "Prompt to verify this session on startup (when unverified)",
      draft.general.prompt_session_verification,
      (v) => { draft = { ...draft, general: { ...draft.general, prompt_session_verification: v } }; },
    ));

    // Help — the keybindings/help screen is otherwise only reachable via `?`
    // or `:help`, which mouse/touch users can't discover. Surface it here.
    section.appendChild(controls.sectionTitle("Help"));
    section.appendChild(controls.dispatchButton(
      "[keybindings & help]",
      "Open keybindings and help",
      () => {
        // One overlay at a time: close settings, then open the help dialog.
        ctx.close();
        ctx.dispatch("help");
      },
    ));

    // Security — device verification and cross-signing are otherwise only
    // reachable via `:verify` / `:cross-sign`, which non-vim users can't find.
    section.appendChild(controls.sectionTitle("Security"));
    const dispatchAndClose = (action: string) => () => {
      // One overlay at a time: close settings before the flow takes over.
      ctx.close();
      ctx.dispatch(action);
    };
    section.appendChild(controls.dispatchButton("[verify a session]", "Verify one of your sessions", dispatchAndClose("verify-session")));
    section.appendChild(controls.dispatchButton("[set up cross-signing]", "Set up cross-signing", dispatchAndClose("setup-cross-signing")));

    const actions = document.createElement("div");
    actions.className = "settings-dialog__section settings-dialog__actions";
    actions.appendChild(controls.saveButton(async () => {
      await setAppConfig(draft);
      // Apply runtime-visible changes immediately (the vim-mode state listener
      // drives editor behaviour; read-receipt visibility re-seeds/clears here).
      AppState.set("vimMode", draft.general.vim_mode);
      AppState.set("sendKeyBehavior", draft.general.send_key_behavior);
      const receiptsChanged = draft.general.show_read_receipts !== cfg.general.show_read_receipts;
      AppState.set("showReadReceipts", draft.general.show_read_receipts);
      if (receiptsChanged) void applyReadReceiptVisibility();
    }));
    section.appendChild(actions);
  },
};
