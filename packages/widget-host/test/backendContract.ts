/**
 * What every `MatrixBackend` must do behind the driver, whichever Matrix client it is built on.
 * Each backend's test file runs this suite with a fixture that can also play the homeserver's part.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { MatrixBackend } from "../../widget-host-bindings/src/generated/widget_matrix_backend";
import { X, behindDriver, tick } from "./harness";

export interface BackendFixture {
  backend: MatrixBackend;
  roomId: string;
  userId: string;
  /** A state event arrives in the room, as a sync would deliver it. */
  receiveState(type: string, stateKey: string, content: Record<string, unknown>): void;
  /** Make the next sends fail with `message`. */
  failSends(message: string): void;
  dispose?(): void;
}

export function describeBackendContract(name: string, make: () => Promise<BackendFixture>) {
  describe(`${name}: backend contract`, () => {
    let fixture: BackendFixture | undefined;
    afterEach(() => fixture?.dispose?.());

    const setup = async () => {
      fixture = await make();
      return { ...fixture, ...behindDriver(fixture.backend) };
    };

    it("reports the room and the user it is bound to", async () => {
      const { ask, grant, roomId, userId } = await setup();
      await grant([`widget:${X}get_matrix_context`]);
      const context = await ask(`${X}get_matrix_context`);
      expect(context.room_id).toBe(roomId);
      expect(context.user_id).toBe(userId);
    });

    it("sends a timeline event, forwards it and reads it back", async () => {
      const { ask, grant, pushed, roomId } = await setup();
      await grant([
        `widget:${X}send_event.timeline:m.room.message`,
        "widget:org.matrix.msc2876.read_events.timeline:m.room.message",
        `host:${X}forward_event.timeline:m.room.message`,
      ]);
      pushed("");

      const sent = await ask(`${X}send_event`, { type: "m.room.message", content: { msgtype: "m.text", body: "hi" } });
      expect(sent.room_id).toBe(roomId);
      expect(typeof sent.event_id).toBe("string");
      await tick();
      const forwarded = pushed(`${X}forward_event`);
      expect(forwarded).toHaveLength(1);
      expect(JSON.stringify(forwarded[0])).toContain('"body":"hi"');

      const read = await ask("org.matrix.msc2876.read_events", { type: "m.room.message", limit: 10 });
      const events = read.events as { event_id: string; content: unknown }[];
      expect(events).toHaveLength(1);
      expect(events[0].event_id).toBe(sent.event_id);
      expect(events[0].content).toEqual({ msgtype: "m.text", body: "hi" });
    });

    it("delivers the current state at once and again when it changes", async () => {
      const { grant, pushed, receiveState } = await setup();
      receiveState("m.room.topic", "", { topic: "first" });
      await grant([`host:${X}update_state:m.room.topic`]);
      await tick();
      const initial = pushed(`${X}update_state`);
      expect(initial).toHaveLength(1);
      expect(JSON.stringify(initial[0])).toContain('"topic":"first"');

      receiveState("m.room.topic", "", { topic: "second" });
      await tick();
      const update = pushed(`${X}update_state`);
      expect(update).toHaveLength(1);
      expect(JSON.stringify(update[0])).toContain('"topic":"second"');
      expect(JSON.stringify(update[0])).not.toContain('"topic":"first"');
    });

    it("reports a failed send to the widget", async () => {
      const { ask, grant, failSends } = await setup();
      await grant([`widget:${X}send_event.timeline:m.room.message`]);
      failSends("boom");
      const failed = await ask(`${X}send_event`, { type: "m.room.message", content: { body: "hi" } });
      expect((failed.error as { message: string }).message).toContain("boom");
    });
  });
}
