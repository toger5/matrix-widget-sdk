import { matrixEventFromJson, type MatrixEvent } from "@matrix-widget-tools/widget-host-bindings";
import type { RoomStateEvent } from "matrix-sdk-uniffi-js";

/** A room event as the SDK hands it out raw: the JSON of the sync, decrypted. It has no `room_id`. */
export function rawToMatrixEvent(json: string, roomId: string): MatrixEvent {
  return matrixEventFromJson(JSON.stringify({ room_id: roomId, ...(JSON.parse(json) as Record<string, unknown>) }));
}

/** A state event from the SDK's store. The id and timestamp are only missing for a room we are invited to. */
export function stateToMatrixEvent(event: RoomStateEvent, eventType: string, roomId: string): MatrixEvent {
  return {
    eventType,
    sender: event.sender,
    eventId: event.eventId ?? "",
    roomId,
    originServerTs: event.timestamp ?? 0n,
    stateKey: event.stateKey,
    content: JSON.parse(event.contentJson),
    unsigned: undefined,
  };
}
