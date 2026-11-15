# Widget host

An MSC4412 widget host in the browser, on `widget-host-driver` through the UniFFI/wasm bindings
in `../widget-host-bindings`. One React app (`src/`) with two modes that share every view
(room list, room view, widget view):

| mode | backend | for |
|---|---|---|
| logged in | `RustSdkBackend` (`src/matrix_session/rust/backend/`): a real room of a matrix-rust-sdk client. A `js` build uses `JsSdkBackend` (`src/matrix_session/js/backend/`) on matrix-js-sdk instead, see "Choosing the Matrix SDK" | opening and debugging the widgets of your rooms |
| in-memory store | the crate's `InMemoryBackend`, an in-memory Matrix room; nothing leaves the page | widget development without a homeserver, end-to-end tests of widgets and of the compat wrapper |

The start page is the login screen. **Use the in-memory store (no login)** on it switches to the
in-memory mode, and so do the URL parameters below. The app has no Element Web or Compound
components yet. Where this is heading (devtools, layouts, timeline) is in
[`docs/host-app/feature-set-and-tech-stack.md`](../../docs/host-app/feature-set-and-tech-stack.md)
and [`handover.md`](../../handover.md).

## Structure

- `src/session.ts` is what the UI needs from a Matrix client, as interfaces (login, session
  restore, room list, the widget state events of a room, a backend per room, device
  verification). The UI imports no SDK. Its `sessions` export picks the SDK and loads it lazily.
- `src/matrix_session/js/session.ts` implements it on matrix-js-sdk: OAuth 2.0 (dynamic client
  registration, PKCE, in a popup that returns through `oidc-callback.html`) or a password,
  `/sync` v2, end-to-end encryption, verification with a recovery key. `src/matrix_session/js/backend/` is the
  `MatrixBackend` for one room. `src/matrix_session/js/` is the only folder that imports matrix-js-sdk.
- `src/matrix_session/rust/session.ts` and `src/matrix_session/rust/backend/` are the same on matrix-rust-sdk
  (`../matrix-sdk-uniffi-js`, with native sliding sync). A build has one SDK or the other, see
  "Choosing the Matrix SDK" below. This implementation has not run against a homeserver yet;
  `../../rust-sdk-port.md` says what it relies on and how it differs.
- `src/memory/memorySession.ts` implements the same `LiveSession` on an `InMemoryBackend`, with
  one room and an editable list of widgets. `MemoryView.tsx` puts the shared `LoggedInView` on it and
  adds `MemoryStorePanel.tsx`, the store's controls, as a side panel.
- `src/views/` holds the views: `Login.tsx`, and `LoggedInView.tsx`, `RoomView.tsx`, `WidgetView.tsx`, which both modes share. `WidgetView` is
  one widget: iframe, its own `WidgetHostDriver`, the capability and OpenID prompts, a message
  log and a driver panel (snapshot, `update_theme` / `update_language` / `update_visibility`).
- `src/widgetStateEvent.ts` decides how a widget state event is embedded (below).

## Logged in

Enter a homeserver, log in, pick a room, open one of its widgets. Widgets come from `m.widget`,
`org.matrix.msc4411.widget` and `im.vector.modular.widgets` state; the list follows the room
state. If the account has cross-signing and this device is not verified, the room list offers
to verify it: by comparing emoji with another device of the account (the host sends the request,
accept it there), or with the recovery key. Log out revokes the session and deletes the stored login and the crypto store.

The login screen only appears when no login is stored or the homeserver has ended the stored
one. If a stored login cannot be started for another reason (the crypto store cannot be opened,
say), the host says so and offers **Try again** and **Log out** instead: logging in again would
create a second device and leave the first one behind.

This mode has been checked up to the login options of matrix.org; everything after the login
(sync, sending, encryption, verification) is covered by tests against a faked client only.

## In-memory store

The in-memory mode is not a Matrix client. It creates one `InMemoryBackend` for its room and
hands it to each widget's driver like any other `MatrixBackend`.

