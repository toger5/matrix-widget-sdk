//! `language_change`, host -> widget: the client's UI language changed.
//!
//! Body: [`LanguageChangeRequest`], acknowledged with `{}`.

use serde::{Deserialize, Serialize};

/// Body of `language_change`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct LanguageChangeRequest {
    /// BCP 47 language tag, e.g. `de-DE`.
    pub lang: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{HostRequest, HostResponse};

    #[test]
    fn roundtrip() {
        let req = HostRequest::LanguageChange { request: LanguageChangeRequest { lang: "de".into() } };
        let wire = req.clone().into_wire("l");
        assert_eq!(wire.action, "language_change");
        assert_eq!(wire.to_value()["request"], json!({"lang": "de"}));
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::LanguageChange);
    }
}
