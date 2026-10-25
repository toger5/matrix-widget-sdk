//! `notify_capabilities` (MSC4412 / MSC2974), host -> widget.
//!
//! The host tells the widget which of the capabilities it asked for were approved. The widget
//! acknowledges with `{}`.

use serde::{Deserialize, Serialize};

use crate::Capability;

/// Body of `notify_capabilities`: the outcome of a `request_capabilities`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct NotifyCapabilitiesRequest {
    pub requested: Vec<Capability>,
    pub approved: Vec<Capability>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{HostRequest, HostResponse, Source};

    #[test]
    fn roundtrip() {
        let req = HostRequest::NotifyCapabilities {
            request: NotifyCapabilitiesRequest {
                requested: vec![Capability::send_event("a"), Capability::send_event("b")],
                approved: vec![Capability::send_event("a")],
            },
        };
        let wire = req.clone().into_wire("n");
        assert_eq!(wire.action, "notify_capabilities");
        assert_eq!(wire.source, Source::Host);
        assert_eq!(wire.to_value()["request"]["approved"], json!(["org.matrix.msc2762.send.event:a"]));
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::NotifyCapabilities);
    }
}
