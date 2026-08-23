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
