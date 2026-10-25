# Widget compat wrapper

A hosted widget that makes a **legacy widget** (built on [matrix-widget-api], `api: fromWidget | toWidget`)
look like an **MSC4412 widget** to its host. The host embeds the wrapper; the wrapper embeds the legacy
widget in an inner iframe and translates between the two protocols.

It contains **no action logic**. It translates envelopes and two action names, forwards every body
untouched (including error responses in both directions), and implements only the startup
handshake, where the two protocols are structurally different.

## How a client uses it during the transition

The client speaks MSC4412 only (for example through `widget-host-driver`) and keeps one piece of
transition code: a check on the widget state event.

1. The client reads the widget state event of the room.
2. **Legacy event** (`im.vector.modular.widgets`): run the usual legacy URL templating
   (`$matrix_user_id`, `$matrix_widget_id`, ..., plus the `widgetId` / `parentUrl` query
   parameters legacy clients append), then embed
   `https://example.org/myHostedCompatWidget?legacy_widget_url=<urlencoded completed legacy url>`
   as a new-style widget with `usesWidgetAPI: true`. The wrapper loads and uses
   `legacy_widget_url` as the `src` of its inner iframe.
3. **New event** (`m.widget`): embed `content.url` directly.

That URL construction is the only client code specific to the transition. Once legacy widgets are
gone, delete it and the wrapper.

## Query parameters

| parameter | required | from the legacy state event | meaning |
|---|---|---|---|
| `legacy_widget_url` | yes | `content.url`, templated by the client | Loaded verbatim in the inner iframe. If it has a `parentUrl` query parameter, the wrapper rewrites it to its own URL, because the widget's parent is now the wrapper. |
| `legacy_widget_id` | no | `state_key` | `widgetId` put on every legacy message. Default: the `widgetId` query parameter of `legacy_widget_url`. One of the two must exist. |
| `legacy_wait_for_iframe_load` | no | `content.waitForIframeLoad` (default `true`) | Decides when the legacy capability round starts, see below. |
| `client_origin` | no | | Target origin for `postMessage` to the host. Default `*`. Set it in production. |

## What the wrapper does

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

Action names: `org.matrix.msc2974.request_capabilities` ↔ `request_capabilities`,
`org.matrix.msc2876.read_events` ↔ `read_events`. Everything else passes through unchanged, so an
action the host does not implement is answered by the host's own error response, which is
forwarded to the widget as is.

### Startup handshake (the only logic)

Legacy capabilities are **host-initiated** (`toWidget capabilities` → the widget answers with its
list), MSC4412 capabilities are **widget-initiated** (`request_capabilities`). The wrapper plays the
legacy host towards the inner iframe:

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
  `clientOrigin`; widgets derive it from `parentUrl`, which the wrapper rewrites. A widget that
  passes `null` cannot talk to any parent, wrapper or not.
- The legacy 10 s request timeout still applies between widget and host.

## Development

```sh
npm install              # from the repository root (npm workspaces)
npm test                 # vitest: envelope translation, handshake state machine, config parsing
npm run dev              # http://localhost:5174/ (only useful when embedded by a host)
npm run build            # static output in dist/, serve it under its own origin
```

Source layout: `src/envelope.ts` (translation tables), `src/bridge.ts` (handshake state machine,
transport free), `src/wrapper.ts` (URL config, iframe, `postMessage` routing), `src/main.ts`.

For an end-to-end run use the test host in `../widget-host` with the legacy test widget from
`../test-widgets`.

[matrix-widget-api]: https://github.com/matrix-org/matrix-widget-api
