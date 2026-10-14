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

/** Barrel elevation clamp, radians: slight depression to high lob. */
export const ELEVATION_MIN = -0.15;
export const ELEVATION_MAX = 1.1;

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
