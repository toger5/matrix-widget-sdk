/**
 * The model of a `DockArea` and its pure transitions (unit tested in `test/dockLayout.test.ts`).
 *
 * A dock is a sequence of full-height columns: up to two side columns on the left, the center,
 * up to two side columns on the right. The center has one to three rows of items; side columns
 * only exist next to two or more rows:
 *
 *   ┌────┬────┬──────────────────────┬────┐
 *   │    │    │ row 0                │    │
 *   │ L0 │ L1 ├──────────────────────┤ R0 │
 *   │    │    │ row 1                │    │
 *   └────┴────┴──────────────────────┴────┘
 *
 * Limits (`withinLimits`): at most `MAX_ROWS` rows, `MAX_SIDE_ITEMS` items per side bar, and
 * `MAX_HORIZONTAL` items side by side: the widest row and all side items together. That is also
 * the width of the one row the side bars fold into when only one row is left, so a fold never
 * goes past the limit. Drops that would leave the limits are not offered (`allowedTargets`).
 *
 * Shares split the space between siblings: the items of a row its width, the rows the center's
 * height, the columns (side items and the center) the dock's width. A
 * share is only stored where there are siblings to split with (`normalize` deletes the others);
 * read it with `shareOf`. The layout only holds ids; the elements shown for them are the caller's
 * (`DockArea`'s `elements`).
 *
 * This folder is self-contained: it imports nothing of the app.
 */

export type DockItemId = string;

export interface DockItem {
  id: DockItemId;
  /** part of its row's width, or of the dock's width for a side column; only with siblings */
  share?: number;
  /** Items of one group accept each other: a drag of that group can be dropped "into" them (e.g. the room id). */
  group?: string;
}

export interface DockRow {
  /** part of the center's height; only with two or more rows */
  share?: number;
  /** left to right */
  items: DockItem[];
}

export interface DockCenter {
  /** part of the dock's width against the side columns; only with a side column */
  share?: number;
  /** 0 to `MAX_ROWS` rows, top to bottom; 0 only while the dock is empty */
  rows: DockRow[];
}

export interface DockLayout {
  center: DockCenter;
  /** 1 to `MAX_SIDE_ITEMS` full-height columns left of the center, left to right; only next to two or more rows (with one row left they fold into it). */
  left?: DockItem[];
  /** The same right of the center. */
  right?: DockItem[];
}

export type DockSide = "left" | "right";

/** Where a dragged item can go. Rows and indices refer to the layout as it is shown while dragging. */
export type DropTarget =
  /** an existing item of the same group: it takes the dragged item in (e.g. a tab joins a window of its room) */
  | { kind: "into"; itemId: DockItemId }
  /** a new item in a row, before the item at `index` (`index` = the row's length: at its end) */
  | { kind: "between"; row: number; index: number }
  /** a new row with the item, before the row at `index` (`index` = the number of rows: at the bottom) */
  | { kind: "newRow"; index: number }
  /** a new side column, before the side's column at `index` (left to right) */
  | { kind: "side"; side: DockSide; index: number };

/** A split between two neighbours that `Splitter` resizes. */
export type DockSplit =
  /** between the items `index` and `index + 1` of a row */
  | { kind: "items"; row: number; index: number }
  /** between the rows `index` and `index + 1` */
  | { kind: "rows"; index: number }
  /** between the columns `index` and `index + 1` of `[...left, center, ...right]` (`dockColumns`) */
  | { kind: "columns"; index: number };

export const MAX_ROWS = 3;
export const MAX_SIDE_ITEMS = 2;
/** Items side by side at most: the widest row plus all side items. */
export const MAX_HORIZONTAL = 6;
/** A new side column's share against the center's (one side column: about 29% of the width). */
export const SIDE_SHARE = 0.4;

export const emptyDock = (): DockLayout => ({ center: { rows: [] } });

/** The share of an item, row or the center; 1 where none is stored. */
export const shareOf = (x: { share?: number }): number => x.share ?? 1;

