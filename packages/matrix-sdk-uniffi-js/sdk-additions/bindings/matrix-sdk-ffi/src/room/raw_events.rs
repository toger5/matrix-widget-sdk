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

//! Raw (JSON) access to the events of a room, for consumers that handle event
//! types the SDK has no model for, like a widget host.

use std::sync::Arc;

use eyeball_im::VectorDiff;
use matrix_sdk::{
    deserialized_responses::TimelineEvent,
    event_cache::{EventsOrigin, RoomEventCache, RoomEventCacheUpdate},
    room::{IncludeRelations, RelationsOptions},
};
use matrix_sdk_common::{SendOutsideWasm, SyncOutsideWasm};
use ruma::{
    EventId,
    api::Direction,
    events::{RoomAccountDataEventType, TimelineEventType, relation::RelationType},
};
use tokio::sync::broadcast::error::RecvError;
use tracing::warn;

use super::Room;
use crate::{TaskHandle, error::ClientError, runtime::get_runtime_handle};

/// A page of the events related to an event, returned by
/// [`Room::relations_raw`].
#[derive(uniffi::Record)]
pub struct RawRelations {
    /// The related events, as JSON strings, decrypted if they were encrypted.
    /// They are in the order of the requested direction.
    pub events: Vec<String>,
    /// The token to pass as `from` to get the next page, if there is one.
    pub next_batch_token: Option<String>,
    /// The token to get the previous page, if there is one.
    pub prev_batch_token: Option<String>,
}

/// A listener for the events a sync adds to a room's timeline, registered
/// with [`Room::subscribe_to_events_raw`].
#[matrix_sdk_ffi_macros::export(callback_interface)]
pub trait RawRoomEventsListener: SyncOutsideWasm + SendOutsideWasm {
    /// Called with the new events of one sync, oldest first, as JSON strings.
    fn on_events(&self, events: Vec<String>);
}

fn to_json(event: &TimelineEvent) -> String {
    event.raw().json().get().to_owned()
}

impl Room {
    async fn room_event_cache(
        &self,
    ) -> Result<(RoomEventCache, Arc<matrix_sdk::event_cache::EventCacheDropHandles>), ClientError>
    {
        let client = self.inner.client();
        let event_cache = client
            .event_cache()
            .ok_or_else(|| ClientError::from_str("the event cache is disabled", None))?;
        Ok(event_cache.room(self.inner.room_id()).await?)
    }
}

#[matrix_sdk_ffi_macros::export]
impl Room {
    /// The events of this room that the event cache currently holds in memory,
    /// oldest first, as JSON strings.
    ///
    /// This is every kind of timeline event, state events included, of any
    /// type. An event that was encrypted is returned decrypted; one that could
    /// not be decrypted is returned as the `m.room.encrypted` event.
    ///
    /// Use [`Room::paginate_events_raw_backwards`] to load older events.
    pub async fn events_raw(&self) -> Result<Vec<String>, ClientError> {
        let (cache, _drop_handles) = self.room_event_cache().await?;
        Ok(cache.events().await?.iter().map(to_json).collect())
    }

    /// Load older events into the event cache, from its store or from the
    /// homeserver, until `num_events` more are there or the start of the room
    /// is reached.
    ///
    /// Returns whether the start of the room was reached.
    pub async fn paginate_events_raw_backwards(&self, num_events: u16) -> Result<bool, ClientError> {
        let (cache, _drop_handles) = self.room_event_cache().await?;
        Ok(cache.pagination().run_backwards_until(num_events).await?.reached_start)
    }

    /// Subscribe to the events that a sync adds to this room's timeline.
    ///
    /// The listener gets every kind of timeline event, state events included,
    /// of any type, as JSON strings, decrypted if they were encrypted. Events
    /// loaded by a pagination are not reported.
    ///
    /// Use the returned [`TaskHandle`] to cancel the subscription.
    pub fn subscribe_to_events_raw(
        self: Arc<Self>,
        listener: Box<dyn RawRoomEventsListener>,
    ) -> Arc<TaskHandle> {
        Arc::new(TaskHandle::new(get_runtime_handle().spawn(async move {
            let (cache, _drop_handles) = match self.room_event_cache().await {
                Ok(cache) => cache,
                Err(error) => {
                    warn!("Can't subscribe to the room's events: {error}");
                    return;
                }
            };
            let mut subscriber = match cache.subscribe().await {
                Ok((_events, subscriber)) => subscriber,
                Err(error) => {
                    warn!("Can't subscribe to the room's events: {error}");
                    return;
                }
            };

            loop {
                let update = match subscriber.recv().await {
                    Ok(update) => update,
                    Err(RecvError::Lagged(num_skipped)) => {
                        warn!(num_skipped, "Lagged behind the room's event cache updates");
                        continue;
                    }
                    Err(RecvError::Closed) => break,
                };

                let RoomEventCacheUpdate::UpdateTimelineEvents(update) = update else {
                    continue;
                };
                if !matches!(update.origin, EventsOrigin::Sync) {
                    continue;
                }

                let mut events = Vec::new();
                for diff in &update.diffs {
                    match diff {
                        VectorDiff::Append { values } => events.extend(values.iter().map(to_json)),
                        VectorDiff::PushBack { value } => events.push(to_json(value)),
                        _ => {}
                    }
                }
                if !events.is_empty() {
                    listener.on_events(events);
                }
            }
        })))
    }

    /// Get one page of the events related to `event_id`, from the homeserver,
    /// as JSON strings, decrypted if they were encrypted.
    ///
    /// # Arguments
    ///
    /// * `relation_type` - Only return relations of this type, e.g.
    ///   `m.annotation`.
    /// * `event_type` - Only return events of this type. Ignored without a
    ///   `relation_type`.
    /// * `from` - A token of a previous page to continue from.
    /// * `limit` - The maximum number of events to return.
    /// * `forward` - Return the events in chronological order rather than
    ///   newest first.
    pub async fn relations_raw(
        &self,
        event_id: String,
        relation_type: Option<String>,
        event_type: Option<String>,
        from: Option<String>,
        limit: Option<u32>,
        forward: bool,
    ) -> Result<RawRelations, ClientError> {
        let include_relations = match (relation_type, event_type) {
            (None, _) => IncludeRelations::AllRelations,
            (Some(relation_type), None) => {
                IncludeRelations::RelationsOfType(RelationType::from(relation_type))
            }
            (Some(relation_type), Some(event_type)) => {
                IncludeRelations::RelationsOfTypeAndEventType(
                    RelationType::from(relation_type),
                    TimelineEventType::from(event_type),
                )
            }
        };
        let options = RelationsOptions {
            from,
            dir: if forward { Direction::Forward } else { Direction::Backward },
            limit: limit.map(Into::into),
            include_relations,
            recurse: false,
        };

        let relations = self.inner.relations(EventId::parse(event_id)?, options).await?;

        Ok(RawRelations {
            events: relations.chunk.iter().map(to_json).collect(),
            next_batch_token: relations.next_batch_token,
            prev_batch_token: relations.prev_batch_token,
        })
    }

    /// Read the account data of the given type in this room, from the store.
    ///
    /// Returns the event as a JSON string, or `None` if there is none.
    pub async fn account_data_raw(&self, event_type: String) -> Result<Option<String>, ClientError> {
        let event = self.inner.account_data(RoomAccountDataEventType::from(event_type)).await?;
        Ok(event.map(|event| event.json().get().to_owned()))
    }
}
