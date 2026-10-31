# widget-host-driver

**Responsibility:** the host side of the widget API. Everything a Matrix client must do
to support widgets. It runs the setup (capabilities and content_loaded), checks every request
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
    fn on_capabilities_requested(&self, requested: Vec<Capability>) { /* prompt the user */ }
    fn on_content_loaded(&self) { /* hide the spinner */ }
    fn on_openid_requested(&self) { /* prompt, then driver.resolve_openid(allowed) */ }
    // navigate, set_always_on_screen, client_id / client_theme / client_language
}

let backend: Arc<dyn MatrixBackend> = Arc::new(MySdkBackend::new(room));
let driver = WidgetHostDriver::new(backend, Arc::new(Platform { /* … */ }));

// 1. every message from the widget iframe:
driver.handle_message_from_widget(json).await?;   // Err(LegacyWidgetApi) → use the compat wrapper
// 2. after the user decided:
driver.approve_capabilities(approved);
```

The driver subscribes to the backend itself once `receive.*` capabilities are approved. The
client does not push events anywhere.

* Legacy widgets (`im.vector.modular.widgets`): embed them through
  `packages/widget-compat-wrapper` and call
  `driver.set_auto_approved(vec![Capability::MatrixContext, Capability::ClientContext])`.
* Client pushes: `notify_theme_change`, `notify_language_change`, `notify_visibility`.
* `WidgetStateEventContent` parses the `m.widget` state event (MSC4411).

### More diagrams

* [How to use the host driver with legacy widgets](../../docs/diagrams/02-legacy-widgets.svg)
* [Capabilities and how the actions use them](../../docs/diagrams/06-capabilities.svg)
