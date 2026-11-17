# Widget host

An MSC4412 widget host in the browser, on `widget-host-driver` through the UniFFI/wasm bindings
in `../widget-host-bindings`. One React app (`src/`) with two modes that share every view
(room panels with tabs, widget view, dev tools):

| mode | backend | for |
|---|---|---|
| logged in | `RustSdkBackend` (`src/matrix_session/rust/backend/`): a real room of a matrix-rust-sdk client. A `js` build uses `JsSdkBackend` (`src/matrix_session/js/backend/`) on matrix-js-sdk instead, see "Choosing the Matrix SDK" | opening and debugging the widgets of your rooms |
| in-memory store (the DevBackend) | the crate's `InMemoryBackend`, an in-memory Matrix room; nothing leaves the page | widget development without a homeserver, end-to-end tests of widgets and of the compat wrapper |

The start page is the login screen. **Skip login and use the DevBackend** on it switches to the
in-memory mode (and enables the dev tools and the DevBackend), and so do the URL parameters below.
Logged in, it is activated from the account list or with **Switch to the DevBackend** at the
bottom of the Dev tools (both shown while **Enable the DevBackend** is on in the settings).
**Enable dev tools** is a switch of its own: the Dev tools, the widget dev tools and
**Add widget** work with a Matrix account as well. The app has no Element Web or Compound
components yet.

## Structure

The app is built as MVVM from the design in [`appDesign.md`](appDesign.md) and its stories (Storybook, `npm run storybook`: every state of the UI is a story, the visual specification). How, and why the widget iframes live outside the UI tree, is in [`implementationPlan.md`](implementationPlan.md); open questions are in [`implementation_findings.md`](implementation_findings.md). A UI change is made in a fixed order (design document, view model, sketch stories, views with stories, app logic, tests), written down for agents in [`.claude/agents/widget-host-ui.md`](../../.claude/agents/widget-host-ui.md).

- `src/appViewModel.ts` is the view model: one serialisable `AppViewModel`, the functions that derive from it, and `AppIntent`, the list of everything a user can ask for.
- `src/app/` is the controller and the runtime. `controller.ts` holds the view model in a store, turns intents into changes and effects, and feeds runtime events back. `layout.ts` has the pure panel/tab transitions. `runtime/widgetRuntime.ts` is one running widget: its `WidgetHostDriver`, the message pump to its iframe, the capability answers and the data of its dev tools. `AppRoot.tsx` connects both to the views and renders the widget iframes. `testHook.ts` is `window.widgetHost`.
- `src/views/` holds the views, one folder per area (`app`, `sidepanel`, `devbackend`, `rooms`, `widget`, `pip`). A view renders a slice of the view model and sends intents; it imports no session, no bindings and nothing from `src/app`. Rules: [`src/views/README.md`](src/views/README.md). Each state of a view is a story (`npm run storybook`); a state that is designed but not built yet is a sketch story (`Sketch/…`, [`.claude/skills/sketch-stories/SKILL.md`](../../.claude/skills/sketch-stories/SKILL.md)).
- `src/styles/app.css` is the stylesheet: a list, in cascade layers, of the design rules `src/styles/<area>.css` and the app-only rules next to the views (`src/views/<area>/*.css`); Storybook adds `.storybook/mockup.css` (stages and fake widgets). The rules for the files are in [`src/views/README.md`](src/views/README.md).
- `src/session.ts` is what the app needs from a Matrix client, as interfaces (login, several stored logins, room list, the widget state events of a room, a backend per room, account and room details, a room's timeline, suspend/resume, device verification). Its `sessions` export picks the SDK and loads it lazily.
- `src/matrix_session/js/` implements it on matrix-js-sdk: OAuth 2.0 (dynamic client registration, PKCE, in a popup that returns through `oidc-callback.html`) or a password, `/sync` v2, end-to-end encryption, device verification (emoji or recovery key). It is the only folder that imports matrix-js-sdk.
- `src/matrix_session/rust/` is the same on matrix-rust-sdk (`../matrix-sdk-uniffi-js`, with native sliding sync). A build has one SDK or the other, see "Choosing the Matrix SDK" below. This implementation has not run against a homeserver yet. The SDK API it adds is in [`../matrix-sdk-uniffi-js/README.md`](../matrix-sdk-uniffi-js/README.md) ("API added to the SDK"), its open questions in [`implementation_findings.md`](implementation_findings.md) ("Matrix sessions").
- `src/matrix_session/memory/devBackend.ts` is the DevBackend: the same `LiveSession` on the crate's `InMemoryBackend`, with several mocked rooms, an editing API for the Dev tools (the DevBackendView) and a JSON seed format (`seed.ts`).
- `src/lib/` holds what is neither a view nor a session: the store of approved capabilities, the avatar cache, log formatting and the driver's log.
- `src/lib/widgetEvents.ts` reads widget state events with the driver's parser (`parseWidgetStateEvent`, `embedWidget` of the bindings): which events are widgets and what their iframe loads (below). Views get it as `ViewEnv.widgetEvents`; `src/widgetStateEvent.ts` keeps the host's types, keys and event types.

## Logged in

Enter a homeserver, log in, pick a room (in an empty room panel or the Room list of the left bar,
under the recently opened widgets and rooms), open one of its widgets. **Open timeline** in the
room's overview adds a Timeline tab: every event of the room, one line each (newest at the bottom,
live), its JSON on a press; the session's older events are loaded with **Load older events**. Widgets come from `m.widget`,
`org.matrix.msc4411.widget` and `im.vector.modular.widgets` state; the list follows the room
state. If the account has cross-signing and this device is not verified, the AccountView offers
to verify it ("Verify this device"): by comparing emoji with another device of the account (the
host sends the request, accept it there), or with the recovery key. Whether the device is verified
follows the session, also when it was verified elsewhere. Log out revokes the session and deletes
the stored login and the crypto store.

