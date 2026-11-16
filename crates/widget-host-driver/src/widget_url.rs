//! The URL check in front of every widget iframe (webview): which `url` of a widget state event a
//! client may load at all, and that it is not the client's own compat wrapper.

use percent_encoding::percent_decode_str;
use url::Url;

/// Why [`embed_url_problem`] refuses a page of the client's compat wrapper.
const LOADS_THE_WRAPPER: &str = "a widget cannot load this client's compat wrapper";

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
    checked_widget_url(url, allow_http).err()
}

/// Why a client whose compat wrapper is at `wrapper_url` must not load `url` as a widget (of either
/// kind), or `None` when it can: [`widget_url_problem`], or `url` is a page of that compat wrapper.
/// [`WidgetDefinition::embed`](crate::WidgetDefinition::embed) refuses the same URLs.
///
/// A client typically serves the compat wrapper from its own origin, and the wrapper loads whatever
/// its `legacy_widget_url` parameter names into an iframe of its own. A widget whose URL is the
/// wrapper (with a `legacy_widget_url` of the widget's choosing) would run on the client's origin.
/// Only the wrapper's directory is refused, not its whole origin: a deployment may serve widgets
/// from the same origin under other paths (this repository's dev site does). A page counts as the
/// wrapper's when a web server could answer it with the wrapper: the same origin, and a path in the
/// wrapper's directory (its path up to the last `/`) or that directory without its trailing slash,
/// compared after percent-decoding, with dot segments resolved, repeated slashes as one and in
/// lower case (Vite's dev server serves the wrapper for `/widget%5Fcompatibility%5Fwrapper/`,
/// `/WIDGET_COMPATIBILITY_WRAPPER/`, `//widget_compatibility_wrapper/` and
/// `/x/..%2Fwidget_compatibility_wrapper/`). A `wrapper_url` that is no widget URL itself
/// ([`widget_url_problem`] with `http:`) cannot be loaded, so nothing is a page of it.
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn embed_url_problem(url: &str, wrapper_url: Option<String>, allow_http: bool) -> Option<String> {
    checked_embed_url(url, wrapper_url.as_deref(), allow_http).err()
}

/// [`widget_url_problem`], with the URL as the check parsed it.
pub(crate) fn checked_widget_url(url: &str, allow_http: bool) -> Result<Url, String> {
    let allowed = if allow_http { "http: and https:" } else { "https:" };
    let not_absolute = || format!("the URL is not an absolute {} URL", allowed.replace(" and ", " or "));
    let Ok(parsed) = Url::parse(url) else { return Err(not_absolute()) };
    match parsed.scheme() {
        "https" => {}
        "http" if allow_http => {}
        scheme => return Err(format!("{scheme}: URLs are not allowed, only {allowed}")),
    }
    // Against pages of its own scheme: a URL relative there takes the page's host, so it cannot
    // equal itself on two pages with different hosts.
    let same_on = |host: &str| {
        let base = Url::parse(&format!("{}://{host}/", parsed.scheme())).expect("a valid base URL");
        Url::options().base_url(Some(&base)).parse(url).is_ok_and(|resolved| resolved == parsed)
    };
    if same_on("a.invalid") && same_on("b.invalid") {
        Ok(parsed)
    } else {
        Err(not_absolute())
    }
}

/// [`embed_url_problem`], with the URL as the check parsed it.
pub(crate) fn checked_embed_url(url: &str, wrapper_url: Option<&str>, allow_http: bool) -> Result<Url, String> {
    let parsed = checked_widget_url(url, allow_http)?;
    let wrapper = wrapper_url.and_then(|wrapper| checked_widget_url(wrapper, true).ok());
    if wrapper.is_some_and(|wrapper| is_compat_wrapper_page(&parsed, &wrapper)) {
        return Err(LOADS_THE_WRAPPER.to_owned());
    }
    Ok(parsed)
}

