import { describe, expect, it } from "vitest";
import {
  boxPick,
  boxSelect,
  clickSelect,
  doubleClickSelect,
  hostileMembers,
  normalizeRect,
  pickNearest,
  resolveRightClick,
  type TypedUnit,
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

describe("doubleClickSelect", () => {
  const roster: (TypedUnit | undefined)[] = [
    { kind: "flash", team: 0 },
    { kind: "flash", team: 0 },
    { kind: "flash", team: 1 },
    { kind: "stump", team: 0 },
    { kind: "flash", team: 0 },
    undefined,
  ];
  const allVisible = [true, true, true, true, true, true];

  it("selects on-screen mates of the anchor's kind and team, in order", () => {
    expect(doubleClickSelect(4, roster, allVisible)).toEqual([0, 1, 4]);
    // The anchor's own faction gates the group: same kind, other team.
    expect(doubleClickSelect(2, roster, allVisible)).toEqual([2]);
    expect(doubleClickSelect(3, roster, allVisible)).toEqual([3]);
  });

  it("skips off-screen mates but keeps the on-screen ones", () => {
    const visible = [true, false, true, true, true, true];
    expect(doubleClickSelect(0, roster, visible)).toEqual([0, 4]);
  });

  it("excludes wrecks like every other pick path", () => {
    const isDestroyedAt = (i: number): boolean => i === 1;
    expect(doubleClickSelect(0, roster, allVisible, isDestroyedAt)).toEqual([0, 4]);
  });

  it("selects nothing for a null, unknown, or off-roster anchor", () => {
    expect(doubleClickSelect(null, roster, allVisible)).toEqual([]);
    expect(doubleClickSelect(5, roster, allVisible)).toEqual([]);
    expect(doubleClickSelect(99, roster, allVisible)).toEqual([]);
    expect(doubleClickSelect(0, [], [])).toEqual([]);
  });

  it("treats a short visibility list as off-screen past its end", () => {
    expect(doubleClickSelect(0, roster, [true])).toEqual([0]);
  });
});

describe("hostileMembers", () => {
  const teams = [0, 0, 1, 1];
  const teamAt = (i: number): number | undefined => teams[i];

  it("keeps only members across team lines from the target, in order", () => {
    expect(hostileMembers([0, 1, 2, 3], 2, teamAt)).toEqual([0, 1]);
    expect(hostileMembers([2, 3, 0], 0, teamAt)).toEqual([2, 3]);
  });

  it("sits out the target itself, friendlies, and unknown sides", () => {
    expect(hostileMembers([2], 2, teamAt)).toEqual([]);
    expect(hostileMembers([1, 2], 2, teamAt)).toEqual([1]);
    expect(hostileMembers([0, 1], 0, teamAt)).toEqual([]);
    expect(hostileMembers([0, 1], 9, teamAt)).toEqual([]);
    expect(hostileMembers([0, 9], 2, () => undefined)).toEqual([]);
  });
});

describe("resolveRightClick", () => {
  const teams = [0, 0, 1];
  const teamAt = (i: number): number | undefined => teams[i];

  it("attacks a live enemy of the selection", () => {
    expect(resolveRightClick([0, 1], 2, teamAt)).toEqual({ kind: "attack", target: 2 });
    // Mixed selections attack through their hostile members alone.
    expect(resolveRightClick([0, 2], 1, teamAt)).toEqual({ kind: "attack", target: 1 });
  });

  it("moves on ground, selected units, friendlies, and unknown sides", () => {
    expect(resolveRightClick([0, 1], null, teamAt)).toEqual({ kind: "move" });
    expect(resolveRightClick([0, 1], 1, teamAt)).toEqual({ kind: "move" });
    expect(resolveRightClick([0, 1], 0, teamAt)).toEqual({ kind: "move" });
    expect(resolveRightClick([0], 1, teamAt)).toEqual({ kind: "move" });
    expect(resolveRightClick([0], 2, () => undefined)).toEqual({ kind: "move" });
    expect(resolveRightClick([], 2, teamAt)).toEqual({ kind: "move" });
  });
});
