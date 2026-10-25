//! The `m.widget` state event (MSC4411): how a widget is placed in a room.
//!
//! This is host-side vocabulary: the client reads these events from room state to decide which
//! widgets to render and how. Widgets themselves never see it, which is why it lives here and not
//! in `widget-actions`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Stable event type of the widget state event (MSC4411).
pub const WIDGET_EVENT_TYPE: &str = "m.widget";
/// Unstable event type of the widget state event (MSC4411).
pub const WIDGET_EVENT_TYPE_UNSTABLE: &str = "org.matrix.msc4411.widget";
/// Legacy event type still used by Element and friends.
pub const WIDGET_EVENT_TYPE_LEGACY: &str = "im.vector.modular.widgets";

/// Content of an `m.widget` state event (MSC4411 + the `usesWidgetAPI` field from MSC4412).
///
/// The `state_key` of the event is the opaque widget id (a client generated uuid v4). An event
/// whose content does not match this shape (e.g. `{}`) denotes a *removed* widget; use
/// [`WidgetStateEventContent::parse`] which returns `None` in that case.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct WidgetStateEventContent {
    /// Human readable name, treated like a room name (same for all users).
    pub name: String,
    /// `https://` URL the widget is loaded from. Also serves as the widget "type".
    pub url: String,
    /// Optional `mxc://` avatar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    /// When `true` the host waits for `content_loaded` before showing the widget and sets up
    /// the widget API. Defaults to `false` (the widget is a plain embedded web page).
    #[serde(rename = "usesWidgetAPI", default, skip_serializing_if = "std::ops::Not::not")]
    pub uses_widget_api: bool,
}

impl WidgetStateEventContent {
    /// Parse state event content. Returns `None` for removed widgets (content not matching).
    pub fn parse(content: &Value) -> Option<Self> {
        serde_json::from_value(content.clone()).ok()
    }

    /// Is this one of the event types that carries widget definitions?
    pub fn is_widget_event_type(event_type: &str) -> bool {
        matches!(event_type, WIDGET_EVENT_TYPE | WIDGET_EVENT_TYPE_UNSTABLE)
    }

    /// Basic URL validation as demanded by MSC4411: only `https://` is acceptable in production.
    pub fn has_valid_url(&self) -> bool {
        self.url.starts_with("https://")
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn widget_content() {
        let c = WidgetStateEventContent::parse(&json!({
            "name": "Notes", "url": "https://w.example/notes", "usesWidgetAPI": true
        }))
        .unwrap();
        assert!(c.uses_widget_api);
        assert!(c.has_valid_url());
        assert_eq!(serde_json::to_value(&c).unwrap()["usesWidgetAPI"], true);

        let plain = WidgetStateEventContent::parse(&json!({"name": "n", "url": "https://x"})).unwrap();
        assert!(!plain.uses_widget_api);
        assert!(serde_json::to_value(&plain).unwrap().get("usesWidgetAPI").is_none());

        assert!(WidgetStateEventContent::parse(&json!({})).is_none());
        assert!(!WidgetStateEventContent::parse(&json!({"name": "n", "url": "javascript:alert(1)"}))
            .unwrap()
            .has_valid_url());
    }
}
