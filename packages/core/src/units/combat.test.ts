import { describe, expect, it } from "vitest";
import { mulberry32 } from "../terrain/noise.js";
import {
  AIM_SCATTER_DEADZONE,
  AIM_SCATTER_MAX,
  ballisticPosition,
  ballisticVelocity,
  barrelSegment,
  barrelTouchesTrunk,
  BARREL_MOUNT,
  clampElevation,
  disperseAim,
  ELEVATION_AIM_TOLERANCE,
  ELEVATION_MAX,
  ELEVATION_MIN,
  ELEVATION_SLEW_RATE,
  firingSidestep,
  flightClearsTerrain,
  flightClearsTrees,
  flightStickChance,
  flightTerrainHit,
  FLIGHT_MAX_TIME,
  flightDuration,
  GRAVITY,
  inRange,
  MAX_EXPLOSIONS,
  MAX_SHOTS,
  maxRangeFor,
  MIN_RANGE,
  muzzleForward,
  muzzleHeight,
  MOVING_REFIRE_MULTIPLIER,
  nextShotDelay,
  nextShotDelayFor,
  orbitStrafe,
  pickHostilePair,
  pickSkirmishPair,
  pointInTree,
  rollTreeStick,
  scatterRadius,
  SHOT_DELAY_MAX,
  SHOT_DELAY_MIN,
  SIDESTEP_OFFSET,
  solveBallistic,
  solveBallisticHigh,
  solveDirect,
  solveShot,
  solveShotClearing,
  stepElevation,
  TERRAIN_GRAZE,
  treesOnSegment,
  treeStickChance,
  trunksOnBarrel,
  type TreeStand,
  WEAPON_MAX_RANGE,
  WEAPON_PROFILES,
} from "./combat.js";
import { UNIT_KINDS } from "./types.js";

describe("pickSkirmishPair", () => {
  it("returns null with fewer than two units", () => {
    const rng = mulberry32(1);
    expect(pickSkirmishPair(0, rng)).toBeNull();
    expect(pickSkirmishPair(1, rng)).toBeNull();
  });

  it("always picks distinct in-range indices", () => {
    const rng = mulberry32(7);
    for (let n = 0; n < 500; n++) {
      const pair = pickSkirmishPair(6, rng)!;
      expect(pair.attacker).toBeGreaterThanOrEqual(0);
      expect(pair.attacker).toBeLessThan(6);
      expect(pair.target).toBeGreaterThanOrEqual(0);
      expect(pair.target).toBeLessThan(6);
      expect(pair.target).not.toBe(pair.attacker);
    }
  });

  it("covers every ordered pair uniformly enough (no dead slots)", () => {
    const rng = mulberry32(42);
    const seen = new Set<string>();
    for (let n = 0; n < 2000; n++) {
      const pair = pickSkirmishPair(4, rng)!;
      seen.add(`${pair.attacker}>${pair.target}`);
    }
    // 4 * 3 = 12 ordered pairs; all must appear.
    expect(seen.size).toBe(12);
  });

  it("is deterministic for a seeded rng", () => {
    const a = pickSkirmishPair(6, mulberry32(99));
    const b = pickSkirmishPair(6, mulberry32(99));
    expect(a).toEqual(b);
  });
});

describe("pickHostilePair", () => {
  // 3v3 demo split: west Blue, east Orange.
  const teams = [0, 0, 0, 1, 1, 1];

  it("returns null with fewer than two units or one empty side", () => {
    const rng = mulberry32(1);
    expect(pickHostilePair(0, [], rng)).toBeNull();
    expect(pickHostilePair(1, [0], rng)).toBeNull();
    expect(pickHostilePair(3, [0, 0, 0], rng)).toBeNull();
    expect(pickHostilePair(2, [undefined, undefined], rng)).toBeNull();
  });

  it("only ever pairs across team lines", () => {
    const rng = mulberry32(7);
    for (let n = 0; n < 500; n++) {
      const pair = pickHostilePair(6, teams, rng)!;
      expect(pair.attacker).toBeGreaterThanOrEqual(0);
      expect(pair.attacker).toBeLessThan(6);
      expect(pair.target).toBeGreaterThanOrEqual(0);
      expect(pair.target).toBeLessThan(6);
      expect(pair.target).not.toBe(pair.attacker);
      expect(teams[pair.target]).not.toBe(teams[pair.attacker]);
    }
  });

  it("covers every ordered cross-team pair (no dead slots)", () => {
    const rng = mulberry32(42);
    const seen = new Set<string>();
    for (let n = 0; n < 2000; n++) {
      const pair = pickHostilePair(4, [0, 0, 1, 1], rng)!;
      seen.add(`${pair.attacker}>${pair.target}`);
    }
    // 2 * 2 * 2 directions = 8 ordered cross-team pairs; all must appear.
    expect(seen.size).toBe(8);
  });

  it("skips units with unknown sides", () => {
    const rng = mulberry32(3);
    for (let n = 0; n < 200; n++) {
      const pair = pickHostilePair(4, [0, undefined, 1, undefined], rng)!;
      expect([pair.attacker, pair.target].sort()).toEqual([0, 2]);
    }
  });

  it("is deterministic for a seeded rng", () => {
    const a = pickHostilePair(6, teams, mulberry32(99));
    const b = pickHostilePair(6, teams, mulberry32(99));
    expect(a).toEqual(b);
  });
});

describe("nextShotDelay", () => {
  it("stays inside the scheduler window", () => {
    const rng = mulberry32(3);
    for (let n = 0; n < 200; n++) {
      const d = nextShotDelay(rng);
      expect(d).toBeGreaterThanOrEqual(SHOT_DELAY_MIN);
      expect(d).toBeLessThanOrEqual(SHOT_DELAY_MAX);
    }
  });

  it("honours custom bounds", () => {
    const rng = mulberry32(5);
    for (let n = 0; n < 100; n++) {
      const d = nextShotDelay(rng, 2, 3);
      expect(d).toBeGreaterThanOrEqual(2);
      expect(d).toBeLessThanOrEqual(3);
    }
  });
});

