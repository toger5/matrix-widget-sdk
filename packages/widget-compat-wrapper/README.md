# Widget compat wrapper

A hosted widget that makes a **legacy widget** (built on [matrix-widget-api], `api: fromWidget | toWidget`)
look like an **MSC4412 widget** to its host. The host embeds the wrapper; the wrapper embeds the legacy
widget in an inner iframe and translates between the two protocols.

It contains **no action logic**. It translates envelopes, action names and capability names,
forwards every other body untouched except file payloads (converted between `Blob` and base64,
see below) and the error responses of the legacy widget (which get the `code` MSC4412 requires),
and implements only two things itself:
the legacy **URL templating** (`$matrix_user_id` & co., fed by the `get_matrix_context` /
`get_client_context` actions) and the startup handshake, where the two protocols are structurally
different.

The wrapper is the **only** place the legacy names are understood. The host knows the action and
capability names of [`capability-naming-proposal.md`](../../docs/spec-appendix/capability-naming-proposal.md)
and nothing else.

![Using legacy widgets with the new driver](../../docs/diagrams/02-legacy-widgets.svg)

## How a client uses it during the transition

The client speaks MSC4412 only (for example through `widget-host-driver`) and keeps one piece of
transition code: a check on the widget state event.

1. The client reads the widget state event of the room.
2. **Legacy event** (`im.vector.modular.widgets`): embed
   `https://example.org/myHostedCompatWidget?legacy_widget_url=<urlencoded content.url>&legacy_widget_id=<state_key>`
   as a new-style widget with `usesWidgetAPI: true`. The URL is passed **untemplated**; the host
   knows nothing about template variables. The wrapper resolves them (it asks the host for
   `get_matrix_context` and `get_client_context`), appends the `widgetId` / `parentUrl` query parameters
   legacy clients used to add, and loads the result in its inner iframe.
