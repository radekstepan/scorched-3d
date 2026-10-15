import type { UnitKind } from "./types.js";

/**
 * Ambient-skirmish combat helpers for the demo: random attacker/target
 * pairing plus projectile ballistics. Framework-free (no three.js) so the
 * web renderer and vitest can both consume it directly.
 *
 * Nanolathe parallel: the retail weapon catalog drives shots from per-slot
 * reload timers with velocity/range/burst fields (retail spec §2); here a
 * single interval scheduler picks pairs instead of simulating slots, and
 * per-kind muzzle velocities stand in for catalog velocity. Retail splits
 * direct fire (time-of-flight `T = D / weaponvelocity`, spec 06 §3.2 lead)
 * from ballistic fire (muzzle velocity `V` plus the gravity global `g`
 * through the §3.3 solver, low-angle root preferred): bolts use the direct
 * solution (constant-velocity, no gravity — plasma-stroke analog), shells
 * use the ballistic solution below.
 */

export interface CombatVec3 {
  x: number;
  y: number;
  z: number;
}

export interface SkirmishPair {
  attacker: number;
  target: number;
}

export type ShotKind = "bolt" | "shell";

/** Per-kind weapon profile: muzzle velocity, tracer color, flash time. */
export interface WeaponProfile {
  shot: ShotKind;
  /** Muzzle velocity in world units per second. */
  speed: number;
  /** Tracer/projectile tint as 0xRRGGBB. */
  color: number;
  /** Seconds of muzzle flash + recoil kick. */
  flashTime: number;
}

export const WEAPON_PROFILES: Record<UnitKind, WeaponProfile> = {
  // Fast light tank: flat tracer bolt (cf. nanolathe plasma shots).
  flash: { shot: "bolt", speed: 1300, color: 0xffd34d, flashTime: 0.12 },
  // Medium tank: heavier flat bolt.
  stump: { shot: "bolt", speed: 1050, color: 0xff9a3c, flashTime: 0.14 },
  // Artillery: slow ballistic shell under gravity (cf. TA ballistic solver).
  hammer: { shot: "shell", speed: 520, color: 0xff6a2a, flashTime: 0.18 },
  // Commander: heavy blue-white bolt (D-gun read as a tracer, not a beam).
  commander: { shot: "bolt", speed: 900, color: 0x7fd4ff, flashTime: 0.16 },
};

/**
 * Gravity for ballistic shells, world units/s² (retail reads a gravity
 * global in its §3.3 solver; here one constant for the single shell weapon).
 * With the hammer's 520 u/s muzzle velocity the level-ground max range is
 * V²/g ≈ 1931 units — about one map width (128 cells × 16), so artillery
 * reaches most of the field but not every corner-to-corner pair.
 */
export const GRAVITY = 140;

/** Scheduler bounds: seconds between ambient shots. */
export const SHOT_DELAY_MIN = 0.35;
export const SHOT_DELAY_MAX = 1.1;
/** Perf caps: concurrent tracers and the flights they may spawn. */
export const MAX_SHOTS = 6;
export const MAX_EXPLOSIONS = 8;
/** Longest allowed flight, seconds (safety net; range gates fire first). */
export const FLIGHT_MAX_TIME = 3.0;
/**
 * Below this muzzle-to-impact distance (world units) guns hold fire: the
 * barrel cannot depress onto a target underneath the muzzle, and the
 * sub-frame flight would read as a pop. Rare in practice (placement keeps
 * hulls ≥160 units apart).
 */
export const MIN_RANGE = 50;

/** Barrel elevation clamp, radians: slight depression to near-vertical lob. */
export const ELEVATION_MIN = -0.15;
export const ELEVATION_MAX = 1.45;
/** Longest allowed canopy-lob flight, seconds (high roots hang ~7.4s). */
export const LOBBED_MAX_TIME = 8;

/** Clamp a barrel elevation into the physical mount range. */
export function clampElevation(elevation: number): number {
  return Math.min(Math.max(elevation, ELEVATION_MIN), ELEVATION_MAX);
}

/**
 * Max engagement range per kind, world units (retail's admission range
 * test, spec 06 §3.3): shells are ballistically limited to V²/g on level
 * ground; bolts fly straight, limited only by the flight-time safety net.
 */
export function maxRangeFor(kind: UnitKind): number {
  const profile = WEAPON_PROFILES[kind];
  if (!profile) return 0;
  if (profile.shot === "shell") return (profile.speed * profile.speed) / GRAVITY;
  return profile.speed * FLIGHT_MAX_TIME;
}

