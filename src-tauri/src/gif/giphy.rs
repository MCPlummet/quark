use crate::gif::{self, GifProvider, GifResult};
use reqwest::Client;
use serde::Deserialize;

/// Giphy API GIF search client.
pub struct GiphyClient {
    api_key: String,
    http: Client,
}

impl GiphyClient {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            http: Client::new(),
        }
    }
}

// Giphy API response types
#[derive(Debug, Deserialize)]
struct GiphyResponse {
    data: Vec<GiphyGif>,
}

#[derive(Debug, Deserialize)]
struct GiphyGif {
    id: String,
    title: String,
    images: GiphyImages,
}

#[derive(Debug, Deserialize)]
struct GiphyImages {
    original: GiphyImage,
    fixed_width_small: GiphyImage,
}

#[derive(Debug, Deserialize)]
struct GiphyImage {
    url: String,
    #[serde(default)]
    width: String,
    #[serde(default)]
    height: String,
}

impl GifProvider for GiphyClient {
    async fn search(
        &self,
        query: &str,
        limit: u32,
        rating: &str,
    ) -> Result<Vec<GifResult>, String> {
        let url = build_search_url(query, &self.api_key, limit, rating);

        let response = gif::fetch_response(&self.http, "Giphy", &url).await?;

        let giphy_resp: GiphyResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Giphy response: {e}"))?;

        let results: Vec<GifResult> = giphy_resp
            .data
            .into_iter()
            .map(|gif| {
                let width: u32 = gif.images.original.width.parse().unwrap_or(0);
                let height: u32 = gif.images.original.height.parse().unwrap_or(0);

                GifResult {
                    id: gif.id,
                    title: gif.title,
                    url: gif.images.original.url,
                    preview_url: gif.images.fixed_width_small.url,
                    width,
                    height,
                }
            })
            .collect();

        Ok(results)
    }
}

/// Map a generic rating string to Giphy's rating parameter.
pub(crate) fn rating_to_giphy_rating(rating: &str) -> &'static str {
    match rating {
        "pg-13" => "pg-13",
        "g" => "g",
        "pg" => "pg",
        "r" => "r",
        _ => "pg",
    }
}

/// Build a Giphy search URL from parts (without making an HTTP request).
pub(crate) fn build_search_url(query: &str, api_key: &str, limit: u32, rating: &str) -> String {
    let giphy_rating = rating_to_giphy_rating(rating);
    format!(
        "https://api.giphy.com/v1/gifs/search?q={}&api_key={}&limit={}&rating={}",
        gif::encode_query(query),
        api_key,
        limit,
        giphy_rating,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Rating mapping ---

    #[test]
    fn test_rating_g_passthrough() {
        assert_eq!(rating_to_giphy_rating("g"), "g");
    }

    #[test]
    fn test_rating_pg_passthrough() {
        assert_eq!(rating_to_giphy_rating("pg"), "pg");
    }

    #[test]
    fn test_rating_pg13_passthrough() {
        assert_eq!(rating_to_giphy_rating("pg-13"), "pg-13");
    }

    #[test]
    fn test_rating_r_passthrough() {
        assert_eq!(rating_to_giphy_rating("r"), "r");
    }

    #[test]
    fn test_unknown_rating_defaults_to_pg() {
        assert_eq!(rating_to_giphy_rating("x"), "pg");
        assert_eq!(rating_to_giphy_rating(""), "pg");
        assert_eq!(rating_to_giphy_rating("adult"), "pg");
    }

    // --- URL construction ---

    #[test]
    fn test_build_search_url_simple_query() {
        let url = build_search_url("cats", "MY_KEY", 25, "pg");
        assert!(url.starts_with("https://api.giphy.com/v1/gifs/search?"));
        assert!(url.contains("q=cats"));
        assert!(url.contains("api_key=MY_KEY"));
        assert!(url.contains("limit=25"));
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
    fn test_build_search_url_special_chars_encoded() {
        let url = build_search_url("hello & world", "KEY", 5, "pg");
        // '&' should be percent-encoded so it doesn't break the query string
        assert!(url.contains("%26"));
    }

    #[test]
    fn test_build_search_url_limit_and_key_embedded() {
        let url = build_search_url("dogs", "SECRETKEY", 99, "g");
        assert!(url.contains("limit=99"));
        assert!(url.contains("api_key=SECRETKEY"));
    }

    // --- encode_query helper (shared in gif::mod) ---

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

    #[test]
    fn test_encode_query_alphanumeric_unchanged() {
        assert_eq!(crate::gif::encode_query("abc123XYZ"), "abc123XYZ");
    }

    #[test]
    fn test_encode_query_percent_encodes_special() {
        let result = crate::gif::encode_query("a=b");
        // '=' is not in the safe set
        assert!(result.contains('%'));
    }
}
