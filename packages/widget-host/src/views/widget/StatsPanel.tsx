import { useEffect, useState, type PointerEvent, type ReactNode } from "react";

import type { WidgetStats } from "../../appViewModel";
import { duration } from "./format";

export interface StatsPanelProps {
  stats: WidgetStats;
}

const number = (n: number) => n.toLocaleString("en-US");
/** Axis labels: `0`, `0.5k`, `1k` once the scale reaches thousands (as in the mockup), plain numbers below. */
const axis = (n: number, max: number) => (n === 0 ? "0" : max >= 1000 ? `${n / 1000}k` : String(n));

/** The largest "nice" step (1, 2, 2.5, 5 × 10ⁿ) that gives at most three steps up to `max`. */
function tickStep(max: number): number {
  const raw = Math.max(max, 1) / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((f) => f * pow).find((s) => s >= raw) ?? 10 * pow;
}

function Tile({ value, label, sub }: { value: ReactNode; label: string; sub?: string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** The run duration, ticking once per second while it is mounted. */
function RunDuration({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{duration(now - since)}</>;
}

/** WidgetDevToolStatsPanel: counters and the characters sent over the widget API per direction. leaf devtools/stats */
export function StatsPanel({ stats }: StatsPanelProps) {
  return (
    <div className="stats" data-testid="devtools-stats">
      <div className="stat-grid">
        <Tile value={number(stats.actionsFromWidget + stats.actionsToWidget)} label="actions sent" sub={`${number(stats.actionsFromWidget)} from widget · ${number(stats.actionsToWidget)} to widget`} />
        <Tile value={stats.runningSince === undefined ? "–" : <RunDuration since={stats.runningSince} />} label="run duration" sub={stats.runningSince === undefined ? "the widget is not ready yet" : "since notify_ready"} />
        <Tile value={number(stats.eventsSharedWithWidget)} label="events shared with the widget" />
        <Tile value={number(stats.eventsSentFromWidget)} label="events sent from the widget" />
      </div>
      <CharactersChart points={stats.characters} />
    </div>
  );
}

/**
 * Two lines (to widget: solid, from widget: dashed) over time. Only the lines are SVG and scale
 * with the panel; every text is HTML at a fixed size. The two colors have the same luminance, so
 * the dashes and the direct labels at the line ends carry the difference.
 */
function CharactersChart({ points }: { points: WidgetStats["characters"] }) {
  const [hover, setHover] = useState<number | undefined>();
  const n = points.length;
  const last = points[n - 1];
  const bucketS = n > 1 ? Math.round((last.timestamp - points[0].timestamp) / (n - 1) / 1000) : undefined;
  const title = (
    <span>
      Characters over the widget API{bucketS ? <i> per {bucketS} s</i> : null}
    </span>
  );

  if (n < 2) {
    return (
      <figure className="chart" aria-label="Characters sent over the widget API: no data yet.">
        <div className="chart-h">{title}</div>
        <p className="dt-empty">Nothing was measured yet. The graph is sampled while this panel is open.</p>
      </figure>
    );
  }

  const step = tickStep(Math.max(...points.map((p) => Math.max(p.toWidget, p.fromWidget))));
  const ticks = [0, step, 2 * step, 3 * step];
  const top = 3.2 * step;
  const X = (i: number) => (i * 100) / (n - 1);
  const Y = (v: number) => 100 - (v / top) * 100;
  const path = (key: "toWidget" | "fromWidget") => points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(2)} ${Y(p[key]).toFixed(2)}`).join("");
  const ago = (i: number) => Math.round((last.timestamp - points[i].timestamp) / 1000);

  // The direct labels at the line ends must not overlap: keep them at least 14% of the plot height apart.
  let endTo = Y(last.toWidget);
  let endFrom = Y(last.fromWidget);
  if (Math.abs(endTo - endFrom) < 14) {
    const mid = Math.min(93, Math.max(7, (endTo + endFrom) / 2));
    const toAbove = last.toWidget >= last.fromWidget;
    endTo = mid + (toAbove ? -7 : 7);
    endFrom = mid + (toAbove ? 7 : -7);
  }

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width > 0) setHover(Math.min(n - 1, Math.max(0, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))));
  };

  return (
    <figure
      className="chart"
      aria-label={`Characters sent over the widget API${bucketS ? ` per ${bucketS} seconds` : ""}, one line per direction. Last value: ${number(last.toWidget)} to the widget, ${number(last.fromWidget)} from the widget.`}
    >
      <div className="chart-h">
        {title}
        <span className="legend">
          <i className="sw s1" />
          to widget
          <i className="sw s2" />
          from widget
        </span>
      </div>
      <div className="plot">
        <div className="plot-y" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ top: `${Y(t)}%` }}>
              {axis(t, 3 * step)}
            </span>
          ))}
        </div>
        {/* TODO-FINDING chart-hover-only - the values of a point are shown on pointer hover only; keyboard and screen reader users get the visually hidden table below instead of a focusable chart */}
        <div className="plot-area" onPointerMove={onMove} onPointerLeave={() => setHover(undefined)}>
          {ticks.map((t) => (
            <i key={t} className="gridl" style={{ top: `${Y(t)}%` }} />
          ))}
          {hover !== undefined && <i className="cross" style={{ left: `${X(hover)}%` }} />}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="line s1" d={path("toWidget")} />
            <path className="line s2" d={path("fromWidget")} />
          </svg>
          {hover !== undefined && (
            <>
              <i className="pt s1" style={{ left: `${X(hover)}%`, top: `${Y(points[hover].toWidget)}%` }} />
              <i className="pt s2" style={{ left: `${X(hover)}%`, top: `${Y(points[hover].fromWidget)}%` }} />
              <div className={`tip ${X(hover) < 50 ? "after" : ""}`} style={X(hover) < 50 ? { left: `${X(hover)}%` } : { right: `${100 - X(hover)}%` }} aria-hidden="true">
                <span>{ago(hover) === 0 ? "now" : `${ago(hover)} s ago`}</span>
                <b>
                  <i className="pt s1" />
                  to widget {number(points[hover].toWidget)}
                </b>
                <b>
                  <i className="pt s2" />
                  from widget {number(points[hover].fromWidget)}
                </b>
              </div>
            </>
          )}
        </div>
        <div className="plot-end" aria-hidden="true">
          <span style={{ top: `${endTo}%` }}>to widget</span>
          <span style={{ top: `${endFrom}%` }}>from widget</span>
        </div>
        <div className="plot-x" aria-hidden="true">
          <span>-{ago(0)} s</span>
          <span>now</span>
        </div>
      </div>
      <table className="vh">
        <caption>Characters sent over the widget API{bucketS ? ` per ${bucketS} seconds` : ""}</caption>
        <thead>
          <tr>
            <th scope="col">Seconds ago</th>
            <th scope="col">To widget</th>
            <th scope="col">From widget</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.timestamp}>
              <th scope="row">{ago(i)}</th>
              <td>{p.toWidget}</td>
              <td>{p.fromWidget}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
