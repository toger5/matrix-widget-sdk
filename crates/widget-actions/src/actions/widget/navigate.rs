//! `org.matrix.msc2931.navigate` (MSC2931), widget -> host: ask the client to navigate to a
//! `https://matrix.to/#/...` URI.
//!
//! Body: [`NavigateRequest`], acknowledged with `{}`. Requires `org.matrix.msc2931.navigate`.

use serde::{Deserialize, Serialize};

/// Body of `navigate`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct NavigateRequest {
    /// A `https://matrix.to/#/` permalink.
    pub uri: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let req = WidgetRequest::Navigate { request: NavigateRequest { uri: "https://matrix.to/#/#room:x".into() } };
        let wire = req.clone().into_wire("n");
        assert_eq!(wire.action, "org.matrix.msc2931.navigate");
        assert_eq!(wire.to_value()["request"], json!({"uri": "https://matrix.to/#/#room:x"}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), WidgetResponse::Navigate);
    }
}