The login screen only appears when no login is stored or the homeserver has ended the stored
one. If a stored login cannot be started for another reason (the crypto store cannot be opened,
say), the host says so and offers **Try again** and **Log out** instead: logging in again would
create a second device and leave the first one behind.

This mode has been checked up to the login options of matrix.org. What comes after the login is
only tested against faked clients: the backends (`test/*SdkBackend.test.ts`), the room and account
data and the device verification of both SDKs (`test/*SessionData.test.ts`), and the verification
flows of the AccountView (`test/deviceVerification.test.ts`). Sync and encryption themselves are not.

## In-memory store

The in-memory mode is not a Matrix client. It creates one `InMemoryBackend` per mocked room and
hands it to the driver of each widget of that room like any other `MatrixBackend`.

![Test host, test widgets and the in-memory store](../../docs/diagrams/07-test-setup.svg)

### What it does

- **Loads a widget from a widget state event** of a mocked room. The event decides how it is embedded:
  - `m.widget` / `org.matrix.msc4411.widget` → `content.url` is loaded directly; the iframe is
    hidden until `notify_ready` when `uses_widget_api` is `true`. If the widget does not send it
    within 15 seconds, the loading state turns into an error. An event whose content has no string
    `name` or `url` is a removed widget (MSC4411) and is not listed.
  - `im.vector.modular.widgets` (legacy) → `content.url` is handed **untemplated** to the compat
    wrapper: `<wrapper url>?legacy_widget_url=...&legacy_widget_id=...&legacy_wait_for_iframe_load=...[&legacy_widget_data=...]`.
    The wrapper resolves `$matrix_user_id` & co. itself through the `get_matrix_context` /
    `get_client_context` actions; this host has no template engine.
  - A `content.url` (or `wrapper=` URL) that is not an absolute `http:` / `https:` URL is not
    embedded: the widget is listed disabled in the room overview, with the reason. A legacy URL is checked untemplated,
    so one that starts with a `$variable` is refused. So is a URL that an iframe would resolve against
    the host page (`https:example.org`, `http:/path`: without `//` they are pages of the host's origin),
    and a page of this host's own compat wrapper (see [Security notes](#security-notes)).
  - An `m.widget` loads its URL as the driver parsed and serialised it (`  HTTPS://Example.org/a b`
    loads `https://example.org/a%20b`), and messages to it go to that URL's origin.
  Send the event as state in the Dev tools of the DevBackend and the widget appears in the room overview (the
  URL parameters below start with the two test widgets). This is the logic a real client
  needs during the transition. It is the driver's (`WidgetDefinition::parse` / `embed` in
  `crates/widget-host-driver/src/widget_event.rs`), so native clients get the same; the logged-in
  mode uses it too.
