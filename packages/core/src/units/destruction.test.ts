import { describe, expect, it } from "vitest";
import { mulberry32 } from "../terrain/noise.js";
import {
  addScorchMark,
  applyBlastToRocks,
  applyBlastToTrees,
  BLAST_RADIUS,
  BURN_DURATION,
  burningCount,
  craterDepthAt,
  craterDepthForIntensity,
  craterFalloff,
  createDamageField,
  crushTree,
  FALLEN_DECAY_DURATION,
  FALLEN_SINK_DEPTH,
  fallenDecay,
  fallenSink,
  FIRE_SPREAD_RADIUS,
  igniteTree,
  indicesInBlast,
  isFallenGone,
  isTerminalTree,
  MAX_CRATER_DEPTH,
  MAX_CRATER_TOTAL,
  MAX_FELLED_PER_BLAST,
  MAX_FIRES,
  MAX_SCORCH_MARKS,
  resolveScorchSeed,
  resolveTerminal,
  scorchAnisotropy,
  scorchDisplayRGB,
  scorchForKind,
  SCORCH_CORE_RGB,
  SCORCH_RIM_RGB,
  scorchSeed,
  scorchShade,
  SMOULDER_DURATION,
  SPREAD_MIN_AGE,
  SPREAD_RATE,
  tickDamage,
  TOPPLE_FRACTION,
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

  it("keeps blotches small and soft (gentler scorch)", () => {
    for (const kind of ["flash", "stump", "hammer", "commander"] as const) {
      const s = scorchForKind(kind);
      expect(s.radius).toBeLessThanOrEqual(34);
      expect(s.intensity).toBeLessThanOrEqual(0.65);
    }
    expect(scorchForKind("hammer").radius).toBeLessThanOrEqual(34);
    expect(scorchForKind("flash").radius).toBeLessThanOrEqual(20);
  });
});

