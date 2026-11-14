//! `request_capabilities` (MSC4412 core action), widget -> host.
//!
//! The widget asks for initial or additional capabilities; it can never give one back. The host
//! acknowledges with `{}` immediately, which grants nothing, and reports what the widget holds
//! with `update_capabilities`. Needs no capability and may be sent at any time.

use serde::{Deserialize, Serialize};

use crate::Capability;

/// Body of `request_capabilities`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RequestCapabilitiesRequest {
    pub capabilities: Vec<Capability>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let caps = WidgetRequest::RequestCapabilities {
            request: RequestCapabilitiesRequest { capabilities: vec![Capability::send_event("m.room.message")] },
        };
        let wire = caps.clone().into_wire("y");
        assert_eq!(wire.action, "org.matrix.msc4412.request_capabilities");
        assert_eq!(
            wire.to_value()["request"]["capabilities"][0],
            "widget:org.matrix.mscXXXX.send_event.timeline:m.room.message"
        );
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), caps);
        // The MSC2974 spelling of the legacy api is not accepted: the compat wrapper renames it.
        let mut legacy = wire.clone();
        legacy.action = "org.matrix.msc2974.request_capabilities".into();
        assert_eq!(WidgetRequest::from_wire(&legacy).unwrap(), WidgetRequest::Unknown);
        assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), WidgetResponse::RequestCapabilities);
    }
}
