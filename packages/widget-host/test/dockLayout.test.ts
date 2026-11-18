import { describe, expect, it } from "vitest";

import {
  dockColumns,
  dockItems,
  emptyDock,
  flexGrows,
  horizontalCount,
  insertAt,
  MAX_HORIZONTAL,
  moveItem,
  normalize,
  removeItem,
  resetSplit,
  resizeSplit,
  shareOf,
  SIDE_SHARE,
  withinLimits,
  type DockItem,
  type DockLayout,
} from "../src/views/dock/dockLayout";

const item = (id: string, group?: string): DockItem => ({ id, ...(group ? { group } : {}) });
/** A layout from item ids, without shares: `dock([["a", "b"], ["c"]], { right: ["r"] })`. */
const dock = (rows: string[][], sides: { left?: string[]; right?: string[] } = {}): DockLayout => ({
  center: { rows: rows.map((ids) => ({ items: ids.map((id) => item(id)) })) },
  ...(sides.left ? { left: sides.left.map((id) => item(id)) } : {}),
  ...(sides.right ? { right: sides.right.map((id) => item(id)) } : {}),
});
/** Each window's width as a fraction of the dock: the side columns and the items of one row. */
function widths(l: DockLayout, row = 0): Record<string, number> {
  const columns = dockColumns(l).map(shareOf);
  const sum = columns.reduce((a, b) => a + b, 0);
  const items = l.center.rows[row]?.items ?? [];
  const rowSum = items.reduce((a, i) => a + shareOf(i), 0);
  const out: Record<string, number> = {};
  for (const i of [...(l.left ?? []), ...(l.right ?? [])]) out[i.id] = shareOf(i) / sum;
  for (const i of items) out[i.id] = (shareOf(l.center) / sum) * (shareOf(i) / rowSum);
  return out;
}
const expectSameWidths = (before: Record<string, number>, after: Record<string, number>) => {
  for (const id of Object.keys(before)) expect(after[id], id).toBeCloseTo(before[id], 3);
};
const ids = (l: DockLayout) => ({ left: l.left?.map((i) => i.id), rows: l.center.rows.map((r) => r.items.map((i) => i.id)), right: l.right?.map((i) => i.id) });

describe("insertAt", () => {
  it("starts an empty dock with a row, without shares", () => {
    expect(insertAt(emptyDock(), { kind: "newRow", index: 0 }, item("a"))).toEqual({ center: { rows: [{ items: [{ id: "a" }] }] } });
  });

  it("inserts between items, with the mean share of the row", () => {
    const l: DockLayout = { center: { rows: [{ items: [{ id: "a", share: 1 }, { id: "b", share: 3 }] }] } };
    const out = insertAt(l, { kind: "between", row: 0, index: 1 }, item("x"));
    expect(ids(out).rows).toEqual([["a", "x", "b"]]);
    expect(out.center.rows[0].items[1].share).toBe(2);
  });

  it("gives the first item of a row a share when the second one comes", () => {
    expect(insertAt(dock([["a"]]), { kind: "between", row: 0, index: 1 }, item("x")).center.rows[0].items).toEqual([
      { id: "a", share: 1 },
      { id: "x", share: 1 },
    ]);
  });

  it("adds a row at the top, between rows and at the bottom", () => {
    const top = insertAt(dock([["a"]]), { kind: "newRow", index: 0 }, item("x"));
    expect(ids(top).rows).toEqual([["x"], ["a"]]);
    expect(top.center.rows.map((r) => r.share)).toEqual([1, 1]);
    expect(ids(insertAt(dock([["a"], ["b"]]), { kind: "newRow", index: 1 }, item("x"))).rows).toEqual([["a"], ["x"], ["b"]]);
    expect(ids(insertAt(dock([["a"], ["b"]]), { kind: "newRow", index: 2 }, item("x"))).rows).toEqual([["a"], ["b"], ["x"]]);
  });

  it("adds full-height side columns; the columns get shares", () => {
    const one = insertAt(dock([["a"], ["b"]]), { kind: "side", side: "right", index: 0 }, item("x"));
    expect(ids(one)).toEqual({ rows: [["a"], ["b"]], right: ["x"] });
    expect([one.center.share, one.right?.[0].share]).toEqual([1, SIDE_SHARE]);
    const two = insertAt(one, { kind: "side", side: "right", index: 0 }, item("y"));
    expect(ids(two).right).toEqual(["y", "x"]);
  });

  it("`into` changes nothing", () => {
    const l = dock([["a"]]);
    expect(insertAt(l, { kind: "into", itemId: "a" }, item("x"))).toBe(l);
  });
});

