//! `content_loaded` (MSC4412 core action), widget -> host.
//!
//! The widget finished loading and may be shown. The request body is empty and the host
//! acknowledges with `{}`.

/// Wire name of the action.
pub const ACTION: &str = "content_loaded";

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{FromWidgetRequest, FromWidgetResponse};

    #[test]
    fn roundtrip() {
        let wire = FromWidgetRequest::ContentLoaded.into_wire("x");
        assert_eq!(wire.action, super::ACTION);
        assert_eq!(wire.to_value()["request"], json!({}));
        assert_eq!(FromWidgetRequest::from_wire(&wire).unwrap(), FromWidgetRequest::ContentLoaded);
        assert_eq!(FromWidgetResponse::from_wire(&wire.ack()).unwrap(), FromWidgetResponse::Ack);
    }
}
