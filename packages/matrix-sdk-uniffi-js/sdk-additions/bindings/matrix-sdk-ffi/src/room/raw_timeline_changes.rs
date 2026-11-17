// Copyright 2026 The Matrix.org Foundation C.I.C.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for that specific language governing permissions and
// limitations under the License.

//! The changes of a room's event cache that a sync does not explain: the
//! cache dropped its events, or it replaced events in place after decrypting
//! them late. For consumers that read the event cache as a whole, like a
//! widget host that hands out the cached timeline with a cursor.

use std::sync::Arc;

use eyeball_im::VectorDiff;
use matrix_sdk::event_cache::{EventsOrigin, RoomEventCacheUpdate};
use matrix_sdk_common::{SendOutsideWasm, SyncOutsideWasm};
use tokio::sync::broadcast::error::RecvError;
use tracing::warn;

use super::Room;
use crate::{TaskHandle, runtime::get_runtime_handle};

/// A listener for the changes of a room's event cache, registered with
/// [`Room::subscribe_to_timeline_changes_raw`].
#[matrix_sdk_ffi_macros::export(callback_interface)]
pub trait RawTimelineChangesListener: SyncOutsideWasm + SendOutsideWasm {
    /// The event cache dropped the events it held (it was cleared, or reset
    /// after a gap), or this listener missed updates. Events read before may
    /// not connect to the events that follow.
    fn on_reset(&self);

    /// Events the event cache replaced in place with their decrypted form,
    /// because their room key arrived late, as JSON strings.
    fn on_decrypted(&self, events: Vec<String>);
}

#[matrix_sdk_ffi_macros::export]
impl Room {
    /// Subscribe to the changes of this room's event cache that are neither
    /// new events of a sync nor events of a pagination: a reset of the cache,
    /// and events decrypted late (see [`RawTimelineChangesListener`]).
    ///
    /// Use the returned [`TaskHandle`] to cancel the subscription.
    pub fn subscribe_to_timeline_changes_raw(
        self: Arc<Self>,
        listener: Box<dyn RawTimelineChangesListener>,
    ) -> Arc<TaskHandle> {
        Arc::new(TaskHandle::new(get_runtime_handle().spawn(async move {
            let client = self.inner.client();
            let Some(event_cache) = client.event_cache() else {
                warn!("Can't subscribe to the room's event cache changes: the event cache is disabled");
                return;
            };
            let (cache, _drop_handles) = match event_cache.room(self.inner.room_id()).await {
                Ok(cache) => cache,
                Err(error) => {
                    warn!("Can't subscribe to the room's event cache changes: {error}");
                    return;
                }
            };
            let mut subscriber = match cache.subscribe().await {
                Ok((_events, subscriber)) => subscriber,
                Err(error) => {
                    warn!("Can't subscribe to the room's event cache changes: {error}");
                    return;
                }
            };

            loop {
                let update = match subscriber.recv().await {
                    Ok(update) => update,
                    Err(RecvError::Lagged(num_skipped)) => {
                        warn!(num_skipped, "Lagged behind the room's event cache updates");
                        listener.on_reset();
                        continue;
                    }
                    Err(RecvError::Closed) => break,
                };

                let RoomEventCacheUpdate::UpdateTimelineEvents(update) = update else {
                    continue;
                };

                let mut reset = false;
                let mut decrypted = Vec::new();
                for diff in &update.diffs {
                    match diff {
                        VectorDiff::Clear | VectorDiff::Reset { .. } => reset = true,
                        // The redecryptor replaces a UTD with its decrypted form in place.
                        VectorDiff::Set { value, .. }
                            if matches!(update.origin, EventsOrigin::Cache)
                                && value.encryption_info().is_some() =>
                        {
                            decrypted.push(value.raw().json().get().to_owned());
                        }
                        _ => {}
                    }
                }
                if reset {
                    listener.on_reset();
                }
                if !decrypted.is_empty() {
                    listener.on_decrypted(decrypted);
                }
            }
        })))
    }
}
