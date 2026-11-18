import { describe, expect, it } from "vitest";

import { emptyDock, insertAt, MAX_HORIZONTAL, moveItem, withinLimits, type DockItem, type DockLayout } from "../src/views/dock/dockLayout";
import {
  allowedTargets,
  distanceToRect,
  DROP_SPACE,
  GAP,
  HYSTERESIS,
  isSaturated,
  MAX_SHOWN,
  measureTargets,
  nearestTargets,
  SHOW_RADIUS,
  targetKey,
  type MeasuredTarget,
  type Rect,
} from "../src/views/dock/dockTargets";

const item = (id: string, group?: string): DockItem => ({ id, ...(group ? { group } : {}) });
const keys = (layout: DockLayout, drag = {}) => allowedTargets(layout, drag).map(targetKey);

/** A layout from item ids: `dock([["a", "b"], ["c"]], { right: ["r"] })`. */
const dock = (rows: string[][], sides: { left?: string[]; right?: string[] } = {}): DockLayout => ({
  center: { rows: rows.map((ids) => ({ items: ids.map((id) => item(id)) })) },
  ...(sides.left ? { left: sides.left.map((id) => item(id)) } : {}),
  ...(sides.right ? { right: sides.right.map((id) => item(id)) } : {}),
});

describe("allowedTargets", () => {
  it("an empty dock: one new row", () => {
    expect(keys(emptyDock())).toEqual(["newRow:0"]);
  });

  it("one row: the gaps of the row and a row above and below; no sides", () => {
    expect(keys(dock([["a", "b"]]))).toEqual(["between:0:0", "between:0:1", "between:0:2", "newRow:0", "newRow:1"]);
  });

  it(`a row of ${MAX_HORIZONTAL} has no gaps, unless the dragged window is in it`, () => {
    const full = dock([["a", "b", "c", "d", "e", "f"]]);
    expect(keys(full)).toEqual(["newRow:0", "newRow:1"]);
    // a's own gaps (0 and 1) would not change anything
    expect(keys(full, { sourceId: "a" })).toEqual(["between:0:2", "between:0:3", "between:0:4", "between:0:5", "between:0:6", "newRow:0", "newRow:1"]);
  });

  it("two rows: new rows above, between and below; side columns before and after the existing ones", () => {
    expect(keys(dock([["a"], ["b"]], { left: ["l"] }))).toEqual([
      "between:0:0",
      "between:0:1",
      "between:1:0",
      "between:1:1",
      "newRow:0",
      "newRow:1",
      "newRow:2",
      "side:left:0",
      "side:left:1",
      "side:right:0",
    ]);
  });

  it("three rows: no new row; a side with two columns: no third", () => {
    expect(keys(dock([["a"], ["b"], ["c"]])).filter((k) => k.startsWith("newRow"))).toEqual([]);
    expect(keys(dock([["a"], ["b"]], { left: ["l1", "l2"] })).filter((k) => k.startsWith("side:left:"))).toEqual([]);
    // but its columns can swap
    expect(keys(dock([["a"], ["b"]], { left: ["l1", "l2"] }), { sourceId: "l1" }).filter((k) => k.startsWith("side:left:"))).toEqual(["side:left:2"]);
  });

  it("`into` the items of the drag's group, but not the dragged one", () => {
    const l: DockLayout = { center: { rows: [{ items: [item("a", "r1"), item("b", "r2"), item("c", "r1")] }] } };
    expect(keys(l, { group: "r1" }).filter((k) => k.startsWith("into"))).toEqual(["into:a", "into:c"]);
    expect(keys(l, { group: "r1", sourceId: "a" }).filter((k) => k.startsWith("into"))).toEqual(["into:c"]);
    expect(keys(l).filter((k) => k.startsWith("into"))).toEqual([]);
  });

  it("a window moved to a side must stay a side column: not when it would fold into the one row left", () => {
    const sides = (l: DockLayout, sourceId: string) => keys(l, { sourceId }).filter((k) => k.startsWith("side"));
    expect(sides(dock([["a"], ["b"]]), "a")).toEqual([]);
    expect(sides(dock([["a"], ["b", "c", "d"]]), "a")).toEqual([]);
    expect(sides(dock([["a", "x"], ["b"]]), "a")).toEqual(["side:left:0", "side:right:0"]);
  });

  it(`nothing goes past ${MAX_HORIZONTAL} side by side (4 + 1 rows, one left and one right column)`, () => {
    const l = dock([["a", "b", "c", "d"], ["e"]], { left: ["l"], right: ["r"] });
    // e: not into the top row (7), not to a side (it would fold into the one row left); only a new row above
    expect(keys(l, { sourceId: "e" })).toEqual(["newRow:0"]);
    // a new item: the bottom row and new rows, nothing wider
    expect(keys(l)).toEqual(["between:1:0", "between:1:1", "newRow:0", "newRow:1", "newRow:2"]);
    for (const sourceId of [undefined, "a", "e", "l", "r"]) {
      for (const target of allowedTargets(l, { sourceId })) {
        const result = sourceId ? moveItem(l, sourceId, target) : insertAt(l, target, item("new"));
        expect(withinLimits(result), `${sourceId} → ${targetKey(target)}`).toBe(true);
      }
    }
  });

  it("the only window of the only row cannot go to a new row (it would look the same)", () => {
    expect(keys(dock([["a"]]), { sourceId: "a" })).toEqual([]);
  });
});