![Test host, test widgets and the in-memory store](../../docs/diagrams/07-test-setup.svg)

### What it does

- **Loads a widget from a widget state event** you paste in. The event decides how it is embedded:
  - `m.widget` / `org.matrix.msc4411.widget` → `content.url` is loaded directly; the iframe is
    hidden until `notify_ready` when `uses_widget_api` is `true`. If the widget does not send it
    within 15 seconds, the loading state turns into an error.
  - `im.vector.modular.widgets` (legacy) → `content.url` is handed **untemplated** to the compat
    wrapper: `<wrapper url>?legacy_widget_url=...&legacy_widget_id=...&legacy_wait_for_iframe_load=...[&legacy_widget_data=...]`.
    The wrapper resolves `$matrix_user_id` & co. itself through the `get_matrix_context` /
    `get_client_context` actions; this host has no template engine.
  **Add widget to the room** puts the pasted event into the room's widget list (two examples are
  there from the start); open it from the list above the widget. This is the logic a real client
  needs during the transition, in `src/widgetStateEvent.ts`, and the logged-in mode uses the same.
- **Drives the protocol**: every message from the widget iframe goes into the driver, every
  message from the driver goes to the iframe. Both directions are shown in the **Messages** log.
- **Capability prompt**: when the widget requests capabilities you get a checklist and an
  **Approve selected** button, or tick **auto-approve capabilities** to grant everything.
  For legacy widgets the host calls the driver's `setAutoApproved` with what a legacy client
  gave a widget without asking: the `get_matrix_context` and `get_client_context` capabilities the
  compat wrapper needs to template the URL (a legacy client handed the same facts over as URL
  parameters), plus `get_openid` and the `update_theme` / `update_language` / `update_visibility`
  subscriptions the wrapper always requests. The driver grants those without consulting the host;
  the legacy widget's own capabilities are still prompted for, so a wrapped widget prompts once,
  like a new widget. The prompt lists the **new** capability names: the wrapper has already
  translated the legacy ones. The **Driver snapshot** lists the auto-approved set.
  **auto-approve OpenID tokens** hands tokens out without the Allow / Block prompt.
- **Memory store panel** (right column): shows the room's timeline, state, delayed events and
  sent to-device messages as the backend holds them.
  - **Inject event**: stores the JSON event in the room as if it came from sync. The driver's
    subscription delivers it to the widget (`forward_event`, and for state events also
    `update_state`) if the matching `host:…forward_event.*` / `host:…update_state` capability was
    approved. Events the widget sends
    are echoed back the same way.
  - **Inject to-device message**, **Push TURN credentials**, **Set m.tag room account data**,
    **Set RTC transports**, **Fire oldest** delayed event: what a homeserver would deliver or do.
  - **Clear store**: drops all stored events.
  - **fail sends**: every `send_event` (and `upload_file`) from the widget fails with an error
    response.
  - **Media repository**: the store starts with three demo files from `public/demo/`
    (`mxc://example.org/demo-landscape`, `…/demo-tiles`, `…/demo-notes`). Files the widget
    uploads appear here too. Images are previewed, every file has a download link and a
    **copy uri** button for the widget's `mxc uri` input. A typical round trip: download the demo
    image in the widget, upload it again, or upload a file chosen from disk, and watch it show
    up here.
  Approving capabilities also pushes the current permitted state (`update_state`) at once.
- **Driver** panel of the widget: the snapshot (`ready`, approved and pending capabilities) and
  buttons that push `update_theme`, `update_language` and `update_visibility`.
- **Remembered capabilities** (logged-in mode): what you approve is stored in `localStorage` per
  account, room and widget, and granted without a prompt the next time the widget is opened; only
  capabilities it has not been given before are prompted for. Logging out forgets them. The
  in-memory mode stores nothing, so every start asks again.
- **N capabilities** in the widget header: hover (or focus) it to see every capability the widget
  holds.
- **Revoke all**: the widget gets `update_capabilities` with an empty list, and what was
  remembered for it is forgotten.