describe("nextShotDelayFor", () => {
  it("reloads volleys fired on the move at half pace", () => {
    expect(MOVING_REFIRE_MULTIPLIER).toBe(2);
    for (const kind of UNIT_KINDS) {
      const still = nextShotDelayFor(kind, mulberry32(11));
      const moving = nextShotDelayFor(kind, mulberry32(11), true);
      // Same draw, scaled post-draw: exact power-of-two ratio, no brittle
      // absolute — the kind window stays the only absolute.
      expect(moving).toBe(still * MOVING_REFIRE_MULTIPLIER);
    }
  });

  it("keeps the stationary beat and the rng stream untouched", () => {
    for (const kind of UNIT_KINDS) {
      // Explicit `false` matches the legacy two-arg call exactly.
      expect(nextShotDelayFor(kind, mulberry32(7), false)).toBe(
        nextShotDelayFor(kind, mulberry32(7)),
      );
      // One rng draw either way: the penalty scales the drawn value, so the
      // stream stays aligned — the next raw draw matches a fresh stream.
      const scaled = mulberry32(7);
      nextShotDelayFor(kind, scaled, true);
      const fresh = mulberry32(7);
      fresh();
      expect(scaled()).toBe(fresh());
    }
  });
});

describe("flightDuration", () => {
  it("is distance over muzzle velocity for bolts", () => {
    expect(flightDuration(1000, 500)).toBeCloseTo(2.0);
    // No minimum clamp: a fast bolt at close range is a sub-frame snap,
    // not a slowed-down float.
    expect(flightDuration(60, 1300)).toBeCloseTo(60 / 1300);
    expect(flightDuration(0, 500)).toBe(0);
  });

  it("clamps pathological inputs", () => {
    expect(flightDuration(100000, 10)).toBe(FLIGHT_MAX_TIME);
    expect(flightDuration(100, 0)).toBe(0.5);
    expect(flightDuration(100, -5)).toBe(0.5);
  });
});

describe("solveDirect", () => {
  it("fires straight at the impact at muzzle velocity", () => {
    const from = { x: 0, y: 10, z: 0 };
    const to = { x: 300, y: 20, z: 400 };
    const sol = solveDirect(from, to, 1000)!;
    expect(sol).not.toBeNull();
    const dist = Math.hypot(300, 10, 400);
    expect(sol.duration).toBeCloseTo(dist / 1000);
    const speed = Math.hypot(sol.velocity.x, sol.velocity.y, sol.velocity.z);
    expect(speed).toBeCloseTo(1000);
    // Lands exactly on the impact: straight-line, no gravity sag.
    const at = ballisticPosition(from, sol.velocity, sol.duration, 0);
    expect(at.x).toBeCloseTo(to.x, 9);
    expect(at.y).toBeCloseTo(to.y, 9);
    expect(at.z).toBeCloseTo(to.z, 9);
  });

  it("aims slightly down at a target below the muzzle", () => {
    const sol = solveDirect({ x: 0, y: 100, z: 0 }, { x: 500, y: 0, z: 0 }, 900)!;
    expect(sol.elevation).toBeLessThan(0);
    expect(sol.elevation).toBeCloseTo(Math.atan2(-100, 500));
  });

  it("returns null for degenerate inputs", () => {
    const p = { x: 1, y: 2, z: 3 };
    expect(solveDirect(p, p, 1000)).toBeNull();
    expect(solveDirect(p, { x: 2, y: 2, z: 3 }, 0)).toBeNull();
  });
});

describe("solveBallistic", () => {
  const from = { x: 0, y: 30, z: 0 };

  it("matches the flat-ground low-angle root sin2θ = gR/V²", () => {
    const to = { x: 800, y: 30, z: 0 };
    const sol = solveBallistic(from, to, 520, GRAVITY)!;
    expect(sol).not.toBeNull();
    expect(sol.elevation).toBeCloseTo(
      0.5 * Math.asin((GRAVITY * 800) / (520 * 520)),
      9,
    );
    // Muzzle speed is preserved: the barrel sets direction, not energy.
    const speed = Math.hypot(sol.velocity.x, sol.velocity.y, sol.velocity.z);
    expect(speed).toBeCloseTo(520, 9);
  });

  it("lands exactly on the impact, uphill and downhill", () => {
    for (const to of [
      { x: 800, y: 30, z: 0 },
      { x: 600, y: 130, z: 200 },
      { x: 200, y: -40, z: 100 },
      { x: 1500, y: 60, z: -300 },
    ]) {
      const sol = solveBallistic(from, to, 520, GRAVITY)!;
      expect(sol, `reachable ${JSON.stringify(to)}`).not.toBeNull();
      const at = ballisticPosition(from, sol.velocity, sol.duration, GRAVITY);
      expect(at.x).toBeCloseTo(to.x, 6);
      expect(at.y).toBeCloseTo(to.y, 6);
      expect(at.z).toBeCloseTo(to.z, 6);
    }
  });

  it("lobs higher at longer range (arc policy falls out of physics)", () => {
    const near = solveBallistic(from, { x: 200, y: 30, z: 0 }, 520, GRAVITY)!;
    const far = solveBallistic(from, { x: 1500, y: 30, z: 0 }, 520, GRAVITY)!;
    expect(far.elevation).toBeGreaterThan(near.elevation);
    // Apex from energy: (V·sinθ)² / 2g — near-flat up close, high at range.
    const apex = (s: { elevation: number }) =>
      from.y + ((520 * Math.sin(s.elevation)) ** 2) / (2 * GRAVITY);
    expect(apex(near) - from.y).toBeLessThan(15);
    expect(apex(far)).toBeGreaterThan(100);
  });

  it("returns null past max range (retail's no-solution sentinel)", () => {
    // Level-ground max range is V²/g ≈ 1931; 2500 is unreachable.
    expect(solveBallistic(from, { x: 2500, y: 30, z: 0 }, 520, GRAVITY)).toBeNull();
  });

  it("returns null for degenerate inputs", () => {
    expect(solveBallistic(from, from, 520, GRAVITY)).toBeNull();
    expect(solveBallistic(from, { x: 1, y: 2, z: 3 }, 0, GRAVITY)).toBeNull();
    expect(solveBallistic(from, { x: 100, y: 30, z: 0 }, 520, 0)).toBeNull();
  });
});