describe("isSaturated", () => {
  it("when no place is left for a new window", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(isSaturated(dock([six, six.map((x) => `${x}2`), six.map((x) => `${x}3`)]))).toBe(true);
    expect(isSaturated(dock([six, ["g"]]))).toBe(false);
    expect(isSaturated(dock([["a"]]))).toBe(false);
  });
});

/** Two items side by side in one row, 400 x 600 each, with the 8px splitter between them; the gaps as they are before they open. */
const W = 400;
const H = 600;
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const oneRow: DockLayout = { center: { rows: [{ items: [item("a", "g"), item("b")] }] } };
const oneRowRects: Record<string, Rect> = {
  "into:a": rect(0, 0, W, H),
  "into:b": rect(W + GAP, 0, W, H),
  "between:0:0": rect(0, 0, 0, H),
  "between:0:1": rect(W, 0, GAP, H),
  "between:0:2": rect(2 * W + GAP, 0, 0, H),
  "newRow:0": rect(0, 0, 2 * W + GAP, 0),
  "newRow:1": rect(0, H, 2 * W + GAP, 0),
};

describe("measureTargets / nearestTargets", () => {
  const measured = measureTargets(allowedTargets(oneRow, { group: "g" }), oneRowRects);
  const at = (x: number, y: number) => nearestTargets(measured, { x, y });

  it("measures every allowed target that has an element", () => {
    expect(measured.map((m) => m.key).sort()).toEqual(["between:0:0", "between:0:1", "between:0:2", "into:a", "newRow:0", "newRow:1"]);
  });

  it("the middle of an item of the group is `into`; near its edge the gap wins", () => {
    expect(at(W / 2, H / 2).active?.key).toBe("into:a");
    expect(at(W - 10, H / 2).active?.key).toBe("between:0:1");
    expect(at(10, H / 2).active?.key).toBe("between:0:0");
  });

  it("near the top or bottom edge: a new row", () => {
    expect(at(W / 2, 4).active?.key).toBe("newRow:0");
    expect(at(W / 2, H - 4).active?.key).toBe("newRow:1");
  });

  it("far from every target: some shown, none active", () => {
    const far = at(W + GAP + W / 2, H / 2); // the middle of b, which is not of the group
    expect(far.active).toBeUndefined();
    expect(far.shown.map((m) => m.key)).toContain("between:0:1");
  });

  it("an open gap under the pointer is at distance 0", () => {
    const open = measureTargets(allowedTargets(oneRow, {}), { ...oneRowRects, "between:0:1": rect(W, 0, DROP_SPACE, H) });
    expect(nearestTargets(open, { x: W + 30, y: H / 2 }).active?.key).toBe("between:0:1");
  });
});