/** True when a muzzle-to-impact shot at `distance` may leave the barrel. */
export function inRange(kind: UnitKind, distance: number): boolean {
  return distance >= MIN_RANGE && distance <= maxRangeFor(kind);
}

/** Seconds until the next ambient shot, uniform in [min, max]. */
export function nextShotDelay(
  rng: () => number,
  min = SHOT_DELAY_MIN,
  max = SHOT_DELAY_MAX,
): number {
  return min + rng() * (max - min);
}

/**
 * Pick a random ordered attacker/target pair of distinct unit indices.
 * Returns null when fewer than two units exist. Uniform over ordered pairs.
 */
export function pickSkirmishPair(unitCount: number, rng: () => number): SkirmishPair | null {
  if (unitCount < 2) return null;
  const attacker = Math.floor(rng() * unitCount);
  // Uniform over the remaining unitCount - 1 targets.
  const slot = Math.floor(rng() * (unitCount - 1));
  const target = slot >= attacker ? slot + 1 : slot;
  return { attacker, target };
}

/**
 * Muzzle velocity + flight for one shot, solved in world space.
 *
 * - Bolts (`solveDirect`): straight constant-velocity flight at the muzzle
 *   velocity, aimed at the impact point — time-of-flight `T = D / V`, the
 *   same relation retail uses for direct fire (spec 06 §3.2).
 * - Shells (`solveBallistic`): low-angle ballistic root under `GRAVITY`,
 *   `tanθ = (V² − √disc) / (g·R)` with
 *   `disc = V⁴ − g·(g·R² + 2·dy·V²)` — the flat-trajectory solution retail's
 *   §3.3 solver prefers (plus root first, capped at π/4 there; here the low
 *   root stands alone, clamped only by the mount limits). Returns null when
 *   the target is unreachable (negative discriminant — retail's 0x8000
 *   no-solution sentinel, which blocks the shot instead of faking it).
 */
export interface ShotSolution {
  /** Initial velocity vector, world units/s (integrate with gravity). */
  velocity: CombatVec3;
  /** Flight time to the impact point, seconds. */
  duration: number;
  /** Barrel elevation above horizontal, radians (aim the barrel here). */
  elevation: number;
}

/** Straight-line muzzle solution for bolts. Null when ~zero distance. */
export function solveDirect(from: CombatVec3, to: CombatVec3, speed: number): ShotSolution | null {
  if (!(speed > 0)) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist > 1e-6)) return null;
  const duration = dist / speed;
  return {
    velocity: { x: (dx / dist) * speed, y: (dy / dist) * speed, z: (dz / dist) * speed },
    duration,
    elevation: Math.atan2(dy, Math.hypot(dx, dz)),
  };
}

/**
 * Ballistic muzzle solution for shells under `gravity`. Null when the
 * impact is out of range (no real root) or degenerate.
 */
export function solveBallistic(
  from: CombatVec3,
  to: CombatVec3,
  speed: number,
  gravity = GRAVITY,
): ShotSolution | null {
  if (!(speed > 0) || !(gravity > 0)) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const planar = Math.hypot(dx, dz);
  if (!(planar > 1e-6)) return null;
  const v2 = speed * speed;
  const disc = v2 * v2 - gravity * (gravity * planar * planar + 2 * dy * v2);
  if (!(disc >= 0)) return null;
  // Low-angle root: flat trajectory, short flight — the physical pick for
  // every reachable target (retail tests this root first, §3.3).
  const tanTheta = (v2 - Math.sqrt(disc)) / (gravity * planar);
  const elevation = Math.atan(tanTheta);
  const cosE = Math.cos(elevation);
  if (!(cosE > 1e-6)) return null;
  const horizontal = speed * cosE;
  const duration = planar / horizontal;
  const ux = dx / planar;
  const uz = dz / planar;
  return {
    velocity: {
      x: ux * horizontal,
      y: speed * Math.sin(elevation),
      z: uz * horizontal,
    },
    duration,
    elevation,
  };
}

/** Dispatch to the direct or ballistic solver by weapon kind. */
export function solveShot(
  kind: UnitKind,
  from: CombatVec3,
  to: CombatVec3,
): ShotSolution | null {
  const profile = WEAPON_PROFILES[kind];
  if (!profile) return null;
  return profile.shot === "shell"
    ? solveBallistic(from, to, profile.speed, GRAVITY)
    : solveDirect(from, to, profile.speed);
}

