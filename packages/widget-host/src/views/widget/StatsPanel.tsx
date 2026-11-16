import { Fragment, useCallback, useEffect, useLayoutEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { STATS_BUCKET_MS, type WidgetStats } from "../../appViewModel";
import { barCount, bucketOf, compact, denseBuckets, numberPlace, valueOf, yTicks, BAR_GAP_PX, type StatsSeries } from "./chart";
import { duration } from "./format";

export type { StatsSeries } from "./chart";

export interface StatsPanelProps {
  stats: WidgetStats;
  /** Story only: the graph shown first (default: total). */
  initialSeries?: StatsSeries;
}

const number = (n: number) => n.toLocaleString("en-US");

/** The three graphs, in the order of the selector. `cls` is the color of the bars and the swatch. */
const SERIES: { key: StatsSeries; cls: string; label: string; spoken: string }[] = [
  { key: "total", cls: "s0", label: "total", spoken: "both directions" },
  { key: "toWidget", cls: "s1", label: "to widget", spoken: "to the widget" },
  { key: "fromWidget", cls: "s2", label: "from widget", spoken: "from the widget" },
];

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

/** WidgetDevToolStatsPanel: counters and the characters sent over the widget API. stories `widget-devtools-stats--total`, `widget-devtools-stats--to-widget-docked-right` */
export function StatsPanel({ stats, initialSeries }: StatsPanelProps) {
  return (
    <div className="stats" data-testid="devtools-stats">
      <div className="stat-grid">
        <Tile value={number(stats.actionsFromWidget + stats.actionsToWidget)} label="actions sent" sub={`${number(stats.actionsFromWidget)} from widget · ${number(stats.actionsToWidget)} to widget`} />
        <Tile value={stats.runningSince === undefined ? "–" : <RunDuration since={stats.runningSince} />} label="run duration" sub={stats.runningSince === undefined ? "the widget is not ready yet" : "since notify_ready"} />
        <Tile value={number(stats.eventsSharedWithWidget)} label="events shared with the widget" />
        <Tile value={number(stats.eventsSentFromWidget)} label="events sent from the widget" />
      </div>
      <CharactersChart stats={stats} initialSeries={initialSeries} />
    </div>
  );
}

/**
 * The start of the current bucket, updated when the next one starts. The timer runs only while the chart is
 * mounted (its panel is open). It re-arms itself after every tick, so a tick that finds the same bucket (the
 * timer fired early, the clock was set back) does not stop the graph.
 */
function useCurrentBucket(): number {
  const [current, setCurrent] = useState(() => bucketOf(Date.now()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setCurrent(bucketOf(Date.now()));
      timer = setTimeout(tick, STATS_BUCKET_MS - (Date.now() % STATS_BUCKET_MS) + 20);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return current;
}

/**
 * The size of an element, kept up to date. It is measured before every paint that follows a render (a new
 * dock position or panel size re-renders the panel), so the bars never show a frame sized for the old
 * layout; the ResizeObserver covers the changes that do not render (the window is resized).
 */
function useSize(el: HTMLElement | null): { width: number; height: number } | undefined {
  const [size, setSize] = useState<{ width: number; height: number }>();
  const measure = useCallback(() => {
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setSize((s) => (s?.width === width && s.height === height ? s : { width, height }));
  }, [el]);
  useLayoutEffect(measure);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, measure]);
  return size;
}

/** The totals since the widget started; pressing one shows its graph. A radio group: the arrow keys move the selection. */
function SeriesSelect({ value, totals, onChange }: { value: StatsSeries; totals: Record<StatsSeries, number>; onChange: (series: StatsSeries) => void }) {
  const onKey = (e: KeyboardEvent<HTMLSpanElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const index = (SERIES.findIndex((s) => s.key === value) + step + SERIES.length) % SERIES.length;
    onChange(SERIES[index].key);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  };
  return (
    <span className="chart-sel" role="radiogroup" aria-label="Graph" onKeyDown={onKey}>
      {SERIES.map((s) => {
        const on = s.key === value;
        return (
          <button key={s.key} type="button" className={`chip sm ${on ? "on" : ""}`} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => onChange(s.key)}>
            <i className={`sw ${s.cls}`} />
            {s.label} <b>{number(totals[s.key])}</b>
          </button>
        );
      })}
    </span>
  );
}

/**
 * One bar per bucket of the selected series, the newest (the current bucket) at the right; as many as fit.
 * Every text is HTML at a fixed size. A bar's number is written along it where it fits (`numberPlace`); the
 * hover tooltip and the visually hidden table have every value.
 */
