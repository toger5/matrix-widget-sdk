//! `openid_credentials` (MSC1960), host -> widget: the outcome of a `get_openid` that was
//! answered with `state: request` (the user had to be asked).
//!
//! Body: [`OpenIdCredentialsRequest`], acknowledged with `{}`. `original_request_id` is the
//! `requestId` of the widget's `get_openid`.

use serde::{Deserialize, Serialize};

use crate::{OpenIdState, OpenIdToken};

/// Body of `openid_credentials`: like `GetOpenIdResponse` plus the request it answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct OpenIdCredentialsRequest {
    /// `allowed` or `blocked` (never `request` here).
    pub state: OpenIdState,
    /// The `requestId` of the `get_openid` this answers.
    pub original_request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matrix_server_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
}

impl OpenIdCredentialsRequest {
    pub fn allowed(original_request_id: impl Into<String>, token: OpenIdToken) -> Self {
        Self {
            state: OpenIdState::Allowed,
            original_request_id: original_request_id.into(),
            access_token: Some(token.access_token),
            token_type: Some(token.token_type),
            matrix_server_name: Some(token.matrix_server_name),
            expires_in: Some(token.expires_in),
        }
    }

    pub fn blocked(original_request_id: impl Into<String>) -> Self {
        Self {
            state: OpenIdState::Blocked,
            original_request_id: original_request_id.into(),
            access_token: None,
            token_type: None,
            matrix_server_name: None,
            expires_in: None,
        }
    }

    /// The token, when `allowed` and complete.
    pub fn token(&self) -> Option<OpenIdToken> {
        OpenIdToken::assemble(
            self.state,
            self.access_token.clone(),
            self.token_type.clone(),
            self.matrix_server_name.clone(),
            self.expires_in,
        )
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{HostRequest, HostResponse};

    #[test]
    fn roundtrip() {
        let token = OpenIdToken {
            access_token: "tok".into(),
            token_type: "Bearer".into(),
            matrix_server_name: "example.org".into(),
            expires_in: 60,
        };
        let req = HostRequest::OpenIdCredentials { request: OpenIdCredentialsRequest::allowed("o1", token.clone()) };
        let wire = req.clone().into_wire("c");
        assert_eq!(wire.action, "openid_credentials");
        assert_eq!(
            wire.to_value()["request"],
            json!({"state": "allowed", "original_request_id": "o1", "access_token": "tok", "token_type": "Bearer",
                   "matrix_server_name": "example.org", "expires_in": 60})
        );
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::OpenIdCredentials);
        assert_eq!(OpenIdCredentialsRequest::allowed("o1", token.clone()).token(), Some(token));

        let blocked =
            HostRequest::OpenIdCredentials { request: OpenIdCredentialsRequest::blocked("o2") }.into_wire("c2");
        assert_eq!(blocked.to_value()["request"], json!({"state": "blocked", "original_request_id": "o2"}));
    }
}
