//! `update_state`, host -> widget.
//!
//! The host pushes the current room state the widget is allowed to see (it holds
//! `receive.state_event` capabilities for). Body: [`UpdateStateRequest`], acknowledged with `{}`.

use serde::{Deserialize, Serialize};

use crate::MatrixEvent;

/// Body of `update_state`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct UpdateStateRequest {
    pub state: Vec<MatrixEvent>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::test_event;
    use crate::{HostRequest, HostResponse};

    #[test]
    fn roundtrip() {
        let req = HostRequest::UpdateState { request: UpdateStateRequest { state: vec![test_event()] } };
        let wire = req.clone().into_wire("u");
        assert_eq!(wire.action, "update_state");
        assert_eq!(wire.to_value()["request"]["state"][0]["type"], "m.room.message");
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::UpdateState);
    }
}
