//! `set_always_on_screen`, widget -> host: ask the client to keep (or stop keeping) the widget
//! visible while the user moves around, e.g. a running call.
//!
//! Body: [`SetAlwaysOnScreenRequest`], answered with [`SetAlwaysOnScreenResponse`]. Requires
//! `m.always_on_screen`.

use serde::{Deserialize, Serialize};

/// Body of `set_always_on_screen`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SetAlwaysOnScreenRequest {
    pub value: bool,
}

/// Response to `set_always_on_screen`: whether the client honoured the request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SetAlwaysOnScreenResponse {
    pub success: bool,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let req = WidgetRequest::SetAlwaysOnScreen { request: SetAlwaysOnScreenRequest { value: true } };
        let wire = req.clone().into_wire("a");
        assert_eq!(wire.action, "set_always_on_screen");
        assert_eq!(wire.to_value()["request"], json!({"value": true}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(
            WidgetResponse::from_wire(&wire.response_to(json!({"success": false}))).unwrap(),
            WidgetResponse::SetAlwaysOnScreen { response: SetAlwaysOnScreenResponse { success: false } }
        );
    }
}
