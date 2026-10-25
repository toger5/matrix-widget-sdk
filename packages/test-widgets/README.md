# Test widgets

Two tiny widgets that show the current state and every message that arrives, with a button for
each basic action. They only work when embedded by a widget host, for example `../widget-host`.

| path | built on | protocol |
|---|---|---|
| `/legacy/` | [matrix-widget-api] | legacy (`api: fromWidget / toWidget`) |
| `/new/` | `widget-base-sdk` (wasm, this repository) | MSC4412 (`source: widget / host`) |

Both pages have the same layout: an **actions** column (capability list input, message body
input, one button per action), a **state** panel, and a **log** of outgoing results and incoming
host messages, newest first. Button results and errors are logged with the button's label.

## Actions

Legacy (`/legacy/`): start (requests the listed capabilities, calls `start()`, fetches the host's
supported versions), `content_loaded`, renegotiate capabilities (MSC2974), send `m.room.message`,
send state `m.room.topic`, read `m.room.message`, read state `m.room.topic`, and a custom action
`org.example.custom` to see the host's unknown-action error. Incoming `send_event` and
`update_state` are acknowledged and logged. The state panel shows `urlParams`, the query
parameters the page was loaded with: when embedded through the compat wrapper that is the
wrapper's templating result (`userId`, `baseUrl`, `parentUrl`, ...). The same object is written
to the console once on load, so headless runs can read it.

New (`/new/`): `request_capabilities`, `content_loaded`, send `m.room.message`, send state
`m.room.topic`, read `m.room.message`, read state `m.room.topic`, `matrix_context`,
`client_context` (the default capability list includes `m.matrix_context` and
`m.client_context`). Incoming `send_event`,
`update_state` and `notify_capabilities` are logged and the state panel shows the SDK's state.

## URL parameters

| page | parameter | meaning |
|---|---|---|
| both | `autostart=0` | Do nothing on load. Default: the legacy widget requests capabilities and starts; the new widget sends `request_capabilities` and `content_loaded`. |
| legacy | `widgetId` | The widget id, as legacy clients pass it. Required for the legacy transport. |
| legacy | `parentUrl` | The widget only posts to this origin (as Element widgets do). Without it, `*`. The compat wrapper always sets it to itself. |

## Running

```sh
npm run wasm             # once, from the repository root (needs wasm-pack)
npm install              # from the repository root
npm run dev              # serves both at http://localhost:5175/legacy/ and /new/
npm run dev:legacy       # same server, opens the legacy page
npm run dev:new          # same server, opens the new page
npm run build            # static multi-page build in dist/
```

The pages share `shared/ui.ts` (a few DOM helpers) and `shared/style.css`.

[matrix-widget-api]: https://github.com/matrix-org/matrix-widget-api