describe("normalize: shares only between siblings", () => {
  it("deletes the center's share without side columns, a lone row's and a lone item's", () => {
    const out = normalize({ center: { share: 0.897, rows: [{ share: 0.735, items: [{ id: "a", share: 1.4 }] }] } });
    expect(out).toEqual({ center: { rows: [{ items: [{ id: "a" }] }] } });
  });

  it("keeps the shares of siblings and fixes invalid ones", () => {
    const out = normalize({
      center: { share: -1, rows: [{ share: 0, items: [{ id: "a", share: Number.NaN }, { id: "b", share: 2 }] }, { share: 3, items: [{ id: "c" }] }] },
      left: [{ id: "l" }],
    });
    expect([out.left?.[0].share, out.center.share]).toEqual([1, 1]);
    expect(out.center.rows.map((r) => r.share)).toEqual([1, 3]);
    expect(out.center.rows[0].items.map((i) => i.share)).toEqual([1, 2]);
    expect(out.center.rows[1].items[0]).toEqual({ id: "c" });
  });

  it("removing the side column after a resize leaves no center share (the center fills the dock again)", () => {
    const resized = resizeSplit(normalize(dock([["a"], ["b"]], { right: ["r"] })), { kind: "columns", index: 0 }, 0.6);
    expect(resized.center.share).not.toBe(1);
    const out = removeItem(resized, "r");
    expect(out.center.share).toBeUndefined();
    expect(out.center.rows.map((r) => r.share)).toEqual([1, 1]);
  });

  it("the row left after the others go has no share", () => {
    const resized = resizeSplit(dock([["a"], ["b"]]), { kind: "rows", index: 0 }, 0.7);
    expect(removeItem(resized, "a").center.rows).toEqual([{ items: [{ id: "b" }] }]);
  });
});

describe("normalize: side columns only next to two or more rows", () => {
  it("without rows, the side columns become the row", () => {
    expect(ids(normalize(dock([], { left: ["l"], right: ["r"] })))).toEqual({ rows: [["l", "r"]] });
  });

  it("with one row left, the side columns fold into it: left ones first, right ones last", () => {
    const out = removeItem(dock([["a"], ["b"]], { left: ["l1", "l2"], right: ["r1", "r2"] }), "a");
    expect(ids(out)).toEqual({ rows: [["l1", "l2", "b", "r1", "r2"]] });
    expect(out.center.share).toBeUndefined();
  });

  it("the fold keeps every window's width", () => {
    const before: DockLayout = {
      center: { share: 1, rows: [{ share: 1, items: [{ id: "a", share: 1 }, { id: "b", share: 3 }] }, { share: 1, items: [{ id: "c" }] }] },
      left: [{ id: "l", share: 0.4 }],
      right: [{ id: "r", share: 0.6 }],
    };
    const out = removeItem(before, "c");
    expect(out).toEqual({ center: { rows: [{ items: [{ id: "l", share: 1.6 }, { id: "a", share: 1 }, { id: "b", share: 3 }, { id: "r", share: 2.4 }] }] } });
    expectSameWidths(widths(before), widths(out));
  });

  it("without rows left, the side columns keep their shares (they take the center's width in proportion)", () => {
    const out = normalize({ center: { share: 1, rows: [] }, left: [{ id: "l1", share: 0.4 }, { id: "l2", share: 0.8 }], right: [{ id: "r", share: 0.4 }] });
    expect(out.center.rows[0].items.map((i) => [i.id, i.share])).toEqual([
      ["l1", 0.4],
      ["l2", 0.8],
      ["r", 0.4],
    ]);
  });

  it("a move that folds keeps the side column's width and the row items' proportions", () => {
    const before: DockLayout = {
      center: { share: 1, rows: [{ share: 1, items: [{ id: "a", share: 1 }, { id: "b", share: 2 }] }, { share: 1, items: [{ id: "c" }] }] },
      left: [{ id: "l", share: 0.5 }],
    };
    const out = moveItem(before, "c", { kind: "between", row: 0, index: 1 });
    expect(ids(out).rows).toEqual([["l", "a", "c", "b"]]);
    const [w0, w1] = [widths(before), widths(out)];
    expect(w1.l).toBeCloseTo(w0.l, 3);
    expect(w1.b / w1.a).toBeCloseTo(w0.b / w0.a, 3);
  });

  it("removes a side column", () => {
    expect(ids(removeItem(dock([["a"], ["b"]], { left: ["l1", "l2"] }), "l1"))).toEqual({ left: ["l2"], rows: [["a"], ["b"]] });
  });
});

