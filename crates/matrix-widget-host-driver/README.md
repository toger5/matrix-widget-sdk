# matrix-widget-host-driver

The host side of the widget API: everything a Matrix client must do to support widgets. It runs
the handshake, checks every request against the approved capabilities, calls the
`MatrixBackend`, answers the widget and pushes what it may receive. The client provides the UI
(`WidgetHostPlatform`) and the Matrix client-server API (`MatrixBackend`).

With the `uniffi` feature its `cdylib` carries the UniFFI scaffolding of all three host crates:
Kotlin / Swift / Python, and TypeScript via `packages/widget-host-bindings`.

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

let options = EmbedOptions { /* the client's compat wrapper and origin */ };
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

`new` fails with `WidgetEventError::Refused` for a widget that must not be loaded. The driver
subscribes to the backend itself for what the approved `host:…` capabilities push; the client
does not push events anywhere.

## Key concepts

The rules are documented on the code (`cargo doc -p matrix-widget-host-driver --open`):

* **Capability negotiation:** `on_capabilities_requested` gets the whole open question; one
  `approve_capabilities` answers every request so far (`src/platform.rs`, `src/driver/mod.rs`).
  Every action has its own capability (`src/driver/access.rs`); the legacy names are translated
  only by the compat wrapper.
* **Single-use grants:** `set_single_use` (default `widget:…get_openid`): a request uses its
  capability up, so every OpenID token is a decision of the user.
* **The iframe:** strict by default (`sandbox="allow-scripts allow-same-origin"`, empty `allow`);
  more is a webview capability (`webview:…sandbox:<token>`, `webview:…allow:<feature>`,
  `src/webview.rs`). A grant or revocation that changes the attributes calls `load_iframe` again;
  the page in the new iframe gets what the old one held (`DriverSnapshot::carried`).
* **Which widgets may be loaded:** `parse_widget_state_event` reads `m.widget`,
  `org.matrix.msc4411.widget` and the legacy `im.vector.modular.widgets` (`src/widget_event.rs`);
  `widget_url_problem` and `EmbedOptions` refuse non-http(s) URLs, pages of the client's compat
  wrapper and pages of the client's own origin (`src/widget_url.rs`, cases in
  `tests/widget_urls.json`). Legacy widgets load through `packages/widget-compat-wrapper` and get
  `legacy_auto_approved()` without asking.
* **No widget API:** a widget without `uses_widget_api: true` is ready right after `load_iframe`
  and every message is refused with `DriverError::NoWidgetApi`.

Exported to foreign code: `WidgetHostDriver`, `parse_widget_state_event`, `widget_url_problem`,
`widget_event_types`, `webview_attributes`, `legacy_auto_approved` (TypeScript:
`parseWidgetStateEvent`, …; `EmbedOptions`, `WidgetDefinition`, `WidgetIframe` and
`WebviewAttributes` are plain objects).

## Test

```sh
cargo test -p matrix-widget-host-driver
```

## Diagrams

* [How to use the host driver with legacy widgets](../../docs/diagrams/02-legacy-widgets.svg)
* [Capabilities and how the actions use them](../../docs/diagrams/06-capabilities.svg)
