//! `client_context`, widget -> host: ask for the basic facts about the embedding client.
//!
//! Not part of an MSC yet; needed because the new API no longer passes these as URL template
//! parameters. Empty request body. Requires the `m.client_context` capability.
//!
//! Response:
//!
//! ```json5
//! { "client_id": string?, "client_theme": string?, "client_language": string? }
//! ```

use serde::{Deserialize, Serialize};

/// Body of the `client_context` response. Every field is optional: a client may not have or
/// may not want to reveal it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ClientContextResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_language: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let wire = WidgetRequest::ClientContext.into_wire("x");
        assert_eq!(wire.action, "client_context");
        assert_eq!(wire.to_value()["request"], json!({}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), WidgetRequest::ClientContext);

        let response = wire.response_to(json!({ "client_theme": "dark", "client_language": "en" }));
        let expected = WidgetResponse::ClientContext {
            response: ClientContextResponse {
                client_id: None,
                client_theme: Some("dark".into()),
                client_language: Some("en".into()),
            },
        };
        assert_eq!(WidgetResponse::from_wire(&response).unwrap(), expected);
        assert_eq!(expected.into_wire_reply(&wire), response);
    }
}
