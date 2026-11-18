/**
 * Playground of the DockArea (`npm run dock`): fake windows of three rooms, each with tabs.
 * - Drag a window by its header (the room name or the empty space): it moves, or joins a window of its room.
 * - Drag a tab: it becomes a new window, or joins a window of its room. A window without tabs closes.
 * Rendered in a shadow root with the app's stylesheet, as the widget host is (src/main.tsx).
 */
import { StrictMode, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";

import "../src/styles/fonts";
import css from "../src/styles/app.css?inline";
import { DockArea, type DockAreaHandle, type DragItem } from "../src/views/dock/DockArea";
import { dockItems, insertAt, removeItem, type DockItemId, type DockLayout } from "../src/dock/dockLayout";
import { allowedTargets } from "../src/dock/dockTargets";
import { dragChip, dragStarter } from "../src/views/dock/dragStart";
import playgroundCss from "./playground.css?inline";

type RoomKey = "design" | "ops" | "random";
const ROOMS: Record<RoomKey, { name: string; hue: number; tabs: string[] }> = {
  design: { name: "Design", hue: 265, tabs: ["Whiteboard", "Notes", "Call", "Polls"] },
  ops: { name: "Ops", hue: 160, tabs: ["Grafana", "Logs", "Pager"] },
  random: { name: "Random", hue: 25, tabs: ["Music", "Memes"] },
};

interface Win {
  id: DockItemId;
  room: RoomKey;
  tabs: string[];
  active: number;
}

const initial = (): { layout: DockLayout; wins: Record<DockItemId, Win> } => ({
  layout: {
    center: {
      rows: [
        {
          items: [
            { id: "w1", share: 1.4, group: "design" },
            { id: "w2", share: 1, group: "ops" },
            { id: "w3", share: 1, group: "design" },
          ],
        },
      ],
    },
  },
  wins: {
    w1: { id: "w1", room: "design", tabs: ["Whiteboard", "Notes"], active: 0 },
    w2: { id: "w2", room: "ops", tabs: ["Grafana", "Logs"], active: 0 },
    w3: { id: "w3", room: "design", tabs: ["Call"], active: 0 },
  },
});

let counter = 0;
const newId = () => `w-${(counter++).toString(36)}`;

/** The drag ghost: a chip with the room colour. */
const ghost = (room: RoomKey, label: string) => dragChip(label, ROOMS[room].hue);

/** A tab name no window has yet. */
function uniqueTab(name: string, wins: Record<DockItemId, Win>): string {
  const taken = new Set(Object.values(wins).flatMap((w) => w.tabs));
  let n = 1;
  let out = name;
  while (taken.has(out)) out = `${name} ${++n}`;
  return out;
}

function Playground() {
  const [{ layout, wins }, setState] = useState(initial);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [showJson, setShowJson] = useState(true);
  const [saturated, setSaturated] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const dock = useRef<DockAreaHandle>(null);
  // One container element per window, made once: the dock moves it, React renders the window into it (a portal).
  const containers = useRef(new Map<DockItemId, HTMLElement>());
  const containerFor = (id: DockItemId) => {
    let el = containers.current.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = "pg-host";
      containers.current.set(id, el);
    }
    return el;
  };
  // Windows emptied by a tab drop, removed when the dock reports the new layout (the provider's job). Filled in `drop`
  // itself, never in a state updater: the dock calls `onLayoutChange` right after `drop`, before React runs the updaters.
  const emptied = useRef(new Set<DockItemId>());
  const note = (line: string) => setLog((l) => [line, ...l].slice(0, 6));

  const onLayoutChange = (next: DockLayout) => {
    for (const id of emptied.current) next = removeItem(next, id);
    emptied.current.clear();
    const ids = new Set(dockItems(next).map((i) => i.id));
    for (const id of containers.current.keys()) if (!ids.has(id)) containers.current.delete(id);
    setState((s) => ({ layout: next, wins: Object.fromEntries(Object.entries(s.wins).filter(([id]) => ids.has(id))) }));
  };

  const roomDrag = (w: Win): DragItem => ({
    element: ghost(w.room, `${ROOMS[w.room].name} · ${w.tabs.length} tab${w.tabs.length === 1 ? "" : "s"}`),
    group: w.room,
    sourceId: w.id,
    cancel: () => note(`cancelled: window ${w.id}`),
    drop(target, itemId) {
      note(`window ${w.id} → ${JSON.stringify(target)}`);
      if (target.kind === "into") {
        setState((s) => {
          const into = s.wins[itemId];
          return { ...s, wins: { ...s.wins, [itemId]: { ...into, tabs: [...into.tabs, ...w.tabs], active: into.tabs.length } } };
        });
      }
      return containerFor(itemId);
    },
  });

  const tabDrag = (w: Win, tab: string): DragItem => ({
    element: ghost(w.room, tab),
    group: w.room,
    cancel: () => note(`cancelled: tab ${tab}`),
    drop(target, itemId) {
      note(`tab ${tab} → ${JSON.stringify(target)} as ${itemId}`);
      // its last tab left (dropped into its own window, it stays)
      const intoItself = target.kind === "into" && itemId === w.id;
      if (w.tabs.length === 1 && !intoItself) emptied.current.add(w.id);
      setState((s) => {
        const source = s.wins[w.id];
        const tabs = source.tabs.filter((t) => t !== tab);
        const wins = { ...s.wins, [w.id]: { ...source, tabs, active: Math.min(source.active, Math.max(0, tabs.length - 1)) } };
        if (target.kind === "into") {
          const into = wins[itemId];
          wins[itemId] = { ...into, tabs: [...into.tabs, tab], active: into.tabs.length };
        } else {
          wins[itemId] = { id: itemId, room: w.room, tabs: [tab], active: 0 };
        }
        return { ...s, wins };
      });
      return containerFor(itemId);
    },
  });

  const closeWin = (id: DockItemId) => onLayoutChange(removeItem(layout, id));

  const addTarget = useMemo(() => {
    const targets = allowedTargets(layout, {}).filter((t) => t.kind !== "into");
    const { rows } = layout.center;
    return targets.find((t) => t.kind === "between" && t.row === rows.length - 1 && t.index === rows[t.row].items.length) ?? targets.find((t) => t.kind === "newRow" && t.index === rows.length) ?? targets[0];
  }, [layout]);
  const addWindow = () => {
    if (!addTarget) return;
    const keys = Object.keys(ROOMS) as RoomKey[];
    const room = keys[Object.keys(wins).length % keys.length];
    const id = newId();
    const tab = uniqueTab(ROOMS[room].tabs[Math.floor(Math.random() * ROOMS[room].tabs.length)], wins);
    setState((s) => ({ layout: insertAt(s.layout, addTarget, { id, group: room }), wins: { ...s.wins, [id]: { id, room, tabs: [tab], active: 0 } } }));
  };

  // the theme tokens are on `[data-theme]`: the document (page background) and the shadow tree
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="pg" data-theme={theme}>
      <header className="pg-bar">
        <b>DockArea playground</b>
        <span className="muted">drag a window header or a tab · Esc cancels</span>
        <span className="sp" />
        {saturated && <span className="pg-full">Dock is full: close a window first</span>}
        <button className="btn sm" onClick={addWindow} disabled={!addTarget}>
          Add window
        </button>
        <button className="btn sm" onClick={() => setState(initial())}>
          Reset
        </button>
        <button className="btn sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Light" : "Dark"} theme
        </button>
        <button className="btn sm" onClick={() => setShowJson(!showJson)}>
          {showJson ? "Hide" : "Show"} layout
        </button>
      </header>
      <div className="pg-main">
        <DockArea ref={dock} layout={layout} elements={containers.current} onLayoutChange={onLayoutChange} newId={newId} minItemWidth={140} minItemHeight={120} onSaturatedChange={setSaturated} />
        {showJson && (
          <aside className="pg-json">
            <pre>{JSON.stringify(layout, null, 2)}</pre>
            <ol>{log.map((l, i) => <li key={i}>{l}</li>)}</ol>
          </aside>
        )}
      </div>
      {Object.values(wins).map((w) =>
        createPortal(
          <Window
            win={w}
            onRoomDrag={dragStarter(dock, () => roomDrag(w), "button.pg-x")}
            onTabDrag={(tab) => dragStarter(dock, () => ({ ...tabDrag(w, tab), originId: w.id }))}
            onActivate={(i) => setState((s) => (s.wins[w.id] ? { ...s, wins: { ...s.wins, [w.id]: { ...s.wins[w.id], active: i } } } : s))}
            onClose={() => closeWin(w.id)}
          />,
          containerFor(w.id),
          w.id,
        ),
      )}
    </div>
  );
}

