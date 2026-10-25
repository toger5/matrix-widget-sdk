//! `get_openid` (MSC1960), widget -> host: ask for an OpenID token that proves the user's
//! identity to a third party.
//!
//! Empty request body. The host answers at once with [`GetOpenIdResponse`]: `state: allowed`
//! plus the token when it needs no user consent, `state: blocked` when refused, or
//! `state: request` when the user is being asked; in that case the outcome follows as the host
//! -> widget action `openid_credentials` (`actions::host::openid_credentials`) carrying this
//! request's id as `original_request_id`. No capability: the consent prompt is the permission.

use serde::{Deserialize, Serialize};

use crate::OpenIdToken;

/// Where an OpenID request stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum OpenIdState {
    /// Granted; the token fields are set.
    #[serde(rename = "allowed")]
    Allowed,
    /// Refused (by the user or the client).
    #[serde(rename = "blocked")]
    Blocked,
    /// The user is being asked; the decision arrives as `openid_credentials`.
    #[serde(rename = "request")]
    PendingUserConfirmation,
}

/// Response to `get_openid`: the state and, when `allowed`, the token fields (MSC1960 puts them
/// next to `state`; [`token`](Self::token) assembles them).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct GetOpenIdResponse {
    pub state: OpenIdState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matrix_server_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
}

impl GetOpenIdResponse {
    pub fn allowed(token: OpenIdToken) -> Self {
        Self {
            state: OpenIdState::Allowed,
            access_token: Some(token.access_token),
            token_type: Some(token.token_type),
            matrix_server_name: Some(token.matrix_server_name),
            expires_in: Some(token.expires_in),
        }
    }

    pub fn blocked() -> Self {
        Self::without_token(OpenIdState::Blocked)
    }

    pub fn pending() -> Self {
        Self::without_token(OpenIdState::PendingUserConfirmation)
    }

    fn without_token(state: OpenIdState) -> Self {
        Self { state, access_token: None, token_type: None, matrix_server_name: None, expires_in: None }
    }

    /// The token, when the response is `allowed` and complete.
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
    use crate::{WidgetRequest, WidgetResponse};

    fn token() -> OpenIdToken {
        OpenIdToken {
            access_token: "tok".into(),
            token_type: "Bearer".into(),
            matrix_server_name: "example.org".into(),
            expires_in: 3600,
        }
    }

    #[test]
    fn roundtrip() {
        let wire = WidgetRequest::GetOpenId.into_wire("o");
        assert_eq!(wire.action, "get_openid");
        assert_eq!(wire.to_value()["request"], json!({}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), WidgetRequest::GetOpenId);

        let pending = WidgetResponse::GetOpenId { response: GetOpenIdResponse::pending() };
        let reply = pending.clone().into_wire_reply(&wire);
        assert_eq!(reply.to_value()["response"], json!({"state": "request"}));
        assert_eq!(WidgetResponse::from_wire(&reply).unwrap(), pending);

        let allowed = WidgetResponse::GetOpenId { response: GetOpenIdResponse::allowed(token()) };
        let reply = allowed.clone().into_wire_reply(&wire);
        assert_eq!(
            reply.to_value()["response"],
            json!({"state": "allowed", "access_token": "tok", "token_type": "Bearer",
                   "matrix_server_name": "example.org", "expires_in": 3600})
        );
        assert_eq!(WidgetResponse::from_wire(&reply).unwrap(), allowed);
        assert_eq!(GetOpenIdResponse::allowed(token()).token(), Some(token()));
        // A blocked response may carry no token fields at all.
        let blocked = wire.response_to(json!({"state": "blocked"}));
        assert_eq!(
            WidgetResponse::from_wire(&blocked).unwrap(),
            WidgetResponse::GetOpenId { response: GetOpenIdResponse::blocked() }
        );
        assert!(GetOpenIdResponse::blocked().token().is_none());
    }
}
