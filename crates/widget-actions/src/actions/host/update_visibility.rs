//! `update_visibility`, host -> widget: the client started or stopped showing the widget (it may
//! keep the iframe alive while hidden, e.g. for a call). Needs `host:…update_visibility`.
//!
//! Body: [`UpdateVisibilityRequest`], acknowledged with `{}`.

use serde::{Deserialize, Serialize};

/// Body of `update_visibility`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct UpdateVisibilityRequest {
    pub visible: bool,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{HostRequest, HostResponse};

    #[test]
    fn roundtrip() {
        let req = HostRequest::UpdateVisibility { request: UpdateVisibilityRequest { visible: false } };
        let wire = req.clone().into_wire("v");
        assert_eq!(wire.action, "org.matrix.mscXXXX.update_visibility");
        assert_eq!(wire.to_value()["request"], json!({"visible": false}));
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::UpdateVisibility);
    }
}
