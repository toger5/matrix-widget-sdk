//! `update_theme` (MSC2873), host -> widget: the client's theme changed. Needs
//! `host:…update_theme`.
//!
//! Body: a free-form object describing the theme (MSC2873 deliberately leaves its shape to the
//! client; the compat wrapper's `$org.matrix.msc2873.client_theme` template variable is its
//! `name`), acknowledged with `{}`.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{HostRequest, HostResponse};

    #[test]
    fn roundtrip() {
        let theme = json!({"name": "dark", "is_dark": true});
        let wire = HostRequest::UpdateTheme { theme: theme.clone().into() }.into_wire("t");
        assert_eq!(wire.action, "org.matrix.mscXXXX.update_theme");
        assert_eq!(wire.to_value()["request"], theme);
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), HostRequest::UpdateTheme { theme: theme.into() });
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::UpdateTheme);
    }
}
