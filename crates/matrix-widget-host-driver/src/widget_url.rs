//! The URL check in front of every widget iframe (webview): which `url` of a widget state event a
//! client may load at all, that it is not the client's own compat wrapper, and not a page of the
//! client's own origin.

use percent_encoding::percent_decode_str;
use url::{Origin, Url};

/// Why [`checked_embed_url`] refuses a page of the client's compat wrapper.
const LOADS_THE_WRAPPER: &str = "a widget cannot load this client's compat wrapper";
/// Why [`checked_embed_url`] refuses a page of the client's own origin.
const ON_THE_CLIENTS_ORIGIN: &str = "a widget cannot be a page of this client's own origin";

/// What a client tells [`parse_widget_state_event`](crate::parse_widget_state_event)
/// and [`WidgetHostDriver::new`](crate::WidgetHostDriver::new) about itself.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct EmbedOptions {
    /// Where the client's compat wrapper is: no widget may be a page of it, and legacy widgets are
    /// loaded through it. `None`: the client has none and loads no legacy widget.
    pub wrapper_url: Option<String>,
    /// The origin of the client's own pages (`https://app.example`, `location.origin` in a
    /// browser). A widget there would get the client's origin in its iframe (`allow-same-origin`,
    /// one of the base `sandbox` tokens), so it is refused, unless it is in `own_widget_dirs`.
    /// `None`, or something that is no http(s) origin: not checked (a native client).
    pub client_origin: Option<String>,
    /// Directories (URLs ending in `/`, or the directory of a URL) of pages the client ships
    /// itself as widgets, for example the test widgets of a developer site: the exception to the
    /// rule of `client_origin`. They run the client's own code. A directory at the root of an
    /// origin is ignored: it would hold the client itself.
    pub own_widget_dirs: Vec<String>,
    /// Also `http:` URLs (MSC4411 allows them in developer tools).
    pub allow_http: bool,
}

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

/// Why a client must not load `url` as a widget (of either kind), with the URL as the check parsed it:
/// [`widget_url_problem`] (with [`EmbedOptions::allow_http`]); `url` is a page of the client's
/// compat wrapper ([`EmbedOptions::wrapper_url`]); or it is a page of the client's own origin
/// ([`EmbedOptions::client_origin`]) outside the client's own widget directories.
/// [`parse_widget_state_event`](crate::parse_widget_state_event) and
/// [`WidgetHostDriver::new`](crate::WidgetHostDriver::new) run it; a client checks a URL through
/// them.
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
///
/// Every widget iframe gets `allow-scripts allow-same-origin` (the base of the webview
/// capabilities, `crate::webview`), so a page of the client's own origin in one would not be
/// sandboxed from the client: it could reach the client's window, storage and logins
/// (`spec/patch/msc4411/strict-webview-defaults.md`). Such pages are refused, whole origin, unless
/// they are in one of [`EmbedOptions::own_widget_dirs`]: same origin, and the path in the
/// directory both as written and as a server may read it (decoded, dot segments resolved, in lower
/// case; see above), so that `/widgets/..%2F` and `/WIDGETS/` (on a case-sensitive server another
/// page, maybe the client itself) are not in `/widgets/`.
pub(crate) fn checked_embed_url(url: &str, options: &EmbedOptions) -> Result<Url, String> {
    let parsed = checked_widget_url(url, options.allow_http)?;
    let wrapper = options.wrapper_url.as_deref().and_then(|wrapper| checked_widget_url(wrapper, true).ok());
    if wrapper.is_some_and(|wrapper| is_compat_wrapper_page(&parsed, &wrapper)) {
        return Err(LOADS_THE_WRAPPER.to_owned());
    }
    if client_origin(options).is_some_and(|origin| parsed.origin() == origin)
        && !options.own_widget_dirs.iter().any(|dir| is_own_widget_page(&parsed, dir))
    {
        return Err(ON_THE_CLIENTS_ORIGIN.to_owned());
    }
    Ok(parsed)
}

/// [`EmbedOptions::client_origin`] if it is an http(s) origin.
fn client_origin(options: &EmbedOptions) -> Option<Origin> {
    let parsed = Url::parse(options.client_origin.as_deref()?).ok()?;
    matches!(parsed.scheme(), "http" | "https").then(|| parsed.origin())
}

/// Whether a web server could answer `url` with a page of the compat wrapper at `wrapper` (see
/// [`checked_embed_url`]).
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

