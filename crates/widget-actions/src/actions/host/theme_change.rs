//! `theme_change` (MSC2873), host -> widget: the client's theme changed.
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
        let wire = HostRequest::ThemeChange { theme: theme.clone().into() }.into_wire("t");
        assert_eq!(wire.action, "theme_change");
        assert_eq!(wire.to_value()["request"], theme);
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), HostRequest::ThemeChange { theme: theme.into() });
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::ThemeChange);
    }
}