/** Flight time for a bolt covering `distance` at muzzle `speed`. */
export function flightDuration(distance: number, speed: number): number {
  if (!(speed > 0)) return 0.5;
  return Math.min(Math.max(distance / speed, 0), FLIGHT_MAX_TIME);
}

/**
 * Projectile position `t` seconds after leaving the muzzle at `velocity`
 * under `gravity` (0 for bolts): `p = start + v·t − ½·g·t²·ŷ`. Analytic in
 * `t`, so the flight is exact and frame-rate independent for any `dt`
 * sequence — the muzzle solution lands on the impact point at
 * `t = duration` by construction.
 */
export function ballisticPosition(
  start: CombatVec3,
  velocity: CombatVec3,
  t: number,
  gravity: number,
): CombatVec3 {
  const k = Math.max(t, 0);
  return {
    x: start.x + velocity.x * k,
    y: start.y + velocity.y * k - 0.5 * gravity * k * k,
    z: start.z + velocity.z * k,
  };
}

/** Instantaneous velocity `t` seconds into the flight (for mesh orienting). */
export function ballisticVelocity(
  velocity: CombatVec3,
  t: number,
  gravity: number,
): CombatVec3 {
  const k = Math.max(t, 0);
  return { x: velocity.x, y: velocity.y - gravity * k, z: velocity.z };
}

/** Muzzle height above the unit ground anchor, per kind (matches units.ts). */
export function muzzleHeight(kind: UnitKind): number {
  switch (kind) {
    case "flash":
      return 10;
    case "stump":
      return 13;
    case "hammer":
      return 22;
    case "commander":
      return 30;
  }
}

/** Muzzle forward throw from the hull center, per kind. */
export function muzzleForward(kind: UnitKind): number {
  switch (kind) {
    case "flash":
      return 12;
    case "stump":
      return 17;
    case "hammer":
      return 18;
    case "commander":
      return 6;
  }
}

/**
 * Tree interception for projectiles (flat tracers + ballistic shells).
 * A flight segment passing through live wood has a chance to get stuck /
 * detonate early instead of reaching its aimed impact; tanks answer by
 * lobbing over the canopy when the flat line of fire is blocked.
 *
 * Canopy model (matches the renderer posing in `features.ts`: round crowns
 * sit ~24 above grade with ~14-unit radius, pine cones ~28 with ~11; both
 * ride trunks ~18 tall and ~3 in radius — one conservative volume covers
 * both kinds): a sphere for the crown plus a cylinder for the trunk. Only
 * standing trees (intact/burning/smouldering — toppled/stump/snag/gone have
 * no crown left to catch a round) intercept; the caller owns that mask via
 * `TreeStand.standing`.
 */

/** Crown center lift above the tree's ground seat, world units. */
export const TREE_CANOPY_LIFT = 24;
/** Crown sphere radius, world units (conservative over both tree kinds). */
export const TREE_CANOPY_RADIUS = 16;
/** Trunk keepout radius, world units. */
export const TREE_TRUNK_RADIUS = 4;
/** Trunk height above the ground seat, world units. */
export const TREE_TRUNK_HEIGHT = 20;
/** Per-tree stick probability when a bolt crosses live wood. */
export const TREE_STICK_CHANCE_BOLT = 0.55;
/** Per-tree stick probability when a shell crosses live wood. */
export const TREE_STICK_CHANCE_SHELL = 0.35;
/** Flight sampling step for canopy-clearance tests, world units. */
export const CANOPY_SAMPLE_STEP = 16;

/** One tree as a projectile obstacle: ground seat plus standing mask. */
export interface TreeStand {
  x: number;
  z: number;
  /** Terrain surface height at the trunk base, world units. */
  groundY: number;
  /** False for felled/stump/snag/gone trees (no crown left to catch). */
  standing: boolean;
}

/** Stick chance for a shot kind crossing one live tree. */
export function treeStickChance(kind: UnitKind): number {
  return WEAPON_PROFILES[kind]?.shot === "shell"
    ? TREE_STICK_CHANCE_SHELL
    : TREE_STICK_CHANCE_BOLT;
}

