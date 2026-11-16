//! The webview (iframe) a widget runs in: which webview capabilities a host grants without asking,
//! which never, and what the `sandbox` and `allow` attributes of the iframe are made of
//! (`spec/patch/new/webview-capabilities.md`; the strict default of
//! `spec/patch/msc4411/strict-webview-defaults.md`).
//!
//! A webview capability (`webview:…sandbox:<token>`, `webview:…allow:<feature>`) is requested and
//! granted like any other, but no action needs it: the client applies the granted ones to the
//! widget's iframe, which takes a reload. The driver grants and refuses them by [`WebviewPolicy`];
//! the platform builds the attributes with [`webview_attributes`].

use widget_actions::{is_webview_value, Capability};

/// The `sandbox` tokens of every widget iframe, in this order: scripts, and the widget's own origin
/// (without it the widget has an opaque origin: no storage, its own files only through CORS, and
/// a host cannot address it with `postMessage`).
pub const BASE_SANDBOX: [&str; 2] = ["allow-scripts", "allow-same-origin"];

/// The `sandbox` tokens that are never granted: they let the widget navigate the client away
/// (`allow-top-navigation`, `allow-top-navigation-by-user-activation`,
/// `allow-top-navigation-to-custom-protocols`).
const NEVER_SANDBOX_PREFIX: &str = "allow-top-navigation";

/// How a host treats a webview capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebviewPolicy {
    /// Part of every webview ([`BASE_SANDBOX`]): granted when requested, without asking.
    Base,
    /// Granted when the user (or the client's policy) approves it.
    Ask,
    /// Never granted and never asked about: the `allow-top-navigation` tokens.
    Never,
}

impl WebviewPolicy {
    /// The policy of a webview capability; `None` for every other capability.
    pub fn of(capability: &Capability) -> Option<Self> {
        Some(match capability {
            Capability::WebviewSandbox { token } if BASE_SANDBOX.contains(&token.as_str()) => Self::Base,
            Capability::WebviewSandbox { token } if token.starts_with(NEVER_SANDBOX_PREFIX) => Self::Never,
            Capability::WebviewSandbox { .. } | Capability::WebviewAllow { .. } => Self::Ask,
            _ => return None,
        })
    }

    /// Whether the platform is asked about `capability`: neither [`Base`](Self::Base) (granted
    /// anyway) nor [`Never`](Self::Never).
    pub(crate) fn asks(capability: &Capability) -> bool {
        !matches!(Self::of(capability), Some(Self::Base | Self::Never))
    }

    /// Whether `capability` is granted, given that the platform approved it (`approved`).
    pub(crate) fn grants(capability: &Capability, approved: bool) -> bool {
        match Self::of(capability) {
            Some(Self::Base) => true,
            Some(Self::Never) => false,
            Some(Self::Ask) | None => approved,
        }
    }
}

/// The `sandbox` and `allow` attributes of a widget's iframe.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct WebviewAttributes {
    /// The `sandbox` attribute: the [base tokens](BASE_SANDBOX), then the granted ones in
    /// alphabetical order, separated by spaces.
    pub sandbox: String,
    /// The `allow` attribute (Permissions Policy): `<feature> 'src'` per granted feature, in
    /// alphabetical order, separated by `; `. Empty without one, which delegates no feature.
    pub allow: String,
}

