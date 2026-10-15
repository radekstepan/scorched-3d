import { describe, expect, it } from "vitest";
import { mulberry32 } from "../terrain/noise.js";
import {
  ballisticPosition,
  ballisticVelocity,
  barrelSegment,
  BARREL_MOUNT,
  clampElevation,
  ELEVATION_MAX,
  ELEVATION_MIN,
  flightClearsTrees,
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
  nextShotDelay,
  pickHostilePair,
  pickSkirmishPair,
  pointInTree,
  rollTreeStick,
  SHOT_DELAY_MAX,
  SHOT_DELAY_MIN,
  solveBallistic,
  solveBallisticHigh,
  solveDirect,
  solveShot,
  solveShotClearing,
  treesOnSegment,
  treeStickChance,
  trunksOnBarrel,
  type TreeStand,
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
  it("limits shells ballistically, bolts by flight time", () => {
    expect(maxRangeFor("hammer")).toBeCloseTo((520 * 520) / GRAVITY);
    expect(maxRangeFor("flash")).toBe(1300 * FLIGHT_MAX_TIME);
    expect(maxRangeFor("stump")).toBe(1050 * FLIGHT_MAX_TIME);
    expect(maxRangeFor("commander")).toBe(900 * FLIGHT_MAX_TIME);
  });

  it("gates fire inside [MIN_RANGE, maxRange]", () => {
    expect(inRange("hammer", MIN_RANGE - 1)).toBe(false);
    expect(inRange("hammer", MIN_RANGE)).toBe(true);
    expect(inRange("hammer", 1500)).toBe(true);
    expect(inRange("hammer", 2500)).toBe(false);
    expect(inRange("flash", 3000)).toBe(true);
    expect(inRange("flash", 5000)).toBe(false);
  });

  it("clamps barrel elevation to the mount limits", () => {
    expect(clampElevation(0.3)).toBe(0.3);
    expect(clampElevation(99)).toBe(ELEVATION_MAX);
    expect(clampElevation(-99)).toBe(ELEVATION_MIN);
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
    expect(MAX_SHOTS).toBeLessThanOrEqual(12);
    expect(MAX_EXPLOSIONS).toBeGreaterThanOrEqual(MAX_SHOTS);
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

  it("lobs shells over blocked canopy while bolts stay flat", () => {
    const trees = copse;
    const shell = solveShotClearing("hammer", a, b, trees)!;
    expect(shell).not.toBeNull();
    expect(shell.elevated).toBe(true);
    expect(shell.solution.elevation).toBeGreaterThan(Math.PI / 4);
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
});