describe("BLAST_RADIUS", () => {
  it("gives artillery the widest fell radius", () => {
    expect(BLAST_RADIUS.hammer).toBeGreaterThan(BLAST_RADIUS.stump);
    expect(BLAST_RADIUS.hammer).toBeGreaterThan(BLAST_RADIUS.flash);
    expect(BLAST_RADIUS.hammer).toBeGreaterThan(BLAST_RADIUS.commander);
  });

  it("keeps fell radii contained (gentler environment damage)", () => {
    expect(BLAST_RADIUS.hammer).toBeLessThanOrEqual(64);
    expect(BLAST_RADIUS.flash).toBeLessThanOrEqual(40);
    for (const r of Object.values(BLAST_RADIUS)) expect(r).toBeLessThan(70);
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

describe("believable scorch (charred center, irregular edge)", () => {
  it("hashes deterministic 0..1 seeds from blast positions", () => {
    expect(scorchSeed(10, 20)).toBe(scorchSeed(10, 20));
    for (const s of [scorchSeed(0, 0), scorchSeed(-500, 300), scorchSeed(123.4, -99.9)]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
    // Distinct blasts (almost surely) get distinct variants.
    const seeds = new Set(
      [
        [0, 0],
        [10, 0],
        [0, 10],
        [500, -300],
        [-123, 456],
      ].map(([x, z]) => scorchSeed(x!, z!)),
    );
    expect(seeds.size).toBeGreaterThan(1);
  });

  it("resolves explicit seeds and falls back to the position hash", () => {
    expect(resolveScorchSeed({ x: 1, z: 2, radius: 24, intensity: 0.6, seed: 0.42 })).toBe(0.42);
    expect(resolveScorchSeed({ x: 1, z: 2, radius: 24, intensity: 0.6 })).toBe(scorchSeed(1, 2));
  });

  it("squashes silhouettes elliptically without changing decal area much", () => {
    for (const seed of [0, 0.25, 0.5, 0.75, 1]) {
      const [ax, az] = scorchAnisotropy(seed);
      expect(ax).toBeGreaterThanOrEqual(0.86 - 1e-9);
      expect(ax).toBeLessThanOrEqual(1.14 + 1e-9);
      expect(az).toBeGreaterThanOrEqual(0.86 - 1e-9);
      expect(az).toBeLessThanOrEqual(1.14 + 1e-9);
      // Opposite squashes: area-preserving to within 1%.
      expect(ax * az).toBeCloseTo(1, 1);
    }
    // Neutral seed leaves the disc circular.
    expect(scorchAnisotropy(0.5)).toEqual([1, 1]);
  });

  it("shades heavier blasts darker while staying cool grey, never poop-brown", () => {
    expect(scorchShade(0.62)).toBeLessThan(scorchShade(0.45));
    for (const i of [0, 0.45, 0.62, 1]) {
      const [r, g, b] = scorchDisplayRGB(i);
      // Desaturated: channels track within a whisper, no brown cast.
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.02);
      expect(r).toBeLessThanOrEqual(SCORCH_CORE_RGB[0]);
    }
    // Hammer centers read dark grey, flash centers merely dim.
    expect(scorchDisplayRGB(0.62)[0]).toBeLessThan(0.075);
    expect(scorchDisplayRGB(0.45)[0]).toBeGreaterThan(scorchDisplayRGB(0.62)[0]);
    // Core is cool charcoal (blue at/above red), rim a desaturated grey.
    expect(SCORCH_CORE_RGB[2]).toBeGreaterThanOrEqual(SCORCH_CORE_RGB[0]! - 0.005);
    expect(SCORCH_RIM_RGB[0]! - SCORCH_RIM_RGB[2]!).toBeLessThan(0.04);
    // The rim stays dim grey, never mud-bright.
    expect(SCORCH_RIM_RGB[0]).toBeLessThan(0.24);
  });
});

describe("crater dents (tiny, visual-only)", () => {
  it("digs at most a shallow dimple, deeper for heavier blasts", () => {
    expect(craterDepthForIntensity(0.62)).toBeGreaterThan(craterDepthForIntensity(0.45));
    for (const i of [0, 0.45, 0.62, 1]) {
      expect(craterDepthForIntensity(i)).toBeGreaterThan(0);
      expect(craterDepthForIntensity(i)).toBeLessThanOrEqual(MAX_CRATER_DEPTH);
    }
    expect(MAX_CRATER_DEPTH).toBe(0.6);
  });

  it("profiles a smooth bowl: full depth at ground zero, none past the rim", () => {
    expect(craterFalloff(0)).toBe(1);
    expect(craterFalloff(1)).toBe(0);
    expect(craterFalloff(1.5)).toBe(0);
    let prev = Infinity;
    for (const t of [0, 0.25, 0.5, 0.75, 0.99]) {
      const f = craterFalloff(t);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
    expect(craterFalloff(0.5)).toBeGreaterThan(0.25);
  });

  it("sums overlapping bowls and caps the total so pits never form", () => {
    expect(craterDepthAt([], 0, 0)).toBe(0);
    const single = [{ x: 0, z: 0, radius: 40, depth: 0.8 }];
    expect(craterDepthAt(single, 0, 0)).toBeCloseTo(0.8, 9);
    expect(craterDepthAt(single, 400, 0)).toBe(0);
    expect(craterDepthAt(single, 20, 0)).toBeGreaterThan(0);
    expect(craterDepthAt(single, 20, 0)).toBeLessThan(0.8);
    // Degenerate bowls contribute nothing.
    expect(craterDepthAt([{ x: 0, z: 0, radius: 0, depth: 5 }], 0, 0)).toBe(0);
    // Ten stacked heavies still cap instead of digging a pit.
    const stacked = Array.from({ length: 10 }, () => ({ x: 0, z: 0, radius: 34, depth: 0.6 }));
    expect(craterDepthAt(stacked, 0, 0)).toBe(MAX_CRATER_TOTAL);
    expect(MAX_CRATER_TOTAL).toBe(1.2);
  });
});

describe("gentler collateral (smaller cores, slower spread)", () => {
  it("caps the instant-flatten core, spread reach, rate, and ignition age", () => {
    expect(TOPPLE_FRACTION).toBeLessThanOrEqual(0.35);
    expect(FIRE_SPREAD_RADIUS).toBeLessThanOrEqual(50);
    expect(SPREAD_RATE).toBeLessThanOrEqual(0.1);
    expect(SPREAD_MIN_AGE).toBeGreaterThanOrEqual(3);
  });

  it("keeps accumulation + caps: scorch persists with oldest-eviction", () => {
    // Regression pin: gentler tuning must not reintroduce fading scorch.
    let marks: ScorchMark[] = [];
    for (let i = 0; i < MAX_SCORCH_MARKS + 2; i++) {
      marks = addScorchMark(marks, { x: i, z: 0, radius: 18, intensity: 0.45 });
    }
    expect(marks).toHaveLength(MAX_SCORCH_MARKS);
    expect(marks[0]!.x).toBe(2);
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
    tickDamage(field, points, 5.5, () => 0.999);
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

describe("longer subtle burns (fires smoulder on)", () => {
  it("pins the extended burn/smoulder pacing", () => {
    expect(BURN_DURATION).toBe(14);
    expect(SMOULDER_DURATION).toBe(22);
    expect(BURN_DURATION + SMOULDER_DURATION).toBeGreaterThanOrEqual(30);
  });

  it("keeps trees burning past the old timings", () => {
    const field = createDamageField(1, 0);
    expect(igniteTree(field, 0)).toBe(true);
    const pts = [{ x: 0, z: 0 }];
    // The old pipeline left open flame at 6 s; the fire must still burn.
    tickDamage(field, pts, 7, mulberry32(1));
    expect(field.trees[0]).toBe("burning");
    // ... and still smoulder past the old 14 s burn+smoulder total.
    tickDamage(field, pts, BURN_DURATION - 7 + 0.1, mulberry32(1));
    expect(field.trees[0]).toBe("smouldering");
    tickDamage(field, pts, 7, mulberry32(1));
    expect(field.trees[0]).toBe("smouldering");
  });

  it("holds spread ignition back until the later spread age", () => {
    expect(SPREAD_MIN_AGE).toBe(6);
    expect(SPREAD_MIN_AGE).toBeLessThan(BURN_DURATION);
    expect(SPREAD_RATE).toBeLessThanOrEqual(0.06);
  });
});

describe("hull crush (units fell trees by driving over them)", () => {
  it("flattens intact and burning trees to toppled, restarting the fell clock", () => {
    const field = createDamageField(3, 0);
    field.treeAge[0] = 4.5;
    expect(igniteTree(field, 1)).toBe(true);
    expect(crushTree(field, 0)).toBe(true);
    expect(field.trees[0]).toBe("toppled");
    expect(field.treeAge[0]).toBe(0);
    // Bulldozing a burning tree puts its fire out (no more flame/smoke).
    expect(crushTree(field, 1)).toBe(true);
    expect(field.trees[1]).toBe("toppled");
    expect(field.treeAge[1]).toBe(0);
    // Untouched trees stay intact.
    expect(field.trees[2]).toBe("intact");
  });

  it("never re-touches terminal, gone, or out-of-range trees", () => {
    const field = createDamageField(2, 0);
    field.trees[0] = "stump";
    field.trees[1] = "gone";
    expect(crushTree(field, 0)).toBe(false);
    expect(crushTree(field, 1)).toBe(false);
    expect(field.trees[0]).toBe("stump");
    expect(field.trees[1]).toBe("gone");
    expect(crushTree(field, -1)).toBe(false);
    expect(crushTree(field, 2)).toBe(false);
  });
});

describe("fallen-tree decay (felled trees sink and vanish like husks)", () => {
  it("paces decay 0 → 1 over the duration, clamped at both ends", () => {
    expect(FALLEN_DECAY_DURATION).toBe(45);
    expect(fallenDecay(-3)).toBe(0);
    expect(fallenDecay(0)).toBe(0);
    expect(fallenDecay(FALLEN_DECAY_DURATION / 2)).toBeCloseTo(0.5, 12);
    expect(fallenDecay(FALLEN_DECAY_DURATION)).toBe(1);
    expect(fallenDecay(FALLEN_DECAY_DURATION * 3)).toBe(1);
    expect(isFallenGone(FALLEN_DECAY_DURATION - 0.1)).toBe(false);
    expect(isFallenGone(FALLEN_DECAY_DURATION)).toBe(true);
  });

  it("sinks linearly to the full depth, clamped", () => {
    expect(FALLEN_SINK_DEPTH).toBe(6);
    expect(fallenSink(0)).toBe(0);
    expect(fallenSink(0.5)).toBeCloseTo(FALLEN_SINK_DEPTH / 2, 12);
    expect(fallenSink(1)).toBe(FALLEN_SINK_DEPTH);
    expect(fallenSink(-1)).toBe(0);
    expect(fallenSink(2)).toBe(FALLEN_SINK_DEPTH);
  });

  it("ages every fallen state to gone with a decay event, however felled", () => {
    const field = createDamageField(4, 0);
    field.trees[0] = "toppled";
    field.trees[1] = "stump";
    field.trees[2] = "snag";
    // Half the decay: still fallen, no events.
    let ev = tickDamage(
      field,
      [
        { x: 0, z: 0 },
        { x: 5000, z: 0 },
        { x: 10000, z: 0 },
        { x: 15000, z: 0 },
      ],
      FALLEN_DECAY_DURATION / 2,
      mulberry32(5),
    );
    expect(ev.decayed).toEqual([]);
    for (const i of [0, 1, 2]) expect(isTerminalTree(field.trees[i]!)).toBe(true);
    // Past the decay: gone, hidden by the renderer, never resurrected.
    ev = tickDamage(
      field,
      [
        { x: 0, z: 0 },
        { x: 5000, z: 0 },
        { x: 10000, z: 0 },
        { x: 15000, z: 0 },
      ],
      FALLEN_DECAY_DURATION / 2 + 0.1,
      mulberry32(5),
    );
    expect(ev.decayed).toEqual([0, 1, 2]);
    for (const i of [0, 1, 2]) {
      expect(field.trees[i]).toBe("gone");
      expect(isTerminalTree(field.trees[i]!)).toBe(true);
    }
    // Gone trees never decay again, burn, or ignite.
    ev = tickDamage(
      field,
      [
        { x: 0, z: 0 },
        { x: 5000, z: 0 },
        { x: 10000, z: 0 },
        { x: 15000, z: 0 },
      ],
      FALLEN_DECAY_DURATION * 2,
      mulberry32(5),
    );
    expect(ev.decayed).toEqual([]);
    expect(field.trees[3]).toBe("intact");
    expect(igniteTree(field, 0)).toBe(false);
  });

  it("decays crushed trees on the same clock as blast-felled ones", () => {
    const field = createDamageField(2, 0);
    applyBlastToTrees(field, [{ x: 0, z: 0 }], 0, 0, 100, () => 0);
    expect(field.trees[0]).toBe("toppled");
    expect(crushTree(field, 1)).toBe(true);
    const pts = [
      { x: 0, z: 0 },
      { x: 9000, z: 0 },
    ];
    tickDamage(field, pts, FALLEN_DECAY_DURATION - 1, mulberry32(7));
    expect(field.trees[0]).not.toBe("gone");
    expect(field.trees[1]).not.toBe("gone");
    const ev = tickDamage(field, pts, 1.5, mulberry32(7));
    expect(ev.decayed).toEqual([0, 1]);
  });
});
