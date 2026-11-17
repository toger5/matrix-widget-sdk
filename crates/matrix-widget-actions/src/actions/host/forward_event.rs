//! `forward_event` (MSC2762), host -> widget: deliver a new room event the widget holds a
//! `host:…forward_event.timeline:<type>` or `host:…forward_event.state:<type>` capability for.
//!
//! Body: a [`MatrixEvent`](crate::MatrixEvent), acknowledged with `{}`. The widget's request to
//! send an event is a different action, `send_event` (`actions::widget::send_event`).

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::actions::test_event;
    use crate::{ActionError, HostRequest, Source, WireMessage};

    #[test]
    fn to_widget_roundtrip() {
        let wire = HostRequest::ForwardEvent { event: test_event() }.into_wire("s");
        assert_eq!(wire.action, "org.matrix.mscXXXX.forward_event");
        assert_eq!(wire.to_value()["request"]["type"], "m.room.message");
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), HostRequest::ForwardEvent { event: test_event() });

        let widget_msg = WireMessage::request(Source::Widget, "m.send_event", "s", json!({}));
        assert!(matches!(HostRequest::from_wire(&widget_msg), Err(ActionError::WrongSource { .. })));
    }
}
