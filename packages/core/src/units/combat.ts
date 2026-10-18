import type { AttackMode, UnitKind } from "./types.js";

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
  // Infantry scout: automatic-rifle tracer — the fastest bolt on the field,
  // a small bullet with a short flash, fired in a rapid light beat (see
  // `SHOT_DELAY`) that chips per hit (see `UNIT_HIT_DAMAGE`).
  peewee: { shot: "bolt", speed: 1300, color: 0x9fe8ff, flashTime: 0.08 },
};

/**
 * Gravity for ballistic shells, world units/s² (retail reads a gravity
 * global in its §3.3 solver; here one constant for the single shell weapon).
 * With the hammer's 520 u/s muzzle velocity the level-ground ballistic max
 * is V²/g ≈ 1931 units, but doctrine admits only `WEAPON_MAX_RANGE.hammer`
 * (see below), so artillery duels stay readable and map-end HQs are safe
 * from cross-map lobs.
 */
export const GRAVITY = 140;

/** Scheduler bounds: seconds between ambient shots. */
export const SHOT_DELAY_MIN = 0.35;
export const SHOT_DELAY_MAX = 1.1;

/**
 * Per-kind scheduler bounds: seconds between ambient shots after a volley
 * from `kind` leaves. The commander cycles roughly twice as fast as the
 * tank guns; the peewee runs an automatic-rifle beat about four times
 * quicker than the tanks — the retail Peewee's `emg` slot authors a 0.4 s
 * reload with 3-round bursts against much slower tank pieces, and the demo
 * reads the same split at the ambient scheduler: a rapid light gun firing
 * small fast bullets that chip per hit (see `UNIT_HIT_DAMAGE`) instead of a
 * slow heavy one. Tank bounds match the legacy global window exactly, so
 * non-walker pacing is bit-identical with or without the table.
 */
export const SHOT_DELAY: Record<UnitKind, { min: number; max: number }> = {
  flash: { min: SHOT_DELAY_MIN, max: SHOT_DELAY_MAX },
  stump: { min: SHOT_DELAY_MIN, max: SHOT_DELAY_MAX },
  hammer: { min: SHOT_DELAY_MIN, max: SHOT_DELAY_MAX },
  commander: { min: 0.22, max: 0.65 },
  peewee: { min: 0.09, max: 0.28 },
};

/** Scheduler bounds for volleys from `kind` (falls back to the global window). */
export function shotDelayFor(kind: UnitKind): { min: number; max: number } {
  return SHOT_DELAY[kind] ?? { min: SHOT_DELAY_MIN, max: SHOT_DELAY_MAX };
}
/**
 * Refire slowdown while the gunner displaces: a volley fired on the move
 * reloads this much slower than the same volley fired at rest, so driving
 * guns read as firing on the move without matching a dug-in beat. Retail
 * has no such coupling (nanolathe R-STANCE-01 §6: stock mobiles are
 * maneuver + fire-at-will, and weapon reloads run per slot regardless of
 * the drive) — the penalty is game feel, not a retail port, sized as an
 * exact power of two so the moving/stationary ratio pins exactly.
 */
export const MOVING_REFIRE_MULTIPLIER = 2;
/** Army-sized tracer budget; expensive explosion effects remain separately capped. */
export const MAX_SHOTS = 128;
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

/**
 * Barrel elevation clamp, radians: slight depression for every mount, and a
 * per-kind ceiling. The hammer's 70° cap is the realistic self-propelled
 * howitzer band (retail-adjacent pieces span 65–75°): it still makes every
 * flat low-root shot inside doctrine range (≤16° level, ≤~67° up extreme
 * cliffs) but refuses the near-vertical 80°+ high roots, so artillery answers
 * blocked canopy with flat fire into the branches instead of mortar-lobbing
 * over it, and ridge-blocked guns hold fire for a reposition. Other mounts
 * keep the legacy near-vertical ceiling — bolts aim near-flat anyway, and the
 * peewee's steep toss is a hand-thrown grenade, not a cannon lay.
 */
export const ELEVATION_MIN = -0.15;
export const ELEVATION_MAX: Record<UnitKind, number> = {
  flash: 1.45,
  stump: 1.45,
  hammer: (7 * Math.PI) / 18,
  commander: 1.45,
  peewee: 1.45,
};

/** Clamp a barrel elevation into the kind's physical mount range. */
export function clampElevation(elevation: number, kind: UnitKind): number {
  const max = ELEVATION_MAX[kind] ?? 1.45;
  return Math.min(Math.max(elevation, ELEVATION_MIN), max);
}

/**
 * Barrel elevation rate per kind, radians per second. Elevating gears trail
 * the turret yaw slew (cf. `TURRET_SLEW_RATE` in facing.ts): the heavy
 * howitzer cranks slowest, so a lay from rest to a flat solution takes ~1 s
 * of visible traverse instead of snapping there in one frame, while the
 * infantry hand-cannon flicks fast. Shots only leave once the tube is on the
 * solution (see `ELEVATION_AIM_TOLERANCE`), the pitch twin of the yaw
 * traverse-then-fire gate.
 */
export const ELEVATION_SLEW_RATE: Record<UnitKind, number> = {
  flash: 1.1,
  stump: 0.9,
  hammer: 0.5,
  // Torso-aimed walker: no elevating barrel, rate unused (kept for table shape).
  commander: 1.0,
  peewee: 1.6,
};

/** Barrel error under which a shot may leave the muzzle, radians (~2.9°). */
export const ELEVATION_AIM_TOLERANCE = 0.05;

