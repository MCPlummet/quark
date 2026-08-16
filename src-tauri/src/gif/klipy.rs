use crate::gif::{self, GifProvider, GifResult};
use reqwest::Client;
use serde::Deserialize;

/// Klipy API GIF search client.
///
/// API key is embedded in the URL path: `https://api.klipy.com/api/v1/{api_key}/...`
pub struct KlipyClient {
    api_key: String,
    http: Client,
}

impl KlipyClient {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            http: Client::new(),
        }
    }
}

// Klipy API response types
#[derive(Debug, Deserialize)]
struct KlipyResponse {
    #[allow(dead_code)]
    result: bool,
    data: KlipyPage,
}

#[derive(Debug, Deserialize)]
struct KlipyPage {
    data: Vec<KlipyGif>,
}

#[derive(Debug, Deserialize)]
struct KlipyGif {
    id: serde_json::Value, // can be int or string
    title: String,
    file: KlipyFile,
}

#[derive(Debug, Deserialize)]
struct KlipyFile {
    /// High-quality GIF.
    #[serde(default)]
    hd: Option<KlipyHd>,
    /// Fallback GIF when `hd` is absent.
    #[serde(default)]
    gif: Option<KlipyGifFormat>,
    /// Small JPEG thumbnail. Deliberately unread — see `search`, which prefers
    /// the full GIF for previews so the grid animates; kept to document the shape.
    #[serde(default)]
    #[allow(dead_code)]
    xs: Option<KlipyXs>,
}

#[derive(Debug, Deserialize)]
struct KlipyHd {
    gif: KlipyGifFormat,
}

#[derive(Debug, Deserialize)]
struct KlipyGifFormat {
    url: String,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct KlipyXs {
    #[allow(dead_code)]
    jpg: KlipyJpgFormat,
}

#[derive(Debug, Deserialize)]
struct KlipyJpgFormat {
    #[allow(dead_code)]
    url: String,
}

impl GifProvider for KlipyClient {
    async fn search(
        &self,
        query: &str,
        limit: u32,
        rating: &str,
    ) -> Result<Vec<GifResult>, String> {
        let url = build_search_url(query, &self.api_key, limit, rating);

        let response = gif::fetch_response(&self.http, "Klipy", &url).await?;

        let klipy_resp: KlipyResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Klipy response: {e}"))?;

        let results: Vec<GifResult> = klipy_resp
            .data
            .data
            .into_iter()
            .filter_map(|gif| {
                let full_url = gif
                    .file
                    .hd
                    .as_ref()
                    .map(|hd| hd.gif.url.clone())
                    .or_else(|| gif.file.gif.as_ref().map(|g| g.url.clone()))?;

                let (width, height) = gif
                    .file
                    .hd
                    .as_ref()
                    .and_then(|hd| hd.gif.width.zip(hd.gif.height))
                    .or_else(|| {
                        gif.file
                            .gif
                            .as_ref()
                            .and_then(|g| g.width.zip(g.height))
                    })
                    .unwrap_or((0, 0));

                // Klipy's `xs` format is a static JPEG thumbnail — not animated.
                // Use the full GIF URL for preview so the grid shows live animation.
                let preview_url = full_url.clone();

                let id = match &gif.id {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => n.to_string(),
                    other => other.to_string(),
                };

                Some(GifResult {
                    id,
                    title: gif.title,
                    url: full_url,
                    preview_url,
                    width,
                    height,
                })
            })
            .collect();

        Ok(results)
    }
}

/// Build a Klipy search URL from parts (without making an HTTP request).
pub(crate) fn build_search_url(query: &str, api_key: &str, limit: u32, rating: &str) -> String {
    // Klipy uses the same rating values as the app (g, pg, pg-13, r).
    let klipy_rating = match rating {
        r @ ("g" | "pg" | "pg-13" | "r") => r,
        _ => "pg",
    };
    format!(
        "https://api.klipy.com/api/v1/{}/gifs/search?q={}&per_page={}&rating={}",
        api_key,
        gif::encode_query(query),
        limit,
        klipy_rating,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_search_url_simple_query() {
        let url = build_search_url("cats", "MY_KEY", 24, "pg");
        assert!(url.starts_with("https://api.klipy.com/api/v1/MY_KEY/gifs/search?"));
        assert!(url.contains("q=cats"));
        assert!(url.contains("per_page=24"));
        assert!(url.contains("rating=pg"));
    }

    #[test]
    fn test_build_search_url_spaces_encoded() {
        let url = build_search_url("funny cats", "KEY", 10, "g");
        assert!(url.contains("q=funny+cats"));
        assert!(url.contains("rating=g"));
    }

    #[test]
    fn test_build_search_url_pg13_rating() {
        let url = build_search_url("test", "KEY", 5, "pg-13");
        assert!(url.contains("rating=pg-13"));
    }

    #[test]
    fn test_build_search_url_r_rating() {
        let url = build_search_url("test", "KEY", 5, "r");
        assert!(url.contains("rating=r"));
    }

    #[test]
    fn test_build_search_url_unknown_rating_defaults_to_pg() {
        let url = build_search_url("test", "KEY", 5, "adult");
        assert!(url.contains("rating=pg"));
    }

    #[test]
    fn test_build_search_url_api_key_in_path() {
        let url = build_search_url("dogs", "SECRETKEY", 20, "pg");
        assert!(url.contains("/api/v1/SECRETKEY/gifs/search"));
    }

    #[test]
    fn test_build_search_url_special_chars_encoded() {
        let url = build_search_url("hello & world", "KEY", 5, "pg");
        assert!(url.contains("%26"));
    }

    #[test]
    fn test_encode_query_safe_chars_unchanged() {
        assert_eq!(crate::gif::encode_query("hello-world_test.~"), "hello-world_test.~");
    }

    #[test]
    fn test_encode_query_space_becomes_plus() {
        assert_eq!(crate::gif::encode_query("hello world"), "hello+world");
    }

    #[test]
    fn test_encode_query_empty() {
        assert_eq!(crate::gif::encode_query(""), "");
    }
}