function Window({ win, onRoomDrag, onTabDrag, onActivate, onClose }: { win: Win; onRoomDrag: (e: ReactPointerEvent<HTMLElement>) => void; onTabDrag: (tab: string) => (e: ReactPointerEvent<HTMLElement>) => void; onActivate: (i: number) => void; onClose: () => void }) {
  const room = ROOMS[win.room];
  const tab = win.tabs[win.active];
  // A real iframe: shows that the drag overlay keeps the pointer away from it, and that it reloads when its window moves
  // (the widget host avoids that with <slot>s).
  const loadedAt = useMemo(() => new Date().toLocaleTimeString(), [win.id]);
  return (
    <section className="pg-win" style={{ "--hue": room.hue } as CSSProperties} data-window={win.id}>
      <header className="pg-head" onPointerDown={onRoomDrag} title="Drag to move the window">
        <span className="pg-room">
          <i />
          {room.name}
        </span>
        <span className="pg-tabs">
          {win.tabs.map((t, i) => (
            <span
              key={t}
              className={`pg-tab ${i === win.active ? "active" : ""}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onTabDrag(t)(e);
              }}
              onClick={() => onActivate(i)}
              title="Drag the tab"
            >
              {t}
            </span>
          ))}
        </span>
        <span className="sp" />
        <button className="pg-x" onClick={onClose} aria-label="Close window">
          ×
        </button>
      </header>
      <div className="pg-body">
        <h2>{tab}</h2>
        <p className="muted">
          {room.name} · window {win.id} · rendered {loadedAt}
        </p>
        <iframe title={`${tab} iframe`} srcDoc={`<body style="margin:0;font:12px system-ui;color:#888;display:grid;place-items:center;height:100vh">iframe loaded ${new Date().toLocaleTimeString()}</body>`} />
      </div>
    </section>
  );
}

const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
const pgSheet = new CSSStyleSheet();
pgSheet.replaceSync(playgroundCss);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
const host = document.getElementById("root")!;
const shadow = host.attachShadow({ mode: "open" });
shadow.adoptedStyleSheets = [sheet, pgSheet];
const mount = document.createElement("div");
mount.className = "pg-mount";
shadow.append(mount);
createRoot(mount).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
