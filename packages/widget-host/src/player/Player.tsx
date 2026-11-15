import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import { clearCapabilities } from "./capabilityStore";
import { RoomView } from "./RoomView";
import type { LiveSession, RoomSummary } from "./session";
import type { WidgetOptions } from "./WidgetView";

interface Props {
  session: LiveSession;
  /** Called after `session.logout()` succeeded. */
  onLeft: () => void;
  /** Label of the button that ends the session. */
  leaveLabel?: string;
  /** An extra column on the right; the in-memory mode puts its store controls there. */
  sidePanel?: ReactNode;
  /** The room to open right away. */
  initialRoomId?: string;
  /** The widget (`widgetKey`) to open right away in `initialRoomId`. */
  initialWidgetKey?: string;
  widgetOptions?: WidgetOptions;
}

/** The main view of both modes: account, searchable room list, and the open room. */
export function Player({ session, onLeft, leaveLabel = "Log out", sidePanel, initialRoomId, initialWidgetKey, widgetOptions }: Props) {
  const rooms = useRooms(session);
  const [search, setSearch] = useState("");
  const [roomId, setRoomId] = useState<string | undefined>(initialRoomId);
  const [error, setError] = useState<string | undefined>();
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? rooms.filter((room) => room.name.toLowerCase().includes(term)) : rooms;
  }, [rooms, search]);
  const room = rooms.find((r) => r.id === roomId);

  const leave = () => {
    setError(undefined);
    const { userId } = session;
    session
      .logout()
      .then(() => clearCapabilities(userId))
      .then(onLeft, (e: unknown) => setError(`${leaveLabel} failed: ${e instanceof Error ? e.message : String(e)}`));
  };

  return (
    <div className={sidePanel ? "player with-side" : "player"}>
      <aside>
        <div className="account">
          <span className="muted">{session.userId}</span>
          <button onClick={leave}>{leaveLabel}</button>
        </div>
        {error && <div className="error">{error}</div>}
        <Verification session={session} />
        <input type="search" placeholder="Search rooms" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul className="rooms">
          {shown.map((r) => (
            <li key={r.id}>
              <button className={r.id === roomId ? "selected" : ""} onClick={() => setRoomId(r.id)}>
                {r.name}
              </button>
            </li>
          ))}
          {rooms.length === 0 && <li className="muted">No rooms yet (still syncing?)</li>}
        </ul>
      </aside>
      <main>
        {room ? (
          <RoomView
            key={room.id}
            session={session}
            room={room}
            initialWidgetKey={room.id === initialRoomId ? initialWidgetKey : undefined}
            widgetOptions={widgetOptions}
          />
        ) : (
          <div className="centered muted">Pick a room to see its widgets.</div>
        )}
      </main>
      {sidePanel && <section className="side">{sidePanel}</section>}
    </div>
  );
}

function useRooms(session: LiveSession): RoomSummary[] {
  // `rooms()` builds a new array each time, so cache it per change notification.
  const store = useMemo(() => {
    let current = session.rooms();
    return {
      subscribe: (onChange: () => void) =>
        session.onRoomsChanged(() => {
          current = session.rooms();
          onChange();
        }),
      get: () => current,
    };
  }, [session]);
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Asks for the recovery key while this device is unverified; other devices only share keys with verified ones. */
function Verification({ session }: { session: LiveSession }) {
  const [needed, setNeeded] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    session
      .needsVerification()
      .then((value) => !cancelled && setNeeded(value))
      .catch((e: unknown) => console.warn("checking the device verification failed", e));
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!needed) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    session
      .verifyWithRecoveryKey(key)
      .then(() => setNeeded(false))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  return (
    <form className="verification" onSubmit={submit}>
      <div>This device is not verified, so encrypted rooms may not decrypt. Enter your recovery key:</div>
      <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="EsTc …" autoComplete="off" required />
      <button disabled={busy}>{busy ? "Verifying…" : "Verify"}</button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