/** Grow factors of siblings from their shares: they add up to 1, so the siblings always fill their container. */
export function flexGrows(shares: number[]): number[] {
  const sum = shares.reduce((a, b) => a + b, 0);
  return sum > 0 ? shares.map((s) => s / sum) : shares.map(() => 1 / shares.length);
}

const SIDES = ["left", "right"] as const;
const validShare = (share: number | undefined) => (share !== undefined && Number.isFinite(share) && share > 0 ? share : 1);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 1);
const withoutShare = <T extends { share?: number }>(x: T): T => {
  const { share: _share, ...rest } = x;
  return rest as T;
};
/** Shares only between siblings: a single one has none, more have a valid one each. */
const pruneShares = <T extends { share?: number }>(list: T[]): T[] => (list.length < 2 ? list.map(withoutShare) : list.map((x) => ({ ...x, share: validShare(x.share) })));
const sideItems = (layout: DockLayout, side: DockSide): DockItem[] => layout[side] ?? [];

/** The columns of the dock, left to right: the left side items, the center, the right side items. */
export const dockColumns = (layout: DockLayout): { share?: number }[] => [...sideItems(layout, "left"), layout.center, ...sideItems(layout, "right")];

/** Every item of the layout: the left side columns, the rows top to bottom and left to right, the right side columns. */
export function dockItems(layout: DockLayout): DockItem[] {
  return [...sideItems(layout, "left"), ...layout.center.rows.flatMap((r) => r.items), ...sideItems(layout, "right")];
}

export const findItem = (layout: DockLayout, id: DockItemId): DockItem | undefined => dockItems(layout).find((i) => i.id === id);

/** Where an item is: its side or its row, and its index there. */
export function locateItem(layout: DockLayout, id: DockItemId): { side: DockSide; index: number } | { row: number; index: number } | undefined {
  for (const side of SIDES) {
    const index = sideItems(layout, side).findIndex((i) => i.id === id);
    if (index !== -1) return { side, index };
  }
  for (const [row, r] of layout.center.rows.entries()) {
    const index = r.items.findIndex((i) => i.id === id);
    if (index !== -1) return { row, index };
  }
  return undefined;
}

/** Items side by side: the widest row and all side items (the width of the row they would fold into). */
export const horizontalCount = (layout: DockLayout): number =>
  Math.max(0, ...layout.center.rows.map((r) => r.items.length)) + sideItems(layout, "left").length + sideItems(layout, "right").length;

export const withinLimits = (layout: DockLayout): boolean =>
  layout.center.rows.length <= MAX_ROWS && SIDES.every((s) => sideItems(layout, s).length <= MAX_SIDE_ITEMS) && horizontalCount(layout) <= MAX_HORIZONTAL;

/** The ids of a layout as they are arranged, without shares: two layouts that look the same compare equal. */
export const arrangement = (layout: DockLayout): string =>
  JSON.stringify([sideItems(layout, "left").map((i) => i.id), layout.center.rows.map((r) => r.items.map((i) => i.id)), sideItems(layout, "right").map((i) => i.id)]);

/**
 * Keep the invariants:
 * - no empty row or side;
 * - side columns only next to two or more rows: without rows they become the row, with one row they
 *   fold into it (left ones first, right ones last, every window as wide as before: `foldSides`;
 *   `MAX_HORIZONTAL` keeps that within the limit);
 * - shares only between siblings (`pruneShares`): the columns' with a side column, the rows' with
 *   two or more rows, the items' with two or more in a row.
 * It does not enforce the limits: the transitions only make layouts within them (`allowedTargets`).
 */
export function normalize(layout: DockLayout): DockLayout {
  let rows: DockRow[] = layout.center.rows.filter((r) => r.items.length > 0);
  let left = layout.left?.length ? layout.left : undefined;
  let right = layout.right?.length ? layout.right : undefined;
  if (rows.length <= 1 && (left || right)) {
    rows = [foldSides(rows[0] ?? { items: [] }, left ?? [], right ?? [], layout.center.share)];
    left = right = undefined;
  }
  rows = pruneShares(rows).map((r) => ({ ...r, items: pruneShares(r.items) }));

  const columns = pruneShares([...(left ?? []), { ...layout.center, rows }, ...(right ?? [])]);
  const l = left?.length ?? 0;
  const out: DockLayout = { center: columns[l] as DockCenter };
  if (left) out.left = columns.slice(0, l) as DockItem[];
  if (right) out.right = columns.slice(l + 1) as DockItem[];
  return out;
}

