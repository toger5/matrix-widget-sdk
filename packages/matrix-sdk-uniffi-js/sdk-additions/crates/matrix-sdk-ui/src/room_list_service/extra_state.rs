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

use matrix_sdk::{SlidingSyncList, SlidingSyncMode};
use ruma::events::StateEventType;

use super::{Error, RoomListService};

/// The name of the sliding sync list added by
/// [`RoomListService::sync_extra_state_for_all_rooms`].
pub const EXTRA_STATE_LIST_NAME: &str = "extra_state";

/// How many more rooms each request of the extra state list covers, until it
/// covers all of them.
const EXTRA_STATE_GROWING_BATCH_SIZE: u32 = 100;

impl RoomListService {
    /// Sync `required_state` for all rooms, in addition to the state events the
    /// SDK itself needs.
    ///
    /// The `required_state` of the `all_rooms` list is fixed. This adds a
    /// second list to the same sliding sync connection, which grows until it
    /// covers all rooms and asks for these state events only, with no
    /// timeline. The server sends, for a room that is in several lists, the
    /// state events any of them asks for.
    ///
    /// This is for consumers that need a few state event types of every room,
    /// like a client that marks the rooms with widgets in its room list. For
    /// the entire state of the room in view, see
    /// [`Self::set_room_subscriptions_with_full_state`].
    ///
    /// The list is not cached: call this every time the service is created.
    /// Calling it again replaces the list.
    pub async fn sync_extra_state_for_all_rooms(
        &self,
        required_state: Vec<(StateEventType, String)>,
    ) -> Result<(), Error> {
        let list = SlidingSyncList::builder(EXTRA_STATE_LIST_NAME)
            .sync_mode(SlidingSyncMode::new_growing(EXTRA_STATE_GROWING_BATCH_SIZE))
            .timeline_limit(0)
            .required_state(required_state);

        self.sliding_sync.add_list(list).await.map_err(Error::SlidingSync)?;

        Ok(())
    }
}
