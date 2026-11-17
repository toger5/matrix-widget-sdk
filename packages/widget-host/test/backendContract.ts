/**
 * What every `MatrixBackend` must do behind the driver, whichever Matrix client it is built on.
 * Each backend's test file runs this suite with a fixture that can also play the homeserver's part.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { MatrixBackend } from "../../widget-host-bindings/src/generated/matrix_widget_host_backend_interface";
import { X, behindDriver, tick } from "./harness";

export interface BackendFixture {
  backend: MatrixBackend;
  roomId: string;
  userId: string;
  /** A state event arrives in the room, as a sync would deliver it. */
  receiveState(type: string, stateKey: string, content: Record<string, unknown>): void;
  /** Make the next sends fail with `message`. */
  failSends(message: string): void;
  /**
   * End the back-pagination a widget started: `events` (oldest first) arrive before the oldest
   * cached event, as the homeserver would send them, and the start of the room is reached if
   * `startReached`. Resolves once the backend has them in its cache.
   */
  resolvePagination(events: { type: string; content: Record<string, unknown> }[], startReached: boolean): Promise<void>;
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
        `widget:${X}read_timeline:m.room.message`,
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

      const read = await ask(`${X}read_timeline`, { limit: 10 });
      const events = read.events as { event_id: string; content: unknown }[];
      expect(events).toHaveLength(1);
      expect(events[0].event_id).toBe(sent.event_id);
      expect(events[0].content).toEqual({ msgtype: "m.text", body: "hi" });
    });

    it("reads its timeline cache with a cursor, paginates it on request and tells the widget", async () => {
      const { ask, grant, pushed, resolvePagination } = await setup();
      await grant([
        `widget:${X}send_event.timeline:m.room.message`,
        `widget:${X}read_timeline:m.room.message`,
        `widget:${X}paginate_timeline`,
        `host:${X}notify_timeline_update`,
      ]);
      const a = await ask(`${X}send_event`, { type: "m.room.message", content: { msgtype: "m.text", body: "a" } });
      const b = await ask(`${X}send_event`, { type: "m.room.message", content: { msgtype: "m.text", body: "b" } });
      await tick();
      pushed("");
      const ids = (read: Record<string, unknown>) => (read.events as { event_id: string }[]).map((e) => e.event_id);
      const bodies = (read: Record<string, unknown>) => (read.events as { content: { body: string } }[]).map((e) => e.content.body);

      const newest = await ask(`${X}read_timeline`, { limit: 10 });
      expect(ids(newest)).toEqual([b.event_id, a.event_id]);
      expect(newest.pagination).toBe("idle");
      expect(ids(await ask(`${X}read_timeline`, { from: b.event_id, limit: 10 }))).toEqual([a.event_id]);
      const gone = await ask(`${X}read_timeline`, { from: "$not-cached", limit: 1 });
      expect((gone.error as { code: string }).code).toBe(`${X}event_not_cached`);

      expect(await ask(`${X}paginate_timeline`, { limit: 2 })).toEqual({ pagination: "paginating" });
      await tick();
      expect(pushed(`${X}notify_timeline_update`)).toEqual([{ pagination: { status: "paginating" } }]);
      await resolvePagination([{ type: "m.room.message", content: { msgtype: "m.text", body: "old" } }], true);
      await tick();
      expect(pushed(`${X}notify_timeline_update`)).toEqual([{ pagination: { status: "start_reached" } }]);
      const older = await ask(`${X}read_timeline`, { from: a.event_id, limit: 10 });
      expect(bodies(older)).toEqual(["old"]);
      expect(older.pagination).toBe("start_reached");
      expect(await ask(`${X}paginate_timeline`, {})).toEqual({ pagination: "start_reached" });
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
