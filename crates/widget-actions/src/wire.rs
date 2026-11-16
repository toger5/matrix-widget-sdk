use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ActionError, JsonValue};

/// Unstable namespace of everything MSC4412 itself defines: the core actions and the base error
/// codes.
pub const MSC4412_NAMESPACE: &str = "org.matrix.msc4412";
/// Unstable namespace of everything that has no MSC (number) of its own yet.
pub const PLACEHOLDER_NAMESPACE: &str = "org.matrix.mscXXXX";
/// The stable namespace. Accepted when parsing, never emitted.
pub const STABLE_NAMESPACE: &str = "m";

/// How long a request may stay unanswered (MSC4412 "Action timeouts"). After that the request has
/// failed and a late response is ignored.
pub const ACTION_TIMEOUT_MS: u64 = 10_000;
/// How long a host should wait for `notify_ready` before it shows an error (MSC4412
/// recommendation).
pub const NOTIFY_READY_TIMEOUT_MS: u64 = 15_000;

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

/// The four kinds of message: who started the exchange (`source`) and whether this is the request
/// or the response. Returned by [`WireMessage::kind`].
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
///  action: "<namespace>.<name>",
///  request_id: "<uuid v4>",
///  request: { ... } /* or */ response: { ... }
/// }
/// ```
///
/// A message is a response if and only if `response` is present. There is no version property:
/// legacy (matrix-widget-api) messages have `api` instead of `source` and do not parse as a
/// `WireMessage` at all.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct WireMessage {
    pub source: Source,
    pub action: String,
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<JsonValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<JsonValue>,
}

impl WireMessage {
    /// Build a request envelope.
    pub fn request(source: Source, action: impl Into<String>, request_id: impl Into<String>, body: Value) -> Self {
        Self {
            source,
            action: action.into(),
            request_id: request_id.into(),
            request: Some(JsonValue(body)),
            response: None,
        }
    }

    /// Build the response envelope for this request. `source`, `action` and `request_id` are
    /// copied; the `request` body is not repeated (MSC4412 allows but does not require it).
    pub fn response_to(&self, body: Value) -> Self {
        Self {
            source: self.source,
            action: self.action.clone(),
            request_id: self.request_id.clone(),
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

    /// The message as JSON for (trace) logs.
    ///
    /// The body of the actions that carry credentials (OpenID tokens, LiveKit tokens, TURN
    /// passwords) is replaced by `"<redacted>"`, so that a log never contains a secret.
    pub fn to_log_json(&self) -> String {
        const SECRET_ACTIONS: [&str; 3] = ["get_openid", "get_rtc_livekit_token", "update_turn_servers"];
        let name = self.action.rsplit('.').next().unwrap_or_default();
        if !SECRET_ACTIONS.contains(&name) {
            return self.to_json();
        }
        let mut redacted = self.clone();
        for body in [&mut redacted.request, &mut redacted.response].into_iter().flatten() {
            // An error response has no secret, and is what one looks for in a log.
            if WidgetError::from_response_body(&body.0).is_none() {
                *body = JsonValue(Value::String("<redacted>".to_owned()));
            }
        }
        redacted.to_json()
    }
}

/// What an error `code` means to this crate, see [`WidgetError::kind`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ErrorKind {
    /// `unknown_action`: the receiver does not know or support the action.
    UnknownAction,
    /// `missing_capability`: the capability the action needs has not been granted.
    MissingCapability,
    /// `invalid_request`: the request misses required properties or has invalid values.
    InvalidRequest,
    /// `matrix_api_error`: a Matrix API request made for the widget failed;
    /// [`WidgetError::matrix_api_error`] carries the homeserver's answer.
    MatrixApiError,
    /// `unknown`, and every code this crate does not recognise.
    Unknown,
}

impl ErrorKind {
    /// `(namespace, name)` of the code this kind is sent as.
    fn parts(self) -> (&'static str, &'static str) {
        match self {
            Self::UnknownAction => (MSC4412_NAMESPACE, "unknown_action"),
            Self::MissingCapability => (MSC4412_NAMESPACE, "missing_capability"),
            Self::InvalidRequest => (MSC4412_NAMESPACE, "invalid_request"),
            Self::MatrixApiError => (PLACEHOLDER_NAMESPACE, "matrix_api_error"),
            Self::Unknown => (MSC4412_NAMESPACE, "unknown"),
        }
    }

    /// The (unstable) code this kind is sent as, e.g. `org.matrix.msc4412.missing_capability`.
    pub fn code(self) -> String {
        let (namespace, name) = self.parts();
        format!("{namespace}.{name}")
    }

