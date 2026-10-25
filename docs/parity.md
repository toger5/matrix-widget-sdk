# Parity with matrix-widget-api and shape of the backend

This document is the plan behind the `feat/widget-api-parity` work: which widget API actions
exist in [matrix-widget-api](https://github.com/matrix-org/matrix-widget-api), which of them this
repository implements, how `widget-matrix-backend` relates to the `MatrixBackend` of
[matrix-rust-rtc](../../matrix-rust-rtc), and where the two designs conflict. Decisions taken here
are marked **decision**; everything marked **raised** is a conflict left for a human to confirm.

## 1. Wire names and prefixes

MSC4412 keeps the existing action names and does not rename anything. Many of those names carry an
unstable MSC prefix (`org.matrix.msc2876.read_events`). To keep every action renameable later, this
crate emits the **unstable name** on the wire and accepts the **stable (prefix-less) name as an
alias** when parsing, exactly like it already does for capability strings (`org.matrix.msc2762.` is
emitted, `m.` is accepted). The serde `rename` / `alias` attributes in
`crates/widget-actions/src/actions/*/mod.rs` are the single place a wire name lives.

**Decision:** the two actions this repository invented, `matrix_context` and `client_context`
(and their capabilities), get the prefix `org.matrix.msc4412.` because they replace the URL
templating that MSC4412 removes. Both the action and the capability accept the prefix-less /
`m.` form as alias. Changing the prefix is one constant per action.

## 2. Action inventory

Legend: ✅ implemented before this branch · 🔨 built on this branch (all of these are in; the
marker shows what changed) · ⛔ raised, not built · ➖ dropped by MSC4412.

### Widget → host (`source: widget`, legacy `fromWidget`)

| legacy action | wire name here | capability | status | backend / platform method |
|---|---|---|---|---|
| `supported_api_versions` | – | – | ➖ dropped by MSC4412 (the compat wrapper answers it locally) | – |
| `content_loaded` | `content_loaded` | none | ✅ | `platform.on_content_loaded` |
| `org.matrix.msc2974.request_capabilities` | `request_capabilities` (alias: the legacy name) | none | ✅ | `platform.on_capabilities_requested` |
| `send_event` (MSC2762) | `send_event` | `send.event:<type>` / `send.state_event:<type>[#key]` | ✅ | `backend.send_room_event` / `send_state_event` |
| `send_event` + `room_id` | – | `org.matrix.msc2762.timeline:<room>` | 🔨 accepted only for the backend's own room, see §4 | – |
| `send_event` + `delay` (MSC4157) | – | `org.matrix.msc4157.send.delayed_event` | 🔨 response carries `delay_id` | `backend.send_delayed_event` |
| `send_event` + `sticky_duration_ms` (MSC4407 / MSC4354) | – | `org.matrix.msc4407.send.sticky_event` | 🔨 | `backend.send_sticky_event` |
| `org.matrix.msc4157.update_delayed_event` | `org.matrix.msc4157.update_delayed_event` (alias `update_delayed_event`) | `org.matrix.msc4157.update_delayed_event` | 🔨 | `backend.restart_delayed_event` / `cancel_delayed_event` / `send_delayed_event_now` |
| `org.matrix.msc2876.read_events` | `org.matrix.msc2876.read_events` (alias `read_events`) | `receive.event:<type>` / `receive.state_event:<type>[#key]` | ✅ (+ 🔨 `msgtype`, `since`, `room_ids`) | `backend.read_room_events` / `read_room_state` |
| `org.matrix.msc3869.read_relations` | `org.matrix.msc3869.read_relations` (alias `read_relations`) | results filtered by `receive.*` | 🔨 | `backend.relations` |
| `send_to_device` (MSC3819) | `send_to_device` | `org.matrix.msc3819.send.to_device:<type>` | 🔨 | `backend.send_to_device_message` |
| `get_openid` (MSC1960) | `get_openid` | none (user prompt) | 🔨 two-phase, see §5 | `platform.on_openid_requested`, `backend.openid_token` |
| `watch_turn_servers` / `unwatch_turn_servers` (MSC3846) | same | `town.robin.msc3846.turn_servers` | 🔨 | `backend.subscribe_turn_servers` |
| `org.matrix.msc4515.get_rtc_transports` | `org.matrix.msc4515.get_rtc_transports` (alias `get_rtc_transports`) | `org.matrix.msc4515.rtc_transports` | 🔨 | `backend.rtc_transports` |
| `org.matrix.msc3973.user_directory_search` | `org.matrix.msc3973.user_directory_search` (alias `user_directory_search`) | `org.matrix.msc3973.user_directory_search` | 🔨 | `backend.search_user_directory` |
| `org.matrix.msc4039.get_media_config` | `org.matrix.msc4039.get_media_config` (alias `get_media_config`) | `org.matrix.msc4039.upload_file` | 🔨 | `backend.media_config` |
| `org.matrix.msc4039.upload_file` / `download_file` | – | `org.matrix.msc4039.upload_file` / `download_file` | ⛔ binary payload, see §6 | – |
| `com.beeper.read_room_account_data` | `com.beeper.read_room_account_data` (alias `read_room_account_data`) | `com.beeper.capabilities.receive.room_account_data:<type>` | 🔨 | `backend.read_room_account_data` |
| `org.matrix.msc2931.navigate` | `org.matrix.msc2931.navigate` (alias `navigate`) | `org.matrix.msc2931.navigate` | 🔨 | `platform.navigate` |
| `m.sticker` | `m.sticker` | `m.sticker` | 🔨 | `platform.send_sticker` |
| `org.matrix.msc4533.rtc_livekit_get_token` | same (alias `rtc_livekit_get_token`) | `org.matrix.msc4533.rtc_livekit_get_token` | 🔨 | `backend.rtc_livekit_get_token` |
| `org.matrix.msc4533.rtc_livekit_delegate_delayed_leave` | same (alias `rtc_livekit_delegate_delayed_leave`) | `org.matrix.msc4533.rtc_livekit_delegate_delayed_leave` | 🔨 | `backend.rtc_livekit_delegate_delayed_leave` |
| `set_always_on_screen` | `set_always_on_screen` | `m.always_on_screen` | 🔨 | `platform.set_always_on_screen` |
| `open_modal` / `close_modal` / `set_button_enabled` | – | – | ⛔ modal widgets, see §6 | – |
| *(new)* `matrix_context` | `org.matrix.msc4412.matrix_context` (alias `matrix_context`) | `org.matrix.msc4412.matrix_context` (alias `m.matrix_context`) | ✅ (prefix 🔨) | backend identity getters |
| *(new)* `client_context` | `org.matrix.msc4412.client_context` (alias `client_context`) | `org.matrix.msc4412.client_context` (alias `m.client_context`) | ✅ (prefix 🔨) | `platform.client_*` |

### Host → widget (`source: host`, legacy `toWidget`)

| legacy action | wire name here | capability | status | origin |
|---|---|---|---|---|
| `supported_api_versions` | – | – | ➖ dropped | – |
| `capabilities` | – | – | ➖ capabilities are widget-initiated in MSC4412 | – |
| `notify_capabilities` | `notify_capabilities` | – | ✅ | `driver.approve_capabilities` |
| `send_event` | `send_event` | `receive.event` / `receive.state_event` | ✅ | `RoomSink::on_timeline_events` |
| `update_state` (MSC2762 update_state) | `update_state` | `receive.state_event` | ✅ | `RoomSink::on_state_events` |
| `send_to_device` | `send_to_device` | `org.matrix.msc3819.receive.to_device:<type>` | 🔨 | `ToDeviceSink::on_to_device_message` |
| `openid_credentials` | `openid_credentials` | – | 🔨 | `driver.resolve_openid` |
| `update_turn_servers` | `update_turn_servers` | `town.robin.msc3846.turn_servers` | 🔨 | `TurnServerSink::on_turn_server` |
| `theme_change` (MSC2873) | `theme_change` | – | 🔨 | `driver.notify_theme_change` |
| `language_change` | `language_change` | – | 🔨 | `driver.notify_language_change` |
| `visibility` | `visibility` | – | 🔨 | `driver.notify_visibility` |
| `screenshot` | – | `m.capability.screenshot` | ⛔ binary payload, see §6 | – |
| `widget_config` / `button_clicked` / `close_modal` | – | – | ⛔ modal widgets, see §6 | – |

### Capability strings

All of these parse into a `Capability` variant (unknown ones stay `Capability::Other`):

| capability | parsed as |
|---|---|
| `org.matrix.msc2762.send.event:<type>` (`m.` alias) | `SendEvent` |
| `org.matrix.msc2762.receive.event:<type>` | `ReceiveEvent` |
| `org.matrix.msc2762.send.state_event:<type>[#key]` | `SendStateEvent` |
| `org.matrix.msc2762.receive.state_event:<type>[#key]` | `ReceiveStateEvent` |
| `org.matrix.msc2762.timeline:<room_id>` | `Timeline { room_id }` |
| `org.matrix.msc3819.send.to_device:<type>` | `SendToDevice` |
| `org.matrix.msc3819.receive.to_device:<type>` | `ReceiveToDevice` |
| `org.matrix.msc4157.send.delayed_event` | `SendDelayedEvent` |
| `org.matrix.msc4157.update_delayed_event` | `UpdateDelayedEvent` |
| `org.matrix.msc4407.send.sticky_event` | `SendStickyEvent` |
| `org.matrix.msc4407.receive.sticky_event` | `ReceiveStickyEvent` |
| `com.beeper.capabilities.receive.room_account_data:<type>` | `ReceiveRoomAccountData` |
| `town.robin.msc3846.turn_servers` | `TurnServers` |
| `org.matrix.msc4515.rtc_transports` | `RtcTransports` |
| `org.matrix.msc3973.user_directory_search` | `UserDirectorySearch` |
| `org.matrix.msc4039.upload_file` / `download_file` | `UploadFile` / `DownloadFile` |
| `org.matrix.msc2931.navigate` | `Navigate` |
| `org.matrix.msc4533.rtc_livekit_get_token` / `rtc_livekit_delegate_delayed_leave` | `RtcLivekitGetToken` / `RtcLivekitDelegateDelayedLeave` |
| `m.sticker` | `Sticker` |
| `m.always_on_screen` | `AlwaysOnScreen` |
| `m.capability.screenshot` | `Screenshot` |
| `io.element.requires_client` | `Other` (deprecated Element hint, passed through) |
| `org.matrix.msc4412.matrix_context` (`m.matrix_context` alias) | `MatrixContext` |
| `org.matrix.msc4412.client_context` (`m.client_context` alias) | `ClientContext` |

## 3. `MatrixBackend` next to matrix-rust-rtc

matrix-rust-rtc (`crates/matrix-rtc-core/src/host/backend.rs`, uniffi layer in
`crates/matrix-rtc-ffi/src/backend.rs`) is the reference. Where both projects need the same thing
the method here has the same name and parameter order, so one adapter per Matrix SDK can serve both.

| matrix-rust-rtc | widget-matrix-backend | note |
|---|---|---|
| `own_user_id()` | `own_user_id()` | renamed from `user_id` |
| `own_device_id()` | `own_device_id()` | renamed from `device_id` |
| – | `room_id()`, `display_name()`, `avatar_url()`, `base_url()` | widget only: the backend is bound to one room; the rest feeds `matrix_context` |
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
| – | `search_user_directory(term, limit?)`, `media_config()` | MSC3973 / MSC4039 |
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
   only when they name the backend's room; `room_ids: "*"` and foreign rooms are answered with an
   error. Element Call is the only known user of multi-room reads; revisit when a multi-room host
   appears.
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
   **Decision:** adopt rtc's struct. The driver maps it to the widget error body matrix-widget-api
   already understands: `{ error: { message, matrix_api_error?: { http_status, response: { errcode,
   error } } } }`.
5. **`subscribe_room` sync vs async.** rtc's core trait is async and its uniffi layer sync (uniffi
   cannot return an object from an async foreign method). Here the trait *is* the uniffi layer, so
   it stays sync. No change.
