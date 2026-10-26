# widget-matrix-backend

**Responsibility:** the boundary between the widget driver and a real Matrix SDK. It defines
the `MatrixBackend` trait, everything the driver needs from Matrix (send, read, subscribe,
OpenID, TURN, …). The trait is implemented by the client, once per Matrix SDK. It contains no
widget logic and no permission checks; the driver does those before it calls the backend.

One backend instance serves **one room**, the room the widget lives in. The trait is shaped like
matrix-rust-rtc's `MatrixBackend`, so one adapter can serve both (see `docs/parity.md`).

![Architecture](../../docs/diagrams/01-architecture.svg)

## How to use it

Implement the trait as a thin adapter over your SDK:

```rust
use std::sync::Arc;
use widget_matrix_backend::{BackendError, JsonValue, MatrixBackend, RoomSink, RoomSubjects, Subscription};

struct MySdkBackend { room: matrix_sdk::Room }

#[async_trait::async_trait]
impl MatrixBackend for MySdkBackend {
    fn room_id(&self) -> String { self.room.room_id().to_string() }
    async fn send_room_event(&self, room_id: String, event_type: String, content: JsonValue)
        -> Result<String, BackendError> { /* room.send_raw(…) → event id */ }
    // read_room_events, read_room_state, openid_token, …

    // The one method with substance: register listeners for the requested event types,
    // hand the sink the current state of every requested state type right away, forward new
    // timeline events, and return a Subscription whose cancel() removes the listeners.
    fn subscribe_room(&self, room_id: String, subjects: RoomSubjects, sink: Arc<dyn RoomSink>)
        -> Result<Arc<dyn Subscription>, BackendError> { /* … */ }
}
```

Errors are `BackendError::Failed { errcode, status, reason }`; the driver forwards `errcode`
and `status` to the widget as `matrix_api_error`.

With the `uniffi` feature the trait can be implemented in Kotlin / Swift / Python / TypeScript.

## InMemoryBackend

A complete implementation over plain vectors, for tests and the browser test host:

```rust
let backend = InMemoryBackend::new("!room:example.org".into(), "@alice:example.org".into());
backend.inject(event);                 // as if it arrived from sync; notifies subscriptions
backend.fail_sends(Some("boom".into()));
let sent = backend.timeline();         // what the widget sent
```

![Test setup](../../docs/diagrams/07-test-setup.svg)
