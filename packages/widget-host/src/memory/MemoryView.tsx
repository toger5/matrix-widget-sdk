import { useEffect, useState } from "react";

import { widgetKey, type StateEvent } from "../widgetStateEvent";
import { EXAMPLE_NEW, MemorySession, seedDemoMedia } from "./memorySession";
import { MemoryStorePanel } from "./MemoryStorePanel";
import { LoggedInView } from "../views/LoggedInView";
import type { WidgetOptions } from "../views/WidgetView";

/**
 * URL parameters of the in-memory mode, so tests can start deterministically:
 *   ?event=<json widget state event>&autoload=1&autoApprove=1&wrapper=<url>
 * `event` adds a widget to the room, `autoload=1` opens it (or the first widget) right away,
 * `autoApprove=1` approves every capability request, `room` / `user` set the ids of the room.
 * `mode=memory` only skips the login screen.
 */
const params = () => new URLSearchParams(location.search);

/** Whether the URL asks for the in-memory mode, skipping the login screen. */
export function startsInMemory(): boolean {
  const p = params();
  return p.has("event") || p.get("autoload") === "1" || p.get("mode") === "memory";
}

interface Start {
  session: MemorySession;
  initialWidgetKey?: string;
  problem?: string;
}

function start(): Start {
  const p = params();
  const session = new MemorySession({ roomId: p.get("room") ?? undefined, userId: p.get("user") ?? undefined });
  let first = widgetKey(EXAMPLE_NEW);
  let problem: string | undefined;
  const event = p.get("event");
  if (event !== null) {
    try {
      first = session.addWidget(JSON.parse(event) as StateEvent);
    } catch (e) {
      problem = `The ?event= parameter is not a widget state event: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { session, initialWidgetKey: p.get("autoload") === "1" && !problem ? first : undefined, problem };
}

/**
 * The widget host on the in-memory store instead of a login: the same `LoggedInView` as the logged-in
 * mode, on a `MemorySession`, with the store's controls in a side panel.
 */
export function MemoryView({ onLeft }: { onLeft: () => void }) {
  const [{ session, initialWidgetKey, problem }] = useState(start);
  const [options, setOptions] = useState<WidgetOptions>(() => ({ autoApprove: params().get("autoApprove") === "1", autoApproveOpenId: false, rememberCapabilities: false, devtoolsOpen: true }));

  useEffect(() => {
    seedDemoMedia(session.store).catch((e: unknown) => console.warn("seeding the demo media failed", e));
  }, [session]);

  return (
    <LoggedInView
      session={session}
      onLeft={onLeft}
      leaveLabel="Leave"
      initialRoomId={session.roomId}
      initialWidgetKey={initialWidgetKey}
      widgetOptions={options}
      sidePanel={<MemoryStorePanel session={session} options={options} onOptionsChange={setOptions} problem={problem} />}
    />
  );
}
