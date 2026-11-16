//! The URL check in front of every widget iframe (webview): which `url` of a widget state event a
//! client may load at all.

use url::Url;

/// Why `url` cannot be loaded as a widget, or `None` when it can.
///
/// Only absolute `https:` URLs, and `http:` ones when `allow_http` is set (MSC4411 allows them in
/// developer tools). A `javascript:`, `data:`, `blob:`, `about:` or relative URL would run in, or
/// inherit, the origin of the page that loads it; for a legacy widget that is the compat wrapper,
/// which a host typically serves from its own origin.
///
/// The URL is parsed as a browser parses an iframe's `src` (the WHATWG URL Standard): leading and
/// trailing spaces and control characters, and tabs and newlines anywhere, are dropped; the scheme
/// is case-insensitive. A URL that means another URL relative to the page that embeds it is
/// refused too: `https:example.org` and `http:/path` parse on their own, but an iframe resolves
/// them against the host page when that page has the same scheme, which makes them pages of the
/// host's own origin. Such a URL takes the host of the page it is resolved against, so the check
/// resolves it against pages of its scheme on two different hosts: only a URL that names its own
/// host (two slashes, or backslashes for them, after the scheme) is the same on both. One page
/// would not do: `http:/base.invalid/../x` resolved against `http://base.invalid/` is the URL
/// itself.
///
/// A legacy URL is checked as the template it is: one that starts with a `$variable` has no scheme
/// and is refused, since the variable could expand to one; after the scheme a variable cannot
/// change it (the compat wrapper URI-encodes what it fills in).
///
/// The text names the scheme, never the URL.
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn widget_url_problem(url: &str, allow_http: bool) -> Option<String> {
    let allowed = if allow_http { "http: and https:" } else { "https:" };
    let not_absolute = || Some(format!("the URL is not an absolute {} URL", allowed.replace(" and ", " or ")));
    let Ok(parsed) = Url::parse(url) else { return not_absolute() };
    match parsed.scheme() {
        "https" => {}
        "http" if allow_http => {}
        scheme => return Some(format!("{scheme}: URLs are not allowed, only {allowed}")),
    }
    // Against pages of its own scheme: a URL relative there takes the page's host, so it cannot
    // equal itself on two pages with different hosts.
    let same_on = |host: &str| {
        let base = Url::parse(&format!("{}://{host}/", parsed.scheme())).expect("a valid base URL");
        Url::options().base_url(Some(&base)).parse(url).is_ok_and(|resolved| resolved == parsed)
    };
    if same_on("a.invalid") && same_on("b.invalid") {
        None
    } else {
        not_absolute()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde::Deserialize;

    use super::*;

    /// The shared table of `tests/widget_urls.json`; the host's vitest reads it too.
    #[derive(Deserialize)]
    struct Table {
        allowed: BTreeMap<String, String>,
        refused: BTreeMap<String, String>,
    }

    fn table() -> Table {
        serde_json::from_str(include_str!("../tests/widget_urls.json")).unwrap()
    }

    #[test]
    fn allows_absolute_http_and_https_urls() {
        for (label, url) in table().allowed {
            assert_eq!(widget_url_problem(&url, true), None, "{label}: {url:?}");
        }
    }

    #[test]
    fn refuses_everything_else() {
        for (label, url) in table().refused {
            assert!(widget_url_problem(&url, true).is_some(), "{label}: {url:?}");
        }
    }

    #[test]
    fn names_the_scheme_never_the_url() {
        let problem = |url| widget_url_problem(url, true);
        assert_eq!(problem("JAVASCRIPT:alert(1)").unwrap(), "javascript: URLs are not allowed, only http: and https:");
        assert_eq!(problem("$matrix_widget_url").unwrap(), "the URL is not an absolute http: or https: URL");
        assert_eq!(problem("vbscript:msgbox(1)").unwrap(), "vbscript: URLs are not allowed, only http: and https:");
    }

    #[test]
    fn a_url_relative_to_the_embedding_page_is_refused() {
        // Without a base `http://widget_compatibility_wrapper/…`; in an iframe of
        // `http://localhost:5173/` the host's own compat wrapper, on the host's origin.
        let url =
            "http:/widget_compatibility_wrapper/?legacy_widget_url=javascript:top.__pwned=1//&legacy_widget_id=evil";
        assert!(Url::parse(url).is_ok());
        assert_eq!(widget_url_problem(url, true).unwrap(), "the URL is not an absolute http: or https: URL");
        assert!(widget_url_problem("https:example.org", true).is_some());
        // Naming the host of the page it is checked against does not make it absolute: in an
        // iframe of `http://localhost:5173/` this is the host's own compat wrapper again.
        for host in ["a.invalid", "b.invalid", "base.invalid"] {
            let url = format!("http:/{host}/../widget_compatibility_wrapper/?legacy_widget_url=javascript:x");
            assert_eq!(Url::parse(&url).unwrap().host_str(), Some(host));
            assert!(widget_url_problem(&url, true).is_some(), "{url}");
            assert!(widget_url_problem(&format!("https:{host}/.."), true).is_some(), "{host}");
        }
        // Backslashes count as slashes after a special scheme: absolute on every page.
        assert_eq!(widget_url_problem("HTTP:\\\\example.org\\a", true), None);
    }

    #[test]
    fn https_only_unless_http_is_allowed() {
        assert_eq!(widget_url_problem("https://example.org/", false), None);
        assert_eq!(
            widget_url_problem("http://localhost:5175/new/", false).unwrap(),
            "http: URLs are not allowed, only https:"
        );
        assert_eq!(widget_url_problem("data:text/html,x", false).unwrap(), "data: URLs are not allowed, only https:");
        assert_eq!(widget_url_problem("/widget/", false).unwrap(), "the URL is not an absolute https: URL");
        assert_eq!(widget_url_problem("http://localhost:5175/new/", true), None);
    }
}
