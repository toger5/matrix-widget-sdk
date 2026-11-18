/**
 * Where a drag can be dropped in a `DockArea` and which targets are near the pointer. Pure geometry
 * on measured rects (unit tested in `test/dockTargets.test.ts`).
 *
 * Every target has an element in the dock: `into` an item its cell, the others a gap (the space
 * between items, rows and columns, and at the edges). A shown target's gap opens to `DROP_SPACE`,
 * so the layout makes room for it; the rects are measured again on every move.
 */
import { arrangement, dockItems, insertAt, moveItem, withinLimits, type DockItemId, type DockLayout, type DropTarget } from "./dockLayout";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MeasuredTarget {
  target: DropTarget;
  /** unique per target: the `data-target` of its element, a React key, a test id */
  key: string;
  /** what the distance to the pointer is measured to: an area, or a line (zero width or height) */
  hit: Rect;
}

/** What is being dragged, as far as targets are concerned. */
export interface DragInfo {
  group?: string;
  /** dragging an item of the layout (a whole window): it moves */
  sourceId?: DockItemId;
  /** the item a dragged part comes from (a tab of a window): not an `into` target */
  originId?: DockItemId;
}

/** Gap between items, rows and columns, and the size of a gap opened for a shown target (px; also in dock.css). */
export const GAP = 8;
export const DROP_SPACE = 48;
/** Targets this near to the pointer are shown: their gap opens (dashed gray). */
export const SHOW_RADIUS = 320;
/** A shown target stays shown up to this much further away, so that opening gaps (which move the others) do not flicker. */
export const HYSTERESIS = 64;
/** At most this many targets are shown at once. */
export const MAX_SHOWN = 4;
/** The nearest target is active (blue) if it is this near; releasing elsewhere cancels. */
export const SNAP_RADIUS = 160;

export function targetKey(t: DropTarget): string {
  switch (t.kind) {
    case "into":
      return `into:${t.itemId}`;
    case "between":
      return `between:${t.row}:${t.index}`;
    case "newRow":
      return `newRow:${t.index}`;
    case "side":
      return `side:${t.side}:${t.index}`;
  }
}

const PROBE = "\u0000dock-probe";

/**
 * The targets of a drag. Every place is a candidate (`into` an item of the drag's group, the gaps
 * of the rows, a new row above, below and between the rows, and next to two or more rows a new side
 * column before, between and after the side's columns); one is kept if its result:
 * - is within the limits (`withinLimits`: rows, side columns, `MAX_HORIZONTAL`),
 * - changes the layout (not the gaps next to the dragged window, not the window itself),
 * - for a side target, has the item in that side (not folded into the one row left).
 */
export function allowedTargets(layout: DockLayout, drag: DragInfo): DropTarget[] {
  const { sourceId, originId, group } = drag;
  const { rows } = layout.center;
  const candidates: DropTarget[] = [];
  const range = (n: number) => Array.from({ length: n + 1 }, (_, i) => i);
  rows.forEach((row, r) => range(row.items.length).forEach((index) => candidates.push({ kind: "between", row: r, index })));
  range(rows.length).forEach((index) => candidates.push({ kind: "newRow", index }));
  if (rows.length >= 2) for (const side of ["left", "right"] as const) range(layout[side]?.length ?? 0).forEach((index) => candidates.push({ kind: "side", side, index }));

  const before = arrangement(layout);
  const id = sourceId ?? PROBE;
  const fits = (target: DropTarget) => {
    const result = sourceId !== undefined ? moveItem(layout, sourceId, target) : insertAt(layout, target, { id, ...(group === undefined ? {} : { group }) });
    if (!withinLimits(result) || arrangement(result) === before) return false;
    return target.kind !== "side" || !!result[target.side]?.some((i) => i.id === id);
  };
  const into: DropTarget[] = group === undefined ? [] : dockItems(layout).flatMap((i) => (i.id !== sourceId && i.id !== originId && i.group === group ? [{ kind: "into" as const, itemId: i.id }] : []));
  return [...into, ...candidates.filter(fits)];
}

/** No place is left for a new item (a tab dragged out of its window could only join another one): a window has to be closed first. */
export const isSaturated = (layout: DockLayout): boolean => allowedTargets(layout, {}).length === 0;

const inset = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, width: Math.max(0, r.width - 2 * d), height: Math.max(0, r.height - 2 * d) });

/**
 * The hit shape of each target, from the rects of the targets' elements (keyed by `targetKey`): a
 * gap is its whole rect; `into` the middle of its item, so that near the item's edges the gaps win.
 * Targets without a rect are left out.
 *
 * The distance to it is the shortest distance to the rect (`distanceToRect`, 0 inside): while the
 * pointer is level with a gap only one axis counts (x for the side gaps and the gaps of a row, y for
 * the new row gaps), so gaps stacked on top of each other go to the one the pointer is level with,
 * and in a corner the nearer axis wins.
 */
export function measureTargets(targets: DropTarget[], rects: Readonly<Record<string, Rect>>): MeasuredTarget[] {
  const out: MeasuredTarget[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    const r = rects[key];
    if (r) out.push({ target, key, hit: target.kind === "into" ? inset(r, Math.min(80, r.width / 4, r.height / 4)) : r });
  }
  return out;
}

/** Distance from a point to a rect (0 inside). */
export function distanceToRect(p: { x: number; y: number }, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/**
 * The targets to show for a pointer position, nearest first: within `SHOW_RADIUS` (the ones shown
 * before: `SHOW_RADIUS + HYSTERESIS`), at most `MAX_SHOWN`; and the active one, the nearest if
 * within `SNAP_RADIUS`.
 */
export function nearestTargets(
  measured: MeasuredTarget[],
  point: { x: number; y: number },
  shownBefore: ReadonlySet<string> = new Set(),
): { shown: MeasuredTarget[]; active?: MeasuredTarget } {
  const sorted = measured.map((m) => ({ m, d: distanceToRect(point, m.hit) })).sort((a, b) => a.d - b.d);
  const shown = sorted.filter((s) => s.d <= SHOW_RADIUS + (shownBefore.has(s.m.key) ? HYSTERESIS : 0)).slice(0, MAX_SHOWN);
  const first = sorted[0];
  return { shown: shown.map((s) => s.m), active: first && first.d <= SNAP_RADIUS ? first.m : undefined };
}