### Configuration

The room is `!room:example.org`, the user `@alice:example.org`; `get_matrix_context` reports them
and they are the `room_id` / `sender` of events the widget sends. `get_client_context` reports
`widget-host`, the browser's colour scheme and language. All widgets of the room share the one
store, so one widget sees what another sent.

URL parameters for scripted runs (e2e tests):

| parameter | meaning |
|---|---|
| `event=<json>` | Adds this widget state event (`type`, `state_key`, `content`) to the room. Starts in the in-memory mode. |
| `autoload=1` | Opens the widget from `event` (or the new test widget) on start. Starts in the in-memory mode. |
| `autoApprove=1` | Approves every capability request without a prompt (in-memory mode). |
| `mode=memory` | Starts in the in-memory mode without opening a widget. |
| `room=<id>` / `user=<id>` | Ids of the in-memory room and its user. |
| `wrapper=<url>` | Base URL of the compat wrapper, used for legacy events only (both modes). Default: the copy this host serves itself at `/widget_compatibility_wrapper/`. Set it to test a wrapper hosted elsewhere, e.g. `../widget-compat-wrapper`'s own dev server on `http://localhost:5174/`. |
| `log=<level>` | Level of the driver's own log: `error`, `warn` (default), `info`, `debug`, `trace`. The records appear in the browser console and in the **Messages** log (grey `sdk` lines; warnings and errors in red). |
| `logFilter=<spec>` | `RUST_LOG`-style overrides per module, e.g. `widget_host_driver::driver::requests=trace`. |

Example: `http://localhost:5173/?autoload=1&autoApprove=1&event=%7B%22type%22%3A%22m.widget%22...%7D`

## Running

```sh
npm install              # from the repository root
npm run bindings         # once: generates ../widget-host-bindings (ubrn, wasm-bindgen-cli 0.2.129)
npm run wasm             # once: widget-base-sdk for ../test-widgets (needs wasm-pack)
npm run dev              # http://localhost:5173/
```

For the examples to work also start `../test-widgets` (port 5175). From the root, `npm run dev`
starts both.

The compat wrapper needs no server of its own: the host builds `../widget-compat-wrapper/src`
into a second page, `/widget_compatibility_wrapper/` (`widget_compatibility_wrapper/index.html`),
in the dev server and in `dist/` alike, and loads legacy widgets through it. That page has the
host's origin, unlike a wrapper deployed for a real client.

`npm run build` writes a static site to `dist/` that can be served by any web server.

### Choosing the Matrix SDK

The widget host runs on matrix-rust-sdk unless it is built with `VITE_MATRIX_SDK=js`
(`.env.js`, used by Vite's `js` mode):

```sh
npm run dev:js           # dev server on matrix-js-sdk
npm run build:js         # dist/ on matrix-js-sdk
```

`src/session.ts` reads the variable. Vite replaces it at build time, so a build contains
one SDK only: the `js` build has no matrix-rust-sdk wasm (15 MB gzip) in it, and the default
build no matrix-js-sdk. Logins are stored separately per SDK.

Both implementations are type-checked and tested in every build, and the default build runs on
it, so `../matrix-sdk-uniffi-js` has to be built once:
`npm run bindings -w packages/matrix-sdk-uniffi-js` (slow, see its README).

## Using it in end-to-end tests

Open the host with `event`, `autoload=1` and `autoApprove=1`, then read the page: the
**Messages** log contains every envelope in both directions as JSON, the **Driver snapshot** shows
the negotiated state, and the store panel shows what the widget sent (in the in-memory mode the
log and the driver panel start open). No Matrix SDK code is loaded on this path. Everything is plain DOM,
so Playwright, Cypress or a headless `--dump-dom` run can assert on it. Why the driver refused
or dropped something is in the same log as a red `warn …` line (see `log=` above). Widget-side assertions are
available in the test widgets' own log.

Ports are fixed (`strictPort`): host 5173 (including the compat wrapper), widgets 5175.
