//! `org.matrix.msc4039.upload_file` (MSC4039), widget -> host: upload a file to the media
//! repository (`POST /_matrix/media/v3/upload`).
//!
//! Body: [`UploadFileRequest`], answered with [`UploadFileResponse`]. Requires
//! `org.matrix.msc4039.upload_file`.

use serde::{Deserialize, Serialize};

use crate::Base64File;

/// Body of `upload_file`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct UploadFileRequest {
    pub file: Base64File,
}

/// Response to `upload_file`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct UploadFileResponse {
    /// The `mxc://` URI of the uploaded file.
    pub content_uri: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let file = Base64File { mimetype: Some("text/plain".into()), base64: "aGk=".into() };
        let req = WidgetRequest::UploadFile { request: UploadFileRequest { file } };
        let wire = req.clone().into_wire("u");
        assert_eq!(wire.action, "org.matrix.msc4039.upload_file");
        assert_eq!(wire.to_value()["request"], json!({"file": {"mimetype": "text/plain", "base64": "aGk="}}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);

        let res = wire.response_to(json!({"content_uri": "mxc://x/abc"}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::UploadFile { response: UploadFileResponse { content_uri: "mxc://x/abc".into() } }
        );

        // A legacy `Blob` that reached the host unconverted is an invalid body, not a silent `{}`.
        let blob = crate::WireMessage::request(crate::Source::Widget, "upload_file", "b", json!({"file": {}}));
        assert!(matches!(WidgetRequest::from_wire(&blob), Err(crate::ActionError::InvalidBody { .. })));
    }
}
