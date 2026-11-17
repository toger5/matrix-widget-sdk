//! `update_capabilities` (MSC4412 core action), host -> widget.
//!
//! The host tells the widget which capabilities it holds from now on. `allowed` is always the
//! full list, not a change: a longer list grants capabilities, a shorter one takes them away.
//! The widget acknowledges with `{}`. Needs no capability.

use serde::{Deserialize, Serialize};

use crate::Capability;

/// Body of `update_capabilities`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct UpdateCapabilitiesRequest {
    /// Every capability the widget currently has.
    pub allowed: Vec<Capability>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{HostRequest, HostResponse, Source};

    #[test]
    fn roundtrip() {
        let req = HostRequest::UpdateCapabilities {
            request: UpdateCapabilitiesRequest { allowed: vec![Capability::send_event("a")] },
        };
        let wire = req.clone().into_wire("n");
        assert_eq!(wire.action, "org.matrix.msc4412.update_capabilities");
        assert_eq!(wire.source, Source::Host);
        assert_eq!(wire.to_value()["request"], json!({"allowed": ["widget:org.matrix.mscXXXX.send_event.timeline:a"]}));
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::UpdateCapabilities);
    }
}