describe("ballisticPosition / ballisticVelocity", () => {
  it("is exact at the endpoints and analytic mid-flight", () => {
    const start = { x: 10, y: 40, z: -5 };
    const vel = { x: 300, y: 120, z: 400 };
    const p0 = ballisticPosition(start, vel, 0, GRAVITY);
    expect(p0).toEqual(start);
    const t = 1.25;
    const mid = ballisticPosition(start, vel, t, GRAVITY);
    expect(mid.x).toBeCloseTo(start.x + vel.x * t, 9);
    expect(mid.y).toBeCloseTo(start.y + vel.y * t - 0.5 * GRAVITY * t * t, 9);
    // Velocity is the exact derivative: linear gravity bleed only in Y.
    const v = ballisticVelocity(vel, t, GRAVITY);
    expect(v.x).toBeCloseTo(vel.x, 12);
    expect(v.z).toBeCloseTo(vel.z, 12);
    expect(v.y).toBeCloseTo(vel.y - GRAVITY * t, 9);
  });

  it("flies straight with zero gravity (bolts)", () => {
    const start = { x: 0, y: 10, z: 0 };
    const vel = { x: 1000, y: -50, z: 0 };
    const mid = ballisticPosition(start, vel, 0.5, 0);
    expect(mid).toEqual({ x: 500, y: -15, z: 0 });
  });

  it("clamps negative time at the muzzle", () => {
    const start = { x: 1, y: 2, z: 3 };
    expect(ballisticPosition(start, { x: 9, y: 9, z: 9 }, -2, GRAVITY)).toEqual(start);
  });
});

describe("ranges", () => {
  it("caps every kind below half a battle-map width (HQs are lob-proof)", () => {
    // Doctrine caps (not the physical limits): nothing reaches across the
    // map, so an HQ only takes aimed fire from deep push-ins.
    expect(maxRangeFor("flash")).toBe(900);
    expect(maxRangeFor("stump")).toBe(850);
    expect(maxRangeFor("hammer")).toBe(1000);
    expect(maxRangeFor("commander")).toBe(800);
    expect(WEAPON_MAX_RANGE.hammer).toBeLessThan((520 * 520) / GRAVITY);
  });

  it("gates fire inside [MIN_RANGE, maxRange]", () => {
    expect(inRange("hammer", MIN_RANGE - 1)).toBe(false);
    expect(inRange("hammer", MIN_RANGE)).toBe(true);
    expect(inRange("hammer", 900)).toBe(true);
    expect(inRange("hammer", 1100)).toBe(false);
    expect(inRange("flash", 800)).toBe(true);
    expect(inRange("flash", 1000)).toBe(false);
  });

  it("stretches the cap for veteran gunners, never the point-blank floor", () => {
    // A rookie flash holds fire at 950; a veteran (×1.05 → 945) still
    // holds, an elite (×1.10 → 990) fires.
    expect(inRange("flash", 950)).toBe(false);
    expect(inRange("flash", 950, 1.05)).toBe(false);
    expect(inRange("flash", 950, 1.1)).toBe(true);
    // The ace hammer reaches 1150 yet stays under half a map width (2560).
    expect(inRange("hammer", 1150, 1.15)).toBe(true);
    expect(inRange("hammer", 1151, 1.15)).toBe(false);
    expect(maxRangeFor("hammer") * 1.15).toBeLessThan(2560);
    // Garbage scales read as parity; the floor never moves.
    expect(inRange("flash", 950, 0)).toBe(false);
    expect(inRange("flash", 950, -2)).toBe(false);
    expect(inRange("hammer", MIN_RANGE - 1, 1.15)).toBe(false);
  });

  it("clamps barrel elevation to the per-kind mount limits", () => {
    expect(clampElevation(0.3, "hammer")).toBe(0.3);
    // Artillery mount refuses near-vertical lays (70° howitzer band).
    expect(ELEVATION_MAX.hammer).toBeCloseTo((7 * Math.PI) / 18, 12);
    expect(clampElevation(99, "hammer")).toBe(ELEVATION_MAX.hammer);
    expect(clampElevation(99, "hammer")).toBeLessThan(1.25);
    expect(clampElevation(-99, "hammer")).toBe(ELEVATION_MIN);
    // Other mounts keep the legacy near-vertical ceiling.
    for (const kind of UNIT_KINDS) {
      if (kind === "hammer") continue;
      expect(ELEVATION_MAX[kind]).toBe(1.45);
      expect(clampElevation(99, kind)).toBe(1.45);
      expect(clampElevation(-99, kind)).toBe(ELEVATION_MIN);
    }
  });

  it("cranks heavy barrels slowest (elevation slew trails turret yaw)", () => {
    for (const kind of UNIT_KINDS) {
      expect(ELEVATION_SLEW_RATE[kind]).toBeGreaterThan(0);
    }
    // The howitzer lays slowest; the infantry hand-cannon flicks fastest.
    expect(ELEVATION_SLEW_RATE.hammer).toBeLessThan(ELEVATION_SLEW_RATE.stump);
    expect(ELEVATION_SLEW_RATE.stump).toBeLessThan(ELEVATION_SLEW_RATE.peewee);
    expect(ELEVATION_AIM_TOLERANCE).toBeGreaterThan(0);
    expect(ELEVATION_AIM_TOLERANCE).toBeLessThan(0.1);
  });

  it("steps elevation linearly toward the goal without wrapping", () => {
    expect(stepElevation(0, 1, 0.4)).toBeCloseTo(0.4, 12);
    expect(stepElevation(0, 1, 5)).toBe(1);
    expect(stepElevation(1, 0, 0.25)).toBeCloseTo(0.75, 12);
    expect(stepElevation(0.7, 0.1, 0.01)).toBeCloseTo(0.69, 12);
    expect(stepElevation(-0.1, -0.15, 1)).toBe(-0.15);
  });
});

describe("solveShot", () => {
  it("routes shells ballistically and bolts direct", () => {
    const from = { x: 0, y: 30, z: 0 };
    const to = { x: 800, y: 40, z: 100 };
    const shell = solveShot("hammer", from, to)!;
    expect(shell).not.toBeNull();
    expect(shell.elevation).toBeGreaterThan(0);
    // Shell apex clears the straight line: it arcs, the bolt does not.
    const mid = ballisticPosition(from, shell.velocity, shell.duration / 2, GRAVITY);
    const straight = (from.y + to.y) / 2;
    expect(mid.y).toBeGreaterThan(straight);
    const bolt = solveShot("flash", from, to)!;
    const boltMid = ballisticPosition(from, bolt.velocity, bolt.duration / 2, 0);
    expect(boltMid.y).toBeCloseTo(straight, 9);
  });

  it("refuses unreachable shell shots instead of faking them", () => {
    expect(
      solveShot("hammer", { x: 0, y: 30, z: 0 }, { x: 2500, y: 30, z: 0 }),
    ).toBeNull();
  });
});