    /// The kind of `code`. Both the unstable and the stable (`m.`) spelling are recognised; any
    /// other code is [`ErrorKind::Unknown`], as MSC4412 demands.
    pub fn of(code: &str) -> Self {
        [Self::UnknownAction, Self::MissingCapability, Self::InvalidRequest, Self::MatrixApiError]
            .into_iter()
            .find(|kind| {
                let (namespace, name) = kind.parts();
                [namespace, STABLE_NAMESPACE]
                    .iter()
                    .any(|ns| code.strip_prefix(ns).and_then(|rest| rest.strip_prefix('.')) == Some(name))
            })
            .unwrap_or(Self::Unknown)
    }
}

/// An error returned instead of a regular response body (MSC4412 "Errors"):
///
/// ```json5
/// { "error": {
///     "code": "org.matrix.msc4412.missing_capability",
///     "message": "Missing capability: ...",
///     "matrix_api_error": { /* only with the code `…matrix_api_error`, see MatrixApiError */ }
/// } }
/// ```
///
/// A response is an error response if and only if `response.error` is an object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct WidgetError {
    /// Namespaced, machine readable kind of the error; see [`ErrorKind`]. A sender that leaves it
    /// out (it is required) is read as `unknown`.
    #[serde(default = "unknown_code")]
    pub code: String,
    /// A description for developers. Never parse it.
    #[serde(default)]
    pub message: String,
    /// Additional property of the code `org.matrix.mscXXXX.matrix_api_error`: the failed Matrix
    /// API request the host made on the widget's behalf.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matrix_api_error: Option<MatrixApiError>,
}

