/** The pure parts of the stats graph: buckets, axis, and where a bar's number goes. */
import { describe, expect, it } from "vitest";

import { MAX_STATS_BUCKETS, STATS_BUCKET_MS } from "../src/appViewModel";
import { barCount, bucketOf, compact, denseBuckets, MIN_SLOT_PX, numberPlace, valueOf, yTicks } from "../src/views/widget/chart";

describe("stats chart", () => {
  it("writes numbers short", () => {
    expect([0, 970, 1000, 1500, 4392, 9999, 12_345, 999_499, 999_500, 1_234_567, 12_000_000].map(compact)).toEqual(["0", "970", "1k", "1.5k", "4.4k", "10k", "12k", "999k", "1M", "1.2M", "12M"]);
    // Rounding never gives a four-digit number below the thousands.
    expect([999.4, 999.5].map(compact)).toEqual(["999", "1k"]);
  });

  it("shows as many buckets as fit, at most the ones kept", () => {
    expect(barCount(0)).toBe(1);
    expect(barCount(MIN_SLOT_PX * 20 + 13)).toBe(20);
    expect(barCount(10_000)).toBe(MAX_STATS_BUCKETS);
  });

  it("fills the buckets without traffic with 0 and ends with the current bucket", () => {
    const current = bucketOf(1_800_000_012_345);
    expect(current % STATS_BUCKET_MS).toBe(0);
    const old = { timestamp: current - 10 * STATS_BUCKET_MS, toWidget: 9, fromWidget: 9 };
    const recent = { timestamp: current - STATS_BUCKET_MS, toWidget: 5, fromWidget: 2 };
    const buckets = denseBuckets([old, recent], current, 3);
    expect(buckets).toEqual([{ timestamp: current - 2 * STATS_BUCKET_MS, toWidget: 0, fromWidget: 0 }, recent, { timestamp: current, toWidget: 0, fromWidget: 0 }]);
    expect(buckets.map((b) => valueOf(b, "total"))).toEqual([0, 7, 0]);
    expect(valueOf(recent, "fromWidget")).toBe(2);
    // The bucket boundary: a point at `current` is the newest bar; a point one bucket before the window is not shown.
    const now = { timestamp: current, toWidget: 1, fromWidget: 0 };
    expect(denseBuckets([old, now], current, 10).map((b) => b.toWidget)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(denseBuckets([old, now], current, 11)[0]).toBe(old);
    expect(denseBuckets([now], current, 0)).toEqual([]);
  });

  it("puts at most four nice steps on the y axis, fewer in a short plot", () => {
    expect(yTicks(0, 100)).toEqual([0, 1]);
    expect(yTicks(2370, 150)).toEqual([0, 1000, 2000, 3000]);
    expect(yTicks(1600, 150)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(yTicks(1600, 50)).toEqual([0, 1000, 2000]);
    expect(yTicks(7400, 150)).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(yTicks(9000, 150)).toEqual([0, 2500, 5000, 7500, 10_000]);
    // Steps are whole characters: a label never rounds (2.5 would be written "3").
    expect(yTicks(9, 150)).toEqual([0, 5, 10]);
    expect(yTicks(7, 70)).toEqual([0, 5, 10]);
    expect(yTicks(45, 150)).toEqual([0, 20, 40, 60]);
    expect(yTicks(90, 150)).toEqual([0, 25, 50, 75, 100]);
    expect(yTicks(1, 150)).toEqual([0, 1]);
    for (const max of [0, 1, 3, 7, 9, 13, 99, 1234, 98_765]) for (const t of yTicks(max, 150)) expect(Number.isInteger(t)).toBe(true);
    // The labels stay apart: never more than one step per 22px.
    for (const px of [30, 60, 90, 200]) expect(yTicks(12_345, px).length - 1).toBeLessThanOrEqual(Math.max(1, Math.floor(px / 22)));
  });

  it("writes a bar's number above it, else inside it, else not at all", () => {
    // "1.5k": 4 characters → 30px with the padding.
    expect(numberPlace(1500, 40, 150, 14)).toBe("above");
    expect(numberPlace(1500, 130, 150, 14)).toBe("inside");
    expect(numberPlace(1500, 25, 50, 14)).toBeUndefined(); // neither above (25px) nor inside (25px)
    expect(numberPlace(1500, 40, 150, 10)).toBeUndefined(); // the slot is narrower than a line
    expect(numberPlace(1500, 130, 150, 13)).toBeUndefined(); // inside, the bar (slot − gap) is narrower than a line
    expect(numberPlace(0, 0, 150, 14)).toBeUndefined(); // an empty bucket has no number
  });
});
