/** The in-memory mode's session: its room behaves like any other backend, and its widget list can be edited. */
import { describe, expect, it, vi } from "vitest";

import { matrixEventFromJson } from "../../widget-host-bindings/src/generated/widget_actions";
import { EXAMPLE_LEGACY, EXAMPLE_NEW, MemorySession } from "../src/player/memorySession";
import { describeBackendContract } from "./backendContract";
import "./harness";

describeBackendContract("InMemoryBackend (MemorySession)", async () => {
  const session = new MemorySession();
  const backend = await session.backendFor(session.roomId);
  let n = 0;
  return {
    backend,
    roomId: session.roomId,
    userId: session.userId,
    receiveState: (type, stateKey, content) =>
      void session.store.inject(
        matrixEventFromJson(
          JSON.stringify({ type, state_key: stateKey, content, sender: "@bob:example.org", event_id: `$state-${++n}`, room_id: session.roomId, origin_server_ts: n }),
        ),
      ),
    failSends: (message) => session.store.failSends(message),
    dispose: () => backend.dispose(),
  };
});

describe("MemorySession", () => {
  it("has one room with the two test widgets", async () => {
    const session = new MemorySession();
    expect(session.rooms()).toEqual([{ id: "!room:example.org", name: "In-memory room" }]);
    expect(session.userId).toBe("@alice:example.org");
    expect(await session.widgets(session.roomId)).toEqual([EXAMPLE_NEW, EXAMPLE_LEGACY]);
    expect(await session.widgets("!other:example.org")).toEqual([]);
    expect(await session.needsVerification()).toBe(false);
    await expect(session.backendFor("!other:example.org")).rejects.toThrow("unknown room");
  });

  it("adds and replaces widgets, telling the room view each time", async () => {
    const session = new MemorySession({ roomId: "!r:x", userId: "@u:x", widgets: [] });
    const changed = vi.fn();
    const stop = session.onWidgetsChanged("!r:x", changed);

    const added = { type: "m.widget", state_key: "w", content: { url: "https://widget.example/", name: "One" } };
    expect(session.addWidget(added)).toBe("m.widget/w");
    const replaced = { ...added, content: { url: "https://widget.example/", name: "Two" } };
    session.addWidget(replaced);
    expect(await session.widgets("!r:x")).toEqual([replaced]);
    expect(() => session.addWidget({ type: "m.widget" } as never)).toThrow("state_key");

    expect(changed).toHaveBeenCalledTimes(2);

    stop();
    session.addWidget(added);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
