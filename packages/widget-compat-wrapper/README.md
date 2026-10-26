# Widget compat wrapper

A hosted widget that makes a **legacy widget** (built on [matrix-widget-api], `api: fromWidget | toWidget`)
look like an **MSC4412 widget** to its host. The host embeds the wrapper; the wrapper embeds the legacy
widget in an inner iframe and translates between the two protocols.

It contains **no action logic**. It translates envelopes and two action names, forwards every body
untouched (including error responses in both directions) except file payloads (converted between
`Blob` and base64, see below), and implements only two things itself:
the legacy **URL templating** (`$matrix_user_id` & co., fed by the `matrix_context` /
`client_context` actions) and the startup handshake, where the two protocols are structurally
different.

![Using legacy widgets with the new driver](../../docs/diagrams/02-legacy-widgets.svg)

## How a client uses it during the transition

The client speaks MSC4412 only (for example through `widget-host-driver`) and keeps one piece of
transition code: a check on the widget state event.

1. The client reads the widget state event of the room.
2. **Legacy event** (`im.vector.modular.widgets`): embed
   `https://example.org/myHostedCompatWidget?legacy_widget_url=<urlencoded content.url>&legacy_widget_id=<state_key>`
   as a new-style widget with `usesWidgetAPI: true`. The URL is passed **untemplated**; the host
   knows nothing about template variables. The wrapper resolves them (it asks the host for
   `matrix_context` and `client_context`), appends the `widgetId` / `parentUrl` query parameters
   legacy clients used to add, and loads the result in its inner iframe.
3. **New event** (`m.widget`): embed `content.url` directly.

That URL construction is the only client code specific to the transition. Once legacy widgets are
gone, delete it and the wrapper. The host keeps no template engine at all.

## Query parameters

| parameter | required | from the legacy state event | meaning |
|---|---|---|---|
| `legacy_widget_url` | yes | `content.url`, **untemplated** | Template variables are resolved by the wrapper. `widgetId` is added if missing and `parentUrl` is always set to the wrapper's own URL, because the widget's parent is now the wrapper. |
| `legacy_widget_id` | no | `state_key` | `widgetId` put on every legacy message and value of `$matrix_widget_id`. Default: the `widgetId` query parameter of `legacy_widget_url`. One of the two must exist. |
| `legacy_widget_name` | no | `content.name` | Accessible name (`title`) of the inner iframe. Default: the widget id. |
| `legacy_wait_for_iframe_load` | no | `content.waitForIframeLoad` (default `true`) | Decides when the legacy capability round starts, see below. |
| `legacy_widget_data` | no | `content.data` as JSON | Extra `$key` template variables, as in legacy clients. |
| `client_origin` | no | | Target origin for `postMessage` to the host. Default `*`. Set it in production. |

## What the wrapper does

### Bootstrap: templating the legacy URL

Before the inner iframe exists the wrapper sends `request_capabilities` for
`org.matrix.msc4412.matrix_context` and `org.matrix.msc4412.client_context`, waits for the host's
`notify_capabilities`, requests both contexts and
renders the URL:

| variable | source |
|---|---|
| `$matrix_user_id`, `$matrix_room_id`, `$matrix_display_name`, `$matrix_avatar_url` | `matrix_context` |
| `$org.matrix.msc3819.matrix_device_id`, `$org.matrix.msc4039.matrix_base_url` | `matrix_context` |
| `$org.matrix.msc2873.client_id`, `$org.matrix.msc2873.client_theme`, `$org.matrix.msc2873.client_language` | `client_context` |
| `$matrix_widget_id` | `legacy_widget_id` |
| `$<key>` | `legacy_widget_data` |

Values are URI-encoded, unknown variables stay as they are, and if the host denies a capability
or does not implement an action the corresponding variables are empty (the widget still loads).
Any other host request during this phase is answered with an error, since there is no widget yet.

This means a host prompts twice for a wrapped widget: once for the wrapper's context
capabilities, once for the capabilities the legacy widget itself asks for. A host may of course
grant the context capabilities without prompting.

### Envelope translation (both directions, stateless)

| legacy | MSC4412 |
|---|---|
| `api: "fromWidget"` / `"toWidget"` | `source: "widget"` / `"host"` |
| `widgetId` | absent; added from `legacy_widget_id` |
| absent | `version: "v1"` |
| `data` | `request` |
| response = echo of the request + `response` | response = header + `response` |
| `requestId` | unchanged, so responses correlate without extra state |
| `response.error.message` | unchanged |

Action names: `org.matrix.msc2974.request_capabilities` ↔ `request_capabilities`. Everything else
passes through unchanged (the host emits and accepts the unstable MSC spellings such as
`org.matrix.msc2876.read_events` itself, see `docs/parity.md`), so an
action the host does not implement is answered by the host's own error response, which is
forwarded to the widget as is.