/** Step `current` toward `target` linearly (no angle wrap), at most `maxStep`. */
export function stepElevation(current: number, target: number, maxStep: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}
/** Longest allowed canopy-lob flight, seconds (high roots hang ~7.4s). */
export const LOBBED_MAX_TIME = 8;

/**
 * Max engagement range per kind, world units (retail's admission range
 * test, spec 06 §3.3): bolts fly straight, shells are ballistically
 * solvable far — but doctrine caps both well below the physical limits so
 * guns hold fire across the map instead of lobbing the enemy HQ from their
 * own half. The caps sit well under half a battle-map width (320 cells × 16 =
 * 5120): only attackers that push deep into the far half can shell its HQ.
 */
export const WEAPON_MAX_RANGE: Record<UnitKind, number> = {
  flash: 900,
  stump: 850,
  hammer: 1000,
  commander: 800,
  // Infantry peashooter: short reach — scouts must close to brawl.
  peewee: 550,
};

export function maxRangeFor(kind: UnitKind): number {
  const profile = WEAPON_PROFILES[kind];
  if (!profile) return 0;
  const cap = WEAPON_MAX_RANGE[kind] ?? 0;
  if (profile.shot === "shell") return Math.min((profile.speed * profile.speed) / GRAVITY, cap);
  return Math.min(profile.speed * FLIGHT_MAX_TIME, cap);
}

/**
 * True when a muzzle-to-impact shot at `distance` may leave the barrel.
 * `rangeScale` stretches the doctrine cap for veteran gunners (see
 * `rangeMultiplierForRank`); the default 1 keeps the legacy gate
 * byte-identical, and the point-blank floor never scales — veterans shoot
 * further, not closer.
 */
export function inRange(kind: UnitKind, distance: number, rangeScale = 1): boolean {
  const cap = maxRangeFor(kind) * (rangeScale > 0 ? rangeScale : 1);
  return distance >= MIN_RANGE && distance <= cap;
}

/**
 * Aim dispersion: the longer the shot, the wider it lands around the aim
 * point — artillery most of all. Radius grows linearly past a deadzone
 * (close-range gunnery stays dead-on), capped per kind so rounds never stray
 * "too far off target" (caps sit at or under the kind's `BLAST_RADIUS`, so a
 * max-range stray still splashes its mark). Pure; the caller rolls the offset
 * with its seeded rng via `disperseAim`, so replay streams stay deterministic.
 */
export const AIM_SCATTER_DEADZONE = 150;
/** Extra scatter radius per world unit past the deadzone, per kind. */
export const AIM_SCATTER_RATE: Record<UnitKind, number> = {
  flash: 0.02,
  stump: 0.025,
  hammer: 0.06,
  commander: 0.02,
  peewee: 0.02,
};
/** Hard cap on scatter radius, per kind (bounded stray, never a wild miss). */
export const AIM_SCATTER_MAX: Record<UnitKind, number> = {
  flash: 24,
  stump: 28,
  hammer: 60,
  commander: 24,
  peewee: 20,
};

/** Scatter radius for a shot of `distance` world units, per kind. */
export function scatterRadius(kind: UnitKind, distance: number): number {
  if (!(distance > AIM_SCATTER_DEADZONE)) return 0;
  const rate = AIM_SCATTER_RATE[kind] ?? 0;
  const cap = AIM_SCATTER_MAX[kind] ?? 0;
  return Math.min((distance - AIM_SCATTER_DEADZONE) * rate, cap);
}

/**
 * Scatter an aim point uniformly inside the `scatterRadius` disc around
 * `point` (even density: `r = R·√rng`, `θ = 2π·rng`). XZ only — height is the
 * caller's seat (impact lift, terrain grade). Consumes two rng draws when
 * scattering, none inside the deadzone, so close-range streams replay
 * identically with or without the feature. Returns a fresh point.
 */
