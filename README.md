# matrix-widget-sdk

A reference implementation of Matrix widgets as proposed in
[MSC4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411) (the `m.widget` state
event) and [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412) (the JSON action
protocol spoken over `postMessage`), without the quirks of the old widget API. It also proves the
backwards compatibility approach: legacy widgets run unchanged behind a compat wrapper.

One Rust core is used on both ends of the wire and from several languages:

![Architecture](docs/diagrams/01-architecture.svg)

More diagrams (legacy widgets, wire format, the actions crate, capabilities, test setup) are in
[`docs/diagrams`](docs/diagrams/README.md).

## Crates and packages

| crate | runs on | purpose |
|---|---|---|
| [`matrix-widget-actions`](crates/matrix-widget-actions) | everywhere, optional UniFFI | Plain data types: the wire envelope, the typed `Action` tree, capability strings, `MatrixEvent`. No I/O, no state. |
| [`matrix-widget-sdk`](crates/matrix-widget-sdk) | widget side, wasm + JS | `WidgetClient`: the widget's session, every action as an async function. On `wasm32` also the `WidgetApi` JS class. |
| [`matrix-widget-host-driver`](crates/matrix-widget-host-driver) | host side, optional UniFFI | `WidgetHostDriver`, one per rendered widget: handshake, capability checks, backend calls, room subscriptions; the widget state event parser. Its `cdylib` carries the UniFFI scaffolding of all three host crates. |
| [`matrix-widget-host-backend-interface`](crates/matrix-widget-host-backend-interface) | host side, optional UniFFI | `MatrixBackend`, the trait a host implements once per Matrix SDK, shaped after matrix-rust-rtc's ([`docs/parity.md`](docs/parity.md)). Ships `InMemoryBackend`. |
| [`matrix-widget-logging`](crates/matrix-widget-logging) | bindings only | The logger the bindings install, see [Logging](#logging). |
| [`uniffi-bindgen`](crates/uniffi-bindgen) | tooling | Generates Kotlin / Swift / Python bindings for the crates above. |

| package | npm | what it is |
|---|---|---|
| [`matrix-widget-sdk`](crates/matrix-widget-sdk) (crate, built with wasm-pack) | [`@matrix-widget-sdk/widget`](https://www.npmjs.com/package/@matrix-widget-sdk/widget) | The widget side for JavaScript widgets. |
| [`widget-host-bindings`](packages/widget-host-bindings) | [`@matrix-widget-sdk/host`](https://www.npmjs.com/package/@matrix-widget-sdk/host) | The host crates as TypeScript + one wasm module (uniffi-bindgen-react-native, `web` flavour). |
| [`widget-compat-wrapper`](packages/widget-compat-wrapper) | [`@matrix-widget-sdk/compat-wrapper`](https://www.npmjs.com/package/@matrix-widget-sdk/compat-wrapper) | Hosted widget wrapper for legacy widget compatibility. It behaves like a new widget ([#4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411)) but in another IFrame loads a legacy matrix-widget-api widget. |
| [`widget-host`](packages/widget-host) | | A compleate widget hosting app and test suite. It is a full matrix client, logs in with matrix-rust-sdk (or matrix-js-sdk) or runs on mocked in-memory rooms (the DevBackend), with per-widget dev tools. For debugging widgets and for e2e (playwright) tests. While developing widgets. |
| [`matrix-sdk-uniffi-js`](packages/matrix-sdk-uniffi-js) | | matrix-rust-sdk for the browser, used by the widget host. Encapsulated version of [aurora](https://github.com/element-hq/aurora)'s build script. |
| [`test-widgets`](packages/test-widgets) | | A legacy and an [$4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412) test widget with buttons for most actions. (Kept as simple as possible) |

How to use each piece (widget in JS or Rust, host in Rust or JS) is in its README. For a native
host (Kotlin / Swift / Python):

```sh
cargo build --release --features uniffi -p matrix-widget-host-driver
cargo run -p uniffi-bindgen -- generate --library target/release/libmatrix_widget_host_driver.dylib \
    --language kotlin --out-dir bindings/kotlin
```

The foreign side implements `MatrixBackend` and `WidgetHostPlatform` and uses `WidgetHostDriver`
like the Rust API; event payloads cross the FFI as JSON strings (`JsonValue`), capabilities as their
strings.

## Quick start

```sh
npm install       # also builds the host bindings (needs Rust, wasm32-unknown-unknown, wasm-bindgen-cli 0.2.129)
npm run wasm      # matrix-widget-sdk for the test widgets (needs wasm-pack)
npm run bindings  # host bindings via ubrn, again after a Rust change (packages/widget-host-bindings)
npm run bindings -w packages/matrix-sdk-uniffi-js   # matrix-rust-sdk for the host (slow, once)
npm run dev       # host on :5173 (serves the compat wrapper at /widget_compatibility_wrapper/), widgets on :5175
npm test          # compat wrapper and host unit tests
```

`http://localhost:5173/?mode=memory` opens the host on the DevBackend with both test widgets.

## The protocol in brief

The spec texts are MSC4411 and MSC4412; changes and new MSC drafts are in
[`spec/patch`](spec/patch/README.md). Every action, its capability and its backend method are in
[`docs/parity.md`](docs/parity.md); the naming scheme is
[`docs/spec-appendix/capability-naming-proposal.md`](docs/spec-appendix/capability-naming-proposal.md).

* A message is `{ source: "widget" | "host", action, request_id, request | response }`. `source`
  names the side that started the exchange. Every request gets exactly one response; `{}` is an ack.
* `action` is `<namespace>.<name>`: the unstable prefix of the defining MSC
  (`org.matrix.msc4412.notify_ready`), `org.matrix.mscXXXX` for actions without an MSC yet;
  `m.<name>` is accepted too.
* Capabilities are `source:action[.modifier][:data]`, one per action
  (`widget:org.matrix.mscXXXX.send_event.timeline:m.room.message`). `webview:` capabilities are
  the widget iframe's `sandbox` / `allow` tokens; every iframe starts strict.
* Errors are `{ error: { code, message } }`; a request not answered within 10 seconds failed.
* A legacy (matrix-widget-api) message has `api` instead of `source`. The driver rejects it
  (`DriverError::LegacyWidgetApi`); legacy widgets run behind the
  [compat wrapper](packages/widget-compat-wrapper), which translates names and capabilities.

What is not supported, and why: [`docs/parity.md`](docs/parity.md), §6.

## Logging

All crates log through the Rust [`log`](https://docs.rs/log) facade.

| you use | entry point | default without a call | records go to |
|---|---|---|---|
| widget, JavaScript (`matrix-widget-sdk` wasm) | `initLogging(level, filter?)` | `warn` | browser console |
| host, JavaScript (`widget-host-bindings`) | `setupLogging(LogConfig.create({ level }))` | `warn` | browser console, and a `LogSink` |
| host, Kotlin / Swift / Python | `setupLogging(LogConfig(level = ...))` | silent | logcat (tag `matrix-widget`) on Android, the unified log on iOS, stderr elsewhere, and a `LogSink` |
| any crate from Rust | your own logger (`env_logger`, `tracing-log`, ...) | silent | wherever that logger writes |
| compat wrapper page | `log_level=<level>` query parameter | `warn` | browser console, prefix `[widget-compat-wrapper]` |

A native host is silent until it calls `setupLogging` (a library does not claim the process-wide
logger unasked); a Rust logger the app installed first is kept.

| level | what |
|---|---|
| `error` | a bug in this SDK |
| `warn` | something was dropped or refused: a rejected message, a missing capability, a failed backend call, a timeout, a callback that threw |
| `info` | the lifecycle: ready, capabilities requested / approved / revoked / used up |
| `debug` | one line per message: action, kind and request id, never the body |
| `trace` | the message bodies; credentials (OpenID and LiveKit tokens, TURN passwords) are `"<redacted>"` |

`filter` overrides the level per target in `RUST_LOG` syntax; targets are module paths matched by
prefix (`matrix_widget_host_driver`, `matrix_widget_host_backend_interface`, `matrix_widget_sdk`).

```js
import { LogConfig, LogLevel, setLogSink, setupLogging } from "@matrix-widget-sdk/host";
setupLogging(LogConfig.create({ level: LogLevel.Info, filter: "matrix_widget_host_driver::driver=trace" }));
setLogSink({ log: (record) => rageshake.append(`${record.target}: ${record.message}`) });   // optional
```

A `LogSink` receives every record that passes the filter; `writeToSystem = false` keeps them out of
the platform log. On native platforms the sink runs on one dedicated thread and records are dropped
(counted by `droppedLogRecordCount()`) when it cannot keep up. `clearLogSink()` removes it;
`logEvent(level, target, message)` writes a line of your own.

## Development

```sh
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo build --features uniffi -p matrix-widget-host-driver        # FFI scaffolding compiles
cargo build --target wasm32-unknown-unknown -p matrix-widget-sdk
npm run build                                                     # wasm, bindings and every web package
```

`crates/matrix-widget-sdk/tests/loopback.rs` wires a `WidgetClient` to a `WidgetHostDriver` with an
`InMemoryBackend` and walks through the whole protocol.

Releases (npm packages, crates, tags) are cut by `.github/workflows/release.yml`, see
[`RELEASING.md`](RELEASING.md).

### Dev site (GitHub Pages)

CI builds a static site of the widget host and the test widgets (`npm run build:dev-site`,
[`scripts/build-dev-site.mjs`](scripts/build-dev-site.mjs)) and, once turned on, deploys it from
`main` to `https://toger5.github.io/matrix-widget-sdk/`.

| path | what |
|---|---|
| `/` | landing page; `version.json`: commit, ref, build date, CI run |
| `host/` | the widget host on matrix-rust-sdk; `host/?mode=memory` opens the DevBackend |
| `host-js/` | the same on matrix-js-sdk |
| `widgets/new/`, `widgets/legacy/` | the test widgets (`VITE_TEST_WIDGETS_URL`, see [the host's README](packages/widget-host/README.md)) |
| `host/widget_compatibility_wrapper/` | the compat wrapper |

A pull request gets the site as the artifact `dev-site` of its CI run, built for `/<repository>/`:
`unzip dev-site.zip -d /tmp/site/matrix-widget-sdk`, `python3 -m http.server 8088 -d /tmp/site`.
Locally: `npm run build:dev-site` (to `dist/dev-site`; `SITE_BASE` and `SITE_OUT` for a sub-path).

**Turning it on** (once): Settings → Pages → Source: **GitHub Actions**; then the repository
variable `DEPLOY_DEV_SITE` = `true`. Without the variable the deploy job is skipped. The optional
variable `DEV_SITE_BASE` sets the path the site is served under (default `/<repository>/`; `/` for
a custom domain).

**Do not log in with an account you care about.** The host and its test widgets share one origin
(the widgets run with `allow-same-origin`), and on `*.github.io` so does every other Pages site of
the same owner: any of them can read the access token and encryption keys the host stores. Use the
DevBackend or a test account.

## License

Apache License 2.0 ([`LICENSE`](LICENSE)), except the widget host app in
[`packages/widget-host`](packages/widget-host), which is GNU AGPL v3.0
([`packages/widget-host/LICENSE`](packages/widget-host/LICENSE)), like Element Call. Every crate and
npm package carries its own `LICENSE` file so it ends up in the published package.