describe("weapon profiles", () => {
  it("covers every unit kind with sane values", () => {
    for (const kind of UNIT_KINDS) {
      const p = WEAPON_PROFILES[kind];
      expect(p.speed).toBeGreaterThan(0);
      expect(p.flashTime).toBeGreaterThan(0);
    }
  });

  it("gives artillery the slowest muzzle velocity (bolt tracers are faster)", () => {
    expect(WEAPON_PROFILES.hammer!.speed).toBeLessThan(WEAPON_PROFILES.flash!.speed);
    expect(WEAPON_PROFILES.hammer!.shot).toBe("shell");
    for (const kind of UNIT_KINDS) {
      if (kind !== "hammer") expect(WEAPON_PROFILES[kind]!.shot).toBe("bolt");
    }
  });

  it("keeps perf caps sane", () => {
    expect(MAX_SHOTS).toBeGreaterThan(0);
    // Tracers must accommodate an army; expensive impact effects stay separately capped.
    expect(MAX_SHOTS).toBeGreaterThanOrEqual(64);
    expect(MAX_SHOTS).toBeLessThanOrEqual(128);
    expect(MAX_EXPLOSIONS).toBeGreaterThan(0);
    expect(MAX_EXPLOSIONS).toBeLessThanOrEqual(12);
  });

  it("gives every kind a positive muzzle offset", () => {
    for (const kind of UNIT_KINDS) {
      expect(muzzleHeight(kind)).toBeGreaterThan(0);
      expect(muzzleForward(kind)).toBeGreaterThan(0);
    }
  });
});

describe("tree interception", () => {
  // Flat 400-unit shot at y=30 over flat ground (y=0); a standing tree
  // midway puts its crown sphere (center y=24, r=16) on the line of fire.
  const tree = (x: number, standing = true, groundY = 0): TreeStand => ({ x, z: 0, groundY, standing });
  const a = { x: 0, y: 30, z: 0 };
  const b = { x: 400, y: 30, z: 0 };
  // A tree on a slight rise (crown 16..48) sits solidly on the flat arc.
  const copse = [tree(200, true, 8)];

  it("catches points inside the crown sphere and the trunk cylinder", () => {
    const t = tree(200);
    expect(pointInTree(200, 24, 0, t)).toBe(true);
    expect(pointInTree(200, 24 + 15, 0, t)).toBe(true);
    expect(pointInTree(200, 24 + 17, 0, t)).toBe(false);
    expect(pointInTree(200, 10, 0, t)).toBe(true);
    expect(pointInTree(200 + 3, 10, 0, t)).toBe(true);
    expect(pointInTree(200 + 9, 10, 0, t)).toBe(false);
    expect(pointInTree(200, 24, 0, tree(200, false))).toBe(false);
  });

  it("finds crossed trees in ascending order with a cheap corridor reject", () => {
    const trees = [tree(900), tree(300), tree(100), tree(150, false)];
    expect(treesOnSegment(a, b, trees)).toEqual([1, 2]);
    expect(treesOnSegment(a, b, [])).toEqual([]);
    // High lob passes over the same crowns.
    const over = { x: 0, y: 200, z: 0 };
    const overB = { x: 400, y: 200, z: 0 };
    expect(treesOnSegment(over, overB, trees)).toEqual([]);
  });

  it("tests whole flights: flat clips, high lob clears", () => {
    const trees = copse;
    const low = solveBallistic(a, b, 520, GRAVITY)!;
    expect(flightClearsTrees(a, low.velocity, GRAVITY, low.duration, trees)).toBe(false);
    const high = solveBallisticHigh(a, b, 520, GRAVITY)!;
    expect(high.elevation).toBeGreaterThan(Math.PI / 4);
    expect(high.duration).toBeGreaterThan(low.duration);
    // Same muzzle energy, same impact — only the arc differs.
    const speed = Math.hypot(high.velocity.x, high.velocity.y, high.velocity.z);
    expect(speed).toBeCloseTo(520, 9);
    const at = ballisticPosition(a, high.velocity, high.duration, GRAVITY);
    expect(at.x).toBeCloseTo(b.x, 6);
    expect(at.y).toBeCloseTo(b.y, 6);
    expect(at.z).toBeCloseTo(b.z, 6);
    expect(flightClearsTrees(a, high.velocity, GRAVITY, high.duration, trees)).toBe(true);
    expect(flightClearsTrees(a, low.velocity, GRAVITY, low.duration, [])).toBe(true);
  });

  it("refuses beyond-mount lobs: artillery fires flat into blocked canopy", () => {
    const trees = copse;
    // The 400-unit high root is near-vertical (~84°) — past the hammer's 70°
    // mount — so the lob is refused and the flat round leaves instead (the
    // interception roll may catch it in the branches).
    const high = solveBallisticHigh(a, b, 520, GRAVITY)!;
    expect(high.elevation).toBeGreaterThan(ELEVATION_MAX.hammer);
    const shell = solveShotClearing("hammer", a, b, trees)!;
    expect(shell).not.toBeNull();
    expect(shell.elevated).toBe(false);
    expect(shell.solution.elevation).toBeLessThan(Math.PI / 4);
    // Open ground keeps the flat low root (no gratuitous mortar fire).
    const open = solveShotClearing("hammer", a, b, [])!;
    expect(open.elevated).toBe(false);
    expect(open.solution.elevation).toBeLessThan(Math.PI / 4);
    // A bolt cannot lob: it stays on the target line and accepts the stick
    // risk (the interception roll may catch it in the branches).
    const bolt = solveShotClearing("flash", a, b, trees);
    expect(bolt).not.toBeNull();
    expect(bolt!.elevated).toBe(false);
  });

  it("holds fire when even the flat root exceeds the mount (extreme up-cliff)", () => {
    // 500 above the muzzle at 150 out: the low root needs ~76°, past the
    // hammer's 70° mount — no solution, the gun holds fire.
    const cliff = { x: 150, y: 530, z: 0 };
    const low = solveBallistic(a, cliff, 520, GRAVITY)!;
    expect(low.elevation).toBeGreaterThan(ELEVATION_MAX.hammer);
    expect(solveShotClearing("hammer", a, cliff, [])).toBeNull();
  });

  it("fires the flat shell through when even the lob clips (interception may catch it)", () => {
    // Blockers derived from the actual arcs: one crown centered on the low
    // midpoint, one on the high midpoint — neither root clears.
    const low = solveBallistic(a, b, 520, GRAVITY)!;
    const high = solveBallisticHigh(a, b, 520, GRAVITY)!;
    const lowMid = ballisticPosition(a, low.velocity, low.duration / 2, GRAVITY);
    const highMid = ballisticPosition(a, high.velocity, high.duration / 2, GRAVITY);
    const wall: TreeStand[] = [
      { x: lowMid.x, z: lowMid.z, groundY: lowMid.y - 24, standing: true },
      { x: highMid.x, z: highMid.z, groundY: highMid.y - 24, standing: true },
    ];
    expect(flightClearsTrees(a, low.velocity, GRAVITY, low.duration, wall)).toBe(false);
    expect(flightClearsTrees(a, high.velocity, GRAVITY, high.duration, wall)).toBe(false);
    const shell = solveShotClearing("hammer", a, b, wall)!;
    expect(shell.elevated).toBe(false);
  });

  it("rolls sticks in encounter order with per-kind chances", () => {
    expect(treeStickChance("flash")).toBeGreaterThan(treeStickChance("hammer"));
    // First crossed tree sticks on a low roll; later trees never see the rng.
    let calls = 0;
    const rng = () => {
      calls++;
      return 0;
    };
    expect(rollTreeStick([2, 5, 7], "flash", rng)).toBe(2);
    expect(calls).toBe(1);
    expect(rollTreeStick([], "flash", rng)).toBe(-1);
    // A roll above the chance flies on through every tree.
    expect(rollTreeStick([1, 2], "flash", () => 0.999)).toBe(-1);
  });

  it("quotes the whole-flight stick chance as 1-(1-p)^n", () => {
    // Open ground never sticks, whatever the gun.
    expect(flightStickChance(0, "flash")).toBe(0);
    expect(flightStickChance(0, "hammer")).toBe(0);
    expect(flightStickChance(-3, "flash")).toBe(0);
    // One tree reads the per-kind chance exactly.
    expect(flightStickChance(1, "flash")).toBeCloseTo(treeStickChance("flash"), 12);
    expect(flightStickChance(1, "hammer")).toBeCloseTo(treeStickChance("hammer"), 12);
    // Closed form over three crowns: bolts strand far more often than lobbed
    // shells (0.55 vs 0.35 per tree), which is the number that makes forests
    // read as projectile cover for firing-lane decisions.
    expect(flightStickChance(3, "flash")).toBeCloseTo(1 - Math.pow(0.45, 3), 12);
    expect(flightStickChance(3, "hammer")).toBeCloseTo(1 - Math.pow(0.65, 3), 12);
    expect(flightStickChance(3, "flash")).toBeGreaterThan(flightStickChance(3, "hammer"));
    // Monotonic in cover: more wood between muzzle and mark always sticks
    // more rounds, saturating toward (never past) certainty.
    let prev = flightStickChance(1, "flash");
    for (let n = 2; n <= 10; n++) {
      const next = flightStickChance(n, "flash");
      expect(next).toBeGreaterThan(prev);
      expect(next).toBeLessThanOrEqual(1);
      prev = next;
    }
    // Pure: same query, same answer (no rng inside).
    expect(flightStickChance(4, "stump")).toBe(flightStickChance(4, "stump"));
  });
});

