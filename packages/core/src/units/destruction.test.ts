import { describe, expect, it } from "vitest";
import { mulberry32 } from "../terrain/noise.js";
import {
  addScorchMark,
  applyBlastToRocks,
  applyBlastToTrees,
  BLAST_RADIUS,
  BURN_DURATION,
  burningCount,
  createDamageField,
  igniteTree,
  indicesInBlast,
  isTerminalTree,
  MAX_FELLED_PER_BLAST,
  MAX_FIRES,
  MAX_SCORCH_MARKS,
  resolveTerminal,
  scorchForKind,
  SMOULDER_DURATION,
  tickDamage,
  type ScorchMark,
} from "./destruction";

describe("scorchForKind", () => {
  it("scars widest and darkest for artillery shells", () => {
    const shell = scorchForKind("hammer");
    for (const kind of ["flash", "stump", "commander"] as const) {
      const other = scorchForKind(kind);
      expect(shell.radius).toBeGreaterThan(other.radius);
      expect(shell.intensity).toBeGreaterThanOrEqual(other.intensity);
    }
  });

  it("stays in sane bounds for every kind", () => {
    for (const kind of ["flash", "stump", "hammer", "commander"] as const) {
      const s = scorchForKind(kind);
      expect(s.radius).toBeGreaterThan(0);
      expect(s.intensity).toBeGreaterThan(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });
});

describe("BLAST_RADIUS", () => {
  it("gives artillery the widest fell radius", () => {
    expect(BLAST_RADIUS.hammer).toBeGreaterThan(BLAST_RADIUS.stump);
    expect(BLAST_RADIUS.hammer).toBeGreaterThan(BLAST_RADIUS.flash);
    expect(BLAST_RADIUS.hammer).toBeGreaterThan(BLAST_RADIUS.commander);
  });
});

describe("addScorchMark", () => {
  const mark = (x: number): ScorchMark => ({ x, z: 0, radius: 24, intensity: 0.6 });

  it("appends without mutating the input", () => {
    const before: ScorchMark[] = [mark(1)];
    const after = addScorchMark(before, mark(2));
    expect(after).toHaveLength(2);
    expect(before).toHaveLength(1);
  });

  it("evicts the oldest mark at cap, keeping the newest", () => {
    let marks: ScorchMark[] = [];
    for (let i = 0; i < MAX_SCORCH_MARKS + 5; i++) marks = addScorchMark(marks, mark(i));
    expect(marks).toHaveLength(MAX_SCORCH_MARKS);
    // The first five (x = 0..4) were evicted; x = 5 is now oldest.
    expect(marks[0]!.x).toBe(5);
    expect(marks[marks.length - 1]!.x).toBe(MAX_SCORCH_MARKS + 4);
  });
});

describe("indicesInBlast", () => {
  const points = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 0, z: 30 },
    { x: 100, z: 100 },
  ];

  it("returns ascending indices inside the radius", () => {
    expect(indicesInBlast(points, 0, 0, 30)).toEqual([0, 1, 2]);
    expect(indicesInBlast(points, 0, 0, 5)).toEqual([0]);
  });

  it("returns empty for misses and degenerate inputs", () => {
    expect(indicesInBlast(points, 500, 500, 10)).toEqual([]);
    expect(indicesInBlast(points, 0, 0, 0)).toEqual([]);
    expect(indicesInBlast(points, 0, 0, -4)).toEqual([]);
    expect(indicesInBlast(points, 0, 0, 30, 0)).toEqual([]);
    expect(indicesInBlast([], 0, 0, 30)).toEqual([]);
  });

  it("caps at the nearest entries first", () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 5, z: 0 }));
    const got = indicesInBlast(line, 0, 0, 1000);
    expect(got).toHaveLength(MAX_FELLED_PER_BLAST);
    // Nearest-first: 0, 1, 2, ... up to the cap.
    expect(got).toEqual(Array.from({ length: MAX_FELLED_PER_BLAST }, (_, i) => i));
  });
});

