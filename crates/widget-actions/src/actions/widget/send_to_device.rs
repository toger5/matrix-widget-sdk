//! `send_to_device` (MSC3819), widget -> host: send a to-device message to a set of devices.
//!
//! Body: [`SendToDeviceRequest`], acknowledged with `{}`. Requires
//! `org.matrix.msc3819.send.to_device:<type>`. The host -> widget action of the same name
//! (an incoming message) lives in `actions::host::send_to_device`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::JsonValue;

/// Body of a widget's `send_to_device` request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SendToDeviceRequest {
    #[serde(rename = "type")]
    pub event_type: String,
    /// Whether the host must Olm-encrypt the messages.
    pub encrypted: bool,
    /// `user_id -> device_id -> content`; `*` as device id means every device of the user.
    pub messages: HashMap<String, HashMap<String, JsonValue>>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{ActionError, Source, WidgetRequest, WidgetResponse, WireMessage};

    #[test]
    fn roundtrip() {
        let mut messages = HashMap::new();
        messages.insert("@a:x".to_string(), HashMap::from([("DEV".to_string(), JsonValue::from(json!({"k": 1})))]));
        let req = WidgetRequest::SendToDevice {
            request: SendToDeviceRequest { event_type: "org.example.ping".into(), encrypted: true, messages },
        };
        let wire = req.clone().into_wire("t");
        assert_eq!(wire.action, "send_to_device");
        assert_eq!(
            wire.to_value()["request"],
            json!({"type": "org.example.ping", "encrypted": true, "messages": {"@a:x": {"DEV": {"k": 1}}}})
        );
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), WidgetResponse::SendToDevice);

        let bad = WireMessage::request(Source::Widget, "send_to_device", "t", json!({"type": "x", "messages": {}}));
        assert!(matches!(WidgetRequest::from_wire(&bad), Err(ActionError::InvalidBody { .. })));
    }
}
