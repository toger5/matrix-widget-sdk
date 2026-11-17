//! The push half of the driver: what it subscribes to at the backend, and how it forwards what the
//! backend delivers to the widget.
//!
//! The subscriptions follow the approved `host:…` capabilities: `forward_event.*` and
//! `update_state` give a room subscription, `forward_to_device` a to-device subscription,
//! `notify_timeline_update` a timeline subscription. TURN servers are subscribed only while the
//! widget watches them.

use std::sync::{Arc, Mutex, Weak};

use matrix_widget_actions::{
    Capability, CapabilitySet, HostRequest, MatrixEvent, NotifyTimelineUpdateRequest, PaginationStatus,
    TimelinePagination, ToDeviceEvent, TurnServer, UpdateStateRequest, WidgetError, WireMessage,
};
use matrix_widget_host_backend_interface::{
    RoomSink, RoomSubjects, Subscription, TimelineSink, TimelineUpdate, ToDeviceSink, TurnServerSink,
};

use super::{access, WidgetHostDriver};

/// Holds at most one live backend subscription.
///
/// The old subscription is always taken out before it is cancelled: `cancel` may call back into
/// the driver, so the slot's lock must be free by then.
#[derive(Default)]
pub(super) struct SubscriptionSlot(Mutex<Option<Arc<dyn Subscription>>>);

impl SubscriptionSlot {
    pub(super) fn is_set(&self) -> bool {
        self.lock().is_some()
    }

    /// Store `subscription` and cancel the one held before.
    pub(super) fn replace(&self, subscription: Arc<dyn Subscription>) {
        let old = self.lock().replace(subscription);
        if let Some(old) = old {
            old.cancel();
        }
    }

