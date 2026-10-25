//! `content_loaded` (MSC4412 core action), widget -> host.
//!
//! The widget finished loading and may be shown. The request body is empty and the host
//! acknowledges with `{}`.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let wire = WidgetRequest::ContentLoaded.into_wire("x");
        assert_eq!(wire.action, "content_loaded");
        assert_eq!(wire.to_value()["request"], json!({}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), WidgetRequest::ContentLoaded);
        assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), WidgetResponse::ContentLoaded);
    }
}
