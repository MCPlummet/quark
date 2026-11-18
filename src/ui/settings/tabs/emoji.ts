// Settings → Emoji tab.
//
// :shortcode autocomplete toggle and trigger threshold, then the account's own
// emoji/sticker pack and its favorite packs (#12). Room and space packs are
// managed from their own Emoji tab; favoriting one there lists it here.

import { getAppConfig, setAppConfig } from "../../../ipc/app_config.js";
import type { AppConfig } from "../../../ipc/app_config.js";
import { getUserPack } from "../../../ipc/index.js";
import type { SettingsTab } from "../types.js";
import { PackEditor } from "../../packs/PackEditor.js";
import { favoritesSection } from "../../packs/favorites.js";
import { errorText } from "../commit_field.js";

async function userPackSection(section: HTMLElement): Promise<void> {
  const hint = document.createElement("div");
  hint.className = "settings-dialog__hint settings-dialog__hint--lead";
  hint.textContent =
    "Usable in every room. One personal pack per account — for more, keep packs in a private room and add them to favorites.";
  section.appendChild(hint);
  try {
    const pack = await getUserPack();
    section.appendChild(new PackEditor({
      location: { kind: "user" },
      pack,
      canEdit: true,
      favoritable: false,
    }).getElement());
  } catch (err) {
    const msg = document.createElement("div");
    msg.className = "settings-dialog__row";
    msg.textContent = `Failed to load your pack: ${errorText(err)}`;
    section.appendChild(msg);
  }
}

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

    // The [save] belongs to the autocomplete settings alone, so it sits under
    // them; the pack sections below save each field as it changes.
    const actions = document.createElement("div");
    actions.className = "settings-dialog__actions";
    actions.appendChild(controls.saveButton(() => setAppConfig(draft)));
    section.appendChild(actions);

    const mine = document.createElement("div");
    mine.className = "settings-dialog__section emoji-settings__user-pack";
    mine.appendChild(controls.sectionTitle("Your pack"));
    content.appendChild(mine);

    const favs = document.createElement("div");
    favs.className = "settings-dialog__section emoji-settings__favorites";
    favs.appendChild(controls.sectionTitle("Favorite packs"));
    content.appendChild(favs);

    await Promise.all([
      userPackSection(mine),
      favoritesSection().then((body) => { favs.appendChild(body); }),
    ]);
  },
};