describe("graduated collateral damage", () => {
  it("runs the full burn pipeline: ignite → burn → smoulder → terminal", () => {
    const field = createDamageField(2, 1);
    expect(igniteTree(field, 0)).toBe(true);
    expect(field.trees[0]).toBe("burning");
    // Half the burn: still burning.
    let ev = tickDamage(field, [{ x: 0, z: 0 }, { x: 5000, z: 5000 }], BURN_DURATION / 2, mulberry32(1));
    expect(field.trees[0]).toBe("burning");
    expect(ev.enteredSmoulder).toEqual([]);
    // Past the burn: smouldering.
    ev = tickDamage(field, [{ x: 0, z: 0 }, { x: 5000, z: 5000 }], BURN_DURATION / 2 + 0.1, mulberry32(1));
    expect(field.trees[0]).toBe("smouldering");
    expect(ev.enteredSmoulder).toEqual([0]);
    // Past the smoulder: a persistent terminal state (far neighbour keeps
    // the spread scan from igniting tree 1).
    ev = tickDamage(
      field,
      [{ x: 0, z: 0 }, { x: 5000, z: 5000 }],
      SMOULDER_DURATION + 0.1,
      mulberry32(9),
    );
    expect(isTerminalTree(field.trees[0]!)).toBe(true);
    expect(ev.resolved).toHaveLength(1);
    expect(ev.resolved[0]!.index).toBe(0);
    // Untouched features stay intact; rocks are never lit by tree ticks.
    expect(field.trees[1]).toBe("intact");
    expect(field.rocks[0]).toBe(0);
  });

  it("flattens the blast core and ignites the fringe", () => {
    const field = createDamageField(3, 0);
    const points = [
      { x: 0, z: 0 }, // dead center → flattened now
      { x: 90, z: 0 }, // fringe of a 100-radius blast → ignited
      { x: 500, z: 500 }, // outside → spared
    ];
    const res = applyBlastToTrees(field, points, 0, 0, 100, mulberry32(4));
    expect(res.flattened).toEqual([0]);
    expect(res.ignited).toEqual([1]);
    expect(isTerminalTree(field.trees[0]!)).toBe(true);
    expect(field.trees[1]).toBe("burning");
    expect(field.trees[2]).toBe("intact");
    // A second blast never re-touches terminal trees.
    const again = applyBlastToTrees(field, points, 0, 0, 100, mulberry32(4));
    expect(again.flattened).toEqual([]);
    expect(field.trees[0]).toBe(field.trees[0]);
  });

  it("caps concurrent fires with oldest-eviction and resolves every terminal", () => {
    const field = createDamageField(MAX_FIRES + 3, 0);
    const rng = mulberry32(12);
    for (let i = 0; i < MAX_FIRES; i++) expect(igniteTree(field, i)).toBe(true);
    expect(burningCount(field)).toBe(MAX_FIRES);
    // Age the first fire, then ignite past the cap: the oldest burning tree
    // is fast-forwarded to smoulder so the flame budget holds.
    tickDamage(
      field,
      field.trees.map((_, i) => ({ x: i * 5000, z: 0 })),
      3,
      rng,
    );
    expect(igniteTree(field, MAX_FIRES)).toBe(true);
    expect(burningCount(field)).toBe(MAX_FIRES);
    expect(field.trees[0]).toBe("smouldering");
    // Every terminal roll lands on a persistent state.
    for (let n = 0; n < 30; n++) expect(isTerminalTree(resolveTerminal(rng))).toBe(true);
    // Out-of-range and non-intact ignitions refuse cleanly.
    expect(igniteTree(field, -1)).toBe(false);
    expect(igniteTree(field, field.trees.length)).toBe(false);
    expect(igniteTree(field, 0)).toBe(false);
  });

  it("spreads fringe fire to close neighbours but not distant ones", () => {
    const field = createDamageField(3, 0);
    const points = [
      { x: 0, z: 0 }, // burning source
      { x: 40, z: 0 }, // inside FIRE_SPREAD_RADIUS
      { x: 4000, z: 0 }, // far away
    ];
    expect(igniteTree(field, 0)).toBe(true);
    // Age past SPREAD_MIN_AGE without burning out, then force spread with a
    // stub rng that always ignites eligible pairs.
    tickDamage(field, points, 2.5, () => 0.999);
    const ev = tickDamage(field, points, 1, () => 0);
    expect(ev.ignited).toContain(1);
    expect(ev.ignited).not.toContain(2);
    expect(field.trees[2]).toBe("intact");
  });

  it("chips rocks by proximity: core buries faster than the fringe", () => {
    const field = createDamageField(0, 2);
    const points = [
      { x: 0, z: 0 }, // core → +2 levels
      { x: 90, z: 0 }, // fringe of radius 100 → +1 level
    ];
    const changed = applyBlastToRocks(field, points, 0, 0, 100);
    expect(changed).toEqual([0, 1]);
    expect(field.rocks[0]).toBe(2);
    expect(field.rocks[1]).toBe(1);
    // A buried rock clamps at 3 and reports no further change.
    applyBlastToRocks(field, points, 0, 0, 100);
    expect(field.rocks[0]).toBe(3);
    expect(field.rocks[1]).toBe(2);
    const settled = applyBlastToRocks(field, [{ x: 0, z: 0 }], 0, 0, 100);
    expect(field.rocks[0]).toBe(3);
    expect(settled).toEqual([]);
  });

  it("keeps damage state independent of re-seat poses (re-snap preservation)", () => {
    // The field is indexed by feature id and never keyed on heights, so an
    // exaggeration re-snap (which only re-seats Y) cannot resurrect features:
    // simulate a full burn then assert terminal states survive idle ticks.
    const field = createDamageField(2, 1);
    applyBlastToTrees(field, [{ x: 0, z: 0 }], 0, 0, 100, mulberry32(2));
    applyBlastToRocks(field, [{ x: 5, z: 5 }], 0, 0, 100);
    const before = { trees: [...field.trees], rocks: [...field.rocks] };
    tickDamage(field, [{ x: 0, z: 0 }, { x: 9000, z: 0 }], 0, mulberry32(3));
    tickDamage(field, [{ x: 0, z: 0 }, { x: 9000, z: 0 }], -1, mulberry32(3));
    expect(field.trees).toEqual(before.trees);
    expect(field.rocks).toEqual(before.rocks);
    // Terminal trees stay terminal through long idle ticks (no resurrection).
    tickDamage(field, [{ x: 0, z: 0 }, { x: 9000, z: 0 }], 60, mulberry32(3));
    expect(isTerminalTree(field.trees[0]!)).toBe(true);
  });
});