/// Whether `url` is a page in the own widget directory `dir` (see [`checked_embed_url`]): the
/// opposite direction of [`is_compat_wrapper_page`], so a page counts only if it is in the
/// directory however a server reads it.
fn is_own_widget_page(url: &Url, dir: &str) -> bool {
    let Ok(dir) = checked_widget_url(dir, true) else { return false };
    // The directory with its trailing slash; never the root of the origin.
    let literal = &dir.path()[..=dir.path().rfind('/').unwrap_or(0)];
    let served = served_path(&dir);
    let served = &served[..=served.rfind('/').unwrap_or(0)];
    url.origin() == dir.origin()
        && literal != "/"
        && served != "/"
        && url.path().starts_with(literal)
        && served_path(url).starts_with(served)
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
pub(crate) mod tests {
    use std::collections::BTreeMap;

    use serde::Deserialize;

    use super::*;

    fn embed_url_problem(url: &str, options: EmbedOptions) -> Option<String> {
        checked_embed_url(url, &options).err()
    }

    /// The shared table of `tests/widget_urls.json`; the host's vitest reads it too.
    #[derive(Deserialize)]
    pub(crate) struct Table {
        pub allowed: BTreeMap<String, String>,
        pub refused: BTreeMap<String, String>,
        pub compat_wrapper: WrapperTable,
        pub client_origin: ClientOriginTable,
    }

    /// Its `client_origin` part: pages of the client's origin, in its own widget directories, and
    /// of other origins.
    #[derive(Deserialize)]
    pub(crate) struct ClientOriginTable {
        pub client: String,
        pub own_widget_dirs: Vec<String>,
        pub refused: BTreeMap<String, String>,
        pub own_widgets: BTreeMap<String, String>,
        pub other_origins: BTreeMap<String, String>,
    }

    impl ClientOriginTable {
        /// The options of the table's client: its origin, its own widgets and a compat wrapper.
        pub(crate) fn options(&self) -> EmbedOptions {
            EmbedOptions {
                wrapper_url: Some(format!("{}/widget_compatibility_wrapper/", self.client)),
                client_origin: Some(self.client.clone()),
                own_widget_dirs: self.own_widget_dirs.clone(),
                allow_http: true,
            }
        }
    }

    /// The options of a client with a compat wrapper at `wrapper`, nothing else.
    fn with_wrapper(wrapper: &str) -> EmbedOptions {
        EmbedOptions { wrapper_url: Some(wrapper.to_owned()), allow_http: true, ..EmbedOptions::default() }
    }

    /// Its `compat_wrapper` part: pages of the wrapper and other pages of its origin.
    #[derive(Deserialize)]
    pub(crate) struct WrapperTable {
        pub wrapper: String,
        pub allowed: BTreeMap<String, String>,
        pub refused: BTreeMap<String, String>,
    }

    pub(crate) fn table() -> Table {
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
        let without = EmbedOptions { allow_http: true, ..EmbedOptions::default() };
        for (label, url) in refused {
            assert_eq!(widget_url_problem(&url, true), None, "{label}: a widget URL on its own");
            assert_eq!(embed_url_problem(&url, with_wrapper(&wrapper)).as_deref(), Some(LOADS_THE_WRAPPER), "{label}");
            // A client without a compat wrapper has none to protect.
            assert_eq!(embed_url_problem(&url, without.clone()), None, "{label}");
        }
        for (label, url) in allowed {
            assert_eq!(embed_url_problem(&url, with_wrapper(&wrapper)), None, "{label}: {url}");
        }
        // The URL check comes first; a wrapper URL that cannot be loaded protects nothing.
        let problem = |url: &str, wrapper: &str| embed_url_problem(url, with_wrapper(wrapper));
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
        let wrapper_page = |url: &str, wrapper: &str| embed_url_problem(url, with_wrapper(wrapper)).is_some();
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
    fn no_page_of_the_clients_origin_but_its_own_widgets() {
        let table = table().client_origin;
        let options = table.options();
        let ClientOriginTable { client, refused, own_widgets, other_origins, .. } = table;
        for (label, url) in refused {
            assert_eq!(widget_url_problem(&url, true), None, "{label}: a widget URL on its own");
            assert_eq!(embed_url_problem(&url, options.clone()).as_deref(), Some(ON_THE_CLIENTS_ORIGIN), "{label}");
            // Without the client's origin (a native client) nothing is checked.
            let native = EmbedOptions { client_origin: None, ..options.clone() };
            assert_eq!(embed_url_problem(&url, native), None, "{label}");
        }
        for (label, url) in own_widgets {
            assert_eq!(embed_url_problem(&url, options.clone()), None, "{label}: {url}");
            // Only as the client's own widgets.
            let none = EmbedOptions { own_widget_dirs: vec![], ..options.clone() };
            assert_eq!(embed_url_problem(&url, none).as_deref(), Some(ON_THE_CLIENTS_ORIGIN), "{label}");
        }
        for (label, url) in other_origins {
            assert_eq!(embed_url_problem(&url, options.clone()), None, "{label}: {url}");
        }
        // The compat wrapper's own refusal comes first, also inside an own widget directory.
        let wrapper_in_dir = EmbedOptions { own_widget_dirs: vec![format!("{client}/")], ..options.clone() };
        let wrapper = format!("{client}/widget_compatibility_wrapper/");
        assert_eq!(embed_url_problem(&wrapper, wrapper_in_dir.clone()).as_deref(), Some(LOADS_THE_WRAPPER));
        // A directory at the root of the origin is no exception: it would hold the client.
        assert_eq!(embed_url_problem(&format!("{client}/"), wrapper_in_dir).as_deref(), Some(ON_THE_CLIENTS_ORIGIN));
        // A client origin that is no http(s) origin checks nothing.
        for origin in ["null", "", "file:///home/", "/relative"] {
            let odd = EmbedOptions { client_origin: Some(origin.to_owned()), ..options.clone() };
            assert_eq!(embed_url_problem(&format!("{client}/app/"), odd), None, "{origin:?}");
        }
        // Any spelling of the origin.
        let spelled = EmbedOptions { client_origin: Some(format!("{}/some/page?x", client.to_uppercase())), ..options };
        assert_eq!(embed_url_problem(&format!("{client}/app/"), spelled).as_deref(), Some(ON_THE_CLIENTS_ORIGIN));
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