/** True when the world point sits inside a standing tree's crown or trunk. */
export function pointInTree(x: number, y: number, z: number, tree: TreeStand): boolean {
  if (!tree.standing) return false;
  const dx = x - tree.x;
  const dz = z - tree.z;
  // Crown sphere first (the usual catch for flat tracers).
  const cy = tree.groundY + TREE_CANOPY_LIFT;
  const dy = y - cy;
  const r = TREE_CANOPY_RADIUS;
  if (dx * dx + dy * dy + dz * dz <= r * r) return true;
  // Trunk cylinder (low line of fire clipping the bole).
  const tr = TREE_TRUNK_RADIUS;
  if (dx * dx + dz * dz <= tr * tr && y >= tree.groundY && y <= tree.groundY + TREE_TRUNK_HEIGHT) {
    return true;
  }
  return false;
}

/**
 * Standing-tree ids whose wood the segment `a`→`b` enters, ascending
 * (deterministic encounter order for seeded stick rolls). Broadphase: one
 * XZ corridor reject per tree (canopy radius), then exact segment tests —
 * segment-sphere for the crown, slab test for the trunk cylinder — so long
 * flights past a forest cost one cheap reject per tree.
 */
export function treesOnSegment(
  a: CombatVec3,
  b: CombatVec3,
  trees: readonly TreeStand[],
): number[] {
  const hit: number[] = [];
  const minX = Math.min(a.x, b.x) - TREE_CANOPY_RADIUS;
  const maxX = Math.max(a.x, b.x) + TREE_CANOPY_RADIUS;
  const minZ = Math.min(a.z, b.z) - TREE_CANOPY_RADIUS;
  const maxZ = Math.max(a.z, b.z) + TREE_CANOPY_RADIUS;
  const minY = Math.min(a.y, b.y) - TREE_CANOPY_RADIUS;
  const maxY = Math.max(a.y, b.y) + TREE_CANOPY_RADIUS;
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i]!;
    if (!tree.standing) continue;
    if (tree.x < minX || tree.x > maxX || tree.z < minZ || tree.z > maxZ) continue;
    const cy = tree.groundY + TREE_CANOPY_LIFT;
    if (cy < minY || cy > maxY) continue;
    let struck = false;
    // Crown: segment-sphere intersection.
    if (len2 > 1e-9) {
      const ox = a.x - tree.x;
      const oy = a.y - cy;
      const oz = a.z - tree.z;
      const t = Math.min(Math.max(-(ox * abx + oy * aby + oz * abz) / len2, 0), 1);
      const px = a.x + abx * t - tree.x;
      const py = a.y + aby * t - cy;
      const pz = a.z + abz * t - tree.z;
      const r = TREE_CANOPY_RADIUS;
      struck = px * px + py * py + pz * pz <= r * r;
    } else {
      struck = pointInTree(a.x, a.y, a.z, tree);
    }
    // Trunk: XZ slab crossing while the segment's Y overlaps the bole.
    if (!struck) {
      const tr = TREE_TRUNK_RADIUS;
      const segMinX = Math.min(a.x, b.x) - tr;
      const segMaxX = Math.max(a.x, b.x) + tr;
      const segMinZ = Math.min(a.z, b.z) - tr;
      const segMaxZ = Math.max(a.z, b.z) + tr;
      if (
        tree.x >= segMinX && tree.x <= segMaxX &&
        tree.z >= segMinZ && tree.z <= segMaxZ &&
        Math.min(a.y, b.y) <= tree.groundY + TREE_TRUNK_HEIGHT &&
        Math.max(a.y, b.y) >= tree.groundY
      ) {
        // Closest XZ approach of the segment to the trunk axis.
        const abx2 = b.x - a.x;
        const abz2 = b.z - a.z;
        const xz2 = abx2 * abx2 + abz2 * abz2;
        let cx = a.x;
        let cz = a.z;
        let cySeg = a.y;
        if (xz2 > 1e-9) {
          const t = Math.min(
            Math.max(((tree.x - a.x) * abx2 + (tree.z - a.z) * abz2) / xz2, 0),
            1,
          );
          cx = a.x + abx2 * t;
          cz = a.z + abz2 * t;
          cySeg = a.y + aby * t;
        }
        const ddx = cx - tree.x;
        const ddz = cz - tree.z;
        struck =
          ddx * ddx + ddz * ddz <= tr * tr &&
          cySeg >= tree.groundY &&
          cySeg <= tree.groundY + TREE_TRUNK_HEIGHT;
      }
    }
    if (struck) hit.push(i);
  }
  return hit;
}