describe("shown targets", () => {
  const line = (key: string, x: number): MeasuredTarget => ({ key, target: { kind: "into", itemId: key }, hit: rect(x, 0, 0, 100) });

  it("a target shown before stays shown a little further away", () => {
    const m = [line("k", 0)];
    const p = { x: SHOW_RADIUS + HYSTERESIS / 2, y: 50 };
    expect(nearestTargets(m, p).shown).toEqual([]);
    expect(nearestTargets(m, p, new Set(["k"])).shown.map((s) => s.key)).toEqual(["k"]);
    expect(nearestTargets(m, { x: SHOW_RADIUS + HYSTERESIS + 1, y: 50 }, new Set(["k"])).shown).toEqual([]);
  });

  it("shows at most MAX_SHOWN, the nearest first", () => {
    const m = [5, 1, 4, 2, 6, 3].map((x) => line(`t${x}`, x));
    expect(nearestTargets(m, { x: 0, y: 50 }).shown.map((s) => s.key)).toEqual(["t1", "t2", "t3", "t4"].slice(0, MAX_SHOWN));
  });
});

describe("shortest distance to the rect: one axis while level with it", () => {
  it("in a corner the nearer axis wins", () => {
    const measured = measureTargets(allowedTargets(oneRow, {}), oneRowRects);
    expect(nearestTargets(measured, { x: 6, y: 3 }).active?.key).toBe("newRow:0");
    expect(nearestTargets(measured, { x: 3, y: 6 }).active?.key).toBe("between:0:0");
  });

  /** Two rows of two items in a 1000 x 760 dock, the rows split at 376..384. */
  const twoByTwo: DockLayout = { center: { rows: [{ items: [item("a"), item("b")] }, { items: [item("c"), item("d")] }] } };
  const targets = allowedTargets(twoByTwo, {});
  const rows = (r: number) => (r === 0 ? { y: 0, height: 376 } : { y: 384, height: 376 });
  const gap = (r: number, x: number, width = 0) => rect(x, rows(r).y, width, rows(r).height);

  it("before the spaces open, the end gap of the row the pointer is level with is nearer than the other row's", () => {
    const collapsed = measureTargets(targets, { "side:right:0": rect(1000, 0, 0, 760), "between:0:2": gap(0, 1000), "between:1:2": gap(1, 1000) });
    const keys = nearestTargets(collapsed, { x: 995, y: 600 }).shown.map((m) => m.key);
    expect(keys.indexOf("between:1:2")).toBeLessThan(keys.indexOf("between:0:2"));
  });

  // The right side space open at the outer edge, the end spaces of the rows next to it.
  const open = measureTargets(targets, {
    "side:left:0": rect(0, 0, 0, 760),
    "side:right:0": rect(1000 - DROP_SPACE, 0, DROP_SPACE, 760),
    "between:0:0": gap(0, 0),
    "between:0:1": gap(0, 450, GAP),
    "between:0:2": gap(0, 1000 - 2 * DROP_SPACE, DROP_SPACE),
    "between:1:0": gap(1, 0),
    "between:1:1": gap(1, 450, GAP),
    "between:1:2": gap(1, 1000 - 2 * DROP_SPACE, DROP_SPACE),
  });
  const at = (x: number, y: number) => nearestTargets(open, { x, y }).active?.key;

  it("the open side space is active anywhere along its height, corners included", () => {
    expect(at(976, 10)).toBe("side:right:0");
    expect(at(976, 380)).toBe("side:right:0");
    expect(at(995, 755)).toBe("side:right:0");
  });

  it("over a row's open end space, that row's", () => {
    expect(at(928, 100)).toBe("between:0:2");
    expect(at(928, 600)).toBe("between:1:2");
  });

  it("a pointer far down a tall side gap, level with it, is near it (only x counts)", () => {
    const tall = measureTargets([{ kind: "side", side: "right", index: 0 }], { "side:right:0": rect(1000, 0, 0, 2000) });
    expect(nearestTargets(tall, { x: 700, y: 1950 }).shown.map((m) => m.key)).toEqual(["side:right:0"]);
  });
});

describe("distanceToRect", () => {
  it("is 0 inside and euclidean outside", () => {
    expect(distanceToRect({ x: 5, y: 5 }, rect(0, 0, 10, 10))).toBe(0);
    expect(distanceToRect({ x: 13, y: 14 }, rect(0, 0, 10, 10))).toBe(5);
  });
});
