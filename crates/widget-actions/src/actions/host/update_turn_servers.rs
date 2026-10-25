//! `update_turn_servers` (MSC3846), host -> widget: a (new) set of TURN credentials for a widget
//! that is watching them.
//!
//! Body: a [`TurnServer`](crate::TurnServer), acknowledged with `{}`.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{HostRequest, HostResponse, TurnServer};

    #[test]
    fn roundtrip() {
        let server = TurnServer {
            uris: vec!["turn:turn.example.org:3478?transport=udp".into()],
            username: "u".into(),
            password: "p".into(),
        };
        let wire = HostRequest::UpdateTurnServers { server: server.clone() }.into_wire("u");
        assert_eq!(wire.action, "update_turn_servers");
        assert_eq!(
            wire.to_value()["request"],
            json!({"uris": ["turn:turn.example.org:3478?transport=udp"], "username": "u", "password": "p"})
        );
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), HostRequest::UpdateTurnServers { server });
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::UpdateTurnServers);
    }
}
