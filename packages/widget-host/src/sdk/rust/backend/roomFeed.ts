import type { RoomSink, RoomSubjects, Subscription } from "@matrix-widget-tools/widget-host-bindings";
import { stateEventTypeFromString, type RoomLike } from "matrix-sdk-uniffi-js";

import { rawToMatrixEvent, stateToMatrixEvent } from "./events";

/**
 * Feeds one `subscribe_room` sink from the SDK's sync: timeline events from the room's event
 * cache (any type, decrypted), state from the SDK's store. The store has the state of every type
 * because the session subscribes to the room with its full state before it creates a backend.
 */
export function subscribeRoomFeed(room: RoomLike, subjects: RoomSubjects, sink: RoomSink): Subscription {
  const roomId = room.id();
  const handles = subjects.stateEventTypes.map((type) =>
    // The SDK calls this with the current set right away, then after every change.
    room.subscribeToStateEvents(stateEventTypeFromString(type), {
      onUpdate: (events) => sink.onStateEvents(type, events.map((event) => stateToMatrixEvent(event, type, roomId))),
    }),
  );

  if (subjects.timelineEventTypes.length > 0) {
    const wanted = new Set(subjects.timelineEventTypes);
    handles.push(
      room.subscribeToEventsRaw({
        onEvents: (events) => {
          const matching = events.map((json) => rawToMatrixEvent(json, roomId)).filter((event) => wanted.has(event.eventType));
          if (matching.length > 0) sink.onTimelineEvents(matching);
        },
      }),
    );
  }

  return { cancel: () => handles.forEach((handle) => handle.cancel()) };
}
