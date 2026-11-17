use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};

/// A file as it travels over the widget API: `{ "mimetype": "image/png", "base64": "…" }`.
///
/// MSC4412 messages are JSON (and cross UniFFI and the mobile WebView bridges as strings), so a
/// file is base64 encoded. Legacy widgets send a `Blob` instead; the compat wrapper converts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct Base64File {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mimetype: Option<String>,
    /// Standard base64 with padding.
    pub base64: String,
}

impl Base64File {
    pub fn from_bytes(bytes: &[u8], mimetype: Option<String>) -> Self {
        Self { mimetype, base64: STANDARD.encode(bytes) }
    }

    /// The decoded bytes; an error describes invalid base64.
    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        STANDARD.decode(&self.base64).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_roundtrip() {
        let file = Base64File::from_bytes(b"hello", Some("text/plain".into()));
        assert_eq!(file.base64, "aGVsbG8=");
        assert_eq!(file.to_bytes().unwrap(), b"hello");
        assert!(Base64File { mimetype: None, base64: "not base64!".into() }.to_bytes().is_err());
    }
}