- **Drives the protocol**: every message from the widget iframe goes into the driver, every
  message from the driver goes to the iframe. Both directions are shown in the **Messages** panel of the widget's dev tools.
- **Capability prompt**: when the widget requests capabilities you get a card with a summary in plain
  words and the capabilities in sections (each with a checkbox for all of it), with
  **Approve N selected** and **Deny all**, or turn on **auto-approve capabilities** to grant everything.
  A request that arrives while the card is open joins it (marked "New", your choices stay), and
  one answer decides all of them. **Approve** is blocked for 3 s after the card appeared or a
  request added to it; **Deny all** never is. What the driver does not know is listed under "Unknown to this app".
  Webview capabilities (camera, microphone, popups, ...) are "Browser permissions": approving them restarts the widget.
  For legacy widgets the host calls the driver's `setAutoApproved` with what a legacy client
  gave a widget without asking: the `get_matrix_context` and `get_client_context` capabilities the
  compat wrapper needs to template the URL (a legacy client handed the same facts over as URL
  parameters), plus the `update_theme` / `update_language` / `update_visibility`
  subscriptions the wrapper always requests. The driver grants those without consulting the host;
  the legacy widget's own capabilities are still prompted for, so a wrapped widget prompts once,
  like a new widget. The prompt lists the **new** capability names: the wrapper has already
  translated the legacy ones. The **Driver** panel lists the auto-approved set.
- **OpenID**: a token is the capability `get_openid`, asked for in the same prompt and granted for
  one token: the widget's request uses it up, and the next token is asked about again (the test
  widget's `get_openid` button requests it by itself; for a legacy widget the compat wrapper does).
  Its row in the prompt has **Once** (the default) / **Always**: "Always" puts it in the
  auto-approved set, so every next token is granted without the card; it is remembered with the
  other approvals (else it lasts while the widget runs). The **Driver** panel marks a held one-use
  grant "once". **Auto-approve capabilities** grants every token.
  Remembered capabilities are stored per account, room and widget (`localStorage`,
  `widget_host_capabilities_v2 …`); the entries of version 1 lose their `get_openid` on start.
