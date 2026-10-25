//! `org.matrix.msc4039.get_media_config` (MSC4039), widget -> host: the homeserver's media
//! configuration (`GET /_matrix/client/v1/media/config`).
//!
//! Empty request body, answered with [`MediaConfigResponse`]. Requires
//! `org.matrix.msc4039.upload_file` (the config is what an uploader needs).

use serde::{Deserialize, Serialize};

/// Response to `get_media_config`: the media config object as the homeserver returns it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct MediaConfigResponse {
    /// Maximum upload size in bytes, when the homeserver states one.
    #[serde(rename = "m.upload.size", default, skip_serializing_if = "Option::is_none")]
    pub upload_size: Option<u64>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let wire = WidgetRequest::GetMediaConfig.into_wire("m");
        assert_eq!(wire.action, "org.matrix.msc4039.get_media_config");
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), WidgetRequest::GetMediaConfig);
        let res = wire.response_to(json!({"m.upload.size": 1000}));
        let parsed = WidgetResponse::from_wire(&res).unwrap();
        assert_eq!(
            parsed,
            WidgetResponse::GetMediaConfig { response: MediaConfigResponse { upload_size: Some(1000) } }
        );
        assert_eq!(parsed.into_wire_reply(&wire).to_value()["response"], json!({"m.upload.size": 1000}));
    }
}
