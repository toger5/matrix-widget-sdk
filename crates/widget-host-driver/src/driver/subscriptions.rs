//! The push half of the driver: what it subscribes to at the backend, and how it forwards what the
//! backend delivers to the widget.
//!
//! The subscriptions follow the approved capabilities: `receive.*` gives a room subscription,
//! `receive.to_device:*` a to-device subscription. TURN servers are subscribed only while the
//! widget watches them.

use std::sync::{Arc, Mutex, Weak};

use widget_actions::{
    Capability, CapabilitySet, HostRequest, MatrixEvent, ToDeviceEvent, TurnServer, UpdateStateRequest, WireMessage,
};
use widget_matrix_backend::{RoomSink, RoomSubjects, Subscription, ToDeviceSink, TurnServerSink};

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

impl TurnServerSink for DriverSink {
    fn on_turn_server(&self, server: TurnServer) {
        if let Some(driver) = self.0.upgrade() {
            driver.send_request(HostRequest::UpdateTurnServers { server });
        }
    }
}

impl WidgetHostDriver {
    fn sink(&self) -> Arc<DriverSink> {
        Arc::new(DriverSink(self.this.clone()))
    }

    /// Replace the room and to-device subscriptions with ones matching the approved capabilities.
    ///
    /// The backend may call the sink from inside `subscribe_*`, so no driver lock is held here.
    /// A refused subscription only means that no live events arrive; the protocol has no message
    /// for that, so the error is dropped.
    pub(super) fn resubscribe(&self) {
        let approved = self.approved();
        self.room_subscription.cancel();
        self.to_device_subscription.cancel();

        let subjects = subjects_for(&approved);
        if !subjects.is_empty() {
            if let Ok(subscription) = self.backend.subscribe_room(self.backend.room_id(), subjects, self.sink()) {
                self.room_subscription.replace(subscription);
            }
        }
        let to_device_types = to_device_types_for(&approved);
        if !to_device_types.is_empty() {
            if let Ok(subscription) = self.backend.subscribe_to_device(to_device_types, self.sink()) {
                self.to_device_subscription.replace(subscription);
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
        if let Ok(subscription) = self.backend.subscribe_turn_servers(self.sink()) {
            self.turn_subscription.replace(subscription);
        }
    }

    /// Forward new timeline events as `send_event`, each one the widget may receive.
    fn forward_timeline_events(&self, events: Vec<MatrixEvent>) {
        let approved = self.approved();
        for event in events {
            if access::may_receive(&approved, &event) {
                self.send_request(HostRequest::SendEvent { event });
            }
        }
    }

    /// Forward the current state set of `event_type` as `update_state`, reduced to the events the
    /// widget may receive. Nothing is sent when that leaves no event.
    fn forward_state_events(&self, event_type: String, events: Vec<MatrixEvent>) {
        let approved = self.approved();
        let state: Vec<MatrixEvent> = events
            .into_iter()
            .filter(|e| e.is_state() && e.event_type == event_type && access::may_receive(&approved, e))
            .collect();
        if !state.is_empty() {
            self.send_request(HostRequest::UpdateState { request: UpdateStateRequest { state } });
        }
    }

    /// Forward a to-device message as `send_to_device` if the widget may receive its type.
    fn forward_to_device_message(&self, message: ToDeviceEvent) {
        if self.approved().allows_receive_to_device(&message.event_type) {
            self.send_request(HostRequest::SendToDevice { message });
        }
    }
}

/// The room subscription for a set of approved capabilities.
///
/// * `receive.event:T` subscribes to `T` on the timeline.
/// * `receive.state_event:T[#key]` subscribes to the state set of `T` **and** to `T` on the
///   timeline, because widgets expect state changes as `send_event` too.
///
/// State keys are not part of the subscription; the driver filters by state key when forwarding.
fn subjects_for(approved: &[Capability]) -> RoomSubjects {
    let mut subjects = RoomSubjects::default();
    for capability in approved {
        match capability {
            Capability::ReceiveEvent { event_type, .. } => push_unique(&mut subjects.timeline_event_types, event_type),
            Capability::ReceiveStateEvent { event_type, .. } => {
                push_unique(&mut subjects.timeline_event_types, event_type);
                push_unique(&mut subjects.state_event_types, event_type);
            }
            _ => {}
        }
    }
    subjects
}

/// The to-device message types to subscribe to for a set of approved capabilities.
fn to_device_types_for(approved: &[Capability]) -> Vec<String> {
    let mut types = Vec::new();
    for capability in approved {
        if let Capability::ReceiveToDevice { event_type } = capability {
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
    fn subjects_follow_receive_capabilities() {
        let approved = vec![
            Capability::send_event("m.room.message"),
            Capability::receive_event("m.room.message"),
            Capability::receive_message("m.text"),
            Capability::receive_state_event("m.room.topic", None::<&str>),
            Capability::receive_state_event("m.room.topic", Some("")),
            Capability::receive_to_device("a"),
            Capability::receive_to_device("a"),
        ];
        let subjects = subjects_for(&approved);
        assert_eq!(subjects.timeline_event_types, strings(&["m.room.message", "m.room.topic"]));
        assert_eq!(subjects.state_event_types, strings(&["m.room.topic"]));
        assert_eq!(to_device_types_for(&approved), strings(&["a"]));

        assert!(subjects_for(&[Capability::send_event("x")]).is_empty());
    }
}
