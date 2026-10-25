//! `m.sticker`, widget -> host: a sticker picker asks the client to send a sticker to the
//! current room.
//!
//! Body: [`StickerRequest`], acknowledged with `{}`. Requires `m.sticker`. The client, not the
//! widget, builds and sends the `m.sticker` event (it may add thumbnails, encryption, ...).

use serde::{Deserialize, Serialize};

use crate::JsonValue;

/// Body of `m.sticker`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct StickerRequest {
    /// Short name, used as the event's `body`.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `{ "url": "mxc://...", "info": { "h", "w", "mimetype", "size", "thumbnail_info" } }`,
    /// the content of the `m.sticker` event to send.
    pub content: JsonValue,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let req = WidgetRequest::SendSticker {
            request: StickerRequest {
                name: "cat".into(),
                description: None,
                content: json!({"url": "mxc://x/cat", "info": {"w": 1, "h": 1}}).into(),
            },
        };
        let wire = req.clone().into_wire("s");
        assert_eq!(wire.action, "m.sticker");
        assert_eq!(wire.to_value()["request"]["content"]["url"], "mxc://x/cat");
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), WidgetResponse::SendSticker);
    }
}