/**
 * True when the whole flight `start` + `velocity` under `gravity` for
 * `duration` seconds avoids every standing tree. Samples the analytic arc
 * every `CANOPY_SAMPLE_STEP` world units (plus the endpoint), testing short
 * sub-segments exactly — cheap enough to run per firing solution.
 */
export function flightClearsTrees(
  start: CombatVec3,
  velocity: CombatVec3,
  gravity: number,
  duration: number,
  trees: readonly TreeStand[],
): boolean {
  if (trees.length === 0) return true;
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const steps = Math.min(Math.max(Math.ceil((speed * duration) / CANOPY_SAMPLE_STEP), 1), 256);
  let prev = { ...start };
  for (let s = 1; s <= steps; s++) {
    const p = ballisticPosition(start, velocity, (duration * s) / steps, gravity);
    if (treesOnSegment(prev, p, trees).length > 0) return false;
    prev = p;
  }
  return true;
}

/**
 * High-angle ballistic root for shells (`tanθ = (V² + √disc) / (g·R)` —
 * retail's §3.3 solver tests the low root first and keeps the high root for
 * high-arc fire). Same impact, same muzzle speed, longer hang time over the
 * canopy. Null under the same conditions as `solveBallistic`.
 */
export function solveBallisticHigh(
  from: CombatVec3,
  to: CombatVec3,
  speed: number,
  gravity = GRAVITY,
): ShotSolution | null {
  if (!(speed > 0) || !(gravity > 0)) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const planar = Math.hypot(dx, dz);
  if (!(planar > 1e-6)) return null;
  const v2 = speed * speed;
  const disc = v2 * v2 - gravity * (gravity * planar * planar + 2 * dy * v2);
  if (!(disc >= 0)) return null;
  const tanTheta = (v2 + Math.sqrt(disc)) / (gravity * planar);
  const elevation = Math.atan(tanTheta);
  const cosE = Math.cos(elevation);
  if (!(cosE > 1e-6)) return null;
  const horizontal = speed * cosE;
  const duration = planar / horizontal;
  const ux = dx / planar;
  const uz = dz / planar;
  return {
    velocity: {
      x: ux * horizontal,
      y: speed * Math.sin(elevation),
      z: uz * horizontal,
    },
    duration,
    elevation,
  };
}

export interface CanopySolution {
  solution: ShotSolution;
  /** True when the gun lobbed over wood (shell high root). */
  elevated: boolean;
}

/**
 * Firing solution that respects the woods. Shells prefer the flat low root,
 * but when it clips wood they lob the high root over the canopy when that
 * clears (and fits the flight-time safety net); when neither root clears,
 * the flat round still leaves — the interception roll below may catch it in
 * the branches. Bolts fly flat and cannot lob: they stay on the target line
 * and accept the stick risk, which is what makes tracers get stuck in
 * forests while artillery answers by shooting higher.
 */
export function solveShotClearing(
  kind: UnitKind,
  from: CombatVec3,
  to: CombatVec3,
  trees: readonly TreeStand[],
): CanopySolution | null {
  const profile = WEAPON_PROFILES[kind];
  if (!profile) return null;
  if (profile.shot === "shell") {
    const low = solveBallistic(from, to, profile.speed, GRAVITY);
    if (!low) return null;
    if (flightClearsTrees(from, low.velocity, GRAVITY, low.duration, trees)) {
      return { solution: low, elevated: false };
    }
    const high = solveBallisticHigh(from, to, profile.speed, GRAVITY);
    if (
      high && high.duration > 0 && high.duration <= LOBBED_MAX_TIME &&
      flightClearsTrees(from, high.velocity, GRAVITY, high.duration, trees)
    ) {
      return { solution: high, elevated: true };
    }
    return { solution: low, elevated: false };
  }
  const direct = solveDirect(from, to, profile.speed);
  if (!direct) return null;
  return { solution: direct, elevated: false };
}

/**
 * Roll interception for one flight segment crossing live wood: for each
 * crossed tree in ascending (deterministic) order, roll the per-kind stick
 * chance. Returns the first stuck tree id, or -1 when the round flies on.
 * Consumes rng only for crossed trees, so open-ground flights cost no
 * entropy and replay identically with or without nearby woods.
 */
export function rollTreeStick(
  crossed: readonly number[],
  kind: UnitKind,
  rng: () => number,
): number {
  const chance = treeStickChance(kind);
  for (const fid of crossed) {
    if (rng() < chance) return fid;
  }
  return -1;
}