describe("terrain collision", () => {
  const flat = () => 0;
  // A blocky ridge astride the line of fire: 60 tall between x=150..250.
  const ridge = (x: number, _z: number) => (x > 150 && x < 250 ? 60 : 0);

  it("clears flat bolts over flat ground", () => {
    const from = { x: 0, y: 30, z: 0 };
    const to = { x: 400, y: 30, z: 0 };
    const sol = solveDirect(from, to, 1000)!;
    expect(flightClearsTerrain(from, sol.velocity, 0, sol.duration, flat)).toBe(true);
    expect(flightTerrainHit(from, sol.velocity, 0, 0, sol.duration, flat)).toBeNull();
  });

  it("catches a bolt flying into a ridge, seating the hit on its face", () => {
    const from = { x: 0, y: 30, z: 0 };
    const to = { x: 400, y: 30, z: 0 };
    const sol = solveDirect(from, to, 1000)!;
    expect(flightClearsTerrain(from, sol.velocity, 0, sol.duration, ridge)).toBe(false);
    const hit = flightTerrainHit(from, sol.velocity, 0, 0, sol.duration, ridge)!;
    expect(hit).not.toBeNull();
    // Contact on the near face (x ≈ 150): the flat arc meets the wall at
    // its own height (y ≈ 30), well below the ridge top it never reaches.
    expect(hit.x).toBeGreaterThan(140);
    expect(hit.x).toBeLessThan(165);
    expect(hit.y).toBeCloseTo(30, 0);
    expect(hit.y).toBeLessThan(60);
    expect(hit.t).toBeGreaterThan(0);
    expect(hit.t).toBeLessThan(sol.duration);
  });

  it("cannot tunnel: a fast bolt in one long window still hits a narrow ridge", () => {
    // 1300 u/s bolt, single 1 s window; both endpoints sit above a
    // 200-tall sliver (600..660) an endpoint-only check would straddle.
    const from = { x: 0, y: 100, z: 0 };
    const vel = { x: 1300, y: 0, z: 0 };
    const sliver = (x: number, _z: number) => (x > 600 && x < 660 ? 200 : 0);
    const hit = flightTerrainHit(from, vel, 0, 0, 1, sliver)!;
    expect(hit).not.toBeNull();
    expect(hit.x).toBeGreaterThan(590);
    expect(hit.x).toBeLessThan(675);
    expect(flightClearsTerrain(from, vel, 0, 1, sliver)).toBe(false);
  });

  it("lets shells lob over the ridge that blocks their flat root", () => {
    const a = { x: 0, y: 30, z: 0 };
    const b = { x: 400, y: 30, z: 0 };
    const low = solveBallistic(a, b, 520, GRAVITY)!;
    expect(flightClearsTerrain(a, low.velocity, GRAVITY, low.duration, ridge)).toBe(false);
    const high = solveBallisticHigh(a, b, 520, GRAVITY)!;
    expect(flightClearsTerrain(a, high.velocity, GRAVITY, high.duration, ridge)).toBe(true);
  });

  it("lets honest skimmers fly but clips dirt-grazers", () => {
    const skim = { x: 0, y: TERRAIN_GRAZE + 1, z: 0 };
    const skimSol = solveDirect(skim, { x: 400, y: TERRAIN_GRAZE + 1, z: 0 }, 1000)!;
    expect(flightClearsTerrain(skim, skimSol.velocity, 0, skimSol.duration, flat)).toBe(true);
    const graze = { x: 0, y: TERRAIN_GRAZE - 1, z: 0 };
    const grazeSol = solveDirect(graze, { x: 400, y: TERRAIN_GRAZE - 1, z: 0 }, 1000)!;
    expect(flightClearsTerrain(graze, grazeSol.velocity, 0, grazeSol.duration, flat)).toBe(false);
  });

  it("reads degenerate windows as clear", () => {
    const from = { x: 0, y: 30, z: 0 };
    const vel = { x: 1000, y: 0, z: 0 };
    expect(flightClearsTerrain(from, vel, 0, 0, ridge)).toBe(true);
    expect(flightClearsTerrain(from, vel, 0, -1, ridge)).toBe(true);
    expect(flightTerrainHit(from, vel, 0, 1, 1, ridge)).toBeNull();
    expect(flightTerrainHit(from, vel, 0, 2, 1, ridge)).toBeNull();
  });
});