6. **Delayed events: `send` action.** MSC4140 has `restart`, `cancel` and `send`; rtc implements
   the first two only. Added here as `send_delayed_event_now`; rtc may want the same name.
7. **Platform actions have results.** `navigate` and `m.sticker` can fail on the client side, so
   the platform methods return `Result<(), PlatformError>` (one uniffi error variant with a
   `reason`); `set_always_on_screen` returns the `success` flag the response needs. The other
   platform callbacks stay fire-and-forget.
8. **TURN watch acknowledgement.** matrix-widget-api waits for the first TURN server before
   acknowledging `watch_turn_servers` (and errors if none comes). `subscribe_turn_servers` is
   synchronous here, so the driver acknowledges first and the credentials follow as
   `update_turn_servers`; a widget written against matrix-widget-api handles both orders.

## 5. OpenID flow

`get_openid` has a user-consent step, so it is split like capabilities are:

* the driver calls `platform.on_openid_requested()` and answers the widget with
  `{ state: "request" }`;
* the platform decides and calls `driver.resolve_openid(allowed)` (async); on `true` the driver
  fetches `backend.openid_token()` and sends `openid_credentials { state: "allowed", original_request_id, ...token }`,
  on `false` or on a backend error it sends `state: "blocked"`;
* `driver.set_openid_auto_approved(true)` skips the prompt: the token is fetched inside the
  request and returned as `{ state: "allowed", ... }` directly (legacy `OpenIDRequestState.Allowed`
  in phase one).