![How the envelope changed](../../docs/diagrams/03-wire-format-changes.svg)

### File payloads: Blob → base64

> **The MSC4412 file format is base64.** A file always travels between widget and host as
> `{ "mimetype": "image/png", "base64": "iVBORw0…" }`. Only legacy widgets send files as `Blob`,
> and only the wrapper ever sees one.

matrix-widget-api passes files as `Blob` (`XMLHttpRequestBodyInit`) through `postMessage`
structured cloning. That does not survive the JSON string boundary every MSC4412 host has: the
UniFFI layer and the Android / iOS WebView bridges carry strings only (`JSON.stringify(blob)` is
`{}`, so the file would be silently lost). The wrapper converts on the three actions that carry a
file (`src/files.ts`):

| action | direction | conversion |
|---|---|---|
| `org.matrix.msc4039.upload_file` | widget → host, request `file` | `Blob` → base64 |
| `org.matrix.msc4039.download_file` | host → widget, response `file` | base64 → `Blob` |
| `screenshot` | widget → host, response `screenshot` | `Blob` → base64 |

Any `XMLHttpRequestBodyInit` (Blob, ArrayBuffer, typed array, string, ...) is accepted; the
`mimetype` is the content type the browser would send for that body. The widget still gets its
own request echoed back with the original `Blob`. Base64 adds about 33% to the size, which is
fine for widget-sized files.

### Startup handshake

After the bootstrap above has loaded the inner iframe. Legacy capabilities are **host-initiated**
(`toWidget capabilities` → the widget answers with its list), MSC4412 capabilities are
**widget-initiated** (`request_capabilities`). The wrapper plays the legacy host towards the
inner iframe:

`waitForIframeLoad = true` (legacy default)

```
inner iframe load  ──► host:   content_loaded           (once per wrapper lifetime)
                   ──► widget: capabilities {}
widget: { capabilities } ──► host: request_capabilities { capabilities }   (host acks, ignored)
host: notify_capabilities ──► widget: notify_capabilities (legacy)  ──► widget ack ──► host ack
```

A `content_loaded` from the widget in this mode is answered with the legacy error
"Improper sequence: not expecting ContentLoaded event" and never forwarded.

`waitForIframeLoad = false`

```
inner iframe load  ──► nothing
widget: content_loaded ──► widget: {} ack, host: content_loaded, then the same capability round
```

A second `content_loaded` before a reload is answered with an error, as legacy hosts do.

Always:

- `supported_api_versions` from the widget is **answered locally** with matrix-widget-api's
  `CurrentApiVersions`. The widget asks during `start()` and again while handling `capabilities`;
  forwarding it would make the widget believe the host supports nothing (no MSC2871 → `ready`
  before capabilities are approved, no MSC2974 → no renegotiation).
- Renegotiation (`org.matrix.msc2974.request_capabilities`) is forwarded like any request; the
  resulting `notify_capabilities` is forwarded back.
- On an inner reload the capability round runs again (legacy hosts do the same); `content_loaded`
  is sent to the host only once.
- Messages are routed by `event.source` (parent window vs. inner iframe), never by sniffing the
  format. Messages with another `widgetId` or an MSC4412 version other than `v1` are ignored
  or answered with an error respectively.

### Parity notes

- `notify_capabilities.approved` must be the **cumulative** set, as legacy hosts send it and
  legacy widgets overwrite their approved list with it. `widget-host-driver` does this.
- Legacy widgets built with `new WidgetApi(widgetId, clientOrigin)` only accept a parent at
  `clientOrigin`; widgets derive it from `parentUrl`, which the wrapper sets to itself. A widget
  that passes `null` cannot talk to any parent, wrapper or not.
- The legacy 10 s request timeout still applies between widget and host.

## Development

```sh
npm install              # from the repository root (npm workspaces)
npm test                 # vitest: envelope translation, handshake state machine, config parsing
npm run dev              # http://localhost:5174/ (only useful when embedded by a host)
npm run build            # static output in dist/, serve it under its own origin
```

Source layout: `src/envelope.ts` (translation tables), `src/template.ts` (legacy URL
templating), `src/files.ts` (Blob ↔ base64), `src/bridge.ts` (bootstrap and handshake state machine, transport free),
`src/wrapper.ts` (URL config, iframe, `postMessage` routing), `src/main.ts`.

For an end-to-end run use the test host in `../widget-host` with the legacy test widget from
`../test-widgets`.

[matrix-widget-api]: https://github.com/matrix-org/matrix-widget-api