describe("aim dispersion", () => {
  it("holds dead-on inside the deadzone (zero/low distance ≈ no scatter)", () => {
    for (const kind of UNIT_KINDS) {
      expect(scatterRadius(kind, 0)).toBe(0);
      expect(scatterRadius(kind, AIM_SCATTER_DEADZONE)).toBe(0);
      expect(scatterRadius(kind, AIM_SCATTER_DEADZONE - 1)).toBe(0);
      // Deadzone shots cost no entropy and copy the point exactly.
      let calls = 0;
      const p = disperseAim({ x: 1, y: 2, z: 3 }, kind, 50, () => {
        calls++;
        return 0.5;
      });
      expect(p).toEqual({ x: 1, y: 2, z: 3 });
      expect(calls).toBe(0);
    }
  });

  it("grows scatter with distance", () => {
    for (const kind of UNIT_KINDS) {
      const near = scatterRadius(kind, AIM_SCATTER_DEADZONE + 100);
      const mid = scatterRadius(kind, AIM_SCATTER_DEADZONE + 400);
      const far = scatterRadius(kind, AIM_SCATTER_DEADZONE + 700);
      expect(near).toBeGreaterThan(0);
      expect(mid).toBeGreaterThan(near);
      expect(far).toBeGreaterThan(mid);
    }
  });

  it("scatters artillery more than every other kind at any range", () => {
    for (const dist of [200, 400, 600, 900, 1200]) {
      for (const kind of UNIT_KINDS) {
        if (kind === "hammer") continue;
        expect(scatterRadius("hammer", dist)).toBeGreaterThan(scatterRadius(kind, dist));
      }
    }
  });

  it("bounds scatter (never too far off target)", () => {
    for (const kind of UNIT_KINDS) {
      const cap = AIM_SCATTER_MAX[kind]!;
      // Even absurd ranges clamp at the per-kind cap.
      expect(scatterRadius(kind, 100000)).toBe(cap);
      // Sampled offsets never leave the disc, and height is untouched.
      const rng = mulberry32(7);
      const origin = { x: 500, y: 120, z: 300 };
      for (let n = 0; n < 500; n++) {
        const p = disperseAim(origin, kind, 900, rng);
        expect(Math.hypot(p.x - origin.x, p.z - origin.z)).toBeLessThanOrEqual(cap + 1e-9);
        expect(p.y).toBe(origin.y);
      }
    }
  });

  it("is deterministic for a seeded rng", () => {
    const a = disperseAim({ x: 0, y: 0, z: 0 }, "hammer", 800, mulberry32(99));
    const b = disperseAim({ x: 0, y: 0, z: 0 }, "hammer", 800, mulberry32(99));
    expect(a).toEqual(b);
  });
});

describe("barrelSegment", () => {
  it("throws the tube forward from the mount pivot (flash, flat, facing +Z)", () => {
    const mount = BARREL_MOUNT.flash!;
    const seg = barrelSegment({ x: 0, y: 100, z: 0 }, 0, 0, 0, "flash")!;
    // Pivot rides 3 ahead of the hull center at pivot height.
    expect(seg.a.x).toBeCloseTo(0, 9);
    expect(seg.a.y).toBeCloseTo(100 + mount.pivotY, 9);
    expect(seg.a.z).toBeCloseTo(mount.pivotZ, 9);
    // Flat tube: tip one tube length further along +Z at pivot height.
    expect(seg.b.x).toBeCloseTo(0, 9);
    expect(seg.b.y).toBeCloseTo(100 + mount.pivotY, 9);
    expect(seg.b.z).toBeCloseTo(mount.pivotZ + mount.length, 9);
  });

  it("follows hull + turret yaw and climbs with elevation", () => {
    const mount = BARREL_MOUNT.stump!;
    // Hull east (+X), turret back west-relative: absolute faces +X.
    const seg = barrelSegment({ x: 10, y: 50, z: -20 }, Math.PI / 2, 0, 0.5, "stump")!;
    const horizontal = Math.cos(0.5) * mount.length;
    expect(seg.b.x - seg.a.x).toBeCloseTo(horizontal, 9);
    expect(seg.b.z - seg.a.z).toBeCloseTo(0, 9);
    expect(seg.b.y - seg.a.y).toBeCloseTo(Math.sin(0.5) * mount.length, 9);
  });

  it("returns null for the commander (no tube to clip)", () => {
    expect(barrelSegment({ x: 0, y: 0, z: 0 }, 0, 0, 0, "commander")).toBeNull();
  });
});