/// Whether a web server could answer `url` with a page of the compat wrapper at `wrapper` (see
/// [`embed_url_problem`]).
fn is_compat_wrapper_page(url: &Url, wrapper: &Url) -> bool {
    if url.origin() != wrapper.origin() {
        return false;
    }
    let wrapper_path = served_path(wrapper);
    // The wrapper's directory without its trailing slash: empty for a wrapper at the root.
    let directory = &wrapper_path[..wrapper_path.rfind('/').unwrap_or(0)];
    let path = served_path(url);
    path == directory || path.starts_with(&format!("{directory}/"))
}

/// The path of `url` as a web server may read it: percent-decoded, `\` as `/`, dot segments
/// resolved, repeated slashes as one, in lower case (a case-insensitive file system); again until
/// nothing changes, for a server that decodes twice.
fn served_path(url: &Url) -> String {
    let mut scratch = Url::parse("http://path.invalid/").expect("a valid URL");
    let mut path = url.path().to_lowercase();
    // Each round decodes one level of percent-encoding; servers decode once, some twice.
    for _ in 0..4 {
        let decoded = percent_decode_str(&path).decode_utf8_lossy().replace('\\', "/");
        let mut single = String::with_capacity(decoded.len());
        for c in decoded.chars() {
            if c != '/' || !single.ends_with('/') {
                single.push(c);
            }
        }
        // Resolves the dot segments the decoding revealed (`/x/..%2Fy` is `/y` to a server).
        scratch.set_path(&single);
        let next = scratch.path().to_lowercase();
        if next == path {
            break;
        }
        path = next;
    }
    path
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
        compat_wrapper: WrapperTable,
    }

    /// Its `compat_wrapper` part: pages of the wrapper and other pages of its origin.
    #[derive(Deserialize)]
    struct WrapperTable {
        wrapper: String,
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
    fn the_compat_wrapper_is_no_widget() {
        let WrapperTable { wrapper, allowed, refused } = table().compat_wrapper;
        for (label, url) in refused {
            assert_eq!(widget_url_problem(&url, true), None, "{label}: a widget URL on its own");
            assert_eq!(
                embed_url_problem(&url, Some(wrapper.clone()), true).as_deref(),
                Some(LOADS_THE_WRAPPER),
                "{label}"
            );
            // A client without a compat wrapper has none to protect.
            assert_eq!(embed_url_problem(&url, None, true), None, "{label}");
        }
        for (label, url) in allowed {
            assert_eq!(embed_url_problem(&url, Some(wrapper.clone()), true), None, "{label}: {url}");
        }
        // The URL check comes first; a wrapper URL that cannot be loaded protects nothing.
        let problem = |url: &str, wrapper: &str| embed_url_problem(url, Some(wrapper.to_owned()), true);
        assert_eq!(
            problem("javascript:x", &wrapper).unwrap(),
            "javascript: URLs are not allowed, only http: and https:"
        );
        assert_eq!(problem("http://localhost:5173/widget_compatibility_wrapper/", "javascript:x"), None);
        assert_eq!(
            problem("http://localhost:5173/widget_compatibility_wrapper/", "/widget_compatibility_wrapper/"),
            None
        );
    }

    #[test]
    fn the_wrappers_directory_is_refused() {
        let wrapper_page = |url: &str, wrapper: &str| embed_url_problem(url, Some(wrapper.to_owned()), true).is_some();
        // A wrapper page that is a file: the other files of its directory may be the wrapper too.
        assert!(wrapper_page("https://c.example/compat/other.html", "https://c.example/compat/wrapper.html"));
        assert!(wrapper_page("https://c.example/compat", "https://c.example/compat/wrapper.html"));
        assert!(!wrapper_page("https://c.example/widgets/", "https://c.example/compat/wrapper.html"));
        // A wrapper at the root of its origin: every page of that origin (and only of that origin).
        for url in ["https://compat.example/", "https://compat.example/any/widget", "https://compat.example"] {
            assert!(wrapper_page(url, "https://compat.example/?log_level=debug"), "{url}");
        }
        assert!(!wrapper_page("https://widgets.example/", "https://compat.example/"));
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
