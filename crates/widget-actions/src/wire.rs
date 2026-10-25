use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ActionError, JsonValue};

/// The protocol version carried in every message. MSC4412 only defines `v1`.
pub const API_VERSION_V1: &str = "v1";

/// Who *initiated* the exchange that a message belongs to.
///
/// A request and its response share the same `source`. `widget` corresponds to the legacy
/// `fromWidget` api, `host` to the legacy `toWidget` api.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Source {
    Widget,
    Host,
}

impl Source {
    pub fn as_str(&self) -> &'static str {
        match self {
            Source::Widget => "widget",
            Source::Host => "host",
        }
    }
}

impl std::fmt::Display for Source {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Classification of a [`WireMessage`] by direction and role.
///
/// This enum is only used as the return type of the `kind(&self)`
/// Its not stored as state anywhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum MessageKind {
    /// `source: widget`, has `request`. Sent by the widget, handled by the host.
    WidgetRequest,
    /// `source: widget`, has `response`. Sent by the host, handled by the widget.
    WidgetResponse,
    /// `source: host`, has `request`. Sent by the host, handled by the widget.
    HostRequest,
    /// `source: host`, has `response`. Sent by the widget, handled by the host.
    HostResponse,
}

/// The generic JSON envelope every widget API message uses (MSC4412).
///
/// ```json5
/// {
///  source: "widget" | "host",
///  action: "...",
///  requestId: "<uuid v4>",
///  version: "v1",
///  request: { ... } /* or */ response: { ... }
/// }
/// ```
///
/// Exactly one of `request` / `response` is present. `version` is `None` for messages from
/// pre-MSC4412 ("legacy") widgets; hosts use that to pick the legacy code path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct WireMessage {
    pub source: Source,
    pub action: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<JsonValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<JsonValue>,
}

impl WireMessage {
    /// Build a `v1` request envelope.
    pub fn request(source: Source, action: impl Into<String>, request_id: impl Into<String>, body: Value) -> Self {
        Self {
            source,
            action: action.into(),
            request_id: request_id.into(),
            version: Some(API_VERSION_V1.to_owned()),
            request: Some(JsonValue(body)),
            response: None,
        }
    }

    /// Build the response envelope for this request. `source`, `action`, `requestId` and
    /// `version` are copied; the `request` body is dropped as mandated by MSC4412.
    pub fn response_to(&self, body: Value) -> Self {
        Self {
            source: self.source,
            action: self.action.clone(),
            request_id: self.request_id.clone(),
            version: self.version.clone(),
            request: None,
            response: Some(JsonValue(body)),
        }
    }

    /// Build an error response for this request.
    pub fn error_response_to(&self, error: WidgetError) -> Self {
        self.response_to(error.into_response_body())
    }

    /// Build an empty `{}` acknowledgement for this request.
    pub fn ack(&self) -> Self {
        self.response_to(Value::Object(Default::default()))
    }

    pub fn is_request(&self) -> bool {
        self.response.is_none()
    }

    pub fn is_response(&self) -> bool {
        self.response.is_some()
    }

    pub fn is_v1(&self) -> bool {
        self.version.as_deref() == Some(API_VERSION_V1)
    }

    pub fn kind(&self) -> MessageKind {
        match (self.source, self.is_request()) {
            (Source::Widget, true) => MessageKind::WidgetRequest,
            (Source::Widget, false) => MessageKind::WidgetResponse,
            (Source::Host, true) => MessageKind::HostRequest,
            (Source::Host, false) => MessageKind::HostResponse,
        }
    }

    /// The request body, or `{}` when absent.
    pub fn request_body(&self) -> Value {
        self.request.clone().map(JsonValue::into_inner).unwrap_or_else(|| Value::Object(Default::default()))
    }

    /// The response body, or `{}` when absent.
    pub fn response_body(&self) -> Value {
        self.response.clone().map(JsonValue::into_inner).unwrap_or_else(|| Value::Object(Default::default()))
    }

    /// If this is a response carrying an `error` object, return it.
    pub fn error(&self) -> Option<WidgetError> {
        let response = self.response.as_ref()?;
        WidgetError::from_response_body(&response.0)
    }

    pub fn from_json(json: &str) -> Result<Self, ActionError> {
        serde_json::from_str(json).map_err(ActionError::malformed)
    }

    pub fn from_value(value: Value) -> Result<Self, ActionError> {
        serde_json::from_value(value).map_err(ActionError::malformed)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("WireMessage is always serializable")
    }

    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("WireMessage is always serializable")
    }
}

/// An error returned instead of a regular response body.
///
/// MSC4412 does not (yet) define an error shape; this uses the one established by the existing
/// widget implementations (matrix-widget-api `IWidgetApiErrorResponseData`):
///
/// ```json5
/// { "error": { "message": "...", "matrix_api_error": { /* optional, see MatrixApiError */ } } }
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct WidgetError {
    /// A user-friendly description.
    pub message: String,
    /// Set when the error came from a Matrix API request the host made on the widget's behalf.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matrix_api_error: Option<MatrixApiError>,
}