/**
 * The one row the side columns fold into, every window keeping its width. Before, a side column
 * is `share / S_cols` of the dock wide and a row item `center.share / S_cols · share / S_row`
 * (`S_cols`: all columns' shares, `S_row`: the row items' shares). In the folded row the row items
 * keep their shares, so a side column gets `share / center.share · S_row`. Without row items (no
 * rows left) the side columns keep their shares: the center had nothing to keep.
 */
function foldSides(row: DockRow, left: DockItem[], right: DockItem[], centerShare: number | undefined): DockRow {
  const rowSum = row.items.reduce((sum, i) => sum + shareOf(i), 0);
  const scale = row.items.length ? rowSum / validShare(centerShare) : 1;
  const fold = (side: DockItem[]) => side.map((i) => ({ ...i, share: round(validShare(i.share) * scale) }));
  return { ...row, items: [...fold(left), ...row.items, ...fold(right)] };
}

const withRows = (layout: DockLayout, rows: DockRow[]): DockLayout => ({ ...layout, center: { ...layout.center, rows } });
const insertInto = <T>(list: T[], index: number, value: T): T[] => {
  const out = [...list];
  out.splice(Math.max(0, Math.min(index, out.length)), 0, value);
  return out;
};

/**
 * Add an item at a target (`into` and a row that does not exist change nothing). It does not check
 * the limits: `allowedTargets` only offers targets whose result is within them.
 */
export function insertAt(layout: DockLayout, target: DropTarget, item: DockItem): DockLayout {
  const { rows } = layout.center;
  const bare = withoutShare(item);
  switch (target.kind) {
    case "into":
      return layout;
    case "between": {
      const row = rows[target.row];
      if (!row) return layout;
      // as wide as the others on average
      const items = insertInto(row.items, target.index, { ...bare, share: mean(row.items.map(shareOf)) });
      return normalize(withRows(layout, rows.map((r, i) => (i === target.row ? { ...r, items } : r))));
    }
    case "newRow":
      return normalize(withRows(layout, insertInto(rows, target.index, { share: mean(rows.map(shareOf)), items: [bare] })));
    case "side":
      return normalize({ ...layout, [target.side]: insertInto(sideItems(layout, target.side), target.index, { ...bare, share: shareOf(layout.center) * SIDE_SHARE }) });
  }
}

/** The layout without an item, before `normalize`: only its emptied row or side goes, nothing folds yet. */
function withoutItem(layout: DockLayout, id: DockItemId): DockLayout {
  const out = withRows(
    layout,
    layout.center.rows.map((r) => ({ ...r, items: r.items.filter((i) => i.id !== id) })).filter((r) => r.items.length > 0),
  );
  for (const side of SIDES) {
    const items = sideItems(out, side).filter((i) => i.id !== id);
    if (items.length) out[side] = items;
    else delete out[side];
  }
  return out;
}

/** Remove an item; its row or side goes when it was the last one (and the side columns may fold into the row left). */
export const removeItem = (layout: DockLayout, id: DockItemId): DockLayout => normalize(withoutItem(layout, id));

/**
 * Move an item of the layout to a target of the layout as it is shown (with the item still in its
 * old place): the target's row and index are adjusted for the item leaving. `into` removes it: the
 * target item took it in. A target that would leave the layout as it is changes nothing.
 */
