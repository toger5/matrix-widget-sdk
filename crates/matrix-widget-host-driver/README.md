# matrix-widget-host-driver

**Responsibility:** the host side of the widget API. Everything a Matrix client must do
to support widgets. It runs the setup (capabilities and `notify_ready`), checks every request
against the approved capabilities, calls the `MatrixBackend`, answers the widget, and pushes
events the widget is allowed to receive. It does not know about UI (`WidgetHostPlatform`) or
the matrix CS api (`MatrixBackend`); the client provides both.

With the `uniffi` feature its `cdylib` carries the UniFFI scaffolding of all three host crates.
It runs in any Matrix client: natively in Rust, in Kotlin / Swift / Python, and in TypeScript via
`packages/widget-host-bindings`.

![Architecture](../../docs/diagrams/01-architecture.svg)

## How to use it

One driver per rendered widget, made from the widget's state event:

```rust
use std::sync::Arc;
use matrix_widget_host_driver::{
    parse_widget_state_event, EmbedOptions, MatrixBackend, WidgetHostDriver, WidgetHostPlatform, WidgetIframe,
};
use matrix_widget_host_driver::matrix_widget_actions::Capability;

struct Platform { /* handle to the iframe + UI */ }
impl WidgetHostPlatform for Platform {
    fn load_iframe(&self, iframe: WidgetIframe) { /* a new iframe: src = iframe.url, sandbox, allow; show the loading state */ }
    fn send_to_widget(&self, json: String) { /* iframe.postMessage(json, iframe.origin) */ }
    fn on_capabilities_requested(&self, requested: Vec<Capability>) { /* show (or update) the prompt */ }
    fn on_ready(&self) { /* hide the loading state */ }
    // navigate, set_always_on_screen, client_id / client_theme / client_language
}

let options = EmbedOptions { /* the client's compat wrapper and origin, see below */ };
let widget = parse_widget_state_event(event_type, state_key, content, options.clone())?;
let backend: Arc<dyn MatrixBackend> = Arc::new(MySdkBackend::new(room));
let driver = WidgetHostDriver::new(widget, options, backend, Arc::new(Platform { /* … */ }))?;
driver.set_auto_approved(remembered);             // what the client remembers of earlier approvals
driver.start();                                   // → load_iframe

// 1. every message from the window of the iframe built last:
driver.handle_message_from_widget(json).await?;
// 2. after the user decided:
driver.approve_capabilities(approved);
// 3. whenever the user takes a permission away:
driver.revoke_capabilities(revoked);
```

`new` fails with `WidgetEventError::Refused` for a widget that must not be loaded (the check of
`parse_widget_state_event`, made again). Nothing is loaded before `start()`: it calls
`load_iframe` with the widget's `WidgetIframe { url, origin, sandbox, allow }`, and the driver calls
it again whenever the widget's webview capabilities change `sandbox` or `allow` (below).

`requested` is the whole open question: a request that arrives while the user decides joins it,
and the callback is called again with all of it (minus what the widget holds or gets without
asking). One `approve_capabilities` answers every request so far.

The driver subscribes to the backend itself once `host:…forward_event.*`, `host:…update_state`,
`host:…forward_to_device` or `host:…notify_timeline_update` capabilities are approved. The
client does not push events anywhere.

* Legacy widgets (`im.vector.modular.widgets`): the driver loads them through
  `packages/widget-compat-wrapper` (`EmbedOptions.wrapper_url`; it builds the wrapper's URL,
  below), builds the iframe of a legacy client and grants `legacy_auto_approved()` without asking:
  `get_matrix_context`, `get_client_context`, the theme, language and visibility updates and the
  webview capabilities of a legacy client's iframe (the wrapper requests them when it starts). The
  client passes none of this to `set_auto_approved`.
  The driver understands only the new capability and action names
  (`docs/spec-appendix/capability-naming-proposal.md`); the wrapper translates the legacy ones.
