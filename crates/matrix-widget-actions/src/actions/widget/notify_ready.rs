//! `notify_ready` (MSC4412 core action), widget -> host.
//!
//! The widget is ready to be displayed; until then the host shows a loading state in its place.
//! The request body is empty and the host acknowledges with `{}`. Needs no capability.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let wire = WidgetRequest::NotifyReady.into_wire("x");
        assert_eq!(wire.action, "org.matrix.msc4412.notify_ready");
        assert_eq!(wire.to_value()["request"], json!({}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), WidgetRequest::NotifyReady);
        assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), WidgetResponse::NotifyReady);
    }
}
