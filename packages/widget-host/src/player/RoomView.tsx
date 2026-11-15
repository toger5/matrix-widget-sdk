import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveWidget, widgetKey, type ResolvedWidget, type StateEvent } from "../widgetStateEvent";
import type { LiveSession, RoomBackend, RoomSummary } from "./session";
import { WidgetView, type WidgetOptions } from "./WidgetView";

/** Where legacy widgets are loaded through; the compat wrapper's dev server by default. */
const WRAPPER_URL = new URLSearchParams(location.search).get("wrapper") ?? "http://localhost:5174/";

/** Numbers the backends handed to widget views; see `backend` below. */
let nextGeneration = 0;

interface Props {
  session: LiveSession;
  room: RoomSummary;
  /** The widget (`widgetKey`) to open right away. */
  initialWidgetKey?: string;
  widgetOptions?: WidgetOptions;
}

/** A room: the list of its widgets, and the one that is open. Used by the logged-in and the in-memory mode alike. */
export function RoomView({ session, room, initialWidgetKey, widgetOptions }: Props) {
  const [events, setEvents] = useState<StateEvent[] | undefined>();
  // `generation` changes with every backend, so a widget view never outlives the backend it was created on.
  const [backend, setBackend] = useState<{ backend: RoomBackend; generation: number } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [open, setOpen] = useState<string | undefined>(initialWidgetKey);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let created: RoomBackend | undefined;
    setBackend(undefined);
    setError(undefined);
    session
      .backendFor(room.id)
      .then((be) => {
        created = be;
        if (cancelled) return be.dispose();
        setBackend({ backend: be, generation: ++nextGeneration });
      })
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, [session, room.id, reload]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      session
        .widgets(room.id)
        .then((widgets) => !cancelled && setEvents(widgets))
        .catch((e: unknown) => !cancelled && setError(String(e)));
    setEvents(undefined);
    void load();
    const stop = session.onWidgetsChanged(room.id, () => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, [session, room.id, reload]);

  const widgets = useMemo(() => (events ?? []).map((event) => ({ key: widgetKey(event), ...resolve(event) })), [events]);
  const current = widgets.find((w) => w.key === open);
  const onNavigate = useCallback((uri: string) => {
    if (!window.confirm(`The widget wants to open:\n${uri}`)) throw new Error("the user refused to navigate");
    window.open(uri, "_blank", "noopener");
  }, []);

  return (
    <div className="room">
      <header>
        <h1>{room.name}</h1>
        <span className="muted">{room.id}</span>
        <span className="spacer" />
        <button onClick={() => setReload((n) => n + 1)}>Reload widgets</button>
      </header>
      {error && <div className="error">{error}</div>}
      {!events && !error && <div className="muted pad">Loading widgets…</div>}
      {events && widgets.length === 0 && <div className="muted pad">This room has no widgets.</div>}
      <ul className="widgets">
        {widgets.map((w) => (
          <li key={w.key}>
            <button className={w.key === open ? "selected" : ""} disabled={!w.widget} onClick={() => setOpen(w.key === open ? undefined : w.key)}>
              {w.widget?.name ?? w.key}
            </button>
            <span className="muted">{w.widget ? (w.widget.legacy ? "legacy" : "MSC4411") : w.problem}</span>
          </li>
        ))}
      </ul>
      {current?.widget && backend && (
        // Keyed by backend and URL: the iframe is reloaded whenever the driver has to be recreated.
        <WidgetView
          key={`${backend.generation}|${current.key}|${current.widget.url}`}
          widget={current.widget}
          backend={backend.backend}
          onNavigate={onNavigate}
          options={widgetOptions}
        />
      )}
    </div>
  );
}

function resolve(event: StateEvent): { widget?: ResolvedWidget; problem?: string } {
  try {
    return { widget: resolveWidget(event, WRAPPER_URL) };
  } catch (e) {
    return { problem: e instanceof Error ? e.message : String(e) };
  }
}