describe("trunksOnBarrel", () => {
  // Hull ground anchor at y=100; flash tube rides ~109.5 flat down +Z.
  const hull = { x: 0, y: 100, z: 0 };
  const segOf = (kind: "flash" | "hammer" = "flash", elev = 0) =>
    barrelSegment(hull, 0, 0, elev, kind)!;
  const tree = (x: number, z: number, standing = true): TreeStand => ({
    x,
    z,
    groundY: 100,
    standing,
  });

  it("flags a bole on the tube line inside trunk + tube radius", () => {
    const seg = segOf();
    // On the line, mid-tube.
    expect(trunksOnBarrel(seg.a, seg.b, [tree(0, 10)])).toEqual([0]);
    // 5 aside still grazes (trunk 4 + tube 2 = 6).
    expect(trunksOnBarrel(seg.a, seg.b, [tree(5, 10)])).toEqual([0]);
    // 7 aside clears.
    expect(trunksOnBarrel(seg.a, seg.b, [tree(7, 10)])).toEqual([]);
    // Past the tip clears.
    expect(trunksOnBarrel(seg.a, seg.b, [tree(0, 40)])).toEqual([]);
  });

  it("ignores felled trees (no bole left to hit)", () => {
    const seg = segOf();
    expect(trunksOnBarrel(seg.a, seg.b, [tree(0, 10, false)])).toEqual([]);
  });

  it("ignores crowns (tube past the bole but under the canopy)", () => {
    const seg = segOf();
    // 6.5 aside: outside the 6 bole radius, but inside the crown sphere
    // (center +24, r16: dy 14.5 leaves 6.8 of XZ reach) — leaves may brush,
    // wood must not count.
    expect(trunksOnBarrel(seg.a, seg.b, [tree(6.5, 10)])).toEqual([]);
  });

  it("clears a lobbed barrel climbing over the bole", () => {
    // Hammer at near-vertical elevation: the tube climbs ~31 over ~4 of
    // horizontal reach, so a bole 5 aside is never within tube distance
    // at bole height — while the flat tube at the same spot clips.
    const flat = segOf("hammer", 0);
    expect(trunksOnBarrel(flat.a, flat.b, [tree(5, 12)])).toEqual([0]);
    const lobbed = segOf("hammer", 1.45);
    expect(trunksOnBarrel(lobbed.a, lobbed.b, [tree(5, 12)])).toEqual([]);
  });

  it("lists hits in ascending order", () => {
    const seg = segOf("hammer", 0);
    const trees = [tree(0, 40), tree(0, 8), tree(50, 50), tree(0, 20)];
    expect(trunksOnBarrel(seg.a, seg.b, trees)).toEqual([1, 3]);
  });

  it("costs nothing on open ground", () => {
    const seg = segOf();
    expect(trunksOnBarrel(seg.a, seg.b, [])).toEqual([]);
  });

  it("keeps the bole boundary (exactly at tube reach still clips)", () => {
    // The exact test includes the boundary (`> r²` rejects, `==` clips), so
    // the broadphase must let boundary boles through — a trunk at exactly
    // trunk + tube reach (4 + 2 = 6) from the tube line at bole height
    // still fells. Exactly-representable geometry (midpoint approach,
    // axis-aligned tube) so the boundary is bit-exact, not 1-ulp luck.
    const a = { x: 0, y: 110, z: 0 };
    const b = { x: 0, y: 110, z: 30 };
    expect(trunksOnBarrel(a, b, [tree(6, 15)])).toEqual([0]);
    // …while a hair past clears.
    expect(trunksOnBarrel(a, b, [tree(6 + 1e-6, 15)])).toEqual([]);
  });

  it("agrees with brute force on a seeded sweep (broadphase tripwire)", () => {
    // The per-tree broadphase is an optimization only: on scattered forests
    // and tube-scale segments it must return exactly the brute-force set
    // (same fids, ascending). Any future broadphase change that alters a
    // verdict fails here instead of silently clipping through boles.
    const rng = mulberry32(0xba442);
    const brute = (
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number },
      trees: readonly TreeStand[],
    ): number[] => {
      const out: number[] = [];
      for (let i = 0; i < trees.length; i++) {
        if (barrelTouchesTrunk(a, b, trees[i]!)) out.push(i);
      }
      return out;
    };
    for (let field = 0; field < 4; field++) {
      const count = 150 + Math.floor(rng() * 100);
      const trees: TreeStand[] = [];
      for (let i = 0; i < count; i++) {
        trees.push({
          x: (rng() - 0.5) * 4000,
          z: (rng() - 0.5) * 4000,
          groundY: 80 + rng() * 60,
          standing: rng() < 0.7,
        });
      }
      for (let s = 0; s < 25; s++) {
        // Tube-scale segments (~30u) at hull heights, plus degenerate points.
        const cx = (rng() - 0.5) * 4000;
        const cz = (rng() - 0.5) * 4000;
        const cy = 90 + rng() * 40;
        const yaw = rng() * Math.PI * 2;
        const len = rng() < 0.15 ? 0 : 20 + rng() * 20;
        const a = { x: cx, y: cy, z: cz };
        const b = { x: cx + Math.sin(yaw) * len, y: cy + (rng() - 0.5) * 30, z: cz + Math.cos(yaw) * len };
        expect(trunksOnBarrel(a, b, trees)).toEqual(brute(a, b, trees));
      }
    }
  });
});

describe("firingSidestep", () => {
  const tree = (x: number, z: number, groundY = 8): TreeStand => ({ x, z, groundY, standing: true });
  // Flat 400-unit firing line at y=30; candidates sit ±48 off it.
  const self = { x: 0, y: 30, z: 0 };
  const target = { x: 400, y: 30, z: 0 };

  it("holds an open unshared lane (no improvement, no fidget)", () => {
    expect(firingSidestep(self, target, [])).toBeNull();
    expect(firingSidestep(self, target, [], { allies: [] })).toBeNull();
  });

  it("sidesteps to the clearer side when the lane crosses wood", () => {
    // One crown centered on the lane; both lateral lanes miss it.
    const spot = firingSidestep(self, target, [tree(200, 0)], {
      selfIndex: 0,
      targetIndex: 1,
    })!;
    expect(spot).not.toBeNull();
    // Symmetric tie — the roster indices pick minus (hash (0+17)%2 = 1).
    expect(spot.x).toBeCloseTo(0, 9);
    expect(spot.z).toBeCloseTo(-SIDESTEP_OFFSET, 9);
    // The mirror indices take the mirror side, deterministically.
    const mirror = firingSidestep(self, target, [tree(200, 0)], {
      selfIndex: 1,
      targetIndex: 1,
    })!;
    expect(mirror.x).toBeCloseTo(0, 9);
    expect(mirror.z).toBeCloseTo(SIDESTEP_OFFSET, 9);
    expect(firingSidestep(self, target, [tree(200, 0)], { selfIndex: 1, targetIndex: 1 })).toEqual(
      mirror,
    );
  });

  it("prefers the strictly clearer candidate over the tied one", () => {
    // The lane crown plus a second crown on the minus lateral (midpoint
    // (200,30,-24) sits at its center): only plus clears both.
    const spot = firingSidestep(self, target, [tree(200, 0), tree(200, -24, 6)], {
      selfIndex: 0,
      targetIndex: 1,
    })!;
    expect(spot.x).toBeCloseTo(0, 9);
    expect(spot.z).toBeCloseTo(SIDESTEP_OFFSET, 9);
  });

  it("steps out of a crowded seat even when the lane itself is clear", () => {
    // A crown 18 behind the muzzle crowds the seat but misses the flat lane
    // (closest approach ~19 > r16); both laterals seat clear of it.
    const spot = firingSidestep(self, target, [tree(-18, 0, 0)], {
      selfIndex: 0,
      targetIndex: 1,
    })!;
    expect(spot.x).toBeCloseTo(0, 9);
    expect(Math.abs(spot.z)).toBeCloseTo(SIDESTEP_OFFSET, 9);
  });

  it("flanks away from a mate stacked on the same line", () => {
    // Ally 100 aside shares the target at ~14° (inside the stack angle):
    // the step opens to the far side, away from the mate.
    const spot = firingSidestep(self, target, [], {
      allies: [{ x: 0, z: 100 }],
      selfIndex: 0,
      targetIndex: 1,
    })!;
    expect(spot.x).toBeCloseTo(0, 9);
    expect(spot.z).toBeCloseTo(-SIDESTEP_OFFSET, 9);
  });

  it("holds when the mate already holds a flanking angle", () => {
    // Ally perpendicular to the line (90° at the target): nothing to open,
    // open lanes — the gun stays put.
    expect(
      firingSidestep(self, target, [], { allies: [{ x: 400, z: 300 }] }),
    ).toBeNull();
  });

  it("never flanks into worse wood (bad flank loses to the hold)", () => {
    // Stacked mate pulls to minus, but a crown sits on the minus lateral
    // (midpoint (200,30,-24) at its center) while the current and plus lanes
    // stay clear: no consolation improvement either, so the gun holds.
    expect(
      firingSidestep(self, target, [tree(200, -24, 6)], {
        allies: [{ x: 0, z: 100 }],
        selfIndex: 0,
        targetIndex: 1,
      }),
    ).toBeNull();
  });

  it("returns null for degenerate inputs", () => {
    expect(firingSidestep(self, self, [])).toBeNull();
    expect(firingSidestep(self, target, [], { offset: 0 })).toBeNull();
    expect(firingSidestep(self, target, [], { offset: -5 })).toBeNull();
  });
});

