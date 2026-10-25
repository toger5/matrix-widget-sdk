# Widget test host

A minimal MSC4412 widget host in the browser: `widget-host-driver` through the UniFFI/wasm
bindings in `../widget-host-bindings`, running on the crate's `InMemoryBackend` (an in-memory
Matrix room) which the page creates and hands to the driver like any other `MatrixBackend`. It
exists for manual testing, for end-to-end tests of widgets and of the compat wrapper, and as the
smallest possible example of embedding the driver. It is not a Matrix client: nothing leaves the
page.

## What it does

- **Loads a widget from a widget state event** you paste in. The event decides how it is embedded:
  - `m.widget` / `org.matrix.msc4411.widget` → `content.url` is loaded directly; the iframe is
    hidden until `content_loaded` when `usesWidgetAPI` is `true`.
  - `im.vector.modular.widgets` (legacy) → `content.url` is handed **untemplated** to the compat
    wrapper: `<wrapper url>?legacy_widget_url=...&legacy_widget_id=...&legacy_wait_for_iframe_load=...[&legacy_widget_data=...]`.
    The wrapper resolves `$matrix_user_id` & co. itself through the `matrix_context` /
    `client_context` actions; this host has no template engine.
  The decision and the final URL are shown under the **Load widget** button. This is the logic a
  real client needs during the transition, in `src/widgets.ts`.
- **Drives the protocol**: every message from the widget iframe goes into the driver, every
  message from the driver goes to the iframe. Both directions are shown in the **Messages** log.
- **Capability prompt**: when the widget requests capabilities you get a checklist and an
  **Approve selected** button, or tick **auto-approve capabilities** to grant everything.
  For legacy widgets the host calls the driver's `setAutoApproved` with the `matrix_context` and
  `client_context` capabilities, which the compat wrapper needs to template the URL (a legacy client handed
  the same facts over as URL parameters). The driver grants those without consulting the host;
  the legacy widget's own capabilities are still prompted for, so a wrapped widget prompts once,
  like a new widget. The **Driver snapshot** lists the auto-approved set.
- **Memory store menu**: shows the room's timeline and state as the backend holds them.
  - **Inject event**: stores the JSON event in the room as if it came from sync. The driver's
    subscription delivers it to the widget (`send_event`, and for state events also
    `update_state`) if a matching `receive.*` capability was approved. Events the widget sends
    are echoed back the same way.
  - **Clear store**: drops all stored events.
  - **fail sends**: every `send_event` from the widget fails with an error response.
  Approving capabilities also pushes the current permitted state (`update_state`) at once.
- **Driver snapshot**: `content_loaded`, approved and pending capabilities.

## Configuration

| field | default | meaning |
|---|---|---|
| room id / user id | `!room:example.org` / `@alice:example.org` | Identity of the in-memory room and of the sending user, reported by `matrix_context` and used as `room_id` / `sender` of events the widget sends. `client_context` reports `widget-test-host` / `light` / `en`. |
| compat wrapper url | `http://localhost:5174/` | Base URL of `../widget-compat-wrapper`, used for legacy events only. |
| widget state event | example new widget | Any `m.widget` or `im.vector.modular.widgets` state event (`type`, `state_key`, `content`). Two example buttons fill it in. |

URL parameters for scripted runs (e2e tests):

| parameter | meaning |
|---|---|
| `event=<json>` | Prefills the state event textarea. |
| `autoload=1` | Clicks **Load widget** on start. |
| `autoApprove=1` | Approves every capability request without a prompt. |
| `wrapper=<url>` | Overrides the compat wrapper URL. |

Example: `http://localhost:5173/?autoload=1&autoApprove=1&event=%7B%22type%22%3A%22m.widget%22...%7D`

## Running

```sh
npm install              # from the repository root
npm run bindings         # once: generates ../widget-host-bindings (ubrn, wasm-bindgen-cli 0.2.129)
npm run wasm             # once: widget-base-sdk for ../test-widgets (needs wasm-pack)
npm run dev              # http://localhost:5173/
```

For the examples to work also start `../test-widgets` (port 5175) and, for legacy widgets,
`../widget-compat-wrapper` (port 5174). From the root, `npm run dev` starts all three.

`npm run build` writes a static site to `dist/` that can be served by any web server.

## Using it in end-to-end tests

Open the host with `event`, `autoload=1` and `autoApprove=1`, then read the page: the
**Messages** log contains every envelope in both directions as JSON, the **Driver snapshot** shows
the negotiated state, and the store panels show what the widget sent. Everything is plain DOM,
so Playwright, Cypress or a headless `--dump-dom` run can assert on it. Widget-side assertions are
available in the test widgets' own log.

Ports are fixed (`strictPort`): host 5173, wrapper 5174, widgets 5175.