export function moveItem(layout: DockLayout, id: DockItemId, target: DropTarget): DockLayout {
  const item = findItem(layout, id);
  const from = locateItem(layout, id);
  if (!item || !from) return layout;
  if (target.kind === "into") return target.itemId === id ? layout : removeItem(layout, id);
  // Inserted before normalizing: side columns folding into a row would move the indices of the target.
  const removed = withoutItem(layout, id);
  const fromRow = "row" in from ? from.row : -1;
  const rowGone = fromRow !== -1 && layout.center.rows[fromRow].items.length === 1;
  const shift = (index: number, sameList: boolean, fromIndex: number) => (sameList && fromIndex < index ? index - 1 : index);
  let adjusted: DropTarget;
  switch (target.kind) {
    case "between": {
      const sameRow = fromRow === target.row;
      if (sameRow && rowGone) return layout; // the row held only the item
      adjusted = { ...target, row: rowGone && fromRow < target.row ? target.row - 1 : target.row, index: shift(target.index, sameRow, from.index) };
      break;
    }
    case "newRow":
      adjusted = { ...target, index: rowGone && fromRow < target.index ? target.index - 1 : target.index };
      break;
    case "side": {
      const sameSide = "side" in from && from.side === target.side;
      adjusted = { ...target, index: removed[target.side] ? shift(target.index, sameSide, from.index) : 0 };
      break;
    }
  }
  const next = insertAt(removed, adjusted, item);
  return findItem(next, id) && arrangement(next) !== arrangement(layout) ? next : layout;
}

/** The two neighbours of a split, and how to write their shares back. */
function splitPair(layout: DockLayout, split: DockSplit): { pair: [{ share?: number }, { share?: number }]; write(a: number, b: number): DockLayout } | undefined {
  const { rows } = layout.center;
  const setPair = <T extends { share?: number }>(list: T[], i: number, a: number, b: number) => list.map((x, j) => (j === i ? { ...x, share: a } : j === i + 1 ? { ...x, share: b } : x));
  switch (split.kind) {
    case "items": {
      const items = rows[split.row]?.items;
      if (!items?.[split.index + 1]) return undefined;
      return {
        pair: [items[split.index], items[split.index + 1]],
        write: (a, b) => withRows(layout, rows.map((r, i) => (i === split.row ? { ...r, items: setPair(r.items, split.index, a, b) } : r))),
      };
    }
    case "rows":
      if (!rows[split.index + 1]) return undefined;
      return { pair: [rows[split.index], rows[split.index + 1]], write: (a, b) => withRows(layout, setPair(rows, split.index, a, b)) };
    case "columns": {
      const columns = dockColumns(layout);
      if (!columns[split.index + 1]) return undefined;
      const l = sideItems(layout, "left").length;
      return {
        pair: [columns[split.index], columns[split.index + 1]],
        write: (a, b) => {
          const next = setPair(columns, split.index, a, b);
          const out: DockLayout = { ...layout, center: next[l] as DockCenter };
          if (layout.left) out.left = next.slice(0, l) as DockItem[];
          if (layout.right) out.right = next.slice(l + 1) as DockItem[];
          return out;
        },
      };
    }
  }
}

/** The shares of the two sides of a split: [left or top, right or bottom]. */
export function splitShares(layout: DockLayout, split: DockSplit): [number, number] | undefined {
  const p = splitPair(layout, split);
  return p && [shareOf(p.pair[0]), shareOf(p.pair[1])];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Resize a split: the first (left or top) neighbour gets `fraction` of the two's common share, the
 * other one the rest; the other items keep their size.
 */
export function resizeSplit(layout: DockLayout, split: DockSplit, fraction: number): DockLayout {
  const p = splitPair(layout, split);
  if (!p) return layout;
  const total = shareOf(p.pair[0]) + shareOf(p.pair[1]);
  const a = round(total * Math.max(0.02, Math.min(0.98, fraction)));
  return p.write(a, round(total - a));
}

/** Double click / Enter on a splitter: equal neighbours, or a side column next to the center back to its default width. */
export function resetSplit(layout: DockLayout, split: DockSplit): DockLayout {
  const sideFraction = SIDE_SHARE / (1 + SIDE_SHARE);
  const l = sideItems(layout, "left").length;
  if (split.kind === "columns" && split.index === l - 1) return resizeSplit(layout, split, sideFraction); // last left column | center
  if (split.kind === "columns" && split.index === l && layout.right) return resizeSplit(layout, split, 1 - sideFraction); // center | first right column
  return resizeSplit(layout, split, 0.5);
}
