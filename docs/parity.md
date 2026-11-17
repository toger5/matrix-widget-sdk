# Parity with matrix-widget-api and shape of the backend

This document is the plan behind the `feat/widget-api-parity` work: which widget API actions
exist in [matrix-widget-api](https://github.com/matrix-org/matrix-widget-api), which of them this
repository implements, how `widget-matrix-backend` relates to the `MatrixBackend` of
[matrix-rust-rtc](../../matrix-rust-rtc), and where the two designs conflict. Decisions taken here
are marked **decision**; everything marked **raised** is a conflict left for a human to confirm.

## 1. Wire names and prefixes

MSC4412 demands that every action is `<namespace>.<name>`: `m` for actions in the spec, the
unstable prefix of the defining MSC until then (`org.matrix.msc2876.read_events`). To keep every
action renameable later, this crate emits the **unstable name** on the wire and accepts the
**stable name `m.<name>` as an alias** when parsing. A name without a namespace is not an action.
The serde `rename` / `alias` attributes in `crates/widget-actions/src/actions/*/mod.rs` are the
single place a wire name lives.

**Decision (2026-11-14, updated for the rewritten MSC4412 on the same day):** actions and
capabilities follow MSC4412 and
[`spec-appendix/capability-naming-proposal.md`](spec-appendix/capability-naming-proposal.md).

* **Envelope:** `source`, `action`, `request_id`, `request` / `response`. No `version`: legacy
  messages are recognised by `api` instead of `source`.
* **Core actions** carry MSC4412's prefix: `org.matrix.msc4412.notify_ready`,
  `org.matrix.msc4412.request_capabilities`, `org.matrix.msc4412.update_capabilities`
  (`{ allowed }`, always the full list). They need no capability.
* **Namespaces:** an action keeps the unstable prefix of the MSC that defines it. Actions that
  have no MSC of their own yet use the placeholder `org.matrix.mscXXXX`: `send_event`,
  `send_to_device`, `get_openid`, `watch_turn_servers`, `unwatch_turn_servers`,
  `set_always_on_screen`, `get_matrix_context`, `get_client_context` and every host action
  (`forward_event`, `update_state`, `forward_to_device`, `update_turn_servers`, `update_theme`,
  `update_language`, `update_visibility`).
* **Capabilities** are `source:action[.modifier][:data]`, one per action, where `action` is the
  wire name of the action, namespace included (`widget:org.matrix.msc2876.read_events.state:<type>`,
  `widget:org.matrix.mscXXXX.send_event.timeline:<type>`). The stable spelling
  (`widget:m.navigate`) is parsed as well. The same name under another namespace is a different
  action and grants nothing. No capability names a room.
* **Actions** are verbs, and no name is used by both sources. The proposal's renames are applied
  (`forward_event`, `update_theme`, `get_matrix_context`, ...); a renamed action keeps the prefix
  it had (`org.matrix.msc3973.search_user_directory`).
* **Errors** are `{ error: { code, message } }` with MSC4412's codes
  (`org.matrix.msc4412.unknown_action`, `.missing_capability`, `.invalid_request`, `.unknown`).
  Failed Matrix requests use `org.matrix.mscXXXX.matrix_api_error` with the `matrix_api_error`
  object as the code's additional property.
* **No aliases for legacy names.** Neither the old action names nor the matrix-widget-api
  capability strings are understood by the driver or the widget SDK. Nothing is deployed against
  this API yet, and legacy widgets always run behind `packages/widget-compat-wrapper`, which
  translates both.

**Decision (2026-11-14):** the two actions this repository invented, `get_matrix_context` and
`get_client_context`, use the placeholder `org.matrix.mscXXXX.`. They used to carry
`org.matrix.msc4412.`, but MSC4412 now defines the three core actions only.

### The widget state event

matrix-widget-api's `WidgetParser.parseRoomWidget` treats `m.widget` and
`im.vector.modular.widgets` alike and needs `type` and a creator; Element Web lists an
`im.vector.modular.widgets` event whose content has a `type` and a `url`. Here
`WidgetDefinition::parse` (`crates/widget-host-driver/src/widget_event.rs`) follows MSC4411 for
`m.widget` / `org.matrix.msc4411.widget` (a string `name` and `url`, else a removed widget) and
needs only a string `url` for the legacy event (`type` is optional, the name falls back to the
state key). `parse_widget_state_event` also checks the URL (absolute `http(s)`, parsed per WHATWG,
not relative to the page that embeds it; no page of the client's compat wrapper; no page of the
client's own origin, `EmbedOptions`); a `WidgetHostDriver` made from the definition checks it
again and tells the client what to load (`WidgetHostPlatform::load_iframe`), a legacy widget
through the compat wrapper with its URL untemplated. One parser for every client: the browser host
calls it through the bindings.

### The widget iframe

Element Web gives every widget the same iframe (`AppTile.tsx`, `apps/web/src/components/views/elements/`):

```text
sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-presentation allow-downloads"
allow="microphone; camera; encrypted-media; autoplay; display-capture; clipboard-write; clipboard-read;"
allowFullscreen
```

Its comment on `allow-scripts` with `allow-same-origin`: the pair would let a page lift its sandbox,
"but this would only be for content hosted on the same origin as the element client". MSC4411 used
to recommend this set (without `allowFullscreen`).

| | Element Web | here |
|---|---|---|
| widget of MSC4411 | the set above | `sandbox="allow-scripts allow-same-origin"`, empty `allow`; more only as webview capabilities it requests and the user grants (`webview:…sandbox:<token>`, `webview:…allow:<feature>`), applied with a reload: the driver calls `load_iframe` again and grants the reloaded page what the widget held |
| legacy widget (`im.vector.modular.widgets`) | the set above | the wrapper's iframe: the same set plus `fullscreen` in `allow`, as webview capabilities the wrapper requests and the driver grants without asking (`legacy_auto_approved`); the wrapper's inner iframe: the same, constant |
| a widget of the client's own origin | loaded with the set above | refused ("a widget cannot be a page of this client's own origin"); the dev site's own test widgets are the exception |
| `allow` features | `camera` (default allowlist `'src'`) | `camera 'src'`, spelled out |
| top navigation | not in the set | never granted, even if approved |

**Decision (2026-11-16):** strict iframes and webview capabilities as a capability source of their
own (`webview`), proposed in [`spec/patch/msc4411/strict-webview-defaults.md`](../spec/patch/msc4411/strict-webview-defaults.md),
[`spec/patch/msc4412/capability-sources.md`](../spec/patch/msc4412/capability-sources.md) and
[`spec/patch/new/webview-capabilities.md`](../spec/patch/new/webview-capabilities.md); widgets of
the client's own origin are refused, except the test widgets the dev site serves from the host's
origin.

## 2. Action inventory

Legend: ✅ implemented before the parity branch · 🔨 built on the parity branch (all of these are
in; the marker shows what changed) · ⛔ raised, not built · ➖ dropped by MSC4412.

In the capability column `…` stands for the namespace of the action (the prefix in the "wire name
here" column, or `m`). Every wire name also has the stable alias `m.<name>`.

### Widget → host (`source: widget`, legacy `fromWidget`)

| legacy action | wire name here | capability | status | backend / platform method |
|---|---|---|---|---|
| `supported_api_versions` | – | – | ➖ dropped by MSC4412 (the compat wrapper answers it locally) | – |
| `content_loaded` | `org.matrix.msc4412.notify_ready` | none (core action) | ✅ (🔨 renamed by MSC4412) | `platform.on_ready` |
| `org.matrix.msc2974.request_capabilities` | `org.matrix.msc4412.request_capabilities` | none (core action) | ✅ (🔨 a request before the answer joins the open question; one `update_capabilities` answers all, see `spec/patch/msc4412/merge-capability-requests.md`) | `platform.on_capabilities_requested` (the whole open question) |
| `send_event` (MSC2762) | `org.matrix.mscXXXX.send_event` | `widget:…send_event.timeline:<type>[#msgtype]` / `widget:…send_event.state:<type>[#key]` | ✅ | `backend.send_room_event` / `send_state_event` |
| `send_event` + `room_id` | – | none; only the widget's own room is accepted, see §4 | 🔨 | – |
| `send_event` + `delay` (MSC4157) | – | + `widget:…send_event.delayed` | 🔨 response carries `delay_id` | `backend.send_delayed_event` |
| `send_event` + `sticky_duration_ms` (MSC4407 / MSC4354) | – | + `widget:…send_event.sticky` | 🔨 | `backend.send_sticky_event` |
| `org.matrix.msc4157.update_delayed_event` | `org.matrix.msc4157.update_delayed_event` | `widget:…update_delayed_event` | 🔨 | `backend.restart_delayed_event` / `cancel_delayed_event` / `send_delayed_event_now` |
| `org.matrix.msc2876.read_events` | `org.matrix.msc2876.read_events` | `widget:…read_events.timeline:<type>[#msgtype]` / `widget:…read_events.state:<type>[#key]` | ✅ (+ 🔨 `msgtype`, `since`, `room_ids`) | `backend.read_room_events` / `read_room_state` |
| `org.matrix.msc3869.read_relations` | `org.matrix.msc3869.read_relations` | results filtered by `widget:…read_relations:<type>[#msgtype]` | 🔨 | `backend.relations` |
| `send_to_device` (MSC3819) | `org.matrix.mscXXXX.send_to_device` | `widget:…send_to_device:<type>` | 🔨 | `backend.send_to_device_message` |
| `get_openid` (MSC1960) | `org.matrix.mscXXXX.get_openid` | `widget:…get_openid`, single use by default | 🔨 the token at once, no `state`; see §5 | `backend.openid_token`, `driver.set_single_use` |
| `watch_turn_servers` / `unwatch_turn_servers` (MSC3846) | `org.matrix.mscXXXX.watch_turn_servers` / `org.matrix.mscXXXX.unwatch_turn_servers` | `host:…update_turn_servers` | 🔨 | `backend.subscribe_turn_servers` |
| `org.matrix.msc4515.get_rtc_transports` | `org.matrix.msc4515.get_rtc_transports` | `widget:…get_rtc_transports` | 🔨 | `backend.rtc_transports` |
| `org.matrix.msc3973.user_directory_search` | `org.matrix.msc3973.search_user_directory` | `widget:…search_user_directory` | 🔨 | `backend.search_user_directory` |
| `org.matrix.msc4039.get_media_config` | `org.matrix.msc4039.get_media_config` | `widget:…get_media_config` | 🔨 | `backend.media_config` |
| `org.matrix.msc4039.upload_file` / `download_file` | same | `widget:…upload_file` / `widget:…download_file` | 🔨 file as base64, see §6 | `backend.upload_media` / `download_media` |
| `com.beeper.read_room_account_data` | `com.beeper.read_room_account_data` | `widget:…read_room_account_data:<type>` | 🔨 | `backend.read_room_account_data` |
| `org.matrix.msc2931.navigate` | `org.matrix.msc2931.navigate` | `widget:…navigate` | 🔨 | `platform.navigate` |
| `m.sticker` | – | – | ⛔ not supported | – |
| `org.matrix.msc4533.rtc_livekit_get_token` | `org.matrix.msc4533.get_rtc_livekit_token` | `widget:…get_rtc_livekit_token` | 🔨 | `backend.rtc_livekit_get_token` |
| `org.matrix.msc4533.rtc_livekit_delegate_delayed_leave` | `org.matrix.msc4533.delegate_rtc_livekit_delayed_leave` | `widget:…delegate_rtc_livekit_delayed_leave` | 🔨 | `backend.rtc_livekit_delegate_delayed_leave` |
| `set_always_on_screen` | `org.matrix.mscXXXX.set_always_on_screen` | `widget:…set_always_on_screen` | 🔨 | `platform.set_always_on_screen` |
| `open_modal` / `close_modal` / `set_button_enabled` | – | – | ⛔ modal widgets, see §6 | – |
| *(new)* | `org.matrix.mscXXXX.get_matrix_context` | `widget:…get_matrix_context` | ✅ (prefix 🔨) | backend identity getters |
| *(new)* | `org.matrix.mscXXXX.get_client_context` | `widget:…get_client_context` | ✅ (prefix 🔨) | `platform.client_*` |

### Host → widget (`source: host`, legacy `toWidget`)

| legacy action | wire name here | capability | status | origin |
|---|---|---|---|---|
| `supported_api_versions` | – | – | ➖ dropped | – |
| `capabilities` | – | – | ➖ capabilities are widget-initiated in MSC4412 | – |
| `notify_capabilities` | `org.matrix.msc4412.update_capabilities` | none (core action) | ✅ (🔨 `{ allowed }`: always the full list) | `driver.approve_capabilities` / `driver.revoke_capabilities` |
| `send_event` | `org.matrix.mscXXXX.forward_event` | `host:…forward_event.timeline:<type>[#msgtype]` / `host:…forward_event.state:<type>[#key]` | ✅ | `RoomSink::on_timeline_events` |
| `update_state` (MSC2762 update_state) | `org.matrix.mscXXXX.update_state` | `host:…update_state:<type>[#key]` | ✅ | `RoomSink::on_state_events` |
| `send_to_device` | `org.matrix.mscXXXX.forward_to_device` | `host:…forward_to_device:<type>` | 🔨 | `ToDeviceSink::on_to_device_message` |
| `openid_credentials` | – | – | ➖ removed: `get_openid` answers at once; the compat wrapper sends it to legacy widgets itself (§5) | – |
| `update_turn_servers` | `org.matrix.mscXXXX.update_turn_servers` | `host:…update_turn_servers` | 🔨 | `TurnServerSink::on_turn_server` |
| `theme_change` (MSC2873) | `org.matrix.mscXXXX.update_theme` | `host:…update_theme` | 🔨 | `driver.update_theme` |
| `language_change` | `org.matrix.mscXXXX.update_language` | `host:…update_language` | 🔨 | `driver.update_language` |
| `visibility` | `org.matrix.mscXXXX.update_visibility` | `host:…update_visibility` | 🔨 | `driver.update_visibility` |
| `screenshot` | – | – | ⛔ intentionally not supported, see §6 | – |
| `widget_config` / `button_clicked` / `close_modal` | – | – | ⛔ modal widgets, see §6 | – |

### Capability strings

All of these parse into a `Capability` variant. Anything else stays `Capability::Other` and grants
nothing; that includes every matrix-widget-api capability string.

| capability (`…` = the action's namespace, see the list below, or `m`) | parsed as | matrix-widget-api capability the compat wrapper maps to it |
|---|---|---|
| `widget:…send_event.timeline:<type>[#msgtype]` | `SendEvent` | `org.matrix.msc2762.send.event:<type>` |
| `widget:…send_event.state:<type>[#key]` | `SendStateEvent` | `org.matrix.msc2762.send.state_event:<type>` |
| `widget:…send_event.delayed` | `SendDelayedEvent` | `org.matrix.msc4157.send.delayed_event` |
| `widget:…send_event.sticky` | `SendStickyEvent` | `org.matrix.msc4407.send.sticky_event` |
| `widget:…update_delayed_event` | `UpdateDelayedEvent` | `org.matrix.msc4157.update_delayed_event` |
| `widget:…read_events.timeline:<type>[#msgtype]` | `ReadEvents` | `org.matrix.msc2762.receive.event:<type>` |
| `widget:…read_events.state:<type>[#key]` | `ReadStateEvents` | `org.matrix.msc2762.receive.state_event:<type>` |
| `widget:…read_relations:<type>[#msgtype]` | `ReadRelations` | `org.matrix.msc2762.receive.event:<type>` |
| `widget:…read_room_account_data:<type>` | `ReadRoomAccountData` | `com.beeper.capabilities.receive.room_account_data:<type>` |
| `widget:…send_to_device:<type>` | `SendToDevice` | `org.matrix.msc3819.send.to_device:<type>` |
| `widget:…get_openid` | `GetOpenId` | none (requested by the wrapper per token, §5) |
| `widget:…get_rtc_transports` | `GetRtcTransports` | `org.matrix.msc4515.rtc_transports` |
| `widget:…search_user_directory` | `SearchUserDirectory` | `org.matrix.msc3973.user_directory_search` |
| `widget:…get_media_config` | `GetMediaConfig` | `org.matrix.msc4039.upload_file` |
| `widget:…upload_file` / `widget:…download_file` | `UploadFile` / `DownloadFile` | `org.matrix.msc4039.upload_file` / `download_file` |
| `widget:…get_rtc_livekit_token` / `widget:…delegate_rtc_livekit_delayed_leave` | `GetRtcLivekitToken` / `DelegateRtcLivekitDelayedLeave` | `org.matrix.msc4533.rtc_livekit_get_token` / `rtc_livekit_delegate_delayed_leave` |
| `widget:…navigate` | `Navigate` | `org.matrix.msc2931.navigate` |
| `widget:…set_always_on_screen` | `SetAlwaysOnScreen` | `m.always_on_screen` |
| `widget:…get_matrix_context` / `widget:…get_client_context` | `GetMatrixContext` / `GetClientContext` | none (used by the wrapper itself) |
| `host:…forward_event.timeline:<type>[#msgtype]` | `ForwardEvent` | `org.matrix.msc2762.receive.event:<type>` |
| `host:…forward_event.state:<type>[#key]` | `ForwardStateEvent` | `org.matrix.msc2762.receive.state_event:<type>` |
| `host:…forward_event.sticky` | `ForwardStickyEvent` (parsed, not delivered yet) | `org.matrix.msc4407.receive.sticky_event` |
| `host:…update_state:<type>[#key]` | `UpdateState` | `org.matrix.msc2762.receive.state_event:<type>` |
| `host:…forward_to_device:<type>` | `ForwardToDevice` | `org.matrix.msc3819.receive.to_device:<type>` |
| `host:…update_turn_servers` | `UpdateTurnServers` | `town.robin.msc3846.turn_servers` |
| `host:…update_theme` / `update_language` / `update_visibility` | `UpdateTheme` / `UpdateLanguage` / `UpdateVisibility` | none (always requested by the wrapper) |
| `webview:…sandbox:<token>` (`…` = `org.matrix.mscXXXX` or `m`) | `WebviewSandbox` (about no action: a token of the widget iframe's `sandbox`) | none: the wrapper requests Element Web's tokens for itself; a legacy widget cannot request one |
| `webview:…allow:<feature>` | `WebviewAllow` (a feature of the iframe's `allow`) | none: the wrapper requests Element Web's features plus `fullscreen` for itself |
| `org.matrix.msc2762.timeline:<room_id>` | `Other` | no equivalent: never requested by the wrapper, never granted |
| `io.element.requires_client`, `m.sticker`, `m.capability.screenshot` | `Other` | passed through unchanged; nothing acts on them |

The namespace of a capability is the one of its action: `org.matrix.msc2876` (`read_events`),
`org.matrix.msc3869` (`read_relations`), `org.matrix.msc4157` (`update_delayed_event`),
`org.matrix.msc4515` (`get_rtc_transports`), `org.matrix.msc3973` (`search_user_directory`),
`org.matrix.msc4039` (`get_media_config`, `upload_file`, `download_file`), `org.matrix.msc4533`
(`get_rtc_livekit_token`, `delegate_rtc_livekit_delayed_leave`), `org.matrix.msc2931` (`navigate`),
`com.beeper` (`read_room_account_data`) and `org.matrix.mscXXXX` for everything else, the webview
capabilities included (their MSC is a draft). The table lives in `namespace_of`
(`crates/widget-actions/src/capabilities.rs`) and is repeated in
`packages/widget-compat-wrapper/src/capabilities.ts` and `packages/test-widgets/new/capabilities.ts`.

## 3. `MatrixBackend` next to matrix-rust-rtc

matrix-rust-rtc (`crates/matrix-rtc-core/src/host/backend.rs`, uniffi layer in
`crates/matrix-rtc-ffi/src/backend.rs`) is the reference. Where both projects need the same thing
the method here has the same name and parameter order, so one adapter per Matrix SDK can serve both.

| matrix-rust-rtc | widget-matrix-backend | note |
|---|---|---|
| `own_user_id()` | `own_user_id()` | renamed from `user_id` |
| `own_device_id()` | `own_device_id()` | renamed from `device_id` |
| – | `room_id()`, `display_name()`, `avatar_url()`, `base_url()` | widget only: the backend is bound to one room; the rest feeds `get_matrix_context` |
| `send_room_event(room_id, type, content) -> event_id` | same | renamed from `send_event`, now returns the event id (the driver knows the room) |
| `send_state_event(room_id, type, state_key, content) -> event_id` | same | gained `room_id` |
| `send_sticky_event(room_id, type, content, duration_ms) -> event_id` | same | |
| `send_delayed_event(room_id, type, state_key?, content, delay_ms) -> delay_id` | same | |
| – | `send_delayed_sticky_event(room_id, type, content, delay_ms, duration_ms) -> delay_id` | matrix-widget-api allows `delay` + `sticky_duration_ms` together; kept out of `send_delayed_event` so that one stays identical to rtc's |
| `restart_delayed_event(room_id, delay_id)` / `cancel_delayed_event(room_id, delay_id)` | same | |
| – | `send_delayed_event_now(room_id, delay_id)` | MSC4140 `send` action; rtc never needs it |
| `send_to_device_message(recipients, type, content) -> Vec<ToDeviceDelivery>` | `send_to_device_message(encrypted, type, messages: Vec<ToDeviceMessage>) -> Vec<ToDeviceDelivery>` | **raised**, see §4 |
| `redact_event(room_id, event_id, reason?)` | – | widgets redact through `send_event` of `m.room.redaction`; not needed |
| `subscribe_room(room_id, subjects, sink) -> Subscription` | same (synchronous, as in rtc's uniffi layer) | `RoomSink` has `on_timeline_events` and `on_state_events`; rtc's `on_sticky_events`, `on_joined_members`, `on_encryption`, `on_redaction` are not needed by widgets (yet) |
| `subscribe_to_device(event_types, sink) -> Subscription` | same | `ToDeviceSink::on_to_device_message(message)` |
| – | `subscribe_turn_servers(sink) -> Subscription` | MSC3846; rtc gets transports from `rtc_transports` |
| `relations(room_id, event_id, rel_type, event_type) -> Vec<EventIn>` | `relations(room_id, event_id, rel_type?, event_type?, from?, to?, limit?, direction?) -> RelationsChunk` | **raised**, see §4 |
| `openid_token() -> OpenIdToken` | same | |
| `rtc_transports() -> Value` | `rtc_transports() -> JsonValue` | |
| – | `read_room_events(room_id, type, msgtype?, limit, since?)`, `read_room_state(room_id, type, selector)` | widgets read on demand; rtc only subscribes |
| – | `rtc_livekit_get_token(server_name, url, room_id, slot_id, member_id) -> jwt`, `rtc_livekit_delegate_delayed_leave(url, room_id, slot_id, member_id, delay_id)` | MSC4533 (added to matrix-widget-api in October 2026); rtc may grow the same when it hosts a LiveKit integration |
| – | `read_room_account_data(room_id, type)` | beeper extension |
| – | `search_user_directory(term, limit?)`, `media_config()`, `upload_media(MediaFile) -> mxc`, `download_media(mxc) -> MediaFile` | MSC3973 / MSC4039; media takes raw bytes, the driver does the base64 |
| `BackendError { errcode?, status?, message }` | `BackendError::Failed { errcode?, status?, reason }` | one uniffi error variant like rtc's ffi layer (`reason`, because Kotlin exceptions own `message`); replaces the old four-variant enum; `errcode` and `status` are forwarded to the widget as `matrix_api_error` |
| `EventIn { ..., encryption }` | `MatrixEvent` (client-server JSON incl. `room_id`, `unsigned`) | widgets get the event as the C-S API has it; decryption facts are not part of the widget API |
| content as `content_json: String` | `JsonValue` (string over FFI, plain value in TS) | same thing, nicer in TypeScript |
| async `subscribe_room` in core, sync over uniffi | sync everywhere | this crate is the uniffi surface, there is no separate core |

## 4. Conflicts raised

1. **Rooms.** rtc is multi-room (`room_id` on every call). The legacy widget API is multi-room too
   (`room_id` / `room_ids` on `send_event` / `read_events`, `org.matrix.msc2762.timeline:<room>`
   capabilities, `getKnownRooms`). This backend is bound to **one room** (decided 2026-10-25).
   **Decision:** keep one room per backend, but pass `room_id` on every backend call like rtc does
   so the adapters stay interchangeable. The driver accepts `room_id` / `room_ids` from the widget
   only when they name the backend's room (`room_ids: "*"` means that room); foreign rooms are
   answered with an error.
   **Decision (2026-11-14):** one widget, one room, made strict. There is no room capability at
   all: naming the own room needs none, and the legacy `timeline:<room>` capability has no
   equivalent, so the compat wrapper never gets it approved. Element Call is the only known user
   of multi-room reads.
2. **To-device.** rtc sends *one* content to a list of `(user, device)` recipients. The widget API
   sends `messages: { user_id: { device_id: content } }` with per-device content plus an
   `encrypted` flag the host must honour. **Decision:** the widget backend takes
   `send_to_device_message(encrypted, event_type, messages: Vec<ToDeviceMessage{user_id, device_id,
   content}>)` and returns rtc's per-recipient `ToDeviceDelivery`. An rtc adapter is a one-line
   `map` away; rtc could adopt the per-device form without loss.
3. **Relations.** rtc's `relations` has no pagination (`from`, `to`, `limit`, `direction`) and no
   `next_batch` / `prev_batch`; MSC3869 needs all of them. **Decision:** the widget backend has the
   superset with optional parameters and returns `RelationsChunk { chunk, next_batch, prev_batch }`.
   rtc could grow the same optional parameters.
4. **Error shape.** rtc: one struct `{ errcode?, status?, message }`; here: a four-variant enum.
   **Decision:** adopt rtc's struct. The driver maps it to an MSC4412 error with the code
   `org.matrix.mscXXXX.matrix_api_error` and the additional property matrix-widget-api already
   understands: `{ error: { code, message, matrix_api_error: { http_status, response: { errcode,
   error } } } }`. A backend failure without errcode and status is a plain `unknown` error.
5. **`subscribe_room` sync vs async.** rtc's core trait is async and its uniffi layer sync (uniffi
   cannot return an object from an async foreign method). Here the trait *is* the uniffi layer, so
   it stays sync. No change.
6. **Delayed events: `send` action.** MSC4140 has `restart`, `cancel` and `send`; rtc implements
   the first two only. Added here as `send_delayed_event_now`; rtc may want the same name.
7. **Platform actions have results.** `navigate` can fail on the client side, so
   the platform method returns `Result<(), PlatformError>` (one uniffi error variant with a
   `reason`); `set_always_on_screen` returns the `success` flag the response needs. The other
   platform callbacks stay fire-and-forget.
8. **TURN watch acknowledgement.** matrix-widget-api waits for the first TURN server before
   acknowledging `watch_turn_servers` (and errors if none comes). `subscribe_turn_servers` is
   synchronous here, so the driver acknowledges first and the credentials follow as
   `update_turn_servers`; a widget written against matrix-widget-api handles both orders.

## 5. OpenID flow

MSC1960 asks the user per token outside the capabilities: `get_openid` answers
`{ state: "request" }`, and `openid_credentials` follows once the user decided. Here OpenID is a
capability like any other ([`spec/patch/new/openid-capability.md`](../spec/patch/new/openid-capability.md)),
granted for one token at a time ([`spec/patch/msc4412/capability-lifetimes.md`](../spec/patch/msc4412/capability-lifetimes.md)):

* the user's consent is the capability prompt: the widget requests `widget:…get_openid`, the
  platform approves it like any other capability (`on_capabilities_requested`,
  `approve_capabilities`);
* while the widget holds it, `get_openid` returns the token at once, the body of
  `/openid/request_token` (`OpenIdToken`, no `state`); without it, `missing_capability`;
* the driver grants it for one use (`driver.set_single_use`, default `[GetOpenId]`): the request
  that passes the check uses it up, whatever its result, and the driver sends
  `update_capabilities` without it after the reply;
* auto-approved (`driver.set_auto_approved`), it is granted again per request without asking: the
  host's "always". The widget host does not remember a single-use approval otherwise, and its
  capability store (version 2) dropped the `get_openid` that version 1 held for every widget;
* a time limit is the platform's timer plus `driver.revoke_capabilities`; the driver has no clock;
* the widget SDK's `request_openid_token` requests the capability when the widget does not hold
  it, takes the next `update_capabilities` after the ack as the answer, then asks for the token
  (`OpenIdBlocked` when refused); calls in between share the result;
* legacy widgets: the compat wrapper no longer requests `get_openid` up front. It answers the
  legacy `get_openid` itself: `state: "allowed"` with the token while it holds the capability,
  else `state: "request"`, a request for the capability, and `openid_credentials` (`allowed` or
  `blocked`) for every waiting request once the host decided. The widget host no longer grants
  `get_openid` to legacy widgets without asking.

## 6. Not built, and why

* **Binary payloads** (`upload_file`, `download_file`): matrix-widget-api carries a
  `Blob` / `XMLHttpRequestBodyInit` through `postMessage` structured cloning. Every message here is
  a JSON string across the FFI (and across the Android / iOS WebView bridges), which cannot carry a
  `Blob`. **Decision:** the MSC4412 format for a file is `{ "mimetype": ..., "base64": ... }`;
  only legacy widgets send `Blob`, and the compat wrapper converts in both directions
  (`packages/widget-compat-wrapper/src/files.ts`). `upload_file` / `download_file` are built: the
  driver decodes / encodes base64 and the backend works with raw bytes (`MediaFile`).
* **Modal widgets** (`open_modal`, `close_modal`, `button_clicked`, `set_button_enabled`,
  `widget_config`): pure client UI, no Matrix side effect, and MSC4412 does not mention them.
  Can be added as platform callbacks later without touching the backend.
* **Receiving sticky events** (`host:…forward_event.sticky`): needs
  `RoomSink::on_sticky_events` and a `sticky` field on `MatrixEvent`. Sending is built; receiving
  follows when the MSC4354 shape settles.
* **`redact_event`**: widgets redact via `send_event` of `m.room.redaction`.
* **`parent_delay_id`** on `send_event`: deprecated in matrix-widget-api and ignored by its
  driver; not modelled (unknown body fields are accepted and dropped).
* **msgtype `#` escaping**: matrix-widget-api un-escapes `\#` inside
  `m.room.message#<msgtype>` capability data; this parser splits at the first `#` after
  `m.room.message` without escapes, which covers every msgtype in use.