* A widget without `uses_widget_api: true` (MSC4412) has no widget API: `on_ready` is called right
  after `load_iframe`, and `handle_message_from_widget` refuses every message with
  `DriverError::NoWidgetApi`.
* Client pushes: `update_theme`, `update_language`, `update_visibility`. Each is sent only if
  the widget holds its `host:…` capability.
* Limited grants: `set_single_use(capabilities)` (default: `widget:…get_openid`) makes a request
  use its capability up. The driver takes it away when the request passes the check and sends
  `update_capabilities` without it after the reply, so every OpenID token is a decision of the
  user. Do not remember such an approval, unless the user chose "always": then pass it to
  `set_auto_approved`, and it is granted again per request without asking. A time limit is a
  timer of the client that calls `revoke_capabilities`.

## The widget's iframe: webview capabilities

Every widget iframe starts strict, `sandbox="allow-scripts allow-same-origin"` and an empty `allow`
([`spec/patch/msc4411/strict-webview-defaults.md`](../../spec/patch/msc4411/strict-webview-defaults.md)).
More is a capability of the source `webview` the widget requests like any other
([`spec/patch/new/webview-capabilities.md`](../../spec/patch/new/webview-capabilities.md)):
`webview:…sandbox:<token>`, `webview:…allow:<feature>`.

* `WebviewPolicy` (`src/webview.rs`): **base** (`allow-scripts`, `allow-same-origin`) is granted
  when requested, without asking the platform; **never** (`allow-top-navigation*`) is neither asked
  about nor granted, also when the platform approves it or it is auto-approved; everything else is
  asked about like any capability.
* `webview_attributes(capabilities) -> WebviewAttributes { sandbox, allow }` builds the attributes
  from what the widget holds (other capabilities are ignored): the base tokens first, then the
  granted ones sorted; each feature with the allowlist `'src'`. It checks every value again, so
  nothing but single web tokens reaches the attributes.
* Applying a grant is the driver's part: when a grant, a revocation or `set_auto_approved` changes
  `sandbox` or `allow`, it calls `load_iframe` again with the new attributes. The same driver goes
  on: it forgets the old page (not ready, holds nothing, no open question, subscriptions
  cancelled) and grants the page in the new iframe what the old one held without asking
  (`DriverSnapshot::carried`; not a single-use capability, not what was revoked since). The
  webview capabilities of `set_auto_approved` are part of the first iframe, so a remembered grant
  needs no reload.
* The client's part: build the new iframe in place of the old one, accept messages only from its
  window and `WidgetIframe::origin`, drop a prompt that shows the old page's question, and stop a
  widget that is reloaded too often (the widget host: `loadIframe` in
  `packages/widget-host/src/app/controller.ts`).
