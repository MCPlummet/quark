pub mod giphy;
pub mod klipy;

use reqwest::Client;
use serde::{Deserialize, Serialize};

/// A GIF result from any provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GifResult {
    pub id: String,
    pub title: String,
    /// Direct URL to the full GIF.
    pub url: String,
    /// URL to a smaller preview/thumbnail.
    pub preview_url: String,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
}

/// Unified GIF search provider trait.
pub trait GifProvider {
    fn search(
        &self,
        query: &str,
        limit: u32,
        rating: &str,
    ) -> impl std::future::Future<Output = Result<Vec<GifResult>, String>> + Send;
}

/// Validate a user-supplied GIF provider API key before any network call.
///
/// GIF providers are bring-your-own-key and `[gif] api_key` defaults to `""`.
/// An empty key used to reach the provider anyway — Klipy embeds the key in
/// the URL path, so it produced `/api/v1//gifs/search` and a bare
/// "HTTP 404 Not Found" (#150). Reject it up front with a message that says
/// how to fix it. Surrounding whitespace (a pasted key with a trailing
/// newline/space) is stripped; the trimmed key is returned for use.
pub(crate) fn validate_api_key<'a>(provider: &str, api_key: &'a str) -> Result<&'a str, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err(missing_key_message(provider));
    }
    Ok(key)
}

/// The user-facing error for a missing GIF API key.
pub(crate) fn missing_key_message(provider: &str) -> String {
    format!(
        "No {provider} API key set. GIF search needs your own key: add it in \
         Settings → GIF, or set `api_key` under `[gif]` in config.toml."
    )
}

/// Percent-encode a query string for use in a URL.
///
/// Unreserved characters (`A-Z a-z 0-9 - _ . ~`) are passed through unchanged.
/// Spaces are encoded as `+`.  All other bytes are percent-encoded as `%XX`.
pub(crate) fn encode_query(s: &str) -> String {
    let mut encoded = String::new();
    for c in s.chars() {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                encoded.push(c);
            }
            ' ' => encoded.push('+'),
            c => {
                for byte in c.to_string().as_bytes() {
                    encoded.push('%');
                    encoded.push_str(&format!("{:02X}", byte));
                }
            }
        }
    }
    encoded
}

/// Send a GET request to `url` and check that the response status is successful.
///
/// On network error the message is `"{provider} API request failed: {e}"`.
/// On a non-2xx status the error is `"{provider} API error: HTTP {status}"`.
/// On success the `reqwest::Response` is returned so each provider can parse
/// its own JSON schema independently.
pub(crate) async fn fetch_response(
    http: &Client,
    provider: &str,
    url: &str,
) -> Result<reqwest::Response, String> {
    let response = http
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{provider} API request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("{provider} API error: HTTP {}", response.status()));
    }

    Ok(response)
}

#[cfg(test)]
mod api_key_tests {
    use super::*;

    #[test]
    fn empty_key_is_rejected_with_actionable_message() {
        let err = validate_api_key("Klipy", "").unwrap_err();
        assert!(err.contains("No Klipy API key set"), "{err}");
        assert!(err.contains("Settings → GIF"), "{err}");
        assert!(err.contains("[gif]"), "{err}");
    }

    #[test]
    fn whitespace_only_key_is_rejected() {
        let err = validate_api_key("Giphy", "  \n\t ").unwrap_err();
        assert!(err.contains("No Giphy API key set"), "{err}");
    }

    #[test]
    fn key_is_trimmed() {
        assert_eq!(validate_api_key("Klipy", "  ABC123\n"), Ok("ABC123"));
    }

    #[test]
    fn trimmed_key_yields_no_empty_klipy_path_segment() {
        let key = validate_api_key("Klipy", " KEY ").unwrap();
        let url = klipy::build_search_url("cat", key, 20, "pg");
        assert!(url.starts_with("https://api.klipy.com/api/v1/KEY/gifs/search?"), "{url}");
        assert!(!url.contains("v1//"), "{url}");
    }
}
