//! `forward_to_device` (MSC3819), host -> widget: deliver a to-device message the widget holds a
//! `host:…forward_to_device:<type>` capability for.
//!
//! Body: a [`ToDeviceEvent`](crate::ToDeviceEvent), acknowledged with `{}`. The widget's request
//! to send one is a different action, `send_to_device` (`actions::widget::send_to_device`).

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
        let wire = HostRequest::ForwardToDevice { message: message.clone() }.into_wire("d");
        assert_eq!(wire.action, "forward_to_device");
        assert_eq!(
            wire.to_value()["request"],
            json!({"type": "org.example.ping", "sender": "@a:x", "content": {"k": 1}, "encrypted": false})
        );
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), HostRequest::ForwardToDevice { message });
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::ForwardToDevice);
    }
}
