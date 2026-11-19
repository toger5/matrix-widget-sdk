# Parity with matrix-widget-api and shape of the backend

Which widget API actions exist in [matrix-widget-api](https://github.com/matrix-org/matrix-widget-api),
how this repository implements them, how `matrix-widget-host-backend-interface` relates to the
`MatrixBackend` of [matrix-rust-rtc](../../matrix-rust-rtc), and where the two deliberately differ.

## 1. Wire names and prefixes

Actions and capabilities follow MSC4412 and
[`spec-appendix/capability-naming-proposal.md`](spec-appendix/capability-naming-proposal.md).

* **Envelope:** `source`, `action`, `request_id`, `request` / `response`. No `version`: legacy
  messages are recognised by `api` instead of `source`.
* **Namespaces:** every action is `<namespace>.<name>`. The emitted name carries the unstable
  prefix of the MSC that defines it (`org.matrix.msc3869.read_relations`); the stable `m.<name>` is
  accepted when parsing. Core actions use `org.matrix.msc4412`; actions without an MSC of their own
  use the placeholder `org.matrix.mscXXXX`. A name without a namespace is not an action. The serde
  `rename` / `alias` attributes in `crates/matrix-widget-actions/src/actions/*/mod.rs` are the
  single place a wire name lives.
* **Capabilities** are `source:action[.modifier][:data]`, one per action, where `action` is the
  wire name, namespace included (`widget:org.matrix.msc3869.read_relations:<type>`). The same name
  under another namespace is a different action and grants nothing. No capability names a room.
* **Actions** are verbs, and no name is used by both sources (`forward_event`, `update_theme`,
  `get_matrix_context`, ...). A renamed action keeps its prefix
  (`org.matrix.msc3973.search_user_directory`).
* **Errors** are `{ error: { code, message } }` with MSC4412's codes
  (`org.matrix.msc4412.unknown_action`, `.missing_capability`, `.invalid_request`, `.unknown`).
  Failed Matrix requests use `org.matrix.mscXXXX.matrix_api_error` with a `matrix_api_error`
  object (`{ http_status, response: { errcode, error } }`, the shape matrix-widget-api
  understands). A backend failure without errcode and status is a plain `unknown`.
* **No aliases for legacy names.** Neither the old action names nor the matrix-widget-api
  capability strings are understood by the driver or the widget SDK. Legacy widgets run behind
  `packages/widget-compat-wrapper`, which translates both.

### The widget state event

matrix-widget-api's `WidgetParser.parseRoomWidget` treats `m.widget` and
`im.vector.modular.widgets` alike and needs `type` and a creator. Here `WidgetDefinition::parse`
(`crates/matrix-widget-host-driver/src/widget_event.rs`) follows MSC4411 for `m.widget` /
`org.matrix.msc4411.widget` (a string `name` and `url`, else a removed widget) and needs only a
string `url` for the legacy event (`type` is optional, the name falls back to the state key).
`parse_widget_state_event` also checks the URL (absolute `http(s)`, parsed per WHATWG; no page of
the client's compat wrapper; no page of the client's own origin, `EmbedOptions`); the driver checks
it again and tells the client what to load (`WidgetHostPlatform::load_iframe`), a legacy widget
through the compat wrapper with its URL untemplated.

### The widget iframe

Element Web gives every widget the same iframe (`AppTile.tsx`):

```text
sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-presentation allow-downloads"
allow="microphone; camera; encrypted-media; autoplay; display-capture; clipboard-write; clipboard-read;"
allowFullscreen
```

| | Element Web | here |
|---|---|---|
| widget of MSC4411 | the set above | `sandbox="allow-scripts allow-same-origin"`, empty `allow`; more only as webview capabilities the widget requests and the user grants (`webview:…sandbox:<token>`, `webview:…allow:<feature>`), applied with a reload: the driver calls `load_iframe` again and grants the reloaded page what the widget held |
| legacy widget (`im.vector.modular.widgets`) | the set above | the wrapper's iframe: the same set plus `fullscreen` in `allow`, as webview capabilities the wrapper requests and the driver grants without asking (`legacy_auto_approved`); the wrapper's inner iframe: the same, constant |
| a widget of the client's own origin | loaded with the set above | refused ("a widget cannot be a page of this client's own origin"); the dev site's own test widgets are the exception |
| `allow` features | `camera` (default allowlist `'src'`) | `camera 'src'`, spelled out |
| top navigation | not in the set | never granted, even if approved |

Proposed in [`spec/patch/msc4411/strict-webview-defaults.md`](../spec/patch/msc4411/strict-webview-defaults.md),
[`spec/patch/msc4412/capability-sources.md`](../spec/patch/msc4412/capability-sources.md) and
[`spec/patch/new/webview-capabilities.md`](../spec/patch/new/webview-capabilities.md).

## 2. Action inventory

In the capability column `…` stands for the namespace of the action (the prefix in the "wire name
here" column, or `m`). Every wire name also has the stable alias `m.<name>`. "–" in the wire name
column: not implemented, the reason is next to it or in §6.

### Widget → host (`source: widget`, legacy `fromWidget`)

| legacy action | wire name here | capability | backend / platform method |
|---|---|---|---|
| `supported_api_versions` | – (dropped by MSC4412; the compat wrapper answers it) | – | – |
| `content_loaded` | `org.matrix.msc4412.notify_ready` | none (core action) | `platform.on_ready` |
| `org.matrix.msc2974.request_capabilities` | `org.matrix.msc4412.request_capabilities` | none (core action); a request before the answer joins the open question ([`merge-capability-requests.md`](../spec/patch/msc4412/merge-capability-requests.md)) | `platform.on_capabilities_requested` (the whole open question) |
| `send_event` (MSC2762) | `org.matrix.mscXXXX.send_event` | `widget:…send_event.timeline:<type>[#msgtype]` / `widget:…send_event.state:<type>[#key]` | `backend.send_room_event` / `send_state_event`; `redact_event` for `m.room.redaction` |
| `send_event` + `room_id` | – | none; only the widget's own room is accepted, see §4 | – |
| `send_event` + `delay` (MSC4157) | – | + `widget:…send_event.delayed`; the response carries `delay_id` | `backend.send_delayed_event` |
| `send_event` + `sticky_duration_ms` (MSC4407 / MSC4354) | – | + `widget:…send_event.sticky` | `backend.send_sticky_event` |
| `org.matrix.msc4157.update_delayed_event` | `org.matrix.msc4157.update_delayed_event` | `widget:…update_delayed_event` | `backend.restart_delayed_event` / `cancel_delayed_event` / `send_delayed_event_now` |
| `org.matrix.msc2876.read_events` | – (replaced by the timeline actions, [draft](../spec/patch/new/timeline-reading.md); the compat wrapper serves legacy widgets: timeline reads become `read_timeline` (+ `paginate_timeline` while short), state reads are answered from `update_state`) | – | – |
| *(new)* | `org.matrix.mscXXXX.read_timeline` | results filtered by `widget:…read_timeline:<type>[#msgtype]` | `backend.timeline_read` |
| *(new)* | `org.matrix.mscXXXX.paginate_timeline` | `widget:…paginate_timeline` | `backend.timeline_paginate_backwards` |
| `org.matrix.msc3869.read_relations` | `org.matrix.msc3869.read_relations` | results filtered by `widget:…read_relations:<type>[#msgtype]` | `backend.relations` |
| `send_to_device` (MSC3819) | `org.matrix.mscXXXX.send_to_device` | `widget:…send_to_device:<type>` | `backend.send_to_device_message` |
| `get_openid` (MSC1960) | `org.matrix.mscXXXX.get_openid` | `widget:…get_openid`, single use by default; see §5 | `backend.openid_token`, `driver.set_single_use` |
| `watch_turn_servers` / `unwatch_turn_servers` (MSC3846) | `org.matrix.mscXXXX.watch_turn_servers` / `org.matrix.mscXXXX.unwatch_turn_servers` | `host:…update_turn_servers` | `backend.subscribe_turn_servers` |
| `org.matrix.msc4515.get_rtc_transports` | `org.matrix.msc4515.get_rtc_transports` | `widget:…get_rtc_transports` | `backend.rtc_transports` |
| `org.matrix.msc3973.user_directory_search` | `org.matrix.msc3973.search_user_directory` | `widget:…search_user_directory` | `backend.search_user_directory` |
| `org.matrix.msc4039.get_media_config` | `org.matrix.msc4039.get_media_config` | `widget:…get_media_config` | `backend.media_config` |
| `org.matrix.msc4039.upload_file` / `download_file` | same | `widget:…upload_file` / `widget:…download_file`; file as base64, see §6 | `backend.upload_media` / `download_media` |
| `com.beeper.read_room_account_data` | `com.beeper.read_room_account_data` | `widget:…read_room_account_data:<type>` | `backend.read_room_account_data` |
| `org.matrix.msc2931.navigate` | `org.matrix.msc2931.navigate` | `widget:…navigate` | `platform.navigate` |
| `m.sticker` | – (not supported) | – | – |
| `org.matrix.msc4533.rtc_livekit_get_token` | `org.matrix.msc4533.get_rtc_livekit_token` | `widget:…get_rtc_livekit_token` | `backend.rtc_livekit_get_token` |
| `org.matrix.msc4533.rtc_livekit_delegate_delayed_leave` | `org.matrix.msc4533.delegate_rtc_livekit_delayed_leave` | `widget:…delegate_rtc_livekit_delayed_leave` | `backend.rtc_livekit_delegate_delayed_leave` |
| `set_always_on_screen` | `org.matrix.mscXXXX.set_always_on_screen` | `widget:…set_always_on_screen` | `platform.set_always_on_screen` |
| `open_modal` / `close_modal` / `set_button_enabled` | – (modal widgets, §6) | – | – |
| *(new)* | `org.matrix.mscXXXX.get_matrix_context` | `widget:…get_matrix_context` | backend identity getters |
| *(new)* | `org.matrix.mscXXXX.get_client_context` | `widget:…get_client_context` | `platform.client_*` |

### Host → widget (`source: host`, legacy `toWidget`)

| legacy action | wire name here | capability | origin |
|---|---|---|---|
| `supported_api_versions` | – (dropped) | – | – |
| `capabilities` | – (capabilities are widget-initiated in MSC4412) | – | – |
| `notify_capabilities` | `org.matrix.msc4412.update_capabilities` (`{ allowed }`, always the full list) | none (core action) | `driver.approve_capabilities` / `driver.revoke_capabilities` |
| `send_event` | `org.matrix.mscXXXX.forward_event` | `host:…forward_event.timeline:<type>[#msgtype]` / `host:…forward_event.state:<type>[#key]` | `RoomSink::on_timeline_events` |
| `update_state` (MSC2762) | `org.matrix.mscXXXX.update_state` | `host:…update_state:<type>[#key]` | `RoomSink::on_state_events` |
| *(new)* | `org.matrix.mscXXXX.notify_timeline_update` | `host:…notify_timeline_update` | `TimelineSink::on_timeline_update` (pagination status, `reset`, `decrypted`) |
| `send_to_device` | `org.matrix.mscXXXX.forward_to_device` | `host:…forward_to_device:<type>` | `ToDeviceSink::on_to_device_message` |
| `openid_credentials` | – (`get_openid` answers at once; the compat wrapper sends it to legacy widgets, §5) | – | – |
| `update_turn_servers` | `org.matrix.mscXXXX.update_turn_servers` | `host:…update_turn_servers` | `TurnServerSink::on_turn_server` |
| `theme_change` (MSC2873) | `org.matrix.mscXXXX.update_theme` | `host:…update_theme` | `driver.update_theme` |
| `language_change` | `org.matrix.mscXXXX.update_language` | `host:…update_language` | `driver.update_language` |
| `visibility` | `org.matrix.mscXXXX.update_visibility` | `host:…update_visibility` | `driver.update_visibility` |
| `screenshot` | – (intentionally not supported, §6) | – | – |
| `widget_config` / `button_clicked` / `close_modal` | – (modal widgets, §6) | – | – |

### Capability strings

All of these parse into a `Capability` variant. Anything else stays `Capability::Other` and grants
nothing; that includes every matrix-widget-api capability string.

| capability (`…` = the action's namespace, see below, or `m`) | parsed as | matrix-widget-api capability the compat wrapper maps to it |
|---|---|---|
| `widget:…send_event.timeline:<type>[#msgtype]` | `SendEvent` | `org.matrix.msc2762.send.event:<type>` |
| `widget:…send_event.state:<type>[#key]` | `SendStateEvent` | `org.matrix.msc2762.send.state_event:<type>` |
| `widget:…send_event.delayed` | `SendDelayedEvent` | `org.matrix.msc4157.send.delayed_event` |
| `widget:…send_event.sticky` | `SendStickyEvent` | `org.matrix.msc4407.send.sticky_event` |
| `widget:…update_delayed_event` | `UpdateDelayedEvent` | `org.matrix.msc4157.update_delayed_event` |
| `widget:…read_timeline:<type>[#msgtype]` | `ReadTimeline` | `org.matrix.msc2762.receive.event:<type>` |
| `widget:…paginate_timeline` | `PaginateTimeline` | `org.matrix.msc2762.receive.event:<type>` (any type) |
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
| `host:…notify_timeline_update` | `NotifyTimelineUpdate` | `org.matrix.msc2762.receive.event:<type>` (any type) |
| `webview:…sandbox:<token>` (`…` = `org.matrix.mscXXXX` or `m`) | `WebviewSandbox` (a token of the widget iframe's `sandbox`) | none: the wrapper requests Element Web's tokens for itself; a legacy widget cannot request one |
| `webview:…allow:<feature>` | `WebviewAllow` (a feature of the iframe's `allow`) | none: the wrapper requests Element Web's features plus `fullscreen` for itself |
| `org.matrix.msc2762.timeline:<room_id>` | `Other` | no equivalent: never requested by the wrapper, never granted |
| `io.element.requires_client`, `m.sticker`, `m.capability.screenshot` | `Other` | passed through unchanged; nothing acts on them |

The namespace of a capability is the one of its action: `org.matrix.msc3869` (`read_relations`),
`org.matrix.msc4157` (`update_delayed_event`), `org.matrix.msc4515` (`get_rtc_transports`),
`org.matrix.msc3973` (`search_user_directory`), `org.matrix.msc4039` (`get_media_config`,
`upload_file`, `download_file`), `org.matrix.msc4533` (`get_rtc_livekit_token`,
`delegate_rtc_livekit_delayed_leave`), `org.matrix.msc2931` (`navigate`), `com.beeper`
(`read_room_account_data`) and `org.matrix.mscXXXX` for everything else, the webview capabilities
included. The table lives in `namespace_of` (`crates/matrix-widget-actions/src/capabilities.rs`) and
is repeated in `packages/widget-compat-wrapper/src/capabilities.ts` and
`packages/test-widgets/new/capabilities.ts`.

## 3. `MatrixBackend` next to matrix-rust-rtc

matrix-rust-rtc (`crates/matrix-rtc-core/src/host/backend.rs`, uniffi layer in
`crates/matrix-rtc-ffi/src/backend.rs`) is the reference. Where both projects need the same thing
the method here has the same name and parameter order, so one adapter per Matrix SDK can serve both.

| matrix-rust-rtc | matrix-widget-host-backend-interface | note |
|---|---|---|
| `own_user_id()`, `own_device_id()` | same | |
| – | `room_id()`, `display_name()`, `avatar_url()`, `base_url()` | the backend is bound to one room; the rest feeds `get_matrix_context` |
| `send_room_event(room_id, type, content) -> event_id` | same | |
| `send_state_event(room_id, type, state_key, content) -> event_id` | same | |
| `send_sticky_event(room_id, type, content, duration_ms) -> event_id` | same | |
| `send_delayed_event(room_id, type, state_key?, content, delay_ms) -> delay_id` | same | |
| – | `send_delayed_sticky_event(room_id, type, content, delay_ms, duration_ms) -> delay_id` | matrix-widget-api allows `delay` + `sticky_duration_ms` together; kept apart so `send_delayed_event` stays identical to rtc's |
| `restart_delayed_event(room_id, delay_id)` / `cancel_delayed_event(room_id, delay_id)` | same | |
| – | `send_delayed_event_now(room_id, delay_id)` | MSC4140's `send` action; rtc never needs it |
| `send_to_device_message(recipients, type, content) -> Vec<ToDeviceDelivery>` | `send_to_device_message(encrypted, type, messages: Vec<ToDeviceMessage>) -> Vec<ToDeviceDelivery>` | see §4 |
| `redact_event(room_id, event_id, reason?)` | same, `-> event_id` | called for a `send_event` of `m.room.redaction`: a redaction must not go through `/send`, which would encrypt it and cannot set the top-level `redacts` of rooms before version 11 |
| `subscribe_room(room_id, subjects, sink) -> Subscription` | same (synchronous) | `RoomSink` has `on_timeline_events` and `on_state_events`; rtc's other sink methods are not needed by widgets |
| `subscribe_to_device(event_types, sink) -> Subscription` | same | `ToDeviceSink::on_to_device_message(message)` |
| – | `subscribe_turn_servers(sink) -> Subscription` | MSC3846; rtc gets transports from `rtc_transports` |
| `relations(room_id, event_id, rel_type, event_type) -> Vec<EventIn>` | `relations(room_id, event_id, rel_type?, event_type?, from?, to?, limit?, direction?) -> RelationsChunk` | see §4 |
| `openid_token() -> OpenIdToken` | same | |
| `rtc_transports() -> Value` | `rtc_transports() -> JsonValue` | |
| – | `timeline_read(room_id, from?, limit, filter) -> TimelineChunk`, `timeline_paginate_backwards(room_id, limit?) -> PaginationStatus`, `subscribe_timeline(room_id, sink) -> Subscription` | widgets read the client's timeline cache on demand ([draft](../spec/patch/new/timeline-reading.md)); rtc only subscribes |
| – | `rtc_livekit_get_token(server_name, url, room_id, slot_id, member_id) -> jwt`, `rtc_livekit_delegate_delayed_leave(url, room_id, slot_id, member_id, delay_id)` | MSC4533 |
| – | `read_room_account_data(room_id, type)` | beeper extension |
| – | `search_user_directory(term, limit?)`, `media_config()`, `upload_media(MediaFile) -> mxc`, `download_media(mxc) -> MediaFile` | MSC3973 / MSC4039; media takes raw bytes, the driver does the base64 |
| `BackendError { errcode?, status?, message }` | `BackendError::Failed { errcode?, status?, reason }`, `BackendError::EventNotCached { event_id }` | `Failed` as rtc's ffi layer (`reason`, because Kotlin exceptions own `message`); `errcode` and `status` reach the widget as `matrix_api_error`. `EventNotCached` is `timeline_read`'s answer for a `from` it does not cache (`…event_not_cached`) |
| `EventIn { ..., encryption }` | `MatrixEvent` (client-server JSON incl. `room_id`, `unsigned`) | widgets get the event as the C-S API has it; decryption facts are not part of the widget API |
| content as `content_json: String` | `JsonValue` (string over FFI, plain value in TS) | |
| async `subscribe_room` in core, sync over uniffi | sync everywhere | this crate is the uniffi surface (uniffi cannot return an object from an async foreign method) |

## 4. Deliberate differences

1. **Rooms.** rtc and the legacy widget API are multi-room (`room_id` / `room_ids` on
   `send_event` / `read_events`, `org.matrix.msc2762.timeline:<room>` capabilities). Here one
   widget, one room: the backend is bound to the widget's room, but `room_id` is passed on every
   backend call like in rtc so adapters stay interchangeable. The driver accepts `room_id` /
   `room_ids` only when they name that room (`room_ids: "*"` means it); other rooms get an error.
   There is no room capability, so the compat wrapper never gets `timeline:<room>` approved.
2. **To-device.** rtc sends *one* content to a list of `(user, device)` recipients. The widget API
   sends `messages: { user_id: { device_id: content } }` with per-device content plus an
   `encrypted` flag, so the backend takes `Vec<ToDeviceMessage { user_id, device_id, content }>`
   and returns rtc's per-recipient `ToDeviceDelivery`. An rtc adapter is a one-line `map` away.
3. **Relations.** MSC3869 needs pagination (`from`, `to`, `limit`, `direction`, `next_batch` /
   `prev_batch`), which rtc's `relations` lacks; the backend has the superset with optional
   parameters and returns `RelationsChunk`.
4. **Platform actions have results.** `navigate` can fail on the client side
   (`Result<(), PlatformError>`); `set_always_on_screen` returns the `success` flag. The other
   platform callbacks are fire-and-forget.
5. **TURN watch acknowledgement.** matrix-widget-api waits for the first TURN server before
   acknowledging `watch_turn_servers`. `subscribe_turn_servers` is synchronous here, so the driver
   acknowledges first and the credentials follow as `update_turn_servers`; a widget written against
   matrix-widget-api handles both orders.

## 5. OpenID flow

MSC1960 asks the user per token outside the capabilities: `get_openid` answers
`{ state: "request" }`, and `openid_credentials` follows once the user decided. Here OpenID is a
capability like any other ([`spec/patch/new/openid-capability.md`](../spec/patch/new/openid-capability.md)),
granted for one token at a time ([`spec/patch/msc4412/capability-lifetimes.md`](../spec/patch/msc4412/capability-lifetimes.md)):

* the user's consent is the capability prompt (`on_capabilities_requested`, `approve_capabilities`);
* while the widget holds `widget:…get_openid`, `get_openid` returns the token at once (`OpenIdToken`,
  no `state`); without it, `missing_capability`;
* the driver grants it for one use (`driver.set_single_use`, default `[GetOpenId]`): the request
  that passes the check uses it up, whatever its result, and `update_capabilities` without it
  follows the reply;
* auto-approved (`driver.set_auto_approved`), it is granted again per request without asking: the
  host's "always". Otherwise a single-use approval is not remembered;
* a time limit is the platform's timer plus `driver.revoke_capabilities`; the driver has no clock;
* the widget SDK's `request_openid_token` requests the capability when the widget does not hold
  it, takes the next `update_capabilities` after the ack as the answer, then asks for the token
  (`OpenIdBlocked` when refused); calls in between share the result;
* legacy widgets: the compat wrapper answers the legacy `get_openid` itself: `state: "allowed"`
  with the token while it holds the capability, else `state: "request"`, a request for the
  capability, and `openid_credentials` (`allowed` or `blocked`) for every waiting request once the
  host decided.

## 6. Not built, and why

* **Binary payloads** (`upload_file`, `download_file`): matrix-widget-api carries a `Blob` through
  `postMessage` structured cloning. Every message here is a JSON string across the FFI (and the
  Android / iOS WebView bridges), which cannot carry a `Blob`, so the MSC4412 format for a file is
  `{ "mimetype": ..., "base64": ... }`. Only legacy widgets send `Blob`; the compat wrapper converts
  (`packages/widget-compat-wrapper/src/files.ts`). The driver decodes / encodes base64; the backend
  works with raw bytes (`MediaFile`).
* **`screenshot`** (`m.capability.screenshot`): intentionally not supported; the capability parses
  as `Other` and neither the driver nor the compat wrapper handles the action.
* **`m.sticker`**: not supported; unknown to the driver, the capability parses as `Other`.
* **Modal widgets** (`open_modal`, `close_modal`, `button_clicked`, `set_button_enabled`,
  `widget_config`): client UI only, not in MSC4412. Can be added as platform callbacks later
  without touching the backend.
* **Receiving sticky events** (`host:…forward_event.sticky`): parsed, not delivered. Needs
  `RoomSink::on_sticky_events` and a `sticky` field on `MatrixEvent`, once the MSC4354 shape
  settles. Sending works.
* **Rate limiting of `paginate_timeline`**: the timeline reading draft says clients SHOULD
  rate-limit it per widget; the driver does not.
* **Timeouts on the host side**: the widget SDK fails a request the host does not answer within
  10 seconds. The driver does not time out its own requests to the widget (nothing waits for their
  acks), and the compat wrapper does not time out its bootstrap requests.
* **`since` of the legacy `read_events`**: ignored by the compat wrapper.
* **`parent_delay_id`** on `send_event`: deprecated in matrix-widget-api and ignored by its
  driver; not modelled (unknown body fields are dropped).
* **msgtype `#` escaping**: matrix-widget-api un-escapes `\#` inside `m.room.message#<msgtype>`
  capability data; this parser splits at the first `#` after `m.room.message` without escapes,
  which covers every msgtype in use.
