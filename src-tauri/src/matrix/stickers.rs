use crate::matrix::emoji::{get_emoji_packs, EmojiPack};
use crate::matrix::relations::SendTarget;
use matrix_sdk::{
    ruma::{
        events::sticker::StickerEventContent,
        RoomId,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use tracing::info;

/// A sticker entry derived from an emoji pack with sticker usage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickerInfo {
    pub shortcode: String,
    pub url: String,
    pub body: Option<String>,
    pub pack_id: String,
    pub pack_name: Option<String>,
}

/// Get all sticker packs (packs containing at least one sticker-usage emoji).
pub async fn get_sticker_packs(
    client: &Client,
    room_id: Option<&str>,
) -> Result<Vec<EmojiPack>, String> {
    let all_packs = get_emoji_packs(client, room_id).await?;

    // Filter packs to only those with sticker usage
    let sticker_packs: Vec<EmojiPack> = all_packs
        .into_iter()
        .map(|mut pack| {
            pack.emojis.retain(|e| e.usage.iter().any(|u| u == "sticker"));
            pack
        })
        .filter(|pack| !pack.emojis.is_empty())
        .collect();

    Ok(sticker_packs)
}

/// Flatten sticker packs into a simple list of StickerInfo.
pub async fn list_stickers(
    client: &Client,
    room_id: Option<&str>,
) -> Result<Vec<StickerInfo>, String> {
    let packs = get_sticker_packs(client, room_id).await?;
    let mut stickers = Vec::new();

    for pack in packs {
        for emoji in pack.emojis {
            stickers.push(StickerInfo {
                shortcode: emoji.shortcode,
                url: emoji.url,
                body: emoji.body,
                pack_id: pack.pack_id.clone(),
                pack_name: pack.display_name.clone(),
            });
        }
    }

    Ok(stickers)
}

/// Send a sticker event to a room, optionally into a thread or as a reply.
///
/// Stickers took no target at all until #78, so one sent with a thread open
/// landed in the main timeline — the same defect as images, one event type over.
pub async fn send_sticker(
    client: &Client,
    room_id: &str,
    sticker: &StickerInfo,
    target: SendTarget<'_>,
) -> Result<String, String> {
    use matrix_sdk::ruma::MxcUri;

    let room_id_parsed = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id_parsed)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mxc_uri = <&MxcUri>::try_from(sticker.url.as_str())
        .map_err(|e| format!("Invalid mxc URI: {e}"))?;

    let image_info = matrix_sdk::ruma::events::room::ImageInfo::new();

    let mut sticker_content = StickerEventContent::new(
        sticker.body.clone().unwrap_or_else(|| sticker.shortcode.clone()),
        image_info,
        mxc_uri.to_owned(),
    );
    sticker_content.relates_to = target.relation()?;

    let response = room
        .send(sticker_content)
        .await
        .map_err(|e| format!("Failed to send sticker: {e}"))?;

    let event_id = response.event_id.to_string();
    info!(event_id = %event_id, sticker = %sticker.shortcode, "Sticker sent");
    Ok(event_id)
}