- **Dev tools** (the side panel, opened with the cone button of the left bar; shown while dev tools
  are enabled or the DevBackend is active; it never switches accounts): the State and Timeline of
  one room at a time, with a dropdown to switch rooms.
  - With a **Matrix account** the dropdown lists the rooms open in the room panels (it starts on the
    focused panel's room). Everything is sent to the real room **as you**, through the room's
    backend: another sender is refused, power levels, join rules, encryption, history visibility,
    guest access, server ACL, tombstone, create event, canonical alias, another user's membership
    and replacing a widget ask first, and a refusal (`M_FORBIDDEN`) is a toast. **Scheduled** lists
    only the delayed events scheduled here (the homeserver does not list the others); older
    events are loaded with **Load older events**. **Switch to the DevBackend** is at the bottom
    while the DevBackend is enabled.
  - While the **DevBackend** is active it is the **DevBackendView**: one page per mocked room, the
    dropdown also adds rooms, events are sent as any user, and two tool boxes and **Leave
    DevBackend** are below the room box (leaving keeps the Dev tools open while dev tools are enabled).
  - **State**: shortcuts (name, description, add member in the DevBackend), send a state event (also delayed) from
    a form or as raw JSON, and the current state by type and key with an edit button. Sending a
    widget state event adds a widget to the room; one without `url` removes it. The **Widget** form
    starts with a test widget (new or legacy); the **Element Call** form adds Element Call
    (default `https://call.element.io/room`, loaded from the internet) as Element Web describes its
    call widget: `im.vector.modular.widgets` of type `m.call`, embedded through the compat wrapper.
  - **Timeline**: send an event from a form (message, sticker, RTC member, image/audio) or as raw
    JSON, also delayed. In the DevBackend it is stored as if it came from sync: the driver's subscription delivers
    it to the widget (`forward_event`, and for state events also `update_state`) if the matching
    `host:…forward_event.*` / `host:…update_state` capability was approved. Events the widget
    sends are echoed back the same way. **Scheduled** lists the delayed events (MSC4157) with
    send now / restart / cancel; nothing fires by itself.
  - **Client Backend Tool** (below the room box, shared by all mocked rooms; one tool box is open
    at a time): **Widget host behavior** (auto-approve capabilities, OpenID tokens included,
    remember capabilities, and **fail sends**: every `send_event` and `upload_file` from a widget
    fails with an error response) and **To-device messages** (MSC3819): send one to the widgets,
    and read what widgets sent.
  - **Media Backend Tool** (below the Client Backend Tool): the store starts with three demo files from `public/demo/`
    (`mxc://example.org/demo-landscape`, `…/demo-tiles`, `…/demo-notes`). Upload more; files a
    widget uploads appear here too. Every file has a button to copy its `mxc://` URI.
  Approving capabilities also pushes the current permitted state (`update_state`) at once.
- **Timeline tab** (**Open timeline** in the room overview): every event of the mocked room, the
  ones widgets send included, as they arrive.
- **Add widget** (the Widgets card of the room overview; enable dev tools in the settings), in
  any room, logged in or in the DevBackend: the **Widget** or **Element Call** form of the
  Dev tools, or **Paste JSON** (a whole `{ type, state_key, content }`, e.g. from Element's
  room state explorer; other fields are ignored). It adds the widget without opening it, either
  **only in this host** (a local widget, marked "Local": kept in `localStorage` per account and
  room, deleted on logout, the DevBackend's in memory only; edit and remove are in its row) or to
  **the room** as a state event sent as you (replacing a widget of the room asks first; a refusal
  such as `M_FORBIDDEN` stays in the form). A local widget's key is `local:<type>/<state key>`, so
  it never shares remembered capabilities with a room widget; they are forgotten when its URL
  (of a legacy widget also its `data`, the values of the URL's variables) changes (it reloads) or
  it is removed. Only `http:` / `https:` URLs are accepted.
- **Dev tools of a widget** (the ⋯ button of its tab; enable dev tools in the settings), docked
  top, bottom, left or right: **Messages** (every envelope in both directions, expandable),
  **Stats** (counters, and a bar graph of the characters sent per 5 s: both directions, to or from
  the widget), **Driver** (approved, auto-approved and denied capabilities, revoke, and buttons that
  push `update_theme`, `update_language` and `update_visibility`) and **Console** (this host's and
  the driver's log about the widget). **Reload** starts the widget again like Retry: a new iframe
  and driver, the current URL of its state event, empty panels; capabilities are negotiated again.
- **Widget theme**: a widget follows the host's theme, also one that does not use the widget API.
  The iframe gets the theme's `color-scheme`, so `prefers-color-scheme` inside the widget is
  the theme (Chromium, Firefox, WebKit 27.2) and a page that opted into `color-scheme` gets
  dark system colours on a backdrop of its own `Canvas` colour. A theme change (the setting, or the
  OS while it is "System") is also pushed as `update_theme` to widgets holding that capability;
  `get_client_context` answers the current theme. A loading widget is laid out but invisible, so it
  already sees the theme. Details and measurements: [`docs/widget-color-scheme.md`](../../docs/widget-color-scheme.md).
- **Remembered capabilities** (logged-in mode): what you approve is stored in `localStorage` per
  account, room and widget, and granted without a prompt the next time the widget is opened; only
  capabilities it has not been given before are prompted for. Logging out forgets them. In the
  DevBackend nothing is remembered unless "remember capabilities" is on.
- **Revoke** (driver panel): the widget gets `update_capabilities` with the reduced list, and
  what was remembered for it is forgotten ("Revoke all": also what is auto-approved without being
  held now, such as a used up "Always").

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
| `seed=<url>` | Starts in the in-memory mode with the content and screen of this seed JSON (`e2e/seeds/*.json`). |
| `room=<id>` / `user=<id>` | Ids of the in-memory room and its user. |
| `wrapper=<url>` | Base URL of the compat wrapper, used for legacy events only (both modes). Default: the copy this host serves itself at `widget_compatibility_wrapper/` next to its own page (`/widget_compatibility_wrapper/` on the dev server). Set it to test a wrapper hosted elsewhere, e.g. `../widget-compat-wrapper`'s own dev server on `http://localhost:5174/`. |
| `log=<level>` | Level of the driver's own log: `error`, `warn` (default), `info`, `debug`, `trace`. The records appear in the browser console and in the **Console** panel of the dev tools. |
| `logFilter=<spec>` | `RUST_LOG`-style overrides per module, e.g. `widget_host_driver::driver::requests=trace`. |

Example: `http://localhost:5173/?autoload=1&autoApprove=1&event=%7B%22type%22%3A%22m.widget%22...%7D`

## Running

```sh
npm install              # from the repository root
npm run bindings         # once: generates ../widget-host-bindings (ubrn, wasm-bindgen-cli 0.2.129)
npm run wasm             # once: widget-base-sdk for ../test-widgets (needs wasm-pack)
npm run dev              # http://localhost:5173/
```

`npm run storybook` shows every state of the views (port 6006), `npm run e2e` runs the Playwright tests, `npm test` the unit tests, `npm run stories` checks that the stories, `e2e/stories.md` and the tests agree.

For the examples to work also start `../test-widgets` (port 5175). From the root, `npm run dev`
starts both.

The compat wrapper needs no server of its own: the host builds `../widget-compat-wrapper/src`
into a second page, `/widget_compatibility_wrapper/` (`widget_compatibility_wrapper/index.html`),
in the dev server and in `dist/` alike, and loads legacy widgets through it. That page has the
host's origin, unlike a wrapper deployed for a real client.

### Security notes

**Every widget iframe starts strict:** `sandbox="allow-scripts allow-same-origin"` and an empty
`allow` (no camera, microphone, clipboard, popups, downloads, ...). More is a webview capability the
widget requests (`webview:…sandbox:<token>`, `webview:…allow:<feature>`,
[`spec/patch/new/webview-capabilities.md`](../../spec/patch/new/webview-capabilities.md)). The
attributes are made by the driver (`webview_attributes`) from what the widget holds and set once
per start (`WidgetInstanceViewModel.webview`, rendered by `WidgetIframes` in `src/app/AppRoot.tsx`):

- The base tokens are granted without asking, `allow-top-navigation` never (not even "Approve" or
  auto-approve). Everything else goes through the capability prompt, under "Browser permissions".
- A grant applies with a restart of the widget: the runtime (`src/app/runtime/widgetRuntime.ts`)
  reports `webviewChanged` once the widget holds a webview capability its iframe lacks (after the
  driver's `update_capabilities` went out); the controller keeps it for the widget's next starts
  (`webviewKept`, forgotten when the widget stops, and only for the URL it was granted to: a start
  after the widget's state event named another URL does not get it) and starts it again with a new
  generation, whose iframe has it. The widget's request for it is then granted at once, without a
  prompt or another restart. A denial changes nothing; revoking an applied one (driver panel) restarts the widget
  without it; "Add" of a webview capability in the driver panel ("Add and restart") restarts it with it.
  The driver panel shows the attributes of the iframe under "Webview of this load". A widget that
  restarts more than twice within 10 s for this fails instead (a guard; it should not happen).
- Remembered webview capabilities (`rememberCapabilities`) are in the iframe from the first start.
  They are remembered per widget (account, room, event type and state key) like all its capabilities,
  not per URL: a room widget whose state event names another URL keeps them (a local widget forgets
  them).
- A legacy widget's iframe (the compat wrapper) has Element Web's set from the start
  (`LEGACY_WEBVIEW` in `src/widgetStateEvent.ts`): the wrapper requests it and gets it without a
  prompt or a restart; the wrapper gives the legacy widget's own iframe the same set.
- Without remembered capabilities (the DevBackend's default), a restart for a webview capability asks
  again for the other capabilities of the widget, as every start does.

`allow-scripts allow-same-origin` is only harmless for pages of another origin than the host's: a
page of the host's own origin in such an iframe is not sandboxed from the host. It can reach
`window.top`, the logins in `localStorage` and IndexedDB. Four layers keep a widget state event
(anyone who may send state to a room can send one) from putting script there:

1. **The URL check** (the driver's `embed`): only absolute `http:` / `https:` URLs that name their
   own host, so no `javascript:`, `data:`, `blob:` or page-relative URL.
2. **The compat wrapper is no widget**: its page runs on the host's origin and loads the
   `legacy_widget_url` of its own query, so an `m.widget` (or legacy widget) whose URL is a page of
   the wrapper's directory, `<host>/widget_compatibility_wrapper/…` in any spelling a server may
   read the same way, is listed disabled: "a widget cannot load this client's compat wrapper".
   With `?wrapper=` the rule protects that wrapper, not the copy this host serves.
3. **No widget of the host's own origin**: every other page of `location.origin`, the host app
   itself included (the dev server answers every unknown path with it), is listed disabled too: "a
   widget cannot be a page of this client's own origin" (`embedOptions` in `src/lib/widgetEvents.ts`,
   the driver's `EmbedOptions.client_origin`). The one exception is deliberate, for this developer
   tool: the test widgets the host ships itself, when the build serves them from its origin
   (`VITE_TEST_WIDGETS_URL` on the [dev site](../../README.md#dev-site-github-pages); `ownWidgetDirs`,
   never a directory that holds the host). They run with `allow-same-origin` on the host's origin.
4. **The wrapper's own check**: it loads only absolute `http:` / `https:` URLs, before and after
   templating (its README), also when another client or another copy of the host embeds it; and a
   legacy widget of its own origin without `allow-same-origin`.

A deployment for real accounts should serve the host on an origin of its own and the widgets (and
the wrapper) elsewhere.

`npm run build` writes a static site to `dist/` that can be served by any web server. Two
build-time settings:

- **Sub-path:** `npx vite build --base /some/path/` builds it for `https://example.org/some/path/`.
  The compat wrapper, the OAuth redirect (`oidc-callback.html`) and the demo media follow the
  base.
- **`VITE_TEST_WIDGETS_URL`:** where the test widgets are served, with a trailing slash; an
  absolute URL, or a path resolved against the host's base URL. Their state events
  (`src/exampleWidgets.ts`: the room of `mode=memory`, the DevBackend's widget form) point there.
  Default: `http://localhost:5175/`, the dev server.

The [dev site](../../README.md#dev-site-github-pages) is built that way (`scripts/build-dev-site.mjs`).

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

Open the host with the URL parameters above (or `?seed=<url of a seed json>`), then use `window.widgetHost` (`src/app/testHook.ts`):

| call | gives |
|---|---|
| `populate(seed)` | Resets the app to the DevBackend with exactly this content and screen (`HostSeed` in `src/app/controller.ts`, examples in `e2e/seeds/`); `open: [{ room, widgets, timeline, active, overview }]` are the room panels and their tabs, `localWidgets: { [room id]: [state event] }` the local widgets ("Add widget", only in this host) |
| `messages(widgetId)` | Every envelope of a widget in both directions, as it crossed the wire |
| `driverSnapshot(widgetId)` | The negotiated state of its driver |
| `webview(widgetId)` | Its start (`generation`), its iframe's `sandbox` and `allow`, and the webview capabilities they were made from (`applied`) |
| `store(roomId)` | Timeline, state, delayed events and sent to-device messages of a mocked room |
| `state()` / `dispatch(intent)` | The view model / send an intent |

A widget id is `<room id>|<widget key>`, e.g. `!room:example.org|m.widget/widget-1`; a local widget's key starts with `local:` (`!room:example.org|local:m.widget/widget-1`). No Matrix SDK code is loaded on this path. The message log and the driver panel of the dev tools show the same data, but collapsed and capped, so assert on the hook. Why the driver refused or dropped something is in the widget's console panel and in the browser console (see `log=` above). Widget-side assertions are available in the test widgets' own log.

The host's own Playwright tests are in `e2e/` ([`e2e/README.md`](e2e/README.md)): `npm run e2e`.

Playwright's colour scheme emulation (a context's `colorScheme`, `"light"` by default) overrides, in Chromium, the scheme a widget iframe passes on: inside the widget `prefers-color-scheme` is then the emulated value, whatever the host's theme. Call `page.emulateMedia({ colorScheme: null })` to test what a widget sees ([`docs/widget-color-scheme.md`](../../docs/widget-color-scheme.md), section 4).

Ports are fixed (`strictPort`): host 5173 (including the compat wrapper), widgets 5175.
