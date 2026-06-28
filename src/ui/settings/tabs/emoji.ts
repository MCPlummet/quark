// Settings → Emoji tab.
//
// :shortcode autocomplete toggle and trigger threshold. Migrated from
// SettingsDialog._buildEmojiTab; behaviour is unchanged.

import { getAppConfig, setAppConfig } from "../../../ipc/app_config.js";
import type { AppConfig } from "../../../ipc/app_config.js";
import type { SettingsTab } from "../types.js";

export const emojiTab: SettingsTab = {
  id: "emoji",
  label: "Emoji",
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
    section.appendChild(controls.sectionTitle("Emoji Autocomplete"));

    let draft = structuredClone(cfg);

    section.appendChild(controls.checkbox(
      "Enable :shortcode autocomplete",
      draft.emoji.shortcode_autocomplete,
      (v) => { draft = { ...draft, emoji: { ...draft.emoji, shortcode_autocomplete: v } }; },
    ));

    section.appendChild(controls.numberRow(
      "Min chars to trigger autocomplete",
      draft.emoji.autocomplete_min_chars,
      1, 10,
      (v) => { draft = { ...draft, emoji: { ...draft.emoji, autocomplete_min_chars: v } }; },
    ));

    const actions = document.createElement("div");
    actions.className = "settings-dialog__actions";
    actions.appendChild(controls.saveButton(() => setAppConfig(draft)));
    content.appendChild(actions);
  },
};