function CharactersChart({ stats, initialSeries }: { stats: WidgetStats; initialSeries?: StatsSeries }) {
  const [series, setSeries] = useState<StatsSeries>(initialSeries ?? "total");
  const [hover, setHover] = useState<number | undefined>();
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const size = useSize(area);
  const current = Math.max(useCurrentBucket(), stats.characters.at(-1)?.timestamp ?? 0);
  const { toWidget, fromWidget } = stats.charactersTotal;
  const { cls, label, spoken } = SERIES.find((s) => s.key === series)!;
  const per = STATS_BUCKET_MS / 1000;

  const header = (
    <div className="chart-h">
      <span className="chart-t">
        Characters over the widget API <i>per {per} s</i>
      </span>
      <SeriesSelect value={series} totals={{ total: toWidget + fromWidget, toWidget, fromWidget }} onChange={setSeries} />
    </div>
  );

  if (stats.characters.length === 0) {
    return (
      <figure className="chart" aria-label="Characters sent over the widget API: nothing yet.">
        {header}
        <p className="dt-empty">Nothing was sent over the widget API yet.</p>
      </figure>
    );
  }

  const n = size ? barCount(size.width) : 0;
  const buckets = denseBuckets(stats.characters, current, n);
  const values = buckets.map((b) => valueOf(b, series));
  const ticks = yTicks(Math.max(0, ...values), size?.height ?? 0);
  const top = ticks[ticks.length - 1] + 0.2 * ticks[1];
  const W = n ? 100 / n : 0;
  const H = (v: number) => (v / top) * 100;
  const slot = size && n ? size.width / n : 0;
  const ago = (b: { timestamp: number }) => (b.timestamp >= current ? "now" : `${duration(current - b.timestamp)} ago`);
  const span = duration(n * STATS_BUCKET_MS);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width > 0 && n > 0) setHover(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * n))));
  };
  const hovered = hover !== undefined && hover < n ? buckets[hover] : undefined;

  return (
    <figure className="chart" aria-label={`Characters sent over the widget API per ${per} seconds: ${spoken}, the last ${span}. Now: ${number(values[n - 1] ?? 0)}.`}>
      {header}
      <div className="plot">
        <div className="plot-y" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${H(t)}%` }}>
              {compact(t)}
            </span>
          ))}
        </div>
        {/* TODO-FINDING chart-hover-only - the value of a bar too small for its number is shown on pointer hover only; keyboard and screen reader users get the visually hidden table below instead of a focusable chart */}
        <div className="plot-area" ref={setArea} onPointerMove={onMove} onPointerLeave={() => setHover(undefined)} aria-hidden="true">
          {ticks.map((t) => (
            <i key={t} className="gridl" style={{ bottom: `${H(t)}%` }} />
          ))}
          {values.map((v, i) => {
            const place = size ? numberPlace(v, (H(v) / 100) * size.height, size.height, slot) : undefined;
            // Keyed by bucket: when the next bucket starts, only the oldest bar leaves and the new one is added.
            return (
              <Fragment key={buckets[i].timestamp}>
                <i className={`bar ${cls} ${i === hover ? "on" : ""}`} style={{ left: `${i * W}%`, width: `calc(${W}% - ${BAR_GAP_PX}px)`, height: `${H(v)}%` }} />
                {place && (
                  <span
                    className={`bar-n ${place === "inside" ? "in" : ""}`}
                    style={{ left: `calc(${(i + 0.5) * W}% - ${BAR_GAP_PX / 2}px)`, ...(place === "above" ? { bottom: `calc(${H(v)}% + 3px)` } : { top: `calc(${100 - H(v)}% + 3px)` }) }}
                  >
                    {compact(v)}
                  </span>
                )}
              </Fragment>
            );
          })}
          {hovered && hover !== undefined && (
            <div className="tip" style={hover < n / 2 ? { left: `calc(${(hover + 1) * W}% + 4px)` } : { right: `calc(${100 - hover * W}% + 4px)` }}>
              <span>{ago(hovered)}</span>
              <b>
                <i className="sw s1" />
                to widget {number(hovered.toWidget)}
              </b>
              <b>
                <i className="sw s2" />
                from widget {number(hovered.fromWidget)}
              </b>
              <b>
                <i className="sw s0" />
                total {number(hovered.toWidget + hovered.fromWidget)}
              </b>
            </div>
          )}
        </div>
        <div className="plot-x" aria-hidden="true">
          <span>-{span}</span>
          <span>now</span>
        </div>
      </div>
      <table className="vh">
        <caption>
          Characters sent over the widget API per {per} seconds, {label} selected
        </caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">To widget</th>
            <th scope="col">From widget</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.timestamp}>
              <th scope="row">{ago(b)}</th>
              <td>{b.toWidget}</td>
              <td>{b.fromWidget}</td>
              <td>{b.toWidget + b.fromWidget}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