## 6. Not built, and why

* **Binary payloads** (`upload_file`, `download_file`, `screenshot`): matrix-widget-api carries a
  `Blob` / `XMLHttpRequestBodyInit` through `postMessage` structured cloning. Every message here is
  a JSON string across the FFI, which cannot carry a `Blob`. Options: (a) define the file as
  `{ "mimetype": ..., "base64": ... }` on the wire (needs an MSC change), (b) keep file transfer
  out of the Rust driver and let the platform intercept these three actions before
  `handle_message_from_widget`. The capability strings parse already; the actions stay `Unknown`.
* **Modal widgets** (`open_modal`, `close_modal`, `button_clicked`, `set_button_enabled`,
  `widget_config`): pure client UI, no Matrix side effect, and MSC4412 does not mention them.
  Can be added as platform callbacks later without touching the backend.
* **Receiving sticky events** (`org.matrix.msc4407.receive.sticky_event`): needs
  `RoomSink::on_sticky_events` and a `sticky` field on `MatrixEvent`. Sending is built; receiving
  follows when the MSC4354 shape settles.
* **`redact_event`**: widgets redact via `send_event` of `m.room.redaction`.
* **`parent_delay_id`** on `send_event`: deprecated in matrix-widget-api and ignored by its
  driver; not modelled (unknown body fields are accepted and dropped).
* **msgtype `#` escaping**: matrix-widget-api un-escapes `\#` inside
  `m.room.message#<msgtype>` capabilities; this parser splits at the first `#` after
  `m.room.message` without escapes, which covers every msgtype in use.