/// The Matrix API failure behind a [`WidgetError`], as matrix-widget-api defines it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct MatrixApiError {
    /// HTTP status of the failed request; `0` when unknown.
    pub http_status: u16,
    /// Response headers relevant to the error (e.g. `Retry-After`).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub http_headers: HashMap<String, String>,
    /// URL of the failed request; empty when unknown.
    #[serde(default)]
    pub url: String,
    /// The standard Matrix error response.
    pub response: MatrixErrorResponse,
}

/// A [standard error response](https://spec.matrix.org/latest/client-server-api/#standard-error-response).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct MatrixErrorResponse {
    pub errcode: String,
    pub error: String,
}

#[derive(Serialize, Deserialize)]
struct ErrorEnvelope {
    error: WidgetError,
}

impl WidgetError {
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), matrix_api_error: None }
    }

    /// An error caused by a Matrix API failure. `errcode` / `status` may be unknown; when both
    /// are, this is the same as [`new`](Self::new).
    pub fn with_matrix_error(
        message: impl Into<String>,
        errcode: Option<String>,
        status: Option<u16>,
        error: impl Into<String>,
    ) -> Self {
        let message = message.into();
        if errcode.is_none() && status.is_none() {
            return Self::new(message);
        }
        Self {
            message,
            matrix_api_error: Some(MatrixApiError {
                http_status: status.unwrap_or(0),
                http_headers: HashMap::new(),
                url: String::new(),
                response: MatrixErrorResponse {
                    errcode: errcode.unwrap_or_else(|| "M_UNKNOWN".to_owned()),
                    error: error.into(),
                },
            }),
        }
    }

    pub fn into_response_body(self) -> Value {
        serde_json::to_value(ErrorEnvelope { error: self }).expect("WidgetError is serializable")
    }

    pub fn from_response_body(body: &Value) -> Option<Self> {
        serde_json::from_value::<ErrorEnvelope>(body.clone()).ok().map(|e| e.error)
    }
}

impl std::fmt::Display for WidgetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for WidgetError {}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn roundtrip_request() {
        let msg = WireMessage::request(Source::Widget, "send_event", "id-1", json!({"type": "m.room.message"}));
        let json = msg.to_json();
        let parsed = WireMessage::from_json(&json).unwrap();
        assert_eq!(parsed, msg);
        assert_eq!(parsed.kind(), MessageKind::WidgetRequest);
        assert!(parsed.is_v1());

        let value = parsed.to_value();
        assert_eq!(value["requestId"], "id-1");
        assert_eq!(value["version"], "v1");
        assert_eq!(value["source"], "widget");
        assert!(value.get("response").is_none());
    }

    #[test]
    fn response_copies_envelope_and_drops_request() {
        let req = WireMessage::request(Source::Host, "send_event", "abc", json!({"x": 1}));
        let res = req.response_to(json!({}));
        assert_eq!(res.kind(), MessageKind::HostResponse);
        assert_eq!(res.request_id, "abc");
        assert_eq!(res.action, "send_event");
        assert!(res.request.is_none());
        assert_eq!(res.response_body(), json!({}));
    }

    #[test]
    fn legacy_message_without_version() {
        let legacy = json!({"api": "fromWidget", "action": "supported_api_versions", "requestId": "x", "data": {}});
        // Not an MSC4412 envelope at all -> malformed (no `source`).
        assert!(WireMessage::from_value(legacy).is_err());

        let v_less = json!({"source": "widget", "action": "content_loaded", "requestId": "x", "request": {}});
        let msg = WireMessage::from_value(v_less).unwrap();
        assert!(!msg.is_v1());
    }

    #[test]
    fn error_response() {
        let req = WireMessage::request(Source::Widget, "send_event", "abc", json!({}));
        let res = req.error_response_to(WidgetError::new("nope"));
        assert_eq!(res.error(), Some(WidgetError::new("nope")));
        assert_eq!(res.to_value()["response"]["error"]["message"], "nope");
        assert!(res.to_value()["response"]["error"].get("matrix_api_error").is_none());
        assert!(req.error().is_none());

        let matrix =
            WidgetError::with_matrix_error("Failed to send", Some("M_FORBIDDEN".into()), Some(403), "no power");
        let res = req.error_response_to(matrix.clone());
        assert_eq!(res.error(), Some(matrix));
        let body = res.to_value()["response"]["error"].clone();
        assert_eq!(body["matrix_api_error"]["http_status"], 403);
        assert_eq!(body["matrix_api_error"]["response"]["errcode"], "M_FORBIDDEN");
        assert!(body["matrix_api_error"].get("http_headers").is_none());
        assert_eq!(WidgetError::with_matrix_error("x", None, None, "y"), WidgetError::new("x"));
    }
}
