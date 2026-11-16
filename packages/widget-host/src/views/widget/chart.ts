/**
 * The pure parts of the stats graph (WidgetDevToolStatsPanel): buckets, axis and where a bar's number
 * goes. The mockup (`statsPanel` in design/src/components.mjs) uses the same numbers.
 */
import { MAX_STATS_BUCKETS, STATS_BUCKET_MS, type WidgetStats } from "../../appViewModel";

/** The three graphs: one per total of the selector. */
export type StatsSeries = "total" | "toWidget" | "fromWidget";
export type StatsBucket = WidgetStats["characters"][number];

/** A bar slot is at least this wide, so that a rotated number fits (12px line + the gap). */
export const MIN_SLOT_PX = 14;
/** The space between two bars. */
export const BAR_GAP_PX = 2;
/** The rotated number: a 12px line of 10px text, at most 6px per character, 3px from the bar and from the plot's edge. */
const LINE_PX = 12;
const CHAR_PX = 6;
const PAD_PX = 3;
/** The labels of the y axis stay at least this far apart. */
const Y_TICK_MIN_PX = 22;

/** `970`, `4.4k`, `12k`, `1.2M`: the numbers on the bars and on the y axis. */
export function compact(n: number): string {
  if (Math.round(n) < 1000) return String(Math.round(n));
  const [div, unit] = n < 999_500 ? [1000, "k"] : [1e6, "M"];
  const v = n / div;
  return `${+v.toFixed(v < 9.95 ? 1 : 0)}${unit}`;
}

export const valueOf = (b: StatsBucket, series: StatsSeries): number => (series === "total" ? b.toWidget + b.fromWidget : b[series]);

/** How many buckets the plot shows: as many as fit at `MIN_SLOT_PX` each, at most the ones the runtime keeps. */
export const barCount = (plotPx: number): number => Math.max(1, Math.min(MAX_STATS_BUCKETS, Math.floor(plotPx / MIN_SLOT_PX)));

/** The start of the bucket that contains `timestamp`. */
export const bucketOf = (timestamp: number): number => Math.floor(timestamp / STATS_BUCKET_MS) * STATS_BUCKET_MS;

/** The `count` buckets that end with the bucket `current`, oldest first; a bucket without traffic is 0. */
export function denseBuckets(points: StatsBucket[], current: number, count: number): StatsBucket[] {
  const known = new Map(points.map((p) => [p.timestamp, p]));
  return Array.from({ length: count }, (_, i) => {
    const timestamp = current - (count - 1 - i) * STATS_BUCKET_MS;
    return known.get(timestamp) ?? { timestamp, toWidget: 0, fromWidget: 0 };
  });
}

/**
 * The y axis: 0 and the multiples of the smallest "nice" step (1, 2, 2.5, 5 × 10ⁿ) that reach `max` in at most
 * four steps, fewer in a short plot so that the labels stay `Y_TICK_MIN_PX` apart. Steps are whole characters
 * (2.5 × 10ⁿ only from 25 on), so that every label is exact.
 */
export function yTicks(max: number, plotPx: number): number[] {
  const most = Math.max(1, Math.min(4, Math.floor(plotPx / Y_TICK_MIN_PX)));
  const m = Math.max(max, 1);
  for (let pow = Math.max(1, 10 ** Math.floor(Math.log10(m / most))); ; pow *= 10) {
    for (const f of [1, 2, 2.5, 5]) {
      if (!Number.isInteger(f * pow)) continue;
      const steps = Math.ceil(m / (f * pow));
      if (steps <= most) return Array.from({ length: steps + 1 }, (_, i) => i * f * pow);
    }
  }
}

/** Where the rotated number of a bar goes: above it if there is room up to the top of the plot, else inside it, else nowhere. */
export function numberPlace(value: number, barPx: number, plotPx: number, slotPx: number): "above" | "inside" | undefined {
  if (value <= 0 || slotPx < LINE_PX) return undefined;
  const length = compact(value).length * CHAR_PX + 2 * PAD_PX;
  if (plotPx - barPx >= length) return "above";
  if (barPx >= length && slotPx - BAR_GAP_PX >= LINE_PX) return "inside";
  return undefined;
}