export function disperseAim(
  point: CombatVec3,
  kind: UnitKind,
  distance: number,
  rng: () => number,
): CombatVec3 {
  const radius = scatterRadius(kind, distance);
  if (!(radius > 0)) return { x: point.x, y: point.y, z: point.z };
  const theta = rng() * Math.PI * 2;
  const r = radius * Math.sqrt(rng());
  return {
    x: point.x + Math.cos(theta) * r,
    y: point.y,
    z: point.z + Math.sin(theta) * r,
  };
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
 * Seconds until the next ambient shot after a volley from `kind`: uniform
 * inside that kind's `SHOT_DELAY` window, so peewee/commander volleys
 * quicken the shared cadence while tank volleys keep the legacy pace. The
 * single-timer scheduler stays (one ambient gun at a time); the attacker's
 * refire sets the next beat, which is what makes the rapid light guns read
 * as faster-firing in the mix without per-unit cooldown state. A volley
 * fired on the move (`moving`) reloads `MOVING_REFIRE_MULTIPLIER` slower:
 * the penalty scales the drawn value post-draw, so the rng stream stays
 * aligned either way and the stationary beat is bit-identical with or
 * without the flag.
 */
export function nextShotDelayFor(kind: UnitKind, rng: () => number, moving = false): number {
  const { min, max } = shotDelayFor(kind);
  const delay = nextShotDelay(rng, min, max);
  return moving ? delay * MOVING_REFIRE_MULTIPLIER : delay;
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
 * Pick a random ordered attacker/target pair across team lines: the attacker
 * and the target must fight for different sides. Returns null when fewer
 * than two units exist or one side has no units (nothing hostile to shoot).
 * Uniform over ordered cross-team pairs in roster order — one rng draw, so
 * live rosters replay deterministically. Wrecks are the caller's filter
 * (pass only live rosters, or live index lists with their teams).
 */
export function pickHostilePair(
  unitCount: number,
  teams: readonly (number | undefined)[],
  rng: () => number,
): SkirmishPair | null {
  if (unitCount < 2) return null;
  const pairs: SkirmishPair[] = [];
  for (let attacker = 0; attacker < unitCount; attacker++) {
    const side = teams[attacker];
    if (side === undefined) continue;
    for (let target = 0; target < unitCount; target++) {
      if (target === attacker) continue;
      if (teams[target] === undefined || teams[target] === side) continue;
      pairs.push({ attacker, target });
    }
  }
  if (pairs.length === 0) return null;
  return pairs[Math.floor(rng() * pairs.length)] ?? null;
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
      return 16.9;
    case "peewee":
      return 9;
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
      return 8.95;
    case "peewee":
      return 8;
  }
}

/** Lateral muzzle offset in the hull frame (+X right, -X left). */
export function muzzleSide(kind: UnitKind): number {
  return kind === "commander" ? -7.1 : 0;
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
/**
 * Consecutive tree-stuck rounds after which a gun asks for a reposition
 * instead of firing into the wood forever: the renderer counts per-attacker
 * rounds swallowed by live trees (see `rollTreeStick`) and, on the Nth
 * consecutive stick, reports the shot as obstructed so the hull closes
 * toward its target — out of the forest when the enemy stands outside it,
 * closer (fewer crossed crowns) when both stand inside — through the same
 * pursuit drive terrain-blocked guns use. A round that reaches its impact
 * resets the count: only *consecutive* futility moves the hull. Sized like
 * the retaliation precedents (`HQ_DEFENSE_HITS`): one stray ember is canopy
 * noise, three in a row is a blocked lane.
 */
export const FOREST_STICK_REPOSITION_HITS = 3;
/**
 * Consecutive wood-blocked launch holds after which a gun fires through the
 * standing wood anyway instead of holding forever: the renderer counts
 * per-attacker volleys refused by the pre-launch tree gate (see
 * `flightClearsTrees`) and, on the Nth consecutive hold, launches the round
 * regardless — the in-flight stick rolls (see `rollTreeStick`) and the
 * struck-tree damage then resolve the lane physically: rounds mostly stick,
 * crowns catch fire and fall, and an eventual round gets through. A launched
 * round resets the count: only *consecutive* futility fires blind. Without
 * this, two enemies with wood on the lane (a hull parked in a crown has no
 * clear seat at any stand-off) hold fire forever — each hold refreshes the
 * reposition pursuit that has nowhere better to stand, so nothing ever
 * shoots until the player moves a hull by hand. Terrain/range/mount holds
 * never count: dirt is hard cover (reposition or hold), wood is soft cover
 * fire destroys. Sized like the stick precedent above: three patient holds,
 * then hose the wood.
 */
export const FOREST_HOLD_FIRE_THROUGH_HITS = 3;

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
 * Boolean twin of `treesOnSegment` for per-tick occlusion/aim checks: true
 * when any standing tree's wood enters the segment `a`→`b`, with the same
 * broadphase + exact crown/trunk tests but an early `true` instead of
 * collecting the fid list — no per-call array when nothing (or something)
 * is hit. Pure; results agree with `treesOnSegment(a, b, trees).length > 0`.
 */
export function treesIntersectSegment(
  a: CombatVec3,
  b: CombatVec3,
  trees: readonly TreeStand[],
): boolean {
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
    if (struck) return true;
  }
  return false;
}

/**
 * Counting twin of `treesOnSegment` for capped penalties: how many standing
 * trees' wood the segment `a`→`b` enters, stopping early once the count
 * passes `limit` (returns `limit + 1` then — enough to saturate any capped
 * penalty exactly). No per-call array either way. Pure; with the default
 * limit the result equals `treesOnSegment(a, b, trees).length`.
 *
 * NOTE: the three probes above/below intentionally inline the same
 * broadphase + exact tests instead of sharing a per-tree helper — a shared
 * helper measured 2.5x slower per scan (call + scratch indirection on the
 * hottest reject path). Keep the three bodies in sync when the geometry
 * changes.
 */
export function countTreesOnSegment(
  a: CombatVec3,
  b: CombatVec3,
  trees: readonly TreeStand[],
  limit: number = Number.POSITIVE_INFINITY,
): number {
  const cap = typeof limit === "number" && limit >= 0 ? limit : 0;
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
  let count = 0;
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
    if (struck) {
      count++;
      if (count > cap) return count;
    }
  }
  return count;
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
    if (treesIntersectSegment(prev, p, trees)) return false;
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
 * Peewee close-range grenade lob: the infantry secondary inside the
 * peashooter's reach. Doctrine: `PEEWEE_GRENADE_RANGE` sits just past the
 * 180 knife-fight stand-off (grenades start where the brawl does) and well
 * inside the 550 bolt reach, so scouts shoot bolts on approach and switch to
 * lobs once they close.
 *
 * Use the low ballistic root at 300 u/s: a short, gravity-driven toss,
 * rather than a near-vertical mortar launch. Range, damage and cadence stay
 * unchanged; infantry-green tint distinguishes it from the cannon.
 */

/** Muzzle-to-impact distance inside which peewees lob grenades, world units. */
export const PEEWEE_GRENADE_RANGE = 220;
/** Grenade muzzle velocity, world units/s (slow lob, not a cannon shot). */
export const PEEWEE_GRENADE_SPEED = 300;
/** Grenade tracer/projectile tint as 0xRRGGBB (infantry green). */
export const PEEWEE_GRENADE_COLOR = 0xb8f39b;
/** Seconds of muzzle flash for a grenade lob. */
export const PEEWEE_GRENADE_FLASH_TIME = 0.14;

/** Peewee attack mode at `distance`: lobs inside grenade range, bolts past it. */
export function peeweeAttackFor(distance: number): AttackMode {
  return isPeeweeGrenadeRange(distance) ? "grenade" : "round";
}

/** True when a muzzle-to-impact shot at `distance` is a grenade lob. */
export function isPeeweeGrenadeRange(distance: number): boolean {
  return distance >= MIN_RANGE && distance <= PEEWEE_GRENADE_RANGE;
}

/**
 * Low-angle grenade solution under `GRAVITY`. Preserve the analytic flight
 * and unreachable-target rejection shared with cannon ballistics, while
 * keeping close-range throws shallow and quick.
 */
export function solvePeeweeGrenade(
  from: CombatVec3,
  to: CombatVec3,
  speed: number = PEEWEE_GRENADE_SPEED,
  gravity: number = GRAVITY,
): ShotSolution | null {
  return solveBallistic(from, to, speed, gravity);
}

/**
 * Firing solution that respects the woods and the gun mount. Shells prefer
 * the flat low root, but when it clips wood they lob the high root over the
 * canopy when that clears, fits the flight-time safety net, and stays inside
 * the kind's `ELEVATION_MAX` mount; when the lob is blocked — or the mount
 * refuses it (the hammer's 70° cap rejects every near-vertical high root at
 * doctrine ranges) — retain the flat candidate so callers can lay the tube
 * and classify the obstruction from its final muzzle. This selects a firing
 * solution, not launch admission: callers must check the resolved flight
 * against wood before launching. A low root the mount cannot make (only
 * extreme up-cliff shots) is no solution at all. Bolts cannot lob and always
 * return their direct candidate for the same final admission check.
 */
export function solveShotClearing(
  kind: UnitKind,
  from: CombatVec3,
  to: CombatVec3,
  trees: readonly TreeStand[],
  attack: AttackMode = "round",
): CanopySolution | null {
  const profile = WEAPON_PROFILES[kind];
  if (!profile) return null;
  // Grenades keep their shallow throw even near trees. Do not substitute a
  // near-vertical mortar arc to clear wood; the final live-muzzle gate
  // admits the trajectory only when the lane is actually clear.
  if (attack === "grenade" && kind === "peewee") {
    const lob = solvePeeweeGrenade(from, to, PEEWEE_GRENADE_SPEED, GRAVITY);
    if (!lob) return null;
    return { solution: lob, elevated: false };
  }
  if (profile.shot === "shell") {
    const mountMax = ELEVATION_MAX[kind] ?? 1.45;
    const low = solveBallistic(from, to, profile.speed, GRAVITY);
    // No root, or a flat root the mount cannot lay (extreme up-cliff shots):
    // hold fire rather than launch a round the barrel cannot match.
    if (!low || low.elevation > mountMax) return null;
    if (flightClearsTrees(from, low.velocity, GRAVITY, low.duration, trees)) {
      return { solution: low, elevated: false };
    }
    const high = solveBallisticHigh(from, to, profile.speed, GRAVITY);
    if (
      high && high.elevation <= mountMax &&
      high.duration > 0 && high.duration <= LOBBED_MAX_TIME &&
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

/**
 * Probability a flight crossing `crossedCount` standing trees gets stuck /
 * detonates early instead of reaching its aimed impact: `1 − (1−p)ⁿ` over
 * the per-kind stick chance. The per-tree rolls in `rollTreeStick` are what
 * the guns actually pay; this closed form is the quotable number for
 * firing-lane and advance decisions — e.g. a bolt crossing 3 crowns sticks
 * with ~0.91 probability, which is why closing through a forest reads as
 * "harder for projectiles to get through" and going around the wood is
 * usually the better path even before drive time is counted. Pure;
 * non-positive counts read as open ground (0).
 */
export function flightStickChance(crossedCount: number, kind: UnitKind): number {
  const chance = treeStickChance(kind);
  const n = Math.floor(crossedCount);
  if (!(n > 0) || !(chance > 0)) return 0;
  if (chance >= 1) return 1;
  return 1 - Math.pow(1 - chance, n);
}

/**
 * Firing-position footwork: a gun holding at stand-off should keep thinking
 * about better ground — out of the wood, off a mate's line — instead of
 * standing statue-still while its turret does all the work. `firingSidestep`
 * scores the two lateral candidates (one short shuffle each way off the
 * firing line) and names the better seat; the renderer sweep attaches it to
 * the holder's threat memory on a cooldown, forest-obstructed seeks attach
 * it on proven futility (see `ThreatMemory.sidestep`), and the pursuit
 * drive walks it like any other short leg.
 *
 * Restraint is the point: the step is small (`SIDESTEP_OFFSET`, a couple of
 * hull lengths), rare (`SIDESTEP_COOLDOWN` between steps, staggered per hull
 * so the squad never shuffles as one), and only ever taken for a strictly
 * better seat or a genuine flank — an open 1v1 lane reads null here. The
 * sweep answers that null with a combat-strafe orbit instead of a hold
 * (see `orbitStrafe`), so holders keep circling while this evaluator keeps
 * judging seats. This is the continuous twin of the forest-futility
 * reposition (see `FOREST_STICK_REPOSITION_HITS`): that one fires after
 * consecutive stuck rounds prove the lane blocked; this one keeps the gun
 * off the blocked lane (and off its mate's line) before the embers strand.
 */

/** Lateral sidestep distance off the firing line, world units. */
export const SIDESTEP_OFFSET = 48;
/** Seconds between firing-position sidesteps on one hull. */
export const SIDESTEP_COOLDOWN = 7;
/** Arrival radius around a sidestep point: inside this the step is done. */
export const SIDESTEP_ARRIVE_RADIUS = 12;
/**
 * Flank trigger: two friendlies engaging the same target from inside this
 * angular separation (radians, measured at the target) read as stacked on
 * one line, and the evaluator sidesteps to open a flanking angle. ~29°.
 */
export const FLANK_STACK_ANGLE = 0.5;

export interface SidestepOptions {
  /**
   * Live teammates already engaging the same target (world XZ): when one
   * shares the firing line inside `FLANK_STACK_ANGLE`, the step flanks away
   * from it. Absent/empty means no flanking pressure.
   */
  allies?: readonly { x: number; z: number }[] | null;
  /** Roster indices, breaking exact ties deterministically (no rng). */
  selfIndex?: number;
  targetIndex?: number;
  /** Lateral step distance (defaults to `SIDESTEP_OFFSET`). */
  offset?: number;
}

/**
 * Better firing seat for a gun at `self` engaging `target`: the better of
 * the two lateral candidates one `offset` off the firing line, or null when
 * the gun should hold. Wood scores the seat — crossed crowns on the lane
 * dominate, trees crowding the seat break near-ties — and a mate stacked on
 * the same line (inside `FLANK_STACK_ANGLE` at the target) pulls the step to
 * the far side, opening a flanking angle instead of doubling the lane. A
 * flank never steps into worse wood (a clearer consolation step, else hold),
 * and an open unshared lane always holds: no improvement, no fidget.
 * Candidate lanes reuse the shooter's height (the seat lift barely changes
 * over one shuffle). Pure; exact ties break on the roster indices.
 */
export function firingSidestep(
  self: CombatVec3,
  target: CombatVec3,
  trees: readonly TreeStand[],
  opts?: SidestepOptions,
): { x: number; z: number } | null {
  if (
    !self || !target ||
    !Number.isFinite(self.x) || !Number.isFinite(self.y) || !Number.isFinite(self.z) ||
    !Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)
  ) {
    return null;
  }
  const dx = target.x - self.x;
  const dz = target.z - self.z;
  const dist = Math.hypot(dx, dz);
  if (!(dist > 1e-6)) return null;
  const offset = opts?.offset ?? SIDESTEP_OFFSET;
  if (!(offset > 0)) return null;
  // Perpendicular of the firing line: +1 reads 90° left of self→target.
  const px = -dz / dist;
  const pz = dx / dist;
  const plus = { x: self.x + px * offset, z: self.z + pz * offset };
  const minus = { x: self.x - px * offset, z: self.z - pz * offset };
  // Wood score: crossed crowns on the lane dominate (×1000 — a blocked lane
  // always outweighs a crowded seat), trees crowding the seat add the rest.
  const crowdRadius = TREE_CANOPY_RADIUS * 1.5;
  const crowd2 = crowdRadius * crowdRadius;
  const scoreOf = (x: number, y: number, z: number): number => {
    const lane = countTreesOnSegment({ x, y, z }, target, trees);
    let crowd = 0;
    for (const tree of trees) {
      if (!tree.standing) continue;
      const cdx = tree.x - x;
      const cdz = tree.z - z;
      if (cdx * cdx + cdz * cdz <= crowd2) crowd++;
    }
    return lane * 1000 + crowd;
  };
  const s0 = scoreOf(self.x, self.y, self.z);
  // Open unshared lane: with no ally stacking this target and not a crown
  // on the seat or the lane, no step can score below zero — hold without
  // scanning the candidates. (A stacked lane still flanks: the far side at
  // equal zero wood is a genuine improvement.)
  if ((opts?.allies?.length ?? 0) === 0 && s0 === 0) return null;
  const sPlus = scoreOf(plus.x, self.y, plus.z);
  const sMinus = scoreOf(minus.x, self.y, minus.z);
  // Flank pressure: the nearest-angular ally on this target, as seen from
  // the target. Inside the stack angle the step opens away from it (the far
  // side of the firing line); past it there is nothing to flank.
  let flankPref = 0;
  const allies = opts?.allies ?? [];
  if (allies.length > 0) {
    const mx = self.x - target.x;
    const mz = self.z - target.z;
    let bestAngle = FLANK_STACK_ANGLE;
    for (const ally of allies) {
      if (!ally || !Number.isFinite(ally.x) || !Number.isFinite(ally.z)) continue;
      const ax = ally.x - target.x;
      const az = ally.z - target.z;
      const aLen = Math.hypot(ax, az);
      if (!(aLen > 1e-6)) continue;
      const cos = (mx * ax + mz * az) / (dist * aLen);
      const angle = Math.acos(Math.min(Math.max(cos, -1), 1));
      if (!(angle < bestAngle)) continue;
      bestAngle = angle;
      // Ally's side of my firing line in the target frame: cross(m, a) < 0
      // reads plus-side (verified: self (0,0), target (400,0), ally (0,100)
      // crosses negative and stands on +z, the plus candidate) — so the
      // flank prefers the opposite sign. Dead-on-line reads +1 either way.
      const cross = mx * az - mz * ax;
      flankPref = cross < 0 ? -1 : 1;
    }
  }
  const improvesPlus = sPlus < s0;
  const improvesMinus = sMinus < s0;
  if (flankPref === 0) {
    // No stacking: move only for strictly clearer ground.
    if (improvesPlus && sPlus <= sMinus) {
      if (sPlus < sMinus || defaultSidestepSide(opts) > 0) return plus;
      return minus;
    }
    if (improvesMinus) return minus;
    return null;
  }
  // Stacked: flank away, but never into worse wood.
  if (flankPref > 0 && sPlus <= s0) return plus;
  if (flankPref < 0 && sMinus <= s0) return minus;
  // The preferred flank thickens the lane: take a clearer consolation step
  // toward the mate's side over standing stacked in worsening wood, else
  // hold — a bad flank is worse than no flank.
  if (improvesPlus) return plus;
  if (improvesMinus) return minus;
  return null;
}

/** Deterministic tie-break side (+1/-1) from the roster indices. */
function defaultSidestepSide(opts?: SidestepOptions): number {
  const rawA = opts?.selfIndex;
  const rawB = opts?.targetIndex;
  const a = typeof rawA === "number" && Number.isInteger(rawA) && rawA >= 0 ? rawA : 0;
  const b = typeof rawB === "number" && Number.isInteger(rawB) && rawB >= 0 ? rawB : 0;
  return (a * 31 + b * 17) % 2 === 0 ? 1 : -1;
}

/**
 * Seconds between combat-strafe orbit steps on one hull. Short on purpose:
 * a holder walks its 48-unit step in well under a second at combat speeds,
 * so this cadence keeps most of an engaged line visibly footworking —
 * near-continuous for slow hulls, every other breath for fast ones — while
 * the per-hull stagger keeps the squad from stepping as one. The
 * seat-improvement shuffle (`SIDESTEP_COOLDOWN`) stays rare: strict
 * improvements answer on their own slower clock on top of the orbit.
 */
export const ORBIT_STRAFE_COOLDOWN = 2.5;

export interface OrbitStrafeOptions {
  /** Lateral step distance (defaults to `SIDESTEP_OFFSET`). */
  offset?: number;
  /**
   * Orbit direction override: +1 steps to the plus side of the firing line,
   * -1 to the minus side. Defaults to the deterministic index hash (see
   * `defaultSidestepSide`), so each hull circles its target a consistent
   * way without any rng. Non-finite values read as the default.
   */
  direction?: number;
  /** Roster indices, fixing the default orbit direction (no rng). */
  selfIndex?: number;
  targetIndex?: number;
  /**
   * Optional terrain probe (world XZ → blocked): candidates the drive could
   * never reach (inside a cliff, across open water) lose to the mirror side
   * like bad-wood candidates do, so the sweep never pins a hull grinding
   * into a wall it cannot climb. The caller owns the surface (the
   * renderer's `stepBlocked` probe); absent, both candidates read walkable.
   */
  blocked?: (x: number, z: number) => boolean;
}

/**
 * Combat-strafe orbit: the next footwork point for a gun holding at
 * stand-off that has no seat improvement worth taking (`firingSidestep`
 * returned null) — one lateral step circling the target instead of standing
 * statue-still while the turret works.
 *
 * Nanolathe parallel (adapted, deterministic): retail TA `Attack_Chase`
 * phase 2 never holds — its reachable cycle is close-to-range, then
 * *repeated strafes* (random points on the engagement-distance circle
 * around the target), occasionally charging and re-establishing range
 * (`research/retail-executable-spec/04-units-orders-scripts-and-movement.md`
 * [R-ORD-01 §3]). This is the repeated-strafe arm only: each step moves the
 * hull one offset laterally at roughly stand-off distance, and the sweep
 * re-arms it every `ORBIT_STRAFE_COOLDOWN`, so an even duel reads as a
 * slow circling brawl instead of two statues trading shells. The
 * charge/re-establish arms stay out — a substate machine on the threat
 * memory is a bigger change than the stall needs.
 *
 * Restraint survives in miniature: the step never worsens the firing lane
 * (a candidate crossing more crowns than the current seat loses to the
 * mirror side, and both-worse holds — a bad strafe is worse than no
 * strafe), and the sweep still refuses outnumbered hulls (waiting for
 * backup), closing hulls, advances, and assaults. An optional `blocked`
 * probe folds terrain into the same preferred-then-mirror fallback, so a
 * wall on the orbit side mirrors the step instead of pinning the hull.
 * Pure; exact ties break on the roster indices.
 */
export function orbitStrafe(
  self: CombatVec3,
  target: CombatVec3,
  trees: readonly TreeStand[],
  opts?: OrbitStrafeOptions,
): { x: number; z: number } | null {
  if (
    !self || !target ||
    !Number.isFinite(self.x) || !Number.isFinite(self.y) || !Number.isFinite(self.z) ||
    !Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)
  ) {
    return null;
  }
  const dx = target.x - self.x;
  const dz = target.z - self.z;
  const dist = Math.hypot(dx, dz);
  if (!(dist > 1e-6)) return null;
  const offset = opts?.offset ?? SIDESTEP_OFFSET;
  if (!(offset > 0)) return null;
  // Perpendicular of the firing line: +1 reads 90° left of self→target,
  // the same frame `firingSidestep` scores in.
  const px = -dz / dist;
  const pz = dx / dist;
  const plus = { x: self.x + px * offset, z: self.z + pz * offset };
  const minus = { x: self.x - px * offset, z: self.z - pz * offset };
  const dir = opts?.direction;
  const preferPlus =
    dir === 1 || dir === -1
      ? dir > 0
      : defaultSidestepSide({ selfIndex: opts?.selfIndex, targetIndex: opts?.targetIndex }) > 0;
  // Lane wood only (candidate lanes reuse the shooter's height, like the
  // seat evaluator): a crowded seat never vetoes a strafe — the seat
  // shuffle handles crowding on its own clock — but the orbit never steps
  // onto a more-blocked lane. Candidates count capped at the seat's own
  // lane: anything past it is vetoed either way, so the scan stops early.
  const lane0 = countTreesOnSegment(self, target, trees);
  const lanePlus = countTreesOnSegment({ x: plus.x, y: self.y, z: plus.z }, target, trees, lane0);
  const laneMinus = countTreesOnSegment({ x: minus.x, y: self.y, z: minus.z }, target, trees, lane0);
  const blocked = opts?.blocked;
  // A candidate must keep the lane no worse AND stand on reachable ground;
  // either veto falls through to the mirror side, then to the hold.
  const ok = (c: { x: number; z: number }, lane: number): boolean =>
    lane <= lane0 && !(blocked?.(c.x, c.z) ?? false);
  const first = preferPlus ? plus : minus;
  const firstLane = preferPlus ? lanePlus : laneMinus;
  if (ok(first, firstLane)) return first;
  const second = preferPlus ? minus : plus;
  const secondLane = preferPlus ? laneMinus : lanePlus;
  if (ok(second, secondLane)) return second;
  return null;
}

/**
 * Terrain collision for projectiles (flat tracers + ballistic shells).
 * Shots previously flew their analytic arc straight to the aimed impact and
 * only ever checked trees mid-flight, so any ridge between the muzzle and
 * the target let the round visibly pass through the hillside. Every flight
 * is now swept against the live surface instead: the arc is marched at
 * arc-length steps no longer than `TERRAIN_SAMPLE_STEP` (no tunneling even
 * for 1300 u/s bolts on long ticks) and the first below-surface sample is
 * bisected back to the contact face, so impacts seat on the dirt they hit.
 * A small `TERRAIN_GRAZE` keeps honest skimmers (rounds riding a few units
 * over a crest) from reading as hits on bilinear sampling noise.
 */

/** Longest arc-length step when sweeping a flight against terrain, world units. */
export const TERRAIN_SAMPLE_STEP = 8;
/** Surface grace: a round within this height above the dirt still flies. */
export const TERRAIN_GRAZE = 2;
/** Bisection passes refining a below-surface sample back to the contact face. */
export const TERRAIN_REFINE_STEPS = 12;
/** Hard cap on sweep samples per call (longest lobbed arc stays far below). */
export const TERRAIN_MAX_SAMPLES = 512;

/** First terrain contact of a swept flight: contact time plus world point. */
export interface TerrainHit {
  /** Seconds after leaving the muzzle (within the swept window). */
  t: number;
  /** World-space contact point on the flight arc. */
  x: number;
  y: number;
  z: number;
}

/**
 * First terrain contact of the flight `start` + `velocity` under `gravity`
 * inside the time window [`t0`, `t1`], or null when the whole window flies.
 * Marches the analytic arc at ≤`TERRAIN_SAMPLE_STEP` arc-length steps and
 * bisects the first below-surface sample (`y < groundY + TERRAIN_GRAZE`)
 * back to the contact face. Pure; the caller owns the surface (live
 * `groundY` in the renderer, synthetic ridges in tests).
 */
export function flightTerrainHit(
  start: CombatVec3,
  velocity: CombatVec3,
  gravity: number,
  t0: number,
  t1: number,
  groundY: (x: number, z: number) => number,
): TerrainHit | null {
  if (!(t1 > t0) || !(Number.isFinite(t0) && Number.isFinite(t1))) return null;
  if (
    !(
      Number.isFinite(start.x) && Number.isFinite(start.y) && Number.isFinite(start.z) &&
      Number.isFinite(velocity.x) && Number.isFinite(velocity.y) && Number.isFinite(velocity.z) &&
      Number.isFinite(gravity)
    )
  ) {
    return null;
  }
  const dt = t1 - t0;
  // Arc-length estimate: mean speed over the window (gravity bleed included)
  // times the window — an overestimate on curved arcs, which only refines.
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (!(speed >= 0)) return null;
  const est = (speed + 0.5 * Math.abs(gravity) * dt) * dt;
  if (!(est > 0)) return null;
  const steps = Math.min(Math.max(Math.ceil(est / TERRAIN_SAMPLE_STEP), 1), TERRAIN_MAX_SAMPLES);
  let prevT = t0;
  for (let s = 1; s <= steps; s++) {
    const t = t0 + (dt * s) / steps;
    const p = ballisticPosition(start, velocity, t, gravity);
    if (p.y < groundY(p.x, p.z) + TERRAIN_GRAZE) {
      // Bisect the above-surface `prevT` against the below-surface `t`.
      let lo = prevT;
      let hi = t;
      let hit = { ...p, t };
      for (let i = 0; i < TERRAIN_REFINE_STEPS; i++) {
        const mid = (lo + hi) / 2;
        const m = ballisticPosition(start, velocity, mid, gravity);
        if (m.y < groundY(m.x, m.z) + TERRAIN_GRAZE) {
          hi = mid;
          hit = { x: m.x, y: m.y, z: m.z, t: mid };
        } else {
          lo = mid;
        }
      }
      return hit;
    }
    prevT = t;
  }
  return null;
}

/**
 * True when the whole flight `start` + `velocity` under `gravity` for
 * `duration` seconds stays above the surface — the fire-time admission gate
 * (guns hold fire into a hillside instead of shooting through it) and the
 * per-tick sweep twin below share it. Null/non-positive durations read as
 * clear, so degenerate solves never block on terrain.
 */
export function flightClearsTerrain(
  start: CombatVec3,
  velocity: CombatVec3,
  gravity: number,
  duration: number,
  groundY: (x: number, z: number) => number,
): boolean {
  if (!(duration > 0)) return true;
  return flightTerrainHit(start, velocity, gravity, 0, duration, groundY) === null;
}

/**
 * Gun-tube collision with standing trunks. A traversing turret sweeps a
 * 14–32-unit tube well outside the hull-flank trunk keepout (11–14), so the
 * hull can stand clear of the wood while its cannon passes straight through
 * a bole — the clip this section fixes. The fix treats the tube as part of
 * the vehicle (the task's bounding-box hint: the hull footprint plus the
 * gun tube is the vehicle's full size for collision) and resolves contact
 * the same way hull drives do — the wood falls (`crushTree`), never the
 * barrel: traverse and fire stay sane, forests near parked guns thin the
 * way crushed lanes do. Crowns are deliberately ignored (a tube brushing
 * leaves reads fine; a tube through a bole does not), as are felled trees
 * (flat wood has no bole left to hit) and the commander (its compact
 * claw cannon turns inside the hull keepout).
 */

/** Gun-tube radius, world units (tube 1.2–1.8 plus margin, so paint never touches bark). */
export const BARREL_TUBE_RADIUS = 2;

/**
 * Gun-tube mount per tank kind: pivot height above the hull ground anchor
 * and fore/aft offset in the turret frame, plus tube length. Matches the
 * web `units.ts` build poses (flash pivot (0, 9.5, 3) + 14 tube, stump
 * (0, 12.5, 4) + 22, hammer (0, 13, 0) + 32, peewee (0, 8, 2) + 10). Null for the commander.
 */
export const BARREL_MOUNT: Record<
  UnitKind,
  { pivotY: number; pivotZ: number; length: number } | null
> = {
  flash: { pivotY: 9.5, pivotZ: 3, length: 14 },
  stump: { pivotY: 12.5, pivotZ: 4, length: 22 },
  hammer: { pivotY: 13, pivotZ: 0, length: 32 },
  commander: null,
  // Infantry hand-cannon: short tube on the little torso mount.
  peewee: { pivotY: 8, pivotZ: 2, length: 10 },
};

/** World-space gun-tube segment ends (pivot `a`, tip `b`). */
export interface BarrelSegment {
  a: CombatVec3;
  b: CombatVec3;
}

/**
 * World-space gun-tube segment for a hull at `hull` (ground-anchor position)
 * with `hullYaw` + `turretRel` aim and `elevation` barrel pitch. Null for
 * kinds without an elevating tube (commander). Pure, so the renderer and vitest share
 * the exact segment the pose draws.
 */
export function barrelSegment(
  hull: CombatVec3,
  hullYaw: number,
  turretRel: number,
  elevation: number,
  kind: UnitKind,
): BarrelSegment | null {
  const mount = BARREL_MOUNT[kind];
  if (!mount) return null;
  const abs = hullYaw + turretRel;
  const sy = Math.sin(abs);
  const cy = Math.cos(abs);
  // Pivot rides the turret (turret group sits at the hull center).
  const ax = hull.x + sy * mount.pivotZ;
  const ay = hull.y + mount.pivotY;
  const az = hull.z + cy * mount.pivotZ;
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);
  return {
    a: { x: ax, y: ay, z: az },
    b: {
      x: ax + sy * ce * mount.length,
      y: ay + se * mount.length,
      z: az + cy * ce * mount.length,
    },
  };
}

/**
 * True when the gun-tube segment `a`→`b` enters a standing tree's bole: the
 * XZ approach closes within trunk + tube radius while the tube height
 * overlaps the bole (`groundY`..`groundY + TREE_TRUNK_HEIGHT`). A lobbed
 * barrel climbing over the bole clears honestly — height is tested at the
 * closest approach, not at the endpoints. Non-standing trees never hit.
 */
export function barrelTouchesTrunk(a: CombatVec3, b: CombatVec3, tree: TreeStand): boolean {
  if (!tree.standing) return false;
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = 0;
  if (len2 > 1e-9) {
    t = Math.min(Math.max(((tree.x - a.x) * abx + (tree.z - a.z) * abz) / len2, 0), 1);
  }
  const cx = a.x + abx * t - tree.x;
  const cz = a.z + abz * t - tree.z;
  const r = TREE_TRUNK_RADIUS + BARREL_TUBE_RADIUS;
  if (cx * cx + cz * cz > r * r) return false;
  const y = a.y + (b.y - a.y) * t;
  return y >= tree.groundY && y <= tree.groundY + TREE_TRUNK_HEIGHT;
}

/**
 * Standing-tree ids whose bole the gun-tube segment `a`→`b` enters, in
 * ascending (deterministic) order for the caller's fell pass. Empty without
 * trees, so open-ground ticks cost one length check.
 */
export function trunksOnBarrel(
  a: CombatVec3,
  b: CombatVec3,
  trees: readonly TreeStand[],
): number[] {
  const hit: number[] = [];
  // Broadphase: the tube is tens of units long on a thousands-wide map, so
  // reject trees outside the tube's XZ box (± trunk + tube reach) with four
  // compares before the closest-approach math — same bit-identical-results
  // contract as the crush broadphase (outside is provably past reach, the
  // boundary still reaches the exact inclusive test).
  const r = TREE_TRUNK_RADIUS + BARREL_TUBE_RADIUS;
  const minX = Math.min(a.x, b.x) - r;
  const maxX = Math.max(a.x, b.x) + r;
  const minZ = Math.min(a.z, b.z) - r;
  const maxZ = Math.max(a.z, b.z) + r;
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i]!;
    if (!tree.standing) continue;
    if (tree.x < minX || tree.x > maxX || tree.z < minZ || tree.z > maxZ) continue;
    if (barrelTouchesTrunk(a, b, tree)) hit.push(i);
  }
  return hit;
}
