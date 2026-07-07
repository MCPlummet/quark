// Settings → GIF tab.
//
// Provider selection, API key, content rating, and result caching. Migrated
// from SettingsDialog._buildGifTab; behaviour is unchanged.

import { getAppConfig, setAppConfig } from "../../../ipc/app_config.js";
import type { AppConfig } from "../../../ipc/app_config.js";
import type { SettingsTab } from "../types.js";

export const gifTab: SettingsTab = {
  id: "gif",
  label: "GIF",
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
    section.appendChild(controls.sectionTitle("GIF Provider"));

    let draft = structuredClone(cfg);

    section.appendChild(controls.selectRow(
      "Provider",
      draft.gif.provider,
      [["tenor", "Tenor"], ["giphy", "Giphy"], ["klipy", "Klipy"]],
      (v) => { draft = { ...draft, gif: { ...draft.gif, provider: v as "tenor" | "giphy" | "klipy" } }; },
    ));

    section.appendChild(controls.textRow(
      "API key",
      draft.gif.api_key,
      "paste your API key here",
      (v) => { draft = { ...draft, gif: { ...draft.gif, api_key: v } }; },
    ));

    section.appendChild(controls.selectRow(
      "Content rating",
      draft.gif.rating,
      [["g", "G"], ["pg", "PG"], ["pg-13", "PG-13"], ["r", "R"]],
      (v) => { draft = { ...draft, gif: { ...draft.gif, rating: v as "g" | "pg" | "pg-13" | "r" } }; },
    ));

    section.appendChild(controls.checkbox(
      "Cache search results",
      draft.gif.cache_results,
      (v) => { draft = { ...draft, gif: { ...draft.gif, cache_results: v } }; },
    ));

    const actions = document.createElement("div");
    actions.className = "settings-dialog__actions";
    actions.appendChild(controls.saveButton(() => setAppConfig(draft)));
    content.appendChild(actions);
  },
};