/// The attributes of the iframe of a widget that holds `capabilities`.
///
/// Only webview capabilities count; anything else is ignored. The [base tokens](BASE_SANDBOX) are
/// always in `sandbox`, a [never](WebviewPolicy::Never) token never is, and every value is checked
/// again ([`is_webview_value`]), so nothing but single web tokens reaches the attributes, whatever
/// the caller passes. Each feature is delegated to the origin of the iframe's `src` only (`'src'`).
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn webview_attributes(capabilities: Vec<Capability>) -> WebviewAttributes {
    let mut sandbox: Vec<&str> = Vec::new();
    let mut allow: Vec<&str> = Vec::new();
    for capability in &capabilities {
        match (capability, WebviewPolicy::of(capability)) {
            (_, Some(WebviewPolicy::Base | WebviewPolicy::Never) | None) => {}
            (Capability::WebviewSandbox { token }, _) if is_webview_value(token) => sandbox.push(token),
            (Capability::WebviewAllow { feature }, _) if is_webview_value(feature) => allow.push(feature),
            _ => {}
        }
    }
    for list in [&mut sandbox, &mut allow] {
        list.sort_unstable();
        list.dedup();
    }
    WebviewAttributes {
        sandbox: BASE_SANDBOX.iter().chain(&sandbox).copied().collect::<Vec<_>>().join(" "),
        allow: allow.iter().map(|feature| format!("{feature} 'src'")).collect::<Vec<_>>().join("; "),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps(raw: &[&str]) -> Vec<Capability> {
        raw.iter().map(|r| Capability::parse(r)).collect()
    }

    #[test]
    fn the_strict_default() {
        let strict = WebviewAttributes { sandbox: "allow-scripts allow-same-origin".into(), allow: String::new() };
        assert_eq!(webview_attributes(vec![]), strict);
        // Other capabilities change nothing; the base tokens are there once, requested or not.
        assert_eq!(
            webview_attributes(caps(&[
                "widget:m.navigate",
                "webview:m.sandbox:allow-same-origin",
                "webview:org.matrix.mscXXXX.sandbox:allow-scripts",
                "garbage",
            ])),
            strict
        );
    }

    #[test]
    fn granted_tokens_and_features_in_alphabetical_order() {
        let attributes = webview_attributes(caps(&[
            "webview:m.allow:microphone",
            "webview:org.matrix.mscXXXX.sandbox:allow-popups",
            "webview:m.allow:camera",
            "webview:m.sandbox:allow-forms",
            "webview:m.allow:camera",
        ]));
        assert_eq!(attributes.sandbox, "allow-scripts allow-same-origin allow-forms allow-popups");
        assert_eq!(attributes.allow, "camera 'src'; microphone 'src'");
    }

    #[test]
    fn never_the_top_navigation() {
        for token in [
            "allow-top-navigation",
            "allow-top-navigation-by-user-activation",
            "allow-top-navigation-to-custom-protocols",
        ] {
            let capability = Capability::webview_sandbox(token);
            assert_eq!(WebviewPolicy::of(&capability), Some(WebviewPolicy::Never), "{token}");
            assert!(!WebviewPolicy::asks(&capability) && !WebviewPolicy::grants(&capability, true));
            assert_eq!(webview_attributes(vec![capability]).sandbox, "allow-scripts allow-same-origin");
        }
    }

    #[test]
    fn policies() {
        let policy = |raw: &str| WebviewPolicy::of(&Capability::parse(raw));
        assert_eq!(policy("webview:m.sandbox:allow-scripts"), Some(WebviewPolicy::Base));
        assert_eq!(policy("webview:org.matrix.mscXXXX.sandbox:allow-same-origin"), Some(WebviewPolicy::Base));
        assert_eq!(policy("webview:m.sandbox:allow-popups"), Some(WebviewPolicy::Ask));
        assert_eq!(policy("webview:m.sandbox:allow-modals"), Some(WebviewPolicy::Ask));
        assert_eq!(policy("webview:m.allow:camera"), Some(WebviewPolicy::Ask));
        // A feature named like a base token is a feature.
        assert_eq!(policy("webview:m.allow:allow-scripts"), Some(WebviewPolicy::Ask));
        assert_eq!(policy("widget:m.navigate"), None);
        assert_eq!(policy("webview:m.allow:camera *"), None);
        assert!(
            WebviewPolicy::grants(&Capability::Navigate, true) && !WebviewPolicy::grants(&Capability::Navigate, false)
        );
        assert!(WebviewPolicy::grants(&Capability::webview_sandbox("allow-scripts"), false));
        assert!(
            WebviewPolicy::asks(&Capability::webview_allow("camera")) && WebviewPolicy::asks(&Capability::Navigate)
        );
    }

    #[test]
    fn nothing_but_web_tokens_reaches_the_attributes() {
        // Built by hand around the constructors: checked again.
        let forged = vec![
            Capability::WebviewAllow { feature: "camera *; usb".into() },
            Capability::WebviewSandbox { token: "allow-popups\" onload=\"x".into() },
            Capability::WebviewSandbox { token: "allow-top-navigation".into() },
            Capability::webview_allow("geolocation"),
        ];
        assert_eq!(
            webview_attributes(forged),
            WebviewAttributes { sandbox: "allow-scripts allow-same-origin".into(), allow: "geolocation 'src'".into() }
        );
    }
}