describe("limits", () => {
  it("counts the widest row and all side columns", () => {
    const example = dock([["a", "b", "c", "d"], ["e"]], { left: ["l"], right: ["r1", "r2"] });
    expect(horizontalCount(example)).toBe(7);
    expect(withinLimits(example)).toBe(false);
  });

  it(`allows ${MAX_HORIZONTAL} side by side, three rows and two columns per side`, () => {
    expect(withinLimits(dock([["a", "b", "c", "d", "e", "f"]]))).toBe(true);
    expect(withinLimits(dock([["a", "b", "c", "d", "e", "f", "g"]]))).toBe(false);
    expect(withinLimits(dock([["a"], ["b"], ["c"]], { left: ["l1", "l2"], right: ["r1", "r2"] }))).toBe(true);
    expect(withinLimits(dock([["a"], ["b"], ["c"], ["d"]]))).toBe(false);
    expect(withinLimits(dock([["a"], ["b"]], { left: ["l1", "l2", "l3"] }))).toBe(false);
  });
});

describe("moveItem", () => {
  const l = dock([["a", "b", "c"]]);

  it("moves within a row (targets refer to the layout as shown)", () => {
    expect(ids(moveItem(l, "a", { kind: "between", row: 0, index: 2 })).rows).toEqual([["b", "a", "c"]]);
    expect(ids(moveItem(l, "a", { kind: "between", row: 0, index: 3 })).rows).toEqual([["b", "c", "a"]]);
    expect(ids(moveItem(l, "c", { kind: "between", row: 0, index: 0 })).rows).toEqual([["c", "a", "b"]]);
  });

  it("leaves the layout as it is for the gaps next to the item", () => {
    expect(moveItem(l, "b", { kind: "between", row: 0, index: 1 })).toBe(l);
    expect(moveItem(l, "b", { kind: "between", row: 0, index: 2 })).toBe(l);
  });

  it("moves to a new row", () => {
    expect(ids(moveItem(l, "b", { kind: "newRow", index: 1 })).rows).toEqual([["a", "c"], ["b"]]);
  });

  it("moves the only item of a row to a new row further down (the index is corrected)", () => {
    expect(ids(moveItem(dock([["x"], ["a"], ["b"]]), "x", { kind: "newRow", index: 2 })).rows).toEqual([["a"], ["x"], ["b"]]);
  });

  it("moves into a row that moves up when the item's row goes", () => {
    expect(ids(moveItem(dock([["x"], ["a", "b"]]), "x", { kind: "between", row: 1, index: 1 })).rows).toEqual([["a", "x", "b"]]);
  });

  it("inserts before side columns fold into the row (the item is not lost, the indices hold)", () => {
    const out = moveItem(dock([["x"], ["a", "b"]], { left: ["l"] }), "x", { kind: "between", row: 1, index: 1 });
    expect(ids(out)).toEqual({ rows: [["l", "a", "x", "b"]] });
  });

  it("moves within a side (the index is corrected)", () => {
    expect(ids(moveItem(dock([["a"], ["b"]], { left: ["l1", "l2"] }), "l1", { kind: "side", side: "left", index: 2 })).left).toEqual(["l2", "l1"]);
  });

  it("moves to a side, and from a side into a row", () => {
    const side = moveItem(dock([["a", "b"], ["c"]]), "b", { kind: "side", side: "left", index: 0 });
    expect(ids(side)).toEqual({ left: ["b"], rows: [["a"], ["c"]] });
    expect(ids(moveItem(side, "b", { kind: "between", row: 1, index: 1 }))).toEqual({ rows: [["a"], ["c", "b"]] });
  });

  it("the only item of the top row moved to a side folds into the other row", () => {
    expect(ids(moveItem(dock([["a"], ["b"]]), "a", { kind: "side", side: "right", index: 0 }))).toEqual({ rows: [["b", "a"]] });
  });

  it("`into` another item removes the item (the target took it in)", () => {
    expect(ids(moveItem(l, "a", { kind: "into", itemId: "b" })).rows).toEqual([["b", "c"]]);
  });

  it("keeps the item's group", () => {
    const g: DockLayout = { center: { rows: [{ items: [item("a", "room"), item("b")] }] } };
    expect(dockItems(moveItem(g, "a", { kind: "newRow", index: 0 })).find((i) => i.id === "a")?.group).toBe("room");
  });
});

