//! `matrix_context`, widget -> host: ask who and where the widget is on Matrix.
//!
//! Not part of an MSC yet; needed because the new API no longer passes these as URL template
//! parameters (`$matrix_user_id`, `$matrix_room_id`, ...). Empty request body. Requires the
//! `m.matrix_context` capability.
//!
//! Response:
//!
//! ```json5
//! { "user_id": string, "device_id": string, "room_id": string,
//!   "display_name": string, "avatar_url": string, "matrix_base_url": string }
//! ```
//!
//! `display_name` falls back to the user id and `avatar_url` is empty when unknown, like the
//! legacy template parameters.

use serde::{Deserialize, Serialize};

/// Body of the `matrix_context` response.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct MatrixContextResponse {
    pub user_id: String,
    pub device_id: String,
    pub room_id: String,
    pub display_name: String,
    pub avatar_url: String,
    pub matrix_base_url: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let wire = WidgetRequest::MatrixContext.into_wire("x");
        assert_eq!(wire.action, "matrix_context");
        assert_eq!(wire.to_value()["request"], json!({}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), WidgetRequest::MatrixContext);

        let response = wire.response_to(json!({
            "user_id": "@user:test.org", "device_id": "DEVICEID", "room_id": "!room:test.org",
            "display_name": "This User", "avatar_url": "mxc://test.org/avatar", "matrix_base_url": "https://test.org",
        }));
        let expected = WidgetResponse::MatrixContext {
            response: MatrixContextResponse {
                user_id: "@user:test.org".into(),
                device_id: "DEVICEID".into(),
                room_id: "!room:test.org".into(),
                display_name: "This User".into(),
                avatar_url: "mxc://test.org/avatar".into(),
                matrix_base_url: "https://test.org".into(),
            },
        };
        assert_eq!(WidgetResponse::from_wire(&response).unwrap(), expected);
        assert_eq!(expected.into_wire_reply(&wire), response);
    }
}