    /// Cancel the held subscription, if any.
    pub(super) fn cancel(&self) {
        let old = self.lock().take();
        if let Some(old) = old {
            old.cancel();
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Arc<dyn Subscription>>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The sink the driver hands to the backend.
///
/// It holds the driver weakly: the backend keeps the sink alive, and the driver keeps the backend
/// alive, so a strong reference would be a cycle.
struct DriverSink(Weak<WidgetHostDriver>);

impl RoomSink for DriverSink {
    fn on_timeline_events(&self, events: Vec<MatrixEvent>) {
        if let Some(driver) = self.0.upgrade() {
            driver.forward_timeline_events(events);
        }
    }

    fn on_state_events(&self, event_type: String, events: Vec<MatrixEvent>) {
        if let Some(driver) = self.0.upgrade() {
            driver.forward_state_events(event_type, events);
        }
    }
}

impl ToDeviceSink for DriverSink {
    fn on_to_device_message(&self, message: ToDeviceEvent) {
        if let Some(driver) = self.0.upgrade() {
            driver.forward_to_device_message(message);
        }
    }
}

impl TimelineSink for DriverSink {
    fn on_timeline_update(&self, update: TimelineUpdate) {
        if let Some(driver) = self.0.upgrade() {
            driver.forward_timeline_update(update);
        }
    }
}

impl TurnServerSink for DriverSink {
    fn on_turn_server(&self, server: TurnServer) {
        if let Some(driver) = self.0.upgrade() {
            driver.push(HostRequest::UpdateTurnServers { server });
        }
    }
}

impl WidgetHostDriver {
    fn sink(&self) -> Arc<DriverSink> {
        Arc::new(DriverSink(self.this.clone()))
    }

    /// Replace the room, to-device and timeline subscriptions with ones matching the approved
    /// capabilities.
    ///
    /// The backend may call the sink from inside `subscribe_*`, so no driver lock is held here.
    /// A refused subscription only means that no live events arrive; the protocol has no message
    /// for that, so the error is only logged.
    pub(super) fn resubscribe(&self) {
        let approved = self.approved();
        self.room_subscription.cancel();
        self.to_device_subscription.cancel();
        self.timeline_subscription.cancel();

        let subjects = subjects_for(&approved);
        if !subjects.is_empty() {
            log::debug!(
                "subscribing to the room: timeline {:?}, state {:?}",
                subjects.timeline_event_types,
                subjects.state_event_types
            );
            match self.backend.subscribe_room(self.backend.room_id(), subjects, self.sink()) {
                Ok(subscription) => self.room_subscription.replace(subscription),
                Err(e) => {
                    log::warn!("the backend refused the room subscription, no events are forwarded: {}", e.reason())
                }
            }
        }
        let to_device_types = to_device_types_for(&approved);
        if !to_device_types.is_empty() {
            log::debug!("subscribing to to-device messages: {to_device_types:?}");
            match self.backend.subscribe_to_device(to_device_types, self.sink()) {
                Ok(subscription) => self.to_device_subscription.replace(subscription),
                Err(e) => log::warn!(
                    "the backend refused the to-device subscription, no messages are forwarded: {}",
                    e.reason()
                ),
            }
        }
        if approved.has(&Capability::NotifyTimelineUpdate) {
            log::debug!("subscribing to timeline updates");
            match self.backend.subscribe_timeline(self.backend.room_id(), self.sink()) {
                Ok(subscription) => self.timeline_subscription.replace(subscription),
                Err(e) => log::warn!(
                    "the backend refused the timeline subscription, no timeline updates are sent: {}",
                    e.reason()
                ),
            }
        }
    }

    /// `watch_turn_servers`: subscribe to TURN credentials, unless already watching.
    pub(super) fn watch_turn_servers(&self, msg: &WireMessage) {
        // The ack goes out first: the backend may deliver the current credentials from inside
        // `subscribe_turn_servers`, and the widget expects them after the ack (as in the legacy api).
        self.send(&msg.ack());
        if self.turn_subscription.is_set() {
            return;
        }
        match self.backend.subscribe_turn_servers(self.sink()) {
            Ok(subscription) => self.turn_subscription.replace(subscription),
            Err(e) => log::warn!("the backend refused the TURN server subscription: {}", e.reason()),
        }
    }

    /// Forward new timeline events as `forward_event`, each one the widget holds a
    /// `forward_event.*` capability for.
    fn forward_timeline_events(&self, events: Vec<MatrixEvent>) {
        let approved = self.approved();
        for event in events {
            if access::may_forward(&approved, &event) {
                self.send_request(HostRequest::ForwardEvent { event });
            }
        }
    }

    /// Forward the current state set of `event_type` as `update_state`, reduced to the events the
    /// widget holds an `update_state` capability for. Nothing is sent when that leaves no event.
    fn forward_state_events(&self, event_type: String, events: Vec<MatrixEvent>) {
        let approved = self.approved();
        let state: Vec<MatrixEvent> = events
            .into_iter()
            .filter(|e| e.event_type == event_type && access::may_update_state(&approved, e))
            .collect();
        if !state.is_empty() {
            self.send_request(HostRequest::UpdateState { request: UpdateStateRequest { state } });
        }
    }

    /// Tell the widget about a change of the timeline cache with `notify_timeline_update`.
    /// `decrypted` names only the events the widget may read; an update that leaves nothing to
    /// say is not sent.
    fn forward_timeline_update(&self, update: TimelineUpdate) {
        let approved = self.approved();
        let request = timeline_notification(&approved, update);
        if request.pagination.is_some() || request.reset || !request.decrypted.is_empty() {
            self.push(HostRequest::NotifyTimelineUpdate { request });
        }
    }

    /// Forward a to-device message as `forward_to_device` if the widget holds the capability for
    /// its type.
    fn forward_to_device_message(&self, message: ToDeviceEvent) {
        if self.approved().allows_forward_to_device(&message.event_type) {
            self.send_request(HostRequest::ForwardToDevice { message });
        }
    }
}

/// The room subscription for a set of approved capabilities.
///
/// * `forward_event.timeline:T` and `forward_event.state:T[#key]` subscribe to `T` on the timeline.
/// * `update_state:T[#key]` subscribes to the state set of `T`.
///
/// A widget that wants state changes both as `update_state` and as `forward_event` holds both
/// capabilities. State keys and msgtypes are not part of the subscription; the driver filters by
/// them when forwarding.
fn subjects_for(approved: &[Capability]) -> RoomSubjects {
    let mut subjects = RoomSubjects::default();
    for capability in approved {
        match capability {
            Capability::ForwardEvent { event_type, .. } | Capability::ForwardStateEvent { event_type, .. } => {
                push_unique(&mut subjects.timeline_event_types, event_type)
            }
            Capability::UpdateState { event_type, .. } => push_unique(&mut subjects.state_event_types, event_type),
            _ => {}
        }
    }
    subjects
}

/// The `notify_timeline_update` body for a backend's [`TimelineUpdate`].
fn timeline_notification(approved: &[Capability], update: TimelineUpdate) -> NotifyTimelineUpdateRequest {
    let pagination = match (update.pagination, update.pagination_error) {
        (Some(status), error) => Some(TimelinePagination {
            status,
            error: error.map(|reason| WidgetError::new(format!("Pagination failed: {reason}"))),
        }),
        // An error alone means the pagination is over: the status is `idle` again.
        (None, Some(reason)) => Some(TimelinePagination {
            status: PaginationStatus::Idle,
            error: Some(WidgetError::new(format!("Pagination failed: {reason}"))),
        }),
        (None, None) => None,
    };
    NotifyTimelineUpdateRequest {
        pagination,
        reset: update.reset,
        decrypted: update
            .decrypted
            .into_iter()
            .filter(|e| access::may_read_timeline(approved, e))
            .map(|e| e.event_id)
            .collect(),
    }
}

/// The to-device message types to subscribe to for a set of approved capabilities.
fn to_device_types_for(approved: &[Capability]) -> Vec<String> {
    let mut types = Vec::new();
    for capability in approved {
        if let Capability::ForwardToDevice { event_type } = capability {
            push_unique(&mut types, event_type);
        }
    }
    types
}

fn push_unique(list: &mut Vec<String>, value: &str) {
    if !list.iter().any(|v| v == value) {
        list.push(value.to_owned());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn subjects_follow_the_host_capabilities() {
        let approved = vec![
            Capability::send_event("m.room.message"),
            Capability::forward_event("m.room.message"),
            Capability::forward_messages("m.text"),
            Capability::forward_state_event("m.room.topic", None::<&str>),
            Capability::update_state("m.room.name", None::<&str>),
            Capability::update_state("m.room.name", Some("")),
            Capability::forward_to_device("a"),
            Capability::forward_to_device("a"),
        ];
        let subjects = subjects_for(&approved);
        assert_eq!(subjects.timeline_event_types, strings(&["m.room.message", "m.room.topic"]));
        // `forward_event.state` alone gives no state updates, and `update_state` no timeline events.
        assert_eq!(subjects.state_event_types, strings(&["m.room.name"]));
        assert_eq!(to_device_types_for(&approved), strings(&["a"]));

        // The widget's own actions (send, read) subscribe to nothing.
        let widget_only = [
            Capability::send_event("x"),
            Capability::read_timeline("x"),
            Capability::PaginateTimeline,
            Capability::send_to_device("x"),
        ];
        assert!(subjects_for(&widget_only).is_empty());
        assert!(to_device_types_for(&widget_only).is_empty());
    }
}
