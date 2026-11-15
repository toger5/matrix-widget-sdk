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

//! A room subscription that asks for the entire state of a room.

use std::time::Duration;

use matrix_sdk::ruma::RoomId;

use crate::room_list::{RoomListError, RoomListService};

#[matrix_sdk_ffi_macros::export]
impl RoomListService {
    /// Subscribe to exactly this room, asking for its entire state, so that
    /// `Room::state_events` and `Room::subscribe_to_state_events` work for
    /// state events of any type.
    ///
    /// Returns once a sync has brought an update for the room, which is when
    /// the state is in the store, or after `timeout`: the server sends nothing
    /// if there is no state the client doesn't have yet.
    async fn subscribe_to_room_with_full_state(
        &self,
        room_id: String,
        timeout: Duration,
    ) -> Result<(), RoomListError> {
        let room_id = RoomId::parse(&room_id)
            .map_err(|_| RoomListError::InvalidRoomId { error: room_id })?;
        let mut room_updates = self.inner.room(&room_id)?.subscribe_to_updates();

        self.inner.set_room_subscriptions_with_full_state(&[&room_id]).await;

        // Ignore the result: on a timeout, the state is as complete as it gets.
        let _ = matrix_sdk_common::timeout::timeout(room_updates.recv(), timeout).await;

        Ok(())
    }
}
