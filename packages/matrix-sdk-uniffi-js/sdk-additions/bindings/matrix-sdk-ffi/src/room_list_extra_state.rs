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

//! A sliding sync list that brings extra state events for all rooms.

use matrix_sdk::ruma::events::StateEventType;

use crate::room_list::{RoomListError, RoomListService};

#[matrix_sdk_ffi_macros::export]
impl RoomListService {
    /// Sync the state events of these types (with any state key) for all
    /// rooms, in addition to the state events the SDK itself needs, so that
    /// `Room::state_events` returns them for every room and not just for a
    /// room that is subscribed to.
    ///
    /// Call this every time the service is created, before or after the sync
    /// has started. Calling it again replaces the event types.
    async fn sync_extra_state_for_all_rooms(
        &self,
        event_types: Vec<String>,
    ) -> Result<(), RoomListError> {
        let required_state = event_types
            .into_iter()
            .map(|event_type| (StateEventType::from(event_type), "*".to_owned()))
            .collect();

        self.inner.sync_extra_state_for_all_rooms(required_state).await?;

        Ok(())
    }
}