* `DriverSnapshot` has `iframe` (what the platform was last told to build), `carried`, and
  `auto_approved`: everything granted without asking (the list of `set_auto_approved`, a legacy
  widget's set, `carried`, the webview capabilities the iframe was built with).

## Which widgets a room has: the state event parser

Before there is a driver, the client reads the widget state events of the room
(`WIDGET_EVENT_TYPES`: MSC4411 `m.widget`, its unstable `org.matrix.msc4411.widget`, and the
legacy `im.vector.modular.widgets`) and decides what to list. The parser is here, so every client
decides the same:

```rust
use matrix_widget_host_driver::{parse_widget_state_event, EmbedOptions, WidgetEventError};

let options = EmbedOptions {
    wrapper_url: Some("https://wrapper.example/".into()),
    client_origin: Some("https://client.example".into()), // no widget of the client's own origin
    own_widget_dirs: vec![],
    allow_http: false,
};
match parse_widget_state_event(event_type, state_key, content, options.clone()) {
    // A widget to list (MSC4411: show its URL with the sender) and to make a driver from.
    Ok(widget) => show_in_list(&widget.name, widget.avatar_url.as_deref(), &widget.url),
    // A widget that must not be loaded: "javascript: URLs are not allowed, only https:".
    Err(WidgetEventError::Refused { widget, reason }) => show_disabled(&widget.name, &reason),
    // `Removed` (MSC4411: no string `url` or, for `m.widget`, `name`), `NotAWidgetType`: not listed.
    Err(_) => {}
}
```

* `parse_widget_state_event(event_type, state_key, content, options)` reads the event
  (`WidgetDefinition::parse`) and makes the check a driver makes when it is created from the
  definition: the URL check, and for a legacy widget the compat wrapper's URL. `Refused` carries
  the whole definition. What the iframe loads is not returned: it reaches the client from the
  driver (`WidgetIframe.url` of `load_iframe`).
* `widget_url_problem(url, allow_http)` is the URL check: only absolute `https:` URLs (and `http:`
  with `allow_http`, which MSC4411 allows in developer tools), parsed as a browser parses an
  iframe's `src` (WHATWG, the `url` crate). A URL that an iframe resolves against the page that
  embeds it (`https:example.org`, `http:/path`) is refused: it has to name its own host (`//` after
  the scheme). The texts name the scheme, never the URL.
* `embed_url_problem(url, options)` is that check for both kinds, with `EmbedOptions`
  (`wrapper_url`, `client_origin`, `own_widget_dirs`, `allow_http`): `widget_url_problem`, **no page
  of the client's compat wrapper** ("a widget cannot load this client's compat wrapper"), and **no
  page of the client's own origin** (below). A client usually serves the wrapper from its own origin with
  `allow-same-origin`, and the wrapper loads the `legacy_widget_url` of its own URL: an `m.widget`
  whose URL is the wrapper would bring a page of the event sender's choosing onto the client's
  origin (before the wrapper checked its inner URL, `javascript:` ran there). Refused are the pages
  of the wrapper's directory (its path up to the last `/`, and that directory without the slash)
  on the wrapper's origin, compared as a server may read the path: percent-decoded, dot segments
  resolved, repeated slashes as one, case-insensitive. Other paths of that origin stay allowed,
  since a deployment may serve its widgets there (the dev site does); a wrapper at the root of its
  origin refuses the whole origin. Serve the wrapper from an origin of its own where you can.
* **No page of the client's own origin** (`client_origin`, `location.origin` in a browser): every
  widget iframe has `allow-same-origin`, which would give such a page the client's origin, its
  window, storage and logins ("a widget cannot be a page of this client's own origin"). The one
  exception are directories of widgets the client ships itself (`own_widget_dirs`, the dev site's
  test widgets): a page counts only if its path is in the directory both as written and as a server
  may read it (`/widgets/..%2F` and `/WIDGETS/` are not in `/widgets/`); a directory at the root of
  the origin is ignored. Without `client_origin` (a native client) nothing is checked.
* An MSC4411 widget loads its `url` **as the check parsed and serialised it** (`WidgetIframe.url`),
  not the event's string: no other parser reads it differently, and `WidgetIframe.origin`, the
  widget's `postMessage` target origin, is the origin of the loaded page.
  A legacy widget loads the compat wrapper with
  `legacy_widget_url` (untemplated), `legacy_widget_id`, `legacy_wait_for_iframe_load` and
  `legacy_widget_data` in its query (see the wrapper's README; they replace any the wrapper URL
  has), and always uses the widget API. The wrapper checks the legacy URL again, before and after
  templating.
* Foreign code calls `parse_widget_state_event`, `widget_url_problem`, `embed_url_problem`,
  `widget_event_types`, `webview_attributes` and `legacy_auto_approved` (TypeScript:
  `parseWidgetStateEvent`, `embedUrlProblem`, `webviewAttributes`, `legacyAutoApproved`, …;
  `EmbedOptions`, `WidgetDefinition`, `WidgetIframe` and `WebviewAttributes` are plain objects).

### More diagrams

* [How to use the host driver with legacy widgets](../../docs/diagrams/02-legacy-widgets.svg)
* [Capabilities and how the actions use them](../../docs/diagrams/06-capabilities.svg)
