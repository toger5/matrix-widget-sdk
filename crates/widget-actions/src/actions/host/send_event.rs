//! `send_event` (MSC2762), host -> widget: deliver a room event the widget has a `receive.*`
//! capability for.
//!
//! Body: a [`MatrixEvent`](crate::MatrixEvent), acknowledged with `{}`. The widget -> host
//! action of the same name lives in `actions::widget::send_event`.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::actions::test_event;
    use crate::{ActionError, HostRequest, Source, WireMessage};

    #[test]
    fn to_widget_roundtrip() {
        let wire = HostRequest::SendEvent { event: test_event() }.into_wire("s");
        assert_eq!(wire.to_value()["request"]["type"], "m.room.message");
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), HostRequest::SendEvent { event: test_event() });

        let widget_msg = WireMessage::request(Source::Widget, "send_event", "s", json!({}));
        assert!(matches!(HostRequest::from_wire(&widget_msg), Err(ActionError::WrongSource { .. })));
    }
}
