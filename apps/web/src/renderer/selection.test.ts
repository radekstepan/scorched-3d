import { describe, expect, it } from "vitest";
import {
  boxPick,
  boxSelect,
  clickSelect,
  normalizeRect,
  pickNearest,
} from "./selection";

const PTS = [
  { x: 100, y: 100 },
  { x: 200, y: 150 },
  { x: 300, y: 300 },
];

describe("pickNearest", () => {
  it("picks the unit under the click within the radius", () => {
    expect(pickNearest(PTS, { x: 105, y: 98 })).toBe(0);
    expect(pickNearest(PTS, { x: 400, y: 400 })).toBeNull();
  });

  it("prefers the nearest unit and breaks ties deterministically", () => {
    const pair = [
      { x: 100, y: 100 },
      { x: 130, y: 100 },
    ];
    expect(pickNearest(pair, { x: 118, y: 100 })).toBe(1);
    expect(pickNearest(pair, { x: 112, y: 100 })).toBe(0);
    const dup = [
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ];
    expect(pickNearest(dup, { x: 100, y: 100 })).toBe(0);
  });
});

describe("boxPick", () => {
  it("selects units inside the rect regardless of drag direction", () => {
    const fwd = normalizeRect({ x: 50, y: 50 }, { x: 250, y: 200 });
    const back = normalizeRect({ x: 250, y: 200 }, { x: 50, y: 50 });
    expect(boxPick(PTS, fwd)).toEqual([0, 1]);
    expect(boxPick(PTS, back)).toEqual([0, 1]);
  });

  it("returns nothing when the box is empty", () => {
    expect(boxPick(PTS, normalizeRect({ x: 0, y: 0 }, { x: 10, y: 10 }))).toEqual([]);
  });
});

describe("clickSelect", () => {
  it("replaces on plain click and clears on empty click", () => {
    expect(clickSelect([0, 1], 2, false)).toEqual([2]);
    expect(clickSelect([0, 1], null, false)).toEqual([]);
  });

  it("toggles on shift-click and keeps on shift-empty-click", () => {
    expect(clickSelect([0], 1, true)).toEqual([0, 1]);
    expect(clickSelect([0, 1], 1, true)).toEqual([0]);
    expect(clickSelect([0], null, true)).toEqual([0]);
  });
});

describe("boxSelect", () => {
  it("replaces on plain box and unions on shift-box", () => {
    expect(boxSelect([0], [1, 2], false)).toEqual([1, 2]);
    expect(boxSelect([0], [1, 2], true)).toEqual([0, 1, 2]);
    expect(boxSelect([0, 1], [], false)).toEqual([]);
  });
});
