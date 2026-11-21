// Settings → Emoji → Favorite packs (#12): the room packs listed in
// im.ponies.emote_rooms, usable in every room. A pack is favorited from its
// room's (or space's) Emoji tab; this list is where they are all seen and
// removed — including those of rooms the account has since left.

import { getFavoritePacks, setPackFavorite } from "../../ipc/index.js";
import type { FavoritePack } from "../../ipc/types.js";
import { customEmojiImage, invalidateCustomEmoji } from "../../app/actions/custom_emoji.js";
import { resolveEmojiThumbnail } from "../../app/actions/context.js";
import { errorText, statusLine } from "../settings/commit_field.js";

const EMPTY_TEXT = "No favorite packs. Open a room's Emoji tab and tick \"use in every room\" to add one.";

function row(fav: FavoritePack, onRemoved: () => void, status: ReturnType<typeof statusLine>): HTMLElement {
  const el = document.createElement("div");
  el.className = "settings-dialog__row favorite-packs__row";

  if (fav.avatar_url) {
    const icon = document.createElement("img");
    icon.className = "favorite-packs__icon";
    icon.alt = "";
    const now = customEmojiImage(fav.avatar_url);
    if (now) icon.src = now;
    else void resolveEmojiThumbnail(fav.avatar_url).then((src) => { if (src) icon.src = src; });
    el.appendChild(icon);
  }

  const name = document.createElement("span");
  name.className = "settings-dialog__value favorite-packs__name";
  name.textContent = fav.display_name ?? (fav.state_key || "pack");
  el.appendChild(name);

  const where = document.createElement("span");
  where.className = "settings-dialog__value--muted favorite-packs__where";
  const place = fav.room_name ?? fav.room_id;
  where.textContent = fav.joined
    ? `in ${place} · ${fav.image_count} image${fav.image_count === 1 ? "" : "s"}`
    : `in ${place} · not joined`;
  el.appendChild(where);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "settings-dialog__btn favorite-packs__remove";
  remove.textContent = "[remove]";
  remove.setAttribute("aria-label", `Remove ${name.textContent} from favorites`);
  remove.addEventListener("click", () => {
    remove.disabled = true;
    setPackFavorite(fav.room_id, fav.state_key, false)
      .then(() => {
        el.remove();
        invalidateCustomEmoji();
        onRemoved();
      })
      .catch((err) => {
        remove.disabled = false;
        status.set("error", errorText(err));
      });
  });
  el.appendChild(remove);
  return el;
}

/** The favorite packs section's body: one row per favorite, or how to add one. */
export async function favoritesSection(onChange?: () => void): Promise<HTMLElement> {
  const body = document.createElement("div");
  body.className = "favorite-packs";
  const status = statusLine();

  let favorites: FavoritePack[];
  try {
    favorites = await getFavoritePacks();
  } catch (err) {
    body.textContent = `Failed to load favorites: ${errorText(err)}`;
    return body;
  }

  const empty = document.createElement("div");
  empty.className = "settings-dialog__hint";
  empty.textContent = EMPTY_TEXT;
  const showEmptyIfNone = (): void => {
    if (!body.querySelector(".favorite-packs__row")) body.prepend(empty);
  };

  for (const fav of favorites) {
    body.appendChild(row(fav, () => {
      showEmptyIfNone();
      onChange?.();
    }, status));
  }
  body.appendChild(status.el);
  showEmptyIfNone();
  return body;
}