describe("resizeSplit / resetSplit", () => {
  it("resizes two neighbours, keeping their sum and the others", () => {
    const l: DockLayout = { center: { rows: [{ items: [{ id: "a", share: 1 }, { id: "b", share: 1 }, { id: "c", share: 2 }] }] } };
    const out = resizeSplit(l, { kind: "items", row: 0, index: 0 }, 0.25);
    expect(out.center.rows[0].items.map((i) => i.share)).toEqual([0.5, 1.5, 2]);
    expect(resetSplit(out, { kind: "items", row: 0, index: 0 }).center.rows[0].items.map((i) => i.share)).toEqual([1, 1, 2]);
  });

  it("resizes rows by index", () => {
    const three = normalize(dock([["a"], ["b"], ["c"]]));
    expect(resizeSplit(three, { kind: "rows", index: 1 }, 0.75).center.rows.map((r) => r.share)).toEqual([1, 1.5, 0.5]);
  });

  it("resizes columns; a side column next to the center resets to the side width", () => {
    const l = normalize(dock([["a"], ["b"]], { left: ["l1", "l2"], right: ["r"] }));
    const between = resizeSplit(l, { kind: "columns", index: 0 }, 0.25);
    expect(between.left?.map((i) => i.share)).toEqual([0.5, 1.5]);
    const right = resizeSplit(l, { kind: "columns", index: 2 }, 0.75);
    expect([right.center.share, right.right?.[0].share]).toEqual([1.5, 0.5]);
    const reset = resetSplit(right, { kind: "columns", index: 2 });
    expect(reset.right![0].share! / reset.center.share!).toBeCloseTo(SIDE_SHARE, 2);
  });

  it("ignores a split that does not exist", () => {
    const l = dock([["a"]]);
    expect(resizeSplit(l, { kind: "rows", index: 0 }, 0.3)).toBe(l);
    expect(resizeSplit(l, { kind: "columns", index: 0 }, 0.3)).toBe(l);
  });
});

describe("flexGrows", () => {
  it("adds up to 1, whatever the shares", () => {
    expect(flexGrows([0.897])).toEqual([1]);
    expect(flexGrows([1, 3])).toEqual([0.25, 0.75]);
    expect(flexGrows([0, 1, 0])).toEqual([0, 1, 0]);
  });
});
