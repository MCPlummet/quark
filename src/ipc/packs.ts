// Emoji/sticker pack management IPC (#12) — matches the commands in
// src-tauri/src/commands.rs ("Pack Management Commands"). Each edit re-reads
// the pack from the server and returns it as written.

import { invoke } from "./invoke.js";
import type {
  AddImagesResult,
  EditablePack,
  FavoritePack,
  MetaPatch,
  NewPackImage,
  PackLocation,
  PackUsage,
  RoomPacks,
} from "./types.js";

/** The account's personal pack (im.ponies.user_emotes). */
export async function getUserPack(): Promise<EditablePack> {
  return invoke<EditablePack>("get_user_pack");
}

/** A room's (or space's) packs, and whether the account may edit them. */
export async function getRoomPacks(roomId: string): Promise<RoomPacks> {
  return invoke<RoomPacks>("get_room_packs", { roomId });
}

/** The room packs listed in im.ponies.emote_rooms. */
export async function getFavoritePacks(): Promise<FavoritePack[]> {
  return invoke<FavoritePack[]>("get_favorite_packs");
}

/** Upload an image for a pack (unencrypted); resolves to its mxc:// URL. */
export async function uploadPackMedia(dataBase64: string, mimetype: string): Promise<string> {
  return invoke<string>("upload_pack_media", { dataBase64, mimetype });
}

export async function addPackImages(location: PackLocation, images: NewPackImage[]): Promise<AddImagesResult> {
  return invoke<AddImagesResult>("add_pack_images", { location, images });
}

export async function renamePackImage(location: PackLocation, from: string, to: string): Promise<EditablePack> {
  return invoke<EditablePack>("rename_pack_image", { location, from, to });
}

/** `null` removes the image's own usage, so it inherits the pack's. */
export async function setPackImageUsage(
  location: PackLocation,
  shortcode: string,
  usage: PackUsage[] | null,
): Promise<EditablePack> {
  return invoke<EditablePack>("set_pack_image_usage", { location, shortcode, usage });
}

/** `null` or "" removes the description. */
export async function setPackImageBody(location: PackLocation, shortcode: string, body: string | null): Promise<EditablePack> {
  return invoke<EditablePack>("set_pack_image_body", { location, shortcode, body });
}

export async function removePackImage(location: PackLocation, shortcode: string): Promise<EditablePack> {
  return invoke<EditablePack>("remove_pack_image", { location, shortcode });
}

export async function setPackMeta(location: PackLocation, patch: MetaPatch): Promise<EditablePack> {
  return invoke<EditablePack>("set_pack_meta", { location, patch });
}

export async function createRoomPack(roomId: string, displayName: string): Promise<EditablePack> {
  return invoke<EditablePack>("create_room_pack", { roomId, displayName });
}

/**
 * Empties the pack (state can't be removed) and drops it from favorites.
 * Resolves once the pack is emptied, even if dropping the favorite failed
 * (the backend logs that; the favorite stays listed in Settings → Emoji).
 */
export async function deleteRoomPack(roomId: string, stateKey: string): Promise<void> {
  return invoke<void>("delete_room_pack", { roomId, stateKey });
}

export async function setPackFavorite(roomId: string, stateKey: string, favorite: boolean): Promise<void> {
  return invoke<void>("set_pack_favorite", { roomId, stateKey, favorite });
}
