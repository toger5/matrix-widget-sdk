//! `org.matrix.msc4039.download_file` (MSC4039), widget -> host: download a file from the media
//! repository (`GET /_matrix/client/v1/media/download/...`).
//!
//! Body: [`DownloadFileRequest`], answered with [`DownloadFileResponse`]. Requires
//! `org.matrix.msc4039.download_file`.

use serde::{Deserialize, Serialize};

use crate::Base64File;

/// Body of `download_file`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DownloadFileRequest {
    /// The `mxc://` URI to download.
    pub content_uri: String,
}

/// Response to `download_file`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DownloadFileResponse {
    pub file: Base64File,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let req = WidgetRequest::DownloadFile { request: DownloadFileRequest { content_uri: "mxc://x/abc".into() } };
        let wire = req.clone().into_wire("d");
        assert_eq!(wire.action, "org.matrix.msc4039.download_file");
        assert_eq!(wire.to_value()["request"], json!({"content_uri": "mxc://x/abc"}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);

        let res = wire.response_to(json!({"file": {"base64": "aGk="}}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::DownloadFile {
                response: DownloadFileResponse { file: Base64File { mimetype: None, base64: "aGk=".into() } }
            }
        );
    }
}
