import type { UnitKind } from "./types.js";

/**
 * Ambient-skirmish combat helpers for the demo: random attacker/target
 * pairing plus projectile kinematics. Framework-free (no three.js) so the
 * web renderer and vitest can both consume it directly.
 *
 * Nanolathe parallel: the retail weapon catalog drives shots from per-slot
 * reload timers with velocity/range/burst fields (retail spec §2); here a
 * single interval scheduler picks pairs instead of simulating slots, and
 * per-kind speed/arc profiles stand in for catalog velocity/ballistic flags.
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

/** Per-kind weapon profile: flight speed, shell arc, tracer color. */
export interface WeaponProfile {
  shot: ShotKind;
  /** World units per second. */
  speed: number;
  /** Apex lift above the straight line, in world units. */
  arc: number;
  /** Tracer/projectile tint as 0xRRGGBB. */
  color: number;
  /** Seconds of muzzle flash + recoil kick. */
  flashTime: number;
}

export const WEAPON_PROFILES: Record<UnitKind, WeaponProfile> = {
  // Fast light tank: flat tracer bolt (cf. nanolathe plasma/cannon shots).
  flash: { shot: "bolt", speed: 1300, arc: 18, color: 0xffd34d, flashTime: 0.12 },
  // Medium tank: heavier flat bolt.
  stump: { shot: "bolt", speed: 1050, arc: 24, color: 0xff9a3c, flashTime: 0.14 },
  // Artillery: slow ballistic shell with a high arc (cf. TA ballistic solver).
  hammer: { shot: "shell", speed: 520, arc: 170, color: 0xff6a2a, flashTime: 0.18 },
  // Commander: heavy blue-white bolt (D-gun read as a tracer, not a beam).
  commander: { shot: "bolt", speed: 900, arc: 30, color: 0x7fd4ff, flashTime: 0.16 },
};

/** Scheduler bounds: seconds between ambient shots. */
export const SHOT_DELAY_MIN = 0.35;
export const SHOT_DELAY_MAX = 1.1;
/** Perf caps: concurrent tracers and the flights they may spawn. */
export const MAX_SHOTS = 6;
export const MAX_EXPLOSIONS = 8;

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

/** Flight time for a shot covering `distance` at `speed` (clamped sane). */
export function flightDuration(distance: number, speed: number): number {
  if (!(speed > 0)) return 0.5;
  return Math.min(Math.max(distance / speed, 0.18), 3.0);
}

/**
 * Projectile position at normalized time `t` (0..1): straight lerp plus a
 * parabolic lift peaking at `arc` mid-flight. `t` is clamped.
 */
export function projectilePosition(
  start: CombatVec3,
  end: CombatVec3,
  t: number,
  arc: number,
): CombatVec3 {
  const k = Math.min(Math.max(t, 0), 1);
  return {
    x: start.x + (end.x - start.x) * k,
    y: start.y + (end.y - start.y) * k + Math.sin(k * Math.PI) * arc,
    z: start.z + (end.z - start.z) * k,
  };
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
