//! `send_to_device` (MSC3819), host -> widget: deliver a to-device message the widget has a
//! `receive.to_device` capability for.
//!
//! Body: a [`ToDeviceEvent`](crate::ToDeviceEvent), acknowledged with `{}`. The widget -> host
//! action of the same name lives in `actions::widget::send_to_device`.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{HostRequest, HostResponse, ToDeviceEvent};

    #[test]
    fn to_widget_roundtrip() {
        let message = ToDeviceEvent {
            event_type: "org.example.ping".into(),
            sender: "@a:x".into(),
            content: json!({"k": 1}).into(),
            encrypted: false,
        };
        let wire = HostRequest::SendToDevice { message: message.clone() }.into_wire("d");
        assert_eq!(wire.action, "send_to_device");
        assert_eq!(
            wire.to_value()["request"],
            json!({"type": "org.example.ping", "sender": "@a:x", "content": {"k": 1}, "encrypted": false})
        );
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), HostRequest::SendToDevice { message });
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::SendToDevice);
    }
}
