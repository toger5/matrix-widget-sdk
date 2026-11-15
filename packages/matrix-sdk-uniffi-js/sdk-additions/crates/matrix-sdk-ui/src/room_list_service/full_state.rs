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

//! Room subscriptions that ask for the entire state of a room.

use ruma::{RoomId, events::StateEventType};

use super::{RoomListService, room_subscription_settings};

impl RoomListService {
    /// Set the room subscriptions to exactly `room_ids`, like
    /// [`Self::set_room_subscriptions`], but ask for the entire state of these
    /// rooms rather than for the state events the SDK itself needs.
    ///
    /// This is for consumers that read state events of arbitrary types from
    /// the store, like a widget host. It makes the server send every member
    /// event of the rooms.
    pub async fn set_room_subscriptions_with_full_state(&self, room_ids: &[&RoomId]) {
        // Read the state before the await: the state machine can drift
        // meanwhile.
        let cancel_in_flight_request = self.must_cancel_in_flight_request();

        self.listen_to_latest_events(room_ids).await;

        let mut settings = room_subscription_settings();
        settings.required_state = vec![(StateEventType::from("*"), "*".to_owned())];

        self.sliding_sync.set_room_subscriptions(room_ids, Some(settings), cancel_in_flight_request)
    }
}