describe("orbitStrafe", () => {
  const tree = (x: number, z: number, groundY = 8): TreeStand => ({ x, z, groundY, standing: true });
  // Flat 400-unit firing line at y=30; candidates sit ±48 off it.
  const self = { x: 0, y: 30, z: 0 };
  const target = { x: 400, y: 30, z: 0 };

  it("strafes laterally on an open lane instead of holding", () => {
    // Open unshared lane reads null from the seat evaluator — the orbit
    // answers with a lateral step, so holders keep circling.
    const spot = orbitStrafe(self, target, [], { selfIndex: 0, targetIndex: 1 })!;
    expect(spot.x).toBeCloseTo(0, 9);
    expect(spot.z).toBeCloseTo(-SIDESTEP_OFFSET, 9);
    // Deterministic: same pair, same point, every call.
    expect(orbitStrafe(self, target, [], { selfIndex: 0, targetIndex: 1 })).toEqual(spot);
    // The mirror indices circle the mirror way (hash (31+17)%2 = 0).
    const mirror = orbitStrafe(self, target, [], { selfIndex: 1, targetIndex: 1 })!;
    expect(mirror.x).toBeCloseTo(0, 9);
    expect(mirror.z).toBeCloseTo(SIDESTEP_OFFSET, 9);
  });

  it("honors an explicit direction override and a custom offset", () => {
    const plus = orbitStrafe(self, target, [], { selfIndex: 0, targetIndex: 1, direction: 1 })!;
    expect(plus.x).toBeCloseTo(0, 9);
    expect(plus.z).toBeCloseTo(SIDESTEP_OFFSET, 9);
    const minus = orbitStrafe(self, target, [], { selfIndex: 1, targetIndex: 1, direction: -1 })!;
    expect(minus.x).toBeCloseTo(0, 9);
    expect(minus.z).toBeCloseTo(-SIDESTEP_OFFSET, 9);
    const wide = orbitStrafe(self, target, [], { selfIndex: 1, targetIndex: 1, offset: 100 })!;
    expect(wide.x).toBeCloseTo(0, 9);
    expect(wide.z).toBeCloseTo(100, 9);
  });

  it("falls through to the mirror side when the orbit side worsens the lane", () => {
    // A crown centered on the plus lateral (midpoint (200,30,24)): the
    // current lane stays clear, so the plus-preferring hull mirrors.
    const spot = orbitStrafe(self, target, [tree(200, 24, 6)], {
      selfIndex: 1,
      targetIndex: 1,
    })!;
    expect(spot.x).toBeCloseTo(0, 9);
    expect(spot.z).toBeCloseTo(-SIDESTEP_OFFSET, 9);
  });

  it("holds when both laterals cross more wood than the seat", () => {
    // Crowns on both laterals, current lane clear: a bad strafe loses to
    // the hold, exactly like a bad flank.
    expect(
      orbitStrafe(self, target, [tree(200, 24, 6), tree(200, -24, 6)], {
        selfIndex: 1,
        targetIndex: 1,
      }),
    ).toBeNull();
  });

  it("ignores a crowded seat (crowding is the seat shuffle's job)", () => {
    // A crown 18 behind the muzzle crowds the seat but touches no lane:
    // the orbit steps anyway — the seat evaluator handles the crowd on
    // its own slower clock.
    const spot = orbitStrafe(self, target, [tree(-18, 0, 0)], {
      selfIndex: 0,
      targetIndex: 1,
    })!;
    expect(spot.x).toBeCloseTo(0, 9);
    expect(spot.z).toBeCloseTo(-SIDESTEP_OFFSET, 9);
  });

  it("mirrors around terrain the probe refuses, else holds", () => {
    // A wall across the plus side mirrors the plus-preferring hull.
    const mirrored = orbitStrafe(self, target, [], {
      selfIndex: 1,
      targetIndex: 1,
      blocked: (_x, z) => z > 0,
    })!;
    expect(mirrored.x).toBeCloseTo(0, 9);
    expect(mirrored.z).toBeCloseTo(-SIDESTEP_OFFSET, 9);
    // Walls on both sides hold — the sweep retries next tick.
    expect(
      orbitStrafe(self, target, [], {
        selfIndex: 1,
        targetIndex: 1,
        blocked: () => true,
      }),
    ).toBeNull();
  });

  it("returns null for degenerate inputs", () => {
    expect(orbitStrafe(self, self, [])).toBeNull();
    expect(orbitStrafe(self, target, [], { offset: 0 })).toBeNull();
    expect(orbitStrafe(self, target, [], { offset: -5 })).toBeNull();
    expect(orbitStrafe({ x: NaN, y: 30, z: 0 }, target, [])).toBeNull();
  });
});
