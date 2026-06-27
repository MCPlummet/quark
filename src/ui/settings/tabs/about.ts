// Settings → About tab.
//
// Shows the app version, a GitHub link, and (desktop-only) the Updates
// settings (release channel + auto-check). Satisfies #19 (About tab) and
// #20 (Updates config shown only on desktop, never on mobile).

import type { SettingsTab } from "../types.js";
import { openExternalUrl } from "../../../app/links.js";
import { getAppConfig, setAppConfig, DEFAULT_APP_CONFIG } from "../../../ipc/app_config.js";
import packageJson from "../../../../package.json";

const GITHUB_URL = "https://github.com/MCPlummet/quark";

export const aboutTab: SettingsTab = {
  id: "about",
  label: "About",
  build(ctx) {
    const { content, controls, isMobile } = ctx;
    content.appendChild(controls.sectionTitle("About"));
    content.appendChild(controls.readRow("Version", `v${packageJson.version}`));

    const linkRow = controls.dispatchButton("[ Quark on GitHub ]", "Open Quark on GitHub", () => openExternalUrl(GITHUB_URL));
    linkRow.querySelector("button")?.setAttribute("data-link", "github");
    content.appendChild(linkRow);

    if (!isMobile) {
      content.appendChild(controls.sectionTitle("Updates"));

      // Render the section synchronously with defaults so the UI is immediately
      // interactive, then patch the controls to reflect the loaded config.
      let draft = structuredClone(DEFAULT_APP_CONFIG);

      const channelRow = controls.selectRow(
        "Release channel",
        draft.updater.channel,
        [["stable", "Stable"], ["beta", "Beta (early releases)"]],
        (v) => { if (v === "stable" || v === "beta") draft = { ...draft, updater: { ...draft.updater, channel: v } }; },
      );
      content.appendChild(channelRow);

      const autoCheckRow = controls.checkbox(
        "Check for updates automatically",
        draft.updater.auto_check,
        (v) => { draft = { ...draft, updater: { ...draft.updater, auto_check: v } }; },
      );
      content.appendChild(autoCheckRow);

      content.appendChild(controls.saveButton(() => setAppConfig(draft)));

      // Load actual persisted config and sync the draft + controls.
      void getAppConfig().then((cfg) => {
        draft = structuredClone(cfg);
        const sel = channelRow.querySelector("select") as HTMLSelectElement | null;
        if (sel) sel.value = cfg.updater.channel;
        const cb = autoCheckRow.querySelector("input") as HTMLInputElement | null;
        if (cb) cb.checked = cfg.updater.auto_check;
      });
    }
  },
};