fn unknown_code() -> String {
    ErrorKind::Unknown.code()
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
    /// An error of the given kind.
    pub fn of(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { code: kind.code(), message: message.into(), matrix_api_error: None }
    }

    /// An `unknown` error: the request failed for a reason no other code covers.
    pub fn new(message: impl Into<String>) -> Self {
        Self::of(ErrorKind::Unknown, message)
    }

    /// `unknown_action`: the receiver does not know `action`.
    pub fn unknown_action(action: &str) -> Self {
        Self::of(ErrorKind::UnknownAction, format!("Unknown action `{action}`"))
    }

    /// `missing_capability`: `capability` (a capability string) has not been granted.
    pub fn missing_capability(capability: impl std::fmt::Display) -> Self {
        Self::of(ErrorKind::MissingCapability, format!("Missing capability: {capability}"))
    }

    /// `invalid_request`: the request body is incomplete or invalid.
    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::of(ErrorKind::InvalidRequest, message)
    }

    /// What the `code` means; unrecognised codes are [`ErrorKind::Unknown`].
    pub fn kind(&self) -> ErrorKind {
        ErrorKind::of(&self.code)
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
            code: ErrorKind::MatrixApiError.code(),
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

    /// The error in a response body, if `body.error` is an object.
    pub fn from_response_body(body: &Value) -> Option<Self> {
        if !body.get("error")?.is_object() {
            return None;
        }
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
    fn log_json_hides_credentials_only() {
        let plain = WireMessage::request(Source::Widget, "org.matrix.mscXXXX.send_event", "1", json!({"type": "t"}));
        assert_eq!(plain.to_log_json(), plain.to_json());

        let request = WireMessage::request(Source::Widget, "org.matrix.mscXXXX.get_openid", "2", json!({}));
        let token = request.response_to(json!({"access_token": "secret", "token_type": "Bearer"}));
        let logged = token.to_log_json();
        assert!(!logged.contains("secret"), "{logged}");
        assert!(logged.contains("get_openid") && logged.contains("<redacted>"), "{logged}");
        // The stable name is recognised as well.
        let turn = WireMessage::request(Source::Host, "m.update_turn_servers", "3", json!({"password": "secret"}));
        assert!(!turn.to_log_json().contains("secret"));

        // An error response stays readable.
        let failed = request.error_response_to(WidgetError::new("no token"));
        assert_eq!(failed.to_log_json(), failed.to_json());
    }

    #[test]
    fn roundtrip_request() {
        let msg = WireMessage::request(
            Source::Widget,
            "org.matrix.mscXXXX.send_event",
            "id-1",
            json!({"type": "m.room.message"}),
        );
        let json = msg.to_json();
        let parsed = WireMessage::from_json(&json).unwrap();
        assert_eq!(parsed, msg);
        assert_eq!(parsed.kind(), MessageKind::WidgetRequest);

        let value = parsed.to_value();
        assert_eq!(value["request_id"], "id-1");
        assert!(value.get("version").is_none());
        assert!(value.get("requestId").is_none());
        assert_eq!(value["source"], "widget");
        assert!(value.get("response").is_none());
    }

    #[test]
    fn response_copies_envelope_and_drops_request() {
        let req = WireMessage::request(Source::Host, "m.send_event", "abc", json!({"x": 1}));
        let res = req.response_to(json!({}));
        assert_eq!(res.kind(), MessageKind::HostResponse);
        assert_eq!(res.request_id, "abc");
        assert_eq!(res.action, "m.send_event");
        assert!(res.request.is_none());
        assert_eq!(res.response_body(), json!({}));
    }

    #[test]
    fn legacy_messages_are_not_wire_messages() {
        // Legacy messages have `api` instead of `source`.
        let legacy = json!({"api": "fromWidget", "action": "supported_api_versions", "requestId": "x", "data": {}});
        assert!(WireMessage::from_value(legacy).is_err());
        // The old spelling of the request id is not accepted either.
        let old = json!({"source": "widget", "action": "a.b", "requestId": "x", "request": {}});
        assert!(WireMessage::from_value(old).is_err());
        // A response may repeat the request.
        let both = json!({"source": "widget", "action": "a.b", "request_id": "x", "request": {}, "response": {}});
        assert_eq!(WireMessage::from_value(both).unwrap().kind(), MessageKind::WidgetResponse);
    }

    #[test]
    fn error_response() {
        let req = WireMessage::request(Source::Widget, "m.send_event", "abc", json!({}));
        let res = req.error_response_to(WidgetError::new("nope"));
        assert_eq!(res.error(), Some(WidgetError::new("nope")));
        assert_eq!(res.to_value()["response"]["error"]["message"], "nope");
        assert_eq!(res.to_value()["response"]["error"]["code"], "org.matrix.msc4412.unknown");
        assert!(res.to_value()["response"]["error"].get("matrix_api_error").is_none());
        assert!(req.error().is_none());

        let matrix =
            WidgetError::with_matrix_error("Failed to send", Some("M_FORBIDDEN".into()), Some(403), "no power");
        let res = req.error_response_to(matrix.clone());
        assert_eq!(res.error(), Some(matrix));
        let body = res.to_value()["response"]["error"].clone();
        assert_eq!(body["code"], "org.matrix.mscXXXX.matrix_api_error");
        assert_eq!(body["matrix_api_error"]["http_status"], 403);
        assert_eq!(body["matrix_api_error"]["response"]["errcode"], "M_FORBIDDEN");
        assert!(body["matrix_api_error"].get("http_headers").is_none());
        assert_eq!(WidgetError::with_matrix_error("x", None, None, "y"), WidgetError::new("x"));
    }

    #[test]
    fn error_codes() {
        let cap = "widget:org.matrix.mscXXXX.send_event.timeline:m.room.message";
        let missing = WidgetError::missing_capability(cap);
        assert_eq!(missing.code, "org.matrix.msc4412.missing_capability");
        assert_eq!(missing.message, format!("Missing capability: {cap}"));
        assert_eq!(missing.kind(), ErrorKind::MissingCapability);
        assert_eq!(WidgetError::unknown_action("a.b").code, "org.matrix.msc4412.unknown_action");
        assert_eq!(WidgetError::invalid_request("x").code, "org.matrix.msc4412.invalid_request");

        // Stable spellings are recognised; anything else is `unknown`.
        assert_eq!(ErrorKind::of("m.unknown_action"), ErrorKind::UnknownAction);
        assert_eq!(ErrorKind::of("m.matrix_api_error"), ErrorKind::MatrixApiError);
        assert_eq!(ErrorKind::of("org.example.out_of_coffee"), ErrorKind::Unknown);
        assert_eq!(ErrorKind::of("unknown_action"), ErrorKind::Unknown);

        // `error` must be an object; a missing `code` reads as `unknown`.
        assert_eq!(WidgetError::from_response_body(&json!({"error": "nope"})), None);
        assert_eq!(WidgetError::from_response_body(&json!({"error": null})), None);
        assert_eq!(WidgetError::from_response_body(&json!({"error": {"message": "m"}})), Some(WidgetError::new("m")));
        let custom = WidgetError::from_response_body(&json!({"error": {"code": "org.x.y", "message": "m", "z": 1}}));
        assert_eq!(custom.unwrap().kind(), ErrorKind::Unknown);
    }
}
