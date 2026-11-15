import { matrixEventFromJson, type MatrixEvent } from "@matrix-widget-tools/widget-host-bindings";
import type { MatrixEvent as SdkEvent } from "matrix-js-sdk";

/** A js-sdk event as the bindings' `MatrixEvent`: the decrypted event where there is one. */
export function toMatrixEvent(event: SdkEvent, roomId: string): MatrixEvent {
  return matrixEventFromJson(JSON.stringify({ room_id: roomId, ...event.getEffectiveEvent() }));
}

/** Whether `event` can be handed to a widget now; an event still waiting for its key cannot. */
export function isReadable(event: SdkEvent): boolean {
  return !event.isBeingDecrypted() && !event.isDecryptionFailure() && event.getType() !== "m.room.encrypted";
}
