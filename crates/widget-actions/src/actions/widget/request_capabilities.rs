//! `request_capabilities` (MSC4412 / MSC2974), widget -> host.
//!
//! The widget asks for a set of capabilities. The host acknowledges with `{}` immediately and
//! reports the decision later with `notify_capabilities`.

use serde::{Deserialize, Serialize};

use crate::Capability;

/// Wire name of the action.
pub const ACTION: &str = "request_capabilities";

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
        assert_eq!(wire.action, ACTION);
        assert_eq!(wire.to_value()["request"]["capabilities"][0], "org.matrix.msc2762.send.event:m.room.message");
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), caps);
        assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), WidgetResponse::RequestCapabilities);
    }
}
