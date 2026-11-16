# widget-host-driver

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

One driver per rendered widget:

```rust
use std::sync::Arc;
use widget_host_driver::{MatrixBackend, WidgetHostDriver, WidgetHostPlatform};
use widget_host_driver::widget_actions::Capability;

struct Platform { /* handle to the iframe + UI */ }
impl WidgetHostPlatform for Platform {
    fn send_to_widget(&self, json: String) { /* iframe.postMessage(json, widgetOrigin) */ }
    fn on_capabilities_requested(&self, requested: Vec<Capability>) { /* show (or update) the prompt */ }
    fn on_ready(&self) { /* hide the loading state */ }
    // navigate, set_always_on_screen, client_id / client_theme / client_language
}

let backend: Arc<dyn MatrixBackend> = Arc::new(MySdkBackend::new(room));
let driver = WidgetHostDriver::new(backend, Arc::new(Platform { /* … */ }));

// 1. every message from the widget iframe:
driver.handle_message_from_widget(json).await?;   // Err(LegacyWidgetApi) → use the compat wrapper
// 2. after the user decided:
driver.approve_capabilities(approved);
// 3. whenever the user takes a permission away:
driver.revoke_capabilities(revoked);
```

`requested` is the whole open question: a request that arrives while the user decides joins it,
and the callback is called again with all of it (minus what the widget holds or gets without
asking). One `approve_capabilities` answers every request so far.

The driver subscribes to the backend itself once `host:…forward_event.*`, `host:…update_state` or
`host:…forward_to_device` capabilities are approved. The
client does not push events anywhere.

* Legacy widgets (`im.vector.modular.widgets`): embed them through
  `packages/widget-compat-wrapper` (`WidgetDefinition::embed` builds its URL, below) and call
  `driver.set_auto_approved(vec![Capability::GetMatrixContext, Capability::GetClientContext])`.
  The driver understands only the new capability and action names
  (`docs/spec-appendix/capability-naming-proposal.md`); the wrapper translates the legacy ones.
* Client pushes: `update_theme`, `update_language`, `update_visibility`. Each is sent only if
  the widget holds its `host:…` capability.
* Limited grants: `set_single_use(capabilities)` (default: `widget:…get_openid`) makes a request
  use its capability up. The driver takes it away when the request passes the check and sends
  `update_capabilities` without it after the reply, so every OpenID token is a decision of the
  user. Do not remember such an approval, unless the user chose "always": then pass it to
  `set_auto_approved`, and it is granted again per request without asking. A time limit is a
  timer of the client that calls `revoke_capabilities`.

## Which widgets a room has: the state event parser

Before there is a driver, the client reads the widget state events of the room
(`WIDGET_EVENT_TYPES`: MSC4411 `m.widget`, its unstable `org.matrix.msc4411.widget`, and the
legacy `im.vector.modular.widgets`) and decides what to list and what to load. Both steps are here,
so every client decides the same:

```rust
use widget_host_driver::WidgetDefinition;

// 1. List: `Err(Removed)` for a removed widget (MSC4411: no string `url` or, for `m.widget`, `name`).
let widget = WidgetDefinition::parse(&event_type, &state_key, &content)?;
show_in_list(&widget.name, widget.avatar_url.as_deref(), &widget.url /* MSC4411: show it with the sender */);

// 2. Open: the URL check, and for a legacy widget the compat wrapper's URL.
match widget.embed(Some("https://wrapper.example/"), /* allow_http: */ false) {
    Ok(embed) => load_webview(&embed.url, embed.uses_widget_api), // wait for notify_ready if uses_widget_api
    Err(refused) => show_disabled(&refused.to_string()), // "javascript: URLs are not allowed, only https:"
}
```

* `widget_url_problem(url, allow_http)` is the URL check: only absolute `https:` URLs (and `http:`
  with `allow_http`, which MSC4411 allows in developer tools), parsed as a browser parses an
  iframe's `src` (WHATWG, the `url` crate). A URL that an iframe resolves against the page that
  embeds it (`https:example.org`, `http:/path`) is refused: it has to name its own host (`//` after
  the scheme). The texts name the scheme, never the URL.
* `embed_url_problem(url, wrapper_url, allow_http)` is what `embed` checks for both kinds:
  `widget_url_problem`, and **no page of the client's compat wrapper** ("a widget cannot load this
  client's compat wrapper"). A client usually serves the wrapper from its own origin with
  `allow-same-origin`, and the wrapper loads the `legacy_widget_url` of its own URL: an `m.widget`
  whose URL is the wrapper would bring a page of the event sender's choosing onto the client's
  origin (before the wrapper checked its inner URL, `javascript:` ran there). Refused are the pages
  of the wrapper's directory (its path up to the last `/`, and that directory without the slash)
  on the wrapper's origin, compared as a server may read the path: percent-decoded, dot segments
  resolved, repeated slashes as one, case-insensitive. Other paths of that origin stay allowed,
  since a deployment may serve its widgets there (the dev site does); a wrapper at the root of its
  origin refuses the whole origin. Serve the wrapper from an origin of its own where you can.
* An MSC4411 widget loads its `url` **as the check parsed and serialised it** (`WidgetEmbed.url`),
  not the event's string: no other parser reads it differently, and a client that derives the
  widget's `postMessage` target origin from `WidgetEmbed.url` gets the origin of the loaded page.
  A legacy widget loads the compat wrapper with
  `legacy_widget_url` (untemplated), `legacy_widget_id`, `legacy_wait_for_iframe_load` and
  `legacy_widget_data` in its query (see the wrapper's README; they replace any the wrapper URL
  has), and always uses the widget API. The wrapper checks the legacy URL again, before and after
  templating.
* Foreign code calls `parse_widget_state_event`, `embed_widget`, `widget_url_problem`,
  `embed_url_problem` and `widget_event_types` (TypeScript: `parseWidgetStateEvent`, `embedWidget`,
  `embedUrlProblem`, …).

### More diagrams

* [How to use the host driver with legacy widgets](../../docs/diagrams/02-legacy-widgets.svg)
* [Capabilities and how the actions use them](../../docs/diagrams/06-capabilities.svg)