3. **New event** (`m.widget`): embed `content.url` directly, unless it is a page of the client's
   own compat wrapper: that runs on the client's origin and loads the `legacy_widget_url` the
   event put into its query, unchecked by the client
   ([Which URLs the wrapper loads](#which-urls-the-wrapper-loads)).

That URL construction is the only client code specific to the transition. Once legacy widgets are
gone, delete it and the wrapper. The host keeps no template engine at all. `widget-host-driver`
has it (`WidgetDefinition::embed`, `embedWidget` in the TypeScript bindings), with the URL check
of the widget and of the wrapper, and refuses a widget of either kind whose URL is a page of the
wrapper; it sets `legacy_widget_url`, `legacy_widget_id`,
`legacy_wait_for_iframe_load` and `legacy_widget_data`.

## Query parameters

| parameter | required | from the legacy state event | meaning |
|---|---|---|---|
| `legacy_widget_url` | yes | `content.url`, **untemplated** | Template variables are resolved by the wrapper. `widgetId` is added if missing and `parentUrl` is always set to the wrapper's own URL, because the widget's parent is now the wrapper. Only an absolute `http:` / `https:` URL is loaded, see [below](#which-urls-the-wrapper-loads). |
| `legacy_widget_id` | no | `state_key` | `widgetId` put on every legacy message and value of `$matrix_widget_id`. Default: the `widgetId` query parameter of `legacy_widget_url`. One of the two must exist. |
| `legacy_widget_name` | no | `content.name` | Accessible name (`title`) of the inner iframe. Default: the widget id. |
| `legacy_wait_for_iframe_load` | no | `content.waitForIframeLoad` (default `true`) | Decides when the legacy capability round starts, see below. |
| `legacy_widget_data` | no | `content.data` as JSON | Extra `$key` template variables, as in legacy clients. |
| `client_origin` | no | | Target origin for `postMessage` to the host. Default `*`. Set it in production. |
| `log_level` | no | | What the wrapper writes to the console (prefix `[widget-compat-wrapper]`): `off`, `error`, `warn` (default), `info`, `debug`. `warn` reports dropped responses and refused requests, `debug` adds one line per message. |

## What the wrapper does

### Bootstrap: templating the legacy URL

Before the inner iframe exists the wrapper sends `request_capabilities` for
`widget:org.matrix.mscXXXX.get_matrix_context` and `widget:org.matrix.mscXXXX.get_client_context`,
waits for the host's `update_capabilities`, requests both contexts
(`org.matrix.mscXXXX.get_matrix_context`, `org.matrix.mscXXXX.get_client_context`) and
renders the URL:

| variable | source |
|---|---|
| `$matrix_user_id`, `$matrix_room_id`, `$matrix_display_name`, `$matrix_avatar_url` | `get_matrix_context` |
| `$org.matrix.msc3819.matrix_device_id`, `$org.matrix.msc4039.matrix_base_url` | `get_matrix_context` |
| `$org.matrix.msc2873.client_id`, `$org.matrix.msc2873.client_theme`, `$org.matrix.msc2873.client_language` | `get_client_context` |
| `$matrix_widget_id` | `legacy_widget_id` |
| `$<key>` | `legacy_widget_data` |

Values are URI-encoded, unknown variables stay as they are, and if the host denies a capability
or does not implement an action the corresponding variables are empty (the widget still loads).
Any other host request during this phase is answered with an `invalid_request` error, since there
is no widget yet.

This means a host prompts twice for a wrapped widget: once for the wrapper's context
capabilities, once for the capabilities the legacy widget itself asks for. A host may of course
grant the context capabilities without prompting.

### Which URLs the wrapper loads

The wrapper is often served from its client's own origin (this repository's test host does that),
the client gives its iframe `allow-same-origin`, and the inner iframe has no sandbox. A
`javascript:` URL in the inner iframe would run on the client's origin, and `data:`, `blob:`,
`about:` pages or a URL resolved against the wrapper page (`/x`, `http:/x`) would be pages of that
origin. So the wrapper loads only an **absolute `http:` or `https:` URL that names its own host**:
the rule of `widget_url_problem` in `widget-host-driver` (`src/url.ts`; its tests run the driver's
URL table, `crates/widget-host-driver/tests/widget_urls.json`). It checks:

1. the template in `legacy_widget_url`, when it reads its configuration: a refused one stops the
   wrapper before it talks to the host (a template that starts with a `$variable` has no scheme
   and is refused);
2. the template again and the templated URL, before the inner iframe is created: that is what
   the iframe loads, and it gets the URL as the URL parser serialised it. A value cannot change
   the scheme (it is URI-encoded), but it can make the URL invalid (`https://$server/` with
   `server` = `widgets.example:8443`).

A refused URL creates no inner iframe. The wrapper logs the reason (`console.error`, also at
`log_level=warn`), shows it in its page ("Widget compat wrapper: refused …", the same place as the
errors of a missing parameter), never sends `notify_ready` (so the host's widget stays in its
loading state until the host gives up) and answers every later host request with
`invalid_request`. The texts name the scheme, never the URL.

A client should still check the URL first (the driver's `WidgetDefinition::embed` does, before
templating) and should not load its own compat wrapper as a widget (`embed` refuses that too):
the wrapper's check protects clients that do not, and copies of the wrapper the client does not
know about.

### Envelope translation (both directions, stateless)

| legacy | MSC4412 |
|---|---|
| `api: "fromWidget"` / `"toWidget"` | `source: "widget"` / `"host"` |
| `widgetId` | absent; added from `legacy_widget_id` |
| `data` | `request` |
| response = echo of the request + `response` | response = header + `response` |
| `requestId` | `request_id`, same value, so responses correlate without extra state |
| `response.error: { message }` from the widget | `response.error: { code: "org.matrix.msc4412.unknown", message }` |
| `response.error` from the host | unchanged: the widget reads `message` (and `matrix_api_error`) and ignores `code` |

Neither format has a version. They are told apart by `api` versus `source`; the wrapper routes by
window (`event.source`) and ignores a message of the wrong format.

### Action names (`src/envelope.ts`)

The host does not accept the legacy names of the actions below, so the wrapper renames them.
MSC4412 demands a namespace on every action, so that includes every legacy name without one. The
table depends on the direction, because `send_event` and `send_to_device` are legacy names in both.

`…` is `org.matrix.mscXXXX.`, the placeholder namespace of actions without an MSC of their own.

| direction | legacy widget | host |
|---|---|---|
| widget → host | `content_loaded` | `org.matrix.msc4412.notify_ready` (sent by the wrapper itself, see the handshake) |
| widget → host | `org.matrix.msc2974.request_capabilities` | `org.matrix.msc4412.request_capabilities` |
| widget → host | `send_event` | `…send_event` |
| widget → host | `send_to_device` | `…send_to_device` |
| widget → host | `get_openid` | `…get_openid` |
| widget → host | `watch_turn_servers` / `unwatch_turn_servers` | `…watch_turn_servers` / `…unwatch_turn_servers` |
| widget → host | `set_always_on_screen` | `…set_always_on_screen` |
| widget → host | `org.matrix.msc3973.user_directory_search` | `org.matrix.msc3973.search_user_directory` |
| widget → host | `org.matrix.msc4533.rtc_livekit_get_token` | `org.matrix.msc4533.get_rtc_livekit_token` |
| widget → host | `org.matrix.msc4533.rtc_livekit_delegate_delayed_leave` | `org.matrix.msc4533.delegate_rtc_livekit_delayed_leave` |
| host → widget | `notify_capabilities` | `org.matrix.msc4412.update_capabilities` (body rewritten, see below) |
| host → widget | `send_event` | `…forward_event` |
| host → widget | `send_to_device` | `…forward_to_device` |
| host → widget | `openid_credentials` | `…forward_openid_credentials` |
| host → widget | `update_state` | `…update_state` |
| host → widget | `update_turn_servers` | `…update_turn_servers` |
| host → widget | `theme_change` | `…update_theme` |
| host → widget | `language_change` | `…update_language` |
| host → widget | `visibility` | `…update_visibility` |

Everything else passes through unchanged (the host emits and accepts the unstable MSC spellings
such as `org.matrix.msc2876.read_events` itself, see `docs/parity.md`), so an
action the host does not implement is answered by the host's own error response, which is
forwarded to the widget as is.

### Capabilities (`src/capabilities.ts`)

A legacy widget asks for matrix-widget-api capabilities; the host grants one capability per
action. Every legacy capability stands for a fixed set of new ones. The wrapper requests that set
and tells the widget a legacy capability is approved when the host approved **all** of its set.

| legacy capability (its MSC prefix or `m.`) | requested from the host (`…` = the unstable namespace of the action) |
|---|---|
| `send.event:<t>` | `widget:…send_event.timeline:<t>` |
| `send.state_event:<t>` | `widget:…send_event.state:<t>` |
| `receive.event:<t>` | `widget:…read_events.timeline:<t>`, `widget:…read_relations:<t>`, `host:…forward_event.timeline:<t>` |
| `receive.state_event:<t>` | `widget:…read_events.state:<t>`, `host:…update_state:<t>`, `host:…forward_event.state:<t>` |
| `timeline:<room>` | nothing: never requested, never reported as approved |
| `send.to_device:<t>` / `receive.to_device:<t>` | `widget:…send_to_device:<t>` / `host:…forward_to_device:<t>` |
| `receive.room_account_data:<t>` | `widget:…read_room_account_data:<t>` |
| `send.delayed_event` / `update_delayed_event` | `widget:…send_event.delayed` / `widget:…update_delayed_event` |
| `send.sticky_event` / `receive.sticky_event` | `widget:…send_event.sticky` / `host:…forward_event.sticky` |
| `turn_servers` | `host:…update_turn_servers` |
| `rtc_transports` | `widget:…get_rtc_transports` |
| `user_directory_search` | `widget:…search_user_directory` |
| `upload_file` | `widget:…upload_file`, `widget:…get_media_config` |
| `download_file` | `widget:…download_file` |
| `navigate` | `widget:…navigate` |
| `rtc_livekit_get_token` / `rtc_livekit_delegate_delayed_leave` | `widget:…get_rtc_livekit_token` / `widget:…delegate_rtc_livekit_delayed_leave` |
| `m.always_on_screen` | `widget:…set_always_on_screen` |
| anything else (`m.sticker`, custom strings) | the same string, unchanged |

`<t>` keeps its `#<msgtype>` / `#<state_key>` suffix.

A capability embeds the wire name of its action, so `…` is the prefix the host sends that action
with: `org.matrix.msc2876.` (`read_events`), `org.matrix.msc3869.` (`read_relations`),
`org.matrix.msc4157.` (`update_delayed_event`), `org.matrix.msc4515.` (`get_rtc_transports`),
`org.matrix.msc3973.` (`search_user_directory`), `org.matrix.msc4039.` (`upload_file`,
`download_file`, `get_media_config`), `org.matrix.msc4533.` (the LiveKit actions),
`org.matrix.msc2931.` (`navigate`), `com.beeper.` (`read_room_account_data`) and
`org.matrix.mscXXXX.` for everything else. A host that answers in the stable spelling
(`widget:m.navigate`) is understood as well.

- **Always requested**, whatever the widget asks for: `widget:…get_openid`, `host:…update_theme`,
  `host:…update_language`, `host:…update_visibility`. The legacy api has no capability for these;
  a legacy host simply allows them. A host that wants the legacy behaviour grants them without a
  prompt (`setAutoApproved`).
- **`timeline:<room>` is never granted.** One widget, one room: nothing reaches another room. A
  request that names the widget's own room works without it.
- **`update_capabilities { allowed }` becomes `notify_capabilities { requested, approved }`** for
  the widget: `requested` is the widget's own latest list, `approved` every legacy capability it
  has ever requested whose whole set is in `allowed`. `allowed` is always the full list, so
  `approved` shrinks when the host takes capabilities away. The widget only ever sees legacy
  names, in the spelling it used.
- A partially approved set (the host grants reading but not `forward_event`, say) is reported as
  **not** approved. The host still holds the partial grant, so the parts that were approved work.

![How the envelope changed](../../docs/diagrams/03-wire-format-changes.svg)

### File payloads: Blob → base64

> **The MSC4412 file format is base64.** A file always travels between widget and host as
> `{ "mimetype": "image/png", "base64": "iVBORw0…" }`. Only legacy widgets send files as `Blob`,
> and only the wrapper ever sees one.

matrix-widget-api passes files as `Blob` (`XMLHttpRequestBodyInit`) through `postMessage`
structured cloning. That does not survive the JSON string boundary every MSC4412 host has: the
UniFFI layer and the Android / iOS WebView bridges carry strings only (`JSON.stringify(blob)` is
`{}`, so the file would be silently lost). The wrapper converts on the two actions that carry a
file (`src/files.ts`):

| action | direction | conversion |
|---|---|---|
| `org.matrix.msc4039.upload_file` | widget → host, request `file` | `Blob` → base64 |
| `org.matrix.msc4039.download_file` | host → widget, response `file` | base64 → `Blob` |

Any `XMLHttpRequestBodyInit` (Blob, ArrayBuffer, typed array, string, ...) is accepted; the
`mimetype` is the content type the browser would send for that body. The widget still gets its
own request echoed back with the original `Blob`. Base64 adds about 33% to the size, which is
fine for widget-sized files.

The legacy `screenshot` action (host → widget) is **intentionally not supported**: there is no
conversion for it, and an MSC4412 host never asks for one.

### Startup handshake

After the bootstrap above has loaded the inner iframe. Legacy capabilities are **host-initiated**
(`toWidget capabilities` → the widget answers with its list), MSC4412 capabilities are
**widget-initiated** (`request_capabilities`). The wrapper plays the legacy host towards the
inner iframe:

`waitForIframeLoad = true` (legacy default)

```
inner iframe load  ──► host:   notify_ready             (once per wrapper lifetime)
                   ──► widget: capabilities {}
widget: { capabilities } ──► host: request_capabilities { capabilities }   (host acks, ignored)
host: update_capabilities ──► widget: notify_capabilities (legacy)  ──► widget ack ──► host ack
```

A `content_loaded` from the widget in this mode is answered with the legacy error
"Improper sequence: not expecting ContentLoaded event" and never forwarded.

`waitForIframeLoad = false`

```
inner iframe load  ──► nothing
widget: content_loaded ──► widget: {} ack, host: notify_ready, then the same capability round
```

A second `content_loaded` before a reload is answered with an error, as legacy hosts do.

Always:

- `supported_api_versions` from the widget is **answered locally** with matrix-widget-api's
  `CurrentApiVersions`. The widget asks during `start()` and again while handling `capabilities`;
  forwarding it would make the widget believe the host supports nothing (no MSC2871 → `ready`
  before capabilities are approved, no MSC2974 → no renegotiation).
- Renegotiation (`org.matrix.msc2974.request_capabilities`) is forwarded with its capability list
  translated like the first round's; the resulting `update_capabilities` is translated back.
- On an inner reload the capability round runs again (legacy hosts do the same); `notify_ready`
  is sent to the host only once.
- Messages are routed by `event.source` (parent window vs. inner iframe), never by sniffing the
  format. Messages with another `widgetId`, and messages from the parent that are not MSC4412
  (no `source` / `request_id`), are ignored.

### Parity notes

- Legacy widgets overwrite their approved list with `notify_capabilities.approved`, so it must be
  the full set. MSC4412's `update_capabilities.allowed` is exactly that.
- The wrapper needs the host to wait for `notify_ready` (`uses_widget_api: true`); the test host
  always does for a wrapped widget.
- Legacy widgets built with `new WidgetApi(widgetId, clientOrigin)` only accept a parent at
  `clientOrigin`; widgets derive it from `parentUrl`, which the wrapper sets to itself. A widget
  that passes `null` cannot talk to any parent, wrapper or not.
- The legacy 10 s request timeout still applies between widget and host.

## Development

```sh
npm install              # from the repository root (npm workspaces)
npm test                 # vitest: envelope translation, handshake state machine, config parsing, URL check
npm run dev              # http://localhost:5174/ (standalone; the test host serves its own copy and does not need this)
npm run build            # static output in dist/, serve it under its own origin
```

Source layout: `src/envelope.ts` (translation tables), `src/template.ts` (legacy URL
templating), `src/url.ts` (which legacy URLs are loaded), `src/files.ts` (Blob ↔ base64), `src/bridge.ts` (bootstrap and handshake state machine, transport free),
`src/wrapper.ts` (URL config, iframe, `postMessage` routing), `src/main.ts`.

For an end-to-end run use the test host in `../widget-host` with the legacy test widget from
`../test-widgets`. The host builds `src/main.ts` into its own page `/widget_compatibility_wrapper/`,
so changes here show up there without starting this package's dev server.

[matrix-widget-api]: https://github.com/matrix-org/matrix-widget-api
