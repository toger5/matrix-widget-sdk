//! `get_openid` (MSC1960; as a capability: `spec/patch/new/openid-capability.md`), widget -> host:
//! ask for an OpenID token that proves the user's identity to a third party.
//!
//! Empty request body. Requires `widget:…get_openid`, which the user grants in the capability
//! prompt like any other capability. A host usually grants it for one use only: after the reply it
//! sends `update_capabilities` without it, and the widget requests it again for the next token.
//! While the widget holds it, the host answers at once with the token: the body of
//! `POST /_matrix/client/v3/user/{userId}/openid/request_token` ([`OpenIdToken`]). Without it the
//! answer is a `missing_capability` error.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{OpenIdToken, WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let wire = WidgetRequest::GetOpenId.into_wire("o");
        assert_eq!(wire.action, "org.matrix.mscXXXX.get_openid");
        assert_eq!(wire.to_value()["request"], json!({}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), WidgetRequest::GetOpenId);

        let token = OpenIdToken {
            access_token: "tok".into(),
            token_type: "Bearer".into(),
            matrix_server_name: "example.org".into(),
            expires_in: 3600,
        };
        let reply = WidgetResponse::GetOpenId { response: token.clone() }.into_wire_reply(&wire);
        // The response is the token itself: no `state`, no `original_request_id`.
        assert_eq!(
            reply.to_value()["response"],
            json!({"access_token": "tok", "token_type": "Bearer", "matrix_server_name": "example.org", "expires_in": 3600})
        );
        assert_eq!(WidgetResponse::from_wire(&reply).unwrap(), WidgetResponse::GetOpenId { response: token });

        // The legacy (MSC1960) shapes are not a token.
        for legacy in [json!({"state": "request"}), json!({"state": "blocked"})] {
            assert!(WidgetResponse::from_wire(&wire.response_to(legacy)).is_err());
        }
    }
}
