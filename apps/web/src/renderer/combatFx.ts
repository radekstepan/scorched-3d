import * as THREE from "three";
import {
  accumulateImpact,
  addScorchMark,
  aimStep,
  applyBlastToUnits,
  ballisticPosition,
  ballisticVelocity,
  barrelSegment,
  blastRadiusFor,
  type AttackMode,
  type BlastSlope,
  canFire,
  clampElevation,
  clampTurret,
  craterDepthForIntensity,
  createUnitDamage,
  disperseAim,
  ELEVATION_AIM_TOLERANCE,
  ELEVATION_MAX,
  ELEVATION_SLEW_RATE,
  FOREST_STICK_REPOSITION_HITS,
  flightClearsTerrain,
  flightClearsTrees,
  flightTerrainHit,
  GRAVITY,
  huskDecay,
  huskSink,
  IMPACT_DURATION,
  impactKick,
  impactTiltEnvelope,
  inRange,
  isDestroyed,
  isHuskGone,
  isPeeweeGrenadeRange,
  LOBBED_MAX_TIME,
  MAX_EXPLOSIONS,
  MAX_SCORCH_MARKS,
  MAX_SHOTS,
  maxRangeFor,
  muzzleForward,
  muzzleHeight,
  muzzleYaw,
  nextShotDelay,
  nextShotDelayFor,
  PEEWEE_GRENADE_COLOR,
  PEEWEE_GRENADE_FLASH_TIME,
  pickHostilePair,
  pickSkirmishPair,
  pickStrategicTarget,
  resolveScorchSeed,
  rollTreeStick,
  scorchAnisotropy,
  scorchForAttack,
  scorchSeed,
  scorchShade,
  slewTurret,
  solveBallisticHigh,
  solveShotClearing,
  stepElevation,
  THREAT_ENGAGE_RADIUS,
  treesOnSegment,
  trunksOnBarrel,
  wrapAngle,
  yawToTarget,
  WEAPON_PROFILES,
  zeroImpact,
  type ImpactKick,
  type PlacedUnit,
  type ScorchMark,
  type TreeStand,
  type UnitKind,
} from "@scorched-3d/core";
import { muzzleWorld, getBarrel, getTurret, barrelElevation, setBarrelElevation, setUnitAim, hideUnitCircles } from "./units";
import { applyUnitDamageTint, applyWreckChar, UnitDamageFx } from "./unitDamageFx";
import { disposeScorchTexture, getScorchTexture } from "./craters";
import { nightLightScale } from "./night";

/**
 * Ambient-skirmish combat FX: units randomly fire tracers/shells at each
 * other with muzzle flashes, impact explosions, pooled dynamic lights, and
 * recoil kicks. Runs inside the TerrainCanvas tick; owns every object it
 * adds to the scene and disposes them on clear/dispose.
 *
 * Nanolathe inspiration (adapted to three.js, no sprites/GAF here):
 * - `battle_sprites_projectiles.go` renders cannon shells as ballistic
 *   bodies but plasma bolts/beams as head→tail oriented strokes with a
 *   dynamic light riding the bolt — mirrored here by orienting bolt meshes
 *   along their velocity, trailing a tapered additive warp tail behind
 *   every round (stretched by its instantaneous speed), and pooling point
 *   lights for muzzle/explosion pops.
 * - Retail turret aim is yaw-relative-to-heading from the AimFrom piece
 *   (spec 06 §3.3), traversed by the COB script within its limits: hulls
 *   turn to face the target at a limited rate while the turret/barrel
 *   subgroup slews the remainder inside a clamped traverse, and the muzzle
 *   + projectile always leave down the turret line. Shots only fire once
 *   aimed; otherwise the pair keeps traversing and the scheduler retries.
 *   Far turret swings overshoot their goal a little before correcting back,
 *   the heavy-traverse overcorrect (see core `slewTurret`).
 * - The retail weapon catalog (spec 06 §2: velocity/range/reload/burst)
 *   becomes per-kind `WEAPON_PROFILES` in core (muzzle velocity/color) plus
 *   a single interval scheduler standing in for per-slot reload timers.
 *   Retail splits direct fire (`T = D / V`, spec 06 §3.2) from ballistic
 *   fire (muzzle velocity plus gravity through the §3.3 solver): bolts fly
 *   straight at muzzle velocity, shells integrate under `GRAVITY` along the
 *   low-angle firing solution, and the barrel pitches to that solution
 *   before the shot leaves the exact barrel-tip muzzle. Out-of-range pairs
 *   hold fire like the retail admission range test.
 * - Explosions pair a weapon-tinted flash shell with a rising fireball,
 *   cool-grey smoke puffs, an expanding ground shockwave ring, gravity-driven
 *   spark particles, a lingering ground glow, and a short-lived pooled light,
 *   echoing nanolathe's explosion-sprite + art-light pairing
 *   (`internal/meshscene/battle_sprites_projectiles.go` projectile families;
 *   flash-shell + smoke-column + sparks pairing from `internal/effects`). Every impact also scars the
 *   ground with a persistent scorch decal (capped separately in core) and
 *   damages nearby trees/rocks through the CombatEnv blast hook (blast
 *   core flattens, fringe ignites and chips) and splashes nearby hulls with
 *   accumulating damage (charring hull tint, damage smoke, heavy-hit
 *   embers — hulls are rocked by every splash (decaying directional shove + tilt, plus a brief drive hesitation while the rock plays); a hull that exhausts its
 *   health dies once, epicly, and leaves an exploded husk — tanks pop their
 *   turret clear and keep a breached ring, the walker slumps its torso, all
 *   charred past the live cap — that smoulders, slowly sinks, gutters out,
 *   and vanishes).
 */

interface Shot {
  mesh: THREE.Mesh;
  /**
   * Warp tail: a tapered additive cone parented to the head mesh (local
   * origin, trailing down local -Z), so it inherits the head's position
   * and velocity orientation for free — only its stretch (scale.z) and
   * opacity are re-posed per tick from the instantaneous speed.
   */
  tail: THREE.Mesh;
  /** Per-shot tail material (weapon tint + per-tick opacity, disposed with the shot). */
  tailMat: THREE.MeshBasicMaterial;
  start: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  age: number;
  dur: number;
  kind: UnitKind;
  /**
   * Which weapon fired the round: the kind's primary `round` or the peewee's
   * close-range `grenade` lob. Splashes read it for the lob damage/radius
   * (see core `blastRadiusFor`), and tree interception treats gravity rounds
   * (shells + grenades) as early-burst detonations, bolts as stuck embers.
   */
  attack: AttackMode;
  /**
   * Roster index that fired the round (and its intended target), threaded
   * through to the impact splash so victims know *who* to pursue. Fire only
   * ever crosses team lines, so the attacker is always a valid enemy threat.
   */
  attacker: number;
  target: number;
  /**
   * Aimed impact X/Z: the target position to close on when the lane proves
   * futile (see `forestSticks`) — the scattered aim point, so it tracks the
   * live hull for duels and the fort seat for structure shots alike.
   */
  tx: number;
  tz: number;
}

interface Flash {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  /** Initial scale multiplier (halos start large and faint). */
  base: number;
  /** Growth multiplier over life (halos expand wider than cores). */
  growth: number;
  /** Starting opacity (cores hot, halos faint). */
  peak: number;
}

interface Explosion {
  group: THREE.Group;
  flashMat: THREE.MeshBasicMaterial;
  flashMesh: THREE.Mesh;
  fireMat: THREE.MeshBasicMaterial;
  fireMesh: THREE.Mesh;
  smokeMat: THREE.MeshBasicMaterial;
  smokes: THREE.Mesh[];
  smokeVel: Float32Array;
  ringMat: THREE.MeshBasicMaterial;
  ringMesh: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  glowMesh: THREE.Mesh;
  points: THREE.Points;
  pointsMat: THREE.PointsMaterial;
  velocities: Float32Array;
  /** Live spark count for this explosion (epic death bursts carry more). */
  sparks: number;
  /** True for a unit-death burst: bigger, longer, brighter. */
  epic: boolean;
  age: number;
  maxAge: number;
  /** Ground-seated glow radius (kind scorch radius), for tests. */
  glowRadius: number;
  /**
   * Visual scale of the blast stack (flash/fire/smoke/sparks): 1 for every
   * gun except the peewee's automatic rifle (`PEEWEE_BLAST_SCALE`), which
   * cracks instead of booming. Epic bursts always stage at full scale.
   */
  scale: number;
}

/**
 * Transient hull nudge: one entry per rocked hull, covering both the
 * attacker's straight-back recoil kick and a victim's directional hit
 * reaction (blast shove + hull-frame pitch/roll rock from core
 * `impactKick`). Position is absolute from the seated `base` (shifted by
 * patrol motion like recoil anchors, so the kick restore never snaps a
 * driving unit backward); tilt is relative, applied on top of whatever
 * grade pose movement just seated. Position decays linearly to zero over
 * `dur` while tilt rocks back *and* forward through the shared beat (core
 * `impactTiltEnvelope` — one damped overshoot past the seat), and re-hits
 * refresh it — sustained fire keeps the hull rocking instead of restarting
 * it. Wrecks never hold entries (cleared on
 * the kill), and blasts never displace movers: this kick is renderer-side
 * only, restored exactly on expiry/clear, so drive/pathing/separation never
 * see it. The matching gameplay beat is drive hesitation (see
 * `onUnitStunned`) — the mover recoils away from the blast over the beat.
 */
interface Nudge {
  /** Seated body position the offsets decay back to (shifted by movement). */
  base: THREE.Vector3;
  /** Full-strength positional offset at envelope 1 (world X/Z). */
  ox: number;
  oz: number;
  /** Full-strength hull rock at envelope 1 (radians, YXZ pitch/roll). */
  pitch: number;
  roll: number;
  /** Seconds since the kick (re-hits refresh to 0). */
  age: number;
  /** Seconds for the envelope to reach 0. */
  dur: number;
  /** Tilt applied last tick (subtracted before recomputing — exact). */
  appliedPitch: number;
  appliedRoll: number;
  /**
   * Turret-local recoil: full-strength rearward travel along the barrel at
   * envelope 1 (body-frame units, direction re-read from the live turret yaw
   * every tick so the kick tracks traverse). Runs on its own clock
   * (`turretAge` / `turretDur`) inside the same entry, so a firing hull keeps
   * one seated base for both systems and a hit-rocked hull still kicks its
   * turret without disturbing the rock. Zero while the turret sits at rest.
   */
  turret: number;
  /** Seconds since the turret kick (each shot refreshes to 0). */
  turretAge: number;
  /** Seconds for the turret envelope to reach 0. */
  turretDur: number;
  /**
   * Walker weapon cycle, riding the turret clock: the peewee's hand-cannon
   * pumps its barrel pivot rearward (`pump` units at envelope 1, restored
   * from `barrelBase`), while the tube-less commander braces its torso back
   * (`nod` radians at envelope 1, applied through `appliedNod` like the
   * hull rock). Both are the walkers' "reloading" read — the visible weapon
   * motion at the gun itself, on top of the shared turret slide. Zero (and
   * null) for tanks and at rest.
   */
  pump: number;
  /** Rest seat of the pumped barrel pivot (exact restore on expiry/settle). */
  barrelBase: THREE.Vector3 | null;
  nod: number;
  /** Torso pitch applied last tick (subtracted before recomputing — exact). */
  appliedNod: number;
}

/**
 * Popped tank turret in flight: the actual detached turret subgroup (charred
 * with the wreck, barrel and all), thrown on `wreckPopVelocity(index)` and
 * integrated analytically under core `GRAVITY` — renderer-side, like the
 * impact rock: movers never see it. It tumbles in flight, lands on the live
 * surface, and rests there as charred litter until its husk finishes decaying
 * (`poseHusks` hides it with the body; the roster slot is retained).
 */
interface TurretDebris {
  /** The detached turret group, reparented to the scene. */
  group: THREE.Group;
  /** Analytic flight origin (turret world position at the kill). */
  start: THREE.Vector3;
  /** Launch velocity (see `wreckPopVelocity`). */
  vel: THREE.Vector3;
  /** Seconds since the kill (drives the analytic arc + tumble). */
  age: number;
  /** Tumble direction (+1 / -1, golden-hash stepped). */
  spin: number;
  /** Takeoff pitch (turret aim pose at the kill, kept through the flight). */
  pitch0: number;
  /** True once the chunk has landed (pose frozen, waits out the husk). */
  landed: boolean;
}

/** Attacker recoil: straight-back kick, world units at full envelope. */
const RECOIL_KICK = 5;
/** Attacker recoil envelope, seconds (snappy kick, faster than hit rock). */
const RECOIL_DURATION = 0.28;
/**
 * Turret-local recoil: rearward turret travel along the barrel at full
 * envelope — a fraction of the hull kick, so the gun visibly slams back
 * inside the traversing turret while the hull takes the big shove.
 */
export const TURRET_RECOIL_KICK = 1.5;
/**
 * Turret recoil envelope, seconds: instant out (full strength on the firing
 * tick) with a smooth linear return, slightly ahead of the hull kick so the
 * turret is always re-seated before its hull restores.
 */
export const TURRET_RECOIL_DURATION = 0.25;
/**
 * Walker weapon cycle: rearward pump travel of the peewee's hand-cannon
 * barrel at full envelope — the tube slides back into its mount and springs
 * forward on the turret clock, the visible "reloading" motion at the gun.
 */
export const BARREL_PUMP_KICK = 1.2;
/**
 * Walker weapon cycle: rearward torso pitch of the tube-less commander at
 * full envelope — the walker braces back off its chest cannon and recovers
 * on the turret clock. Aim is yaw-only, so the brace composes with traverse
 * instead of fighting it.
 */
export const COMMANDER_BRACE_KICK = 0.07;
const LIGHT_COUNT = 2;
const FLASH_MAX_AGE = 0.35;
/** Layered explosions live a beat longer than the old single flash. */
const EXPLOSION_MAX_AGE = 1.0;
const SPARKS_PER_EXPLOSION = 36;
/** Cool-grey smoke puffs per explosion (never brown — task 25 palette). */
const SMOKE_PER_EXPLOSION = 3;
/** Epic unit-death bursts: longer staging, bigger footprint, more debris. */
const EPIC_MAX_AGE = 1.8;
const EPIC_SMOKE_PUFFS = 6;
const EPIC_SPARKS = 80;
const EPIC_RADIUS_SCALE = 1.6;
const EPIC_LIGHT_PEAK = 5200;

/**
 * Exploded wreck dressing. Tanks lose the turret (it pops off ballistically,
 * see `wreckPopVelocity` + `TurretDebris`) and keep a breached turret ring;
 * the commander keeps its torso, slumped forward. All deterministic functions
 * of the roster index (golden-angle phasing, no rng) so replays match.
 */
/** Upward kick of a popped turret, world units/s (retail turret-pop read). */
const WRECK_POP_UP = 150;
/** Horizontal throw of a popped turret, world units/s. */
const WRECK_POP_OUT = 95;
/** Turret tumble rate in flight, rad/s (frozen on landing). */
const WRECK_TUMBLE = 5.2;
/**
 * Ambient structure-fire share: about one volley in four answers a live
 * enemy HQ instead of a hull — enough that pushed-in guns visibly shell the
 * fort, rare enough that hull duels still dominate. The exact muzzle range
 * gate still runs, so only guns inside admitted range ever fire.
 */
export const HQ_TARGET_CHANCE = 0.25;
/** Rest height of landed turret litter above the ground, world units. */
const WRECK_DEBRIS_REST = 2;
/** Breached turret-ring seat height per kind (matches the build poses). */
const WRECK_BREACH_Y: Record<UnitKind, number> = {
  flash: 7,
  stump: 9,
  hammer: 9,
  commander: 0,
  peewee: 5,
};
/** Breached turret-ring collar radius per kind (tank turret widths). */
const WRECK_BREACH_R: Record<UnitKind, number> = {
  flash: 4.5,
  stump: 6.5,
  hammer: 5.5,
  commander: 0,
  peewee: 3.5,
};
/** Breach collar fore/aft seat per kind (turret box centers). */
const WRECK_BREACH_Z: Record<UnitKind, number> = {
  flash: -1,
  stump: -2,
  hammer: -2,
  commander: 0,
  peewee: 0,
};

/** Fractional hash 0..1 of a roster index (golden-ratio phasing, no rng). */
function wreckHash(index: number): number {
  return (((index * 0.61803398875) % 1) + 1) % 1;
}

/**
 * Popped-turret launch velocity for wreck `index`: up and outward on a
 * golden-angle bearing, stepped by index so neighbouring kills throw in
 * visibly different directions. Pure for tests. The flight integrates under
 * core `GRAVITY` through `ballisticPosition`, so headless tests can pin the
 * arc exactly and replays match frame for frame.
 */
export function wreckPopVelocity(index: number): { x: number; y: number; z: number } {
  const h = wreckHash(index);
  const bearing = h * Math.PI * 2 + Math.PI / 4;
  const out = WRECK_POP_OUT + (index % 3) * 25;
  return {
    x: Math.sin(bearing) * out,
    y: WRECK_POP_UP + (index % 2) * 35,
    z: Math.cos(bearing) * out,
  };
}

/** Muzzle + impact flashes share one bounded pool (cores + halos). */
const MAX_FLASHES = 24;
/** Muzzle halo: large faint shell around the hot core. */
const HALO_SCALE = 1.9;
const HALO_GROWTH = 2.4;
const HALO_PEAK = 0.4;
/** World up (scratch tilt quaternions align ground discs from this). */
const UP = new THREE.Vector3(0, 1, 0);
/**
 * In-flight projectile glow: pooled dynamic lights riding the brightest live
 * rounds plus an additive ground blob under each one. The terrain (and water
 * and sky) are custom `ShaderMaterial`s that ignore scene lights entirely —
 * see `shaders.ts`, which has no light uniforms — so real `PointLight`s alone
 * could never brighten the dirt. The split is deliberate:
 *
 * - Pooled `PointLight`s (no shadows) light `MeshLambert` neighbors — tree
 *   trunks/canopies (`features.ts`), rocks, and hulls — with physical
 *   distance/decay falloff, exactly like the muzzle/explosion kick pool.
 * - Pooled additive ground blobs fake the same light on the unlit terrain
 *   shader: an oriented ellipse seated on `env.groundY` under each glowing
 *   round — stretched along the head→tail flight line like the projectile
 *   itself (see `projectileGlowFootprint`), fading with height above the dirt.
 *
 * Both pools are fixed-size (no per-shot alloc, no per-frame leak): the first
 * `SHOT_GLOW_LIGHTS` live rounds glow, the rest fly dark. Muzzle/explosion
 * kicks keep their own 2-light pool, untouched; wreck/husk posing is
 * untouched. Pure sim state never sees the glow.
 */
export const SHOT_GLOW_LIGHTS = 4;
/** Peak intensity of one riding glow light (matches the muzzle-kick order). */
export const SHOT_GLOW_PEAK = 1800;
/** Falloff range of the riding lights (distance + decay, no shadows). */
export const SHOT_GLOW_DISTANCE = 600;
/** Height above the dirt over which the glow fades to zero. */
export const SHOT_GLOW_RANGE = 380;
/** Ground-blob disc radius at full strength (subtle highlight, under scorch scale). */
export const SHOT_GLOW_RADIUS = 32;
/** Ground-blob peak opacity (additive, seated like the blast glow). */
export const SHOT_GLOW_OPACITY = 0.22;
/**
 * Daylight washout: by day the riding glow reads against a sunlit field, so
 * it stages at 40% — significantly subtler than the legacy full-strength
 * day glow. Daylight drowns additive pools; the round itself still reads.
 */
export const SHOT_GLOW_DAY_SCALE = 0.4;
/**
 * Night glow: still boosted over day (light sources own the dark field),
 * but staged ~19% under the shared `NIGHT_LIGHT_BOOST` — slightly subtler
 * than the legacy night glow, which bloomed too hot off the dirt.
 */
export const SHOT_GLOW_NIGHT_SCALE = 1.3;

/**
 * In-flight glow scale for the day/night toggle: daylight washout by day,
 * the gentler night boost by night. Replaces the shared `nightLightScale`
 * on the shot-glow path only — muzzle/explosion kicks keep the full boost.
 * Pure for tests.
 */
export function projectileGlowLightScale(night: boolean): number {
  return night ? SHOT_GLOW_NIGHT_SCALE : SHOT_GLOW_DAY_SCALE;
}

/**
 * Glow strength 0..1 for a projectile `height` above the dirt: full at the
 * surface, linear fade to zero at `SHOT_GLOW_RANGE`, clamped. Drives both
 * the riding-light dim and the ground-blob opacity, so night/low-light
 * flight reads near the ground and dies out on high lobbed arcs. Pure for
 * tests.
 */
export function projectileGlowFalloff(height: number): number {
  if (height <= 0) return 1;
  if (height >= SHOT_GLOW_RANGE) return 0;
  return 1 - height / SHOT_GLOW_RANGE;
}

/**
 * Ground-blob disc radius for a glow `falloff` 0..1 (clamped): shrinks
 * toward 60% as the round climbs, so high flight reads smaller as well as
 * fainter. Pure for tests.
 */
export function projectileGlowRadius(falloff: number): number {
  const f = Math.min(Math.max(falloff, 0), 1);
  return Math.max(SHOT_GLOW_RADIUS * (0.6 + 0.4 * f), 1);
}

/**
 * Ground-blob share of the visible warp tail: the blob's long axis mirrors
 * the head→tail stroke the projectile draws in the air (nanolathe reads
 * beams the same way — head→tail oriented strokes with the light riding the
 * line, `battle_sprites_projectiles.go` — and seats the projectile shadow on
 * the floor projection). A flat fast bolt streaks a long ellipse, a shell
 * climbing or diving steeply stamps near-circular, and a shell's blob
 * breathes along its arc exactly like its tail. The gain caps the tail share
 * at ~31 units (max tail × gain — about one disc width at full strength),
 * so the longest blob reads as a reflection of the round, not a cross-map
 * streak. Pure for tests.
 */
export const SHOT_GLOW_TAIL_GAIN = 0.35;

/**
 * Oriented ground-blob footprint for a projectile flying at instantaneous
 * velocity (`vx`, `vy`, `vz`) with glow `falloff` 0..1: `yaw` is the
 * horizontal flight bearing (three.js rotation.y — local +Z lands on the
 * flight line), `width` the legacy disc radius across the flight, and
 * `length` the radius plus the ground-projected tail share along it. Hovering
 * or straight-vertical flight (no horizontal component) falls back to the
 * plain circle at yaw 0. Pure for tests.
 */
export function projectileGlowFootprint(
  vx: number,
  vy: number,
  vz: number,
  falloff: number,
): { yaw: number; width: number; length: number } {
  const width = projectileGlowRadius(falloff);
  const horiz = Math.hypot(vx, vz);
  const speed = Math.hypot(horiz, vy);
  if (!(horiz > 0) || !(speed > 0)) return { yaw: 0, width, length: width };
  const flat = Math.min(horiz / speed, 1);
  return {
    yaw: Math.atan2(vx, vz),
    width,
    length: width + projectileTailLength(speed) * flat * SHOT_GLOW_TAIL_GAIN,
  };
}

/**
 * In-flight warp tail: every round drags a tapered, more transparent tail
 * behind its head along the flight line (nanolathe's head→tail beam-stroke
 * read, adapted from 2D line strokes to a 3D additive cone). The tail spans
 * a fixed window of flight time behind the head, so its stretch is the
 * instantaneous speed times `PROJECTILE_TAIL_WINDOW`, clamped: fast flat
 * bolts streak long, slow lobbed shells trail short, and a shell's tail
 * visibly breathes along its arc — shrinking toward the apex as gravity
 * bleeds its speed, stretching again on the descent. Opacity scales weakly
 * with the same speed, always well under the opaque head. Pure for tests.
 */
/** Seconds of flight the tail spans behind the head (length = speed × window). */
export const PROJECTILE_TAIL_WINDOW = 0.06;
/** Tail clamp, world units (never a nub, never a cross-map streak). */
export const PROJECTILE_TAIL_MIN = 12;
export const PROJECTILE_TAIL_MAX = 90;
/** Tail opacity band (additive over the head's opaque 1.0). */
export const PROJECTILE_TAIL_OPACITY_MIN = 0.18;
export const PROJECTILE_TAIL_OPACITY_MAX = 0.42;
/** Reference speed for full tail opacity: the fastest muzzle velocity (flash/peewee bolts). */
export const PROJECTILE_TAIL_REF_SPEED = 1300;

/**
 * Peewee automatic-rifle read: the infantry gun fires small fast bullets,
 * not cannon shells, and its impacts crack instead of booming. Both scales
 * shrink the shared projectile geos (bolt head + grenade ball, tails ride
 * along as children) and the layered blast stack (flash shell, fireball,
 * smoke, sparks, light kick); the ground ring/glow already size from the
 * core scorch radius, which is the smallest on the field for the peewee.
 * Epic death bursts always stage full-size regardless of kind.
 */
/** Head-mesh scale for peewee-fired projectiles (bolts and grenade lobs). */
export const PEEWEE_BULLET_SCALE = 0.55;
/** Blast-stack visual scale for peewee-fired (non-epic) explosions. */
export const PEEWEE_BLAST_SCALE = 0.55;
/** Peewee-fired blast staging, seconds: a short crack, not a cannon hang. */
export const PEEWEE_EXPLOSION_MAX_AGE = 0.7;

/** Tail stretch for an instantaneous `speed` (world units/s), clamped. */
export function projectileTailLength(speed: number): number {
  if (!(speed > 0)) return PROJECTILE_TAIL_MIN;
  return Math.min(Math.max(speed * PROJECTILE_TAIL_WINDOW, PROJECTILE_TAIL_MIN), PROJECTILE_TAIL_MAX);
}

/** Tail opacity for an instantaneous `speed` (world units/s), clamped. */
export function projectileTailOpacity(speed: number): number {
  if (!(speed > 0)) return PROJECTILE_TAIL_OPACITY_MIN;
  const k = Math.min(speed / PROJECTILE_TAIL_REF_SPEED, 1);
  return PROJECTILE_TAIL_OPACITY_MIN + (PROJECTILE_TAIL_OPACITY_MAX - PROJECTILE_TAIL_OPACITY_MIN) * k;
}

/**
 * Shared warp-tail geometry: a unit cone with its wide base at the local
 * origin opening forward (+Z) and its tip at -Z, so a tail parented to a
 * head mesh trails behind it when the head lookAts along its velocity and
 * scale.z stretches it to `projectileTailLength(speed)`. Owned by the fx.
 */
function makeWarpTailGeometry(): THREE.ConeGeometry {
  const geo = new THREE.ConeGeometry(2.4, 1, 8);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -0.5);
  return geo;
}
/** Scratch yaw quaternion for scorch instance orientation (no per-mark alloc). */
const _yawQuat = new THREE.Quaternion();
/** Scratch shot velocity for per-tick orientation (no per-shot alloc). */
const _shotVel = new THREE.Vector3();
/** Scratch impact point for shot resolution (consumed synchronously). */
const _shotAt = new THREE.Vector3();
/** Scratch look target for bolt orientation (no per-shot clone). */
const _shotLook = new THREE.Vector3();

/** Muzzle world position for a unit body at `pos` yawed by `rotationY`. */
export function muzzlePoint(
  pos: { x: number; y: number; z: number },
  rotationY: number,
  kind: UnitKind,
): { x: number; y: number; z: number } {
  const fx = Math.sin(rotationY);
  const fz = Math.cos(rotationY);
  const fwd = muzzleForward(kind);
  return {
    x: pos.x + fx * fwd,
    y: pos.y + muzzleHeight(kind),
    z: pos.z + fz * fwd,
  };
}

/** Impact point: the distance-scattered aim around the target hull, lifted slightly. */
export function impactPoint(
  pos: { x: number; y: number; z: number },
  rng: () => number,
  kind: UnitKind,
  distance: number,
): { x: number; y: number; z: number } {
  const aim = disperseAim({ x: pos.x, y: pos.y, z: pos.z }, kind, distance, rng);
  return {
    x: aim.x,
    y: pos.y + 6 + rng() * 8,
    z: aim.z,
  };
}

/** Environment hooks for persistent destruction: scorch seating + blasts. */
export interface CombatEnv {
  /** Terrain surface height at world (x, z), for seating scorch decals. */
  groundY: (x: number, z: number) => number;
  /**
   * Downhill blast wash at world (x, z), when the terrain is graded:
   * blasts stretch downhill instead of stamping flat circles. Absent
   * reads as flat ground (circular blasts, legacy behavior).
   */
  slopeAt?: (x: number, z: number) => BlastSlope;
  /**
   * Graduated blast damage to trees/rocks within `radius` of world (x, z):
   * core flattens, fringe ignites/chips. Units are untouched. `slope`
   * stretches the reach downhill (supplied by the fx from `slopeAt`).
   */
  blastFeatures: (x: number, z: number, radius: number, slope?: BlastSlope) => void;
  /**
   * Optional shallow visual dent of the terrain mesh at world (x, z):
   * `depth` is pre-exaggeration height units (≤0.6 per blast). Implemented by
   * the canvas, which owns the terrain geometry; purely visual — pathing and
   * unit seating read the static core heightfield.
   */
  dentTerrain?: (x: number, z: number, radius: number, depth: number, slope?: BlastSlope) => void;
  /**
   * Live tree stands for projectile interception + canopy-aware aiming,
   * indexed by feature id (round trees first, then pines — matching the
   * trunk order). Absent reads as open ground (legacy behavior: every line
   * of fire is clear, no round ever sticks).
   */
  treeStands?: () => TreeStand[];
  /**
   * A round stuck in tree `fid`: the canvas ignites/re-poses that tree
   * through the graduated damage field (shell early bursts already scar
   * through `blastFeatures`, so this mostly serves stuck bolt embers).
   */
  strikeTree?: (fid: number) => void;
  /**
   * A gun tube swept into standing tree `fid`: the canvas fells that tree
   * through `crushTree` (the hull-crush parallel — the tube is part of the
   * vehicle for collision, so contact knocks the bole flat instead of
   * letting the cannon clip through it). Absent, barrels never fell.
   */
  fellTree?: (fid: number) => void;
  /**
   * Live HQ structures for ambient structure fire, when the canvas fields
   * HQs: guns deliberately shell a live enemy HQ once it is inside their
   * admitted range (the range caps in core keep cross-map lobs impossible).
   * Absent reads as no structures (legacy behavior: every round aims at a
   * hull, and every blast splashes hulls only).
   */
  hqTargets?: () => { x: number; y: number; z: number; team: number }[];
  /**
   * A blast that also chips HQ structures at world (x, z): the canvas routes
   * it into the HQ damage state (splash + wreck + defender rally). Absent,
   * structures never take damage.
   */
  damageStructures?: (
    at: { x: number; y: number; z: number },
    kind: UnitKind,
    shooter: number | null,
    hostile: boolean,
    attack?: AttackMode,
  ) => void;
  /**
   * True while a hull is answering a live enemy (a live retaliation/hunt
   * grudge on its drive — see `UnitMovement`): HQ fire skips engaged guns,
   * so a hull shelling the fort that comes under consistent enemy fire deals
   * with the enemy first and resumes the fort once the grudge clears.
   * Absent reads as nobody engaged (legacy behavior: every admitted gun may
   * draw structure fire).
   */
  isEngaged?: (index: number) => boolean;
}

export class CombatFx {
  private scene: THREE.Scene;
  private units: THREE.Group;
  private rng: () => number;
  private timer: number;
  private shots: Shot[] = [];
  private flashes: Flash[] = [];
  private explosions: Explosion[] = [];
  private nudges = new Map<number, Nudge>();
  private lights: THREE.PointLight[] = [];
  /**
   * In-flight glow pool: riding lights + ground blobs, one slot per glowing
   * round (first `SHOT_GLOW_LIGHTS` live shots, reassigned every tick — no
   * per-shot ownership, so simultaneous volleys reuse instead of leaking).
   * Ground-blob materials are per-slot (weapon tint varies per round);
   * the disc geometry is shared and owned by the fx.
   */
  private shotGlowLights: THREE.PointLight[] = [];
  private shotGlowMeshes: THREE.Mesh[] = [];
  private shotGlowMats: THREE.MeshBasicMaterial[] = [];
  private shotGlowGeo = new THREE.CircleGeometry(1, 20);
  private fired = 0;
  /** Peewee grenade lobs fired since construction (for tests/HUD). */
  private lobs = 0;
  /** Rounds stuck in live wood (stuck bolt embers + shell early bursts). */
  private stuck = 0;
  /**
   * Kind of the most recent volley (null before the first shot): the shared
   * ambient timer reloads from that kind's `SHOT_DELAY` window, so rapid
   * walker guns quicken the cadence while tank volleys keep the legacy pace.
   */
  private lastKind: UnitKind | null = null;
  /** Per-unit aim pose: hull yaw + turret-relative yaw (core `aimStep`). */
  private aim: { hull: number; turret: number; overshoot: number }[] = [];
  /** Attacker → target traverse goals, slewed every frame until aimed. */
  private pending = new Map<number, number>();
  /** Attacker → HQ-team traverse goals for ambient structure fire. */
  private pendingHq = new Map<number, number>();
  /**
   * Attacker → barrel elevation goal (radians), set by the launch path from
   * the firing solution and slewed toward every frame at the kind's
   * `ELEVATION_SLEW_RATE` — the pitch twin of the yaw traverse. Shots only
   * leave once the tube is on the goal (see `aimBarrel`), so a lay from rest
   * to a flat solution visibly cranks instead of snapping.
   */
  private elevGoal = new Map<number, number>();
  private boltGeo = new THREE.BoxGeometry(3, 3, 18);
  private shellGeo = new THREE.SphereGeometry(3.2, 8, 6);
  private tailGeo = makeWarpTailGeometry();
  private flashGeo = new THREE.SphereGeometry(7, 10, 8);
  private shockGeo = new THREE.SphereGeometry(10, 14, 10);
  /** Layered-explosion shared geos: fireball, smoke puff, shock ring, glow. */
  private fireGeo = new THREE.SphereGeometry(9, 12, 10);
  private smokeGeo = new THREE.SphereGeometry(8, 8, 6);
  private ringGeo = new THREE.RingGeometry(1, 1.32, 40);
  private glowGeo = new THREE.CircleGeometry(1, 24);
  /** Persistent scorch decals: one shared instanced textured disc, capped in core. */
  private scorchGeo = new THREE.CircleGeometry(1, 28);  private scorchMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: getScorchTexture(),
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  private scorchMesh: THREE.InstancedMesh;
  private scorchMarks: ScorchMark[] = [];
  private scorchDummy = new THREE.Object3D();
  private scorchTint = new THREE.Color();
  /**
   * Shared exploded-wreck dressing: one breached-ring geometry + one
   * near-black char material for every tank collar (per-wreck meshes share
   * both; only instance transforms differ). Owned by the fx, disposed with
   * it; wreck bodies are reverted (collars removed) on dispose.
   */
  private wreckCollarGeo = new THREE.CylinderGeometry(1, 1.15, 0.5, 12);
  private wreckCollarMat = new THREE.MeshLambertMaterial({ color: 0x14100b });
  /** Per-unit accumulated damage 0..1 (core state; char/smoke are views). */
  private damage: number[] = [];
  /**
   * Per-unit kill flags, sized with `damage` (persistent like scorch — never
   * reset by `clearTransients`, only dropped on dispose/regen with the fx).
   * The kill transition derives from the core `isDestroyed` threshold on the
   * before/after pair of one splash, so each flag flips exactly once.
   */
  private destroyed: boolean[] = [];
  /**
   * Deterministic kill clock per unit (`elapsed` seconds at the kill, null
   * while alive), sized with `damage` and persistent like the flags. Husk
   * decay is a pure function of `elapsed - killedAt`, so re-snaps and
   * `clearTransients` (which never touch `elapsed`) cannot disturb it.
   */
  private killedAt: (number | null)[] = [];
  /** Units killed so far (wrecks persist in the roster buffers). */
  private deathCount = 0;
  /**
   * Wreck-dressing flags per unit (persistent like the kill flags): the
   * exploded-husk transform (turret pop / torso slump, breach collar,
   * deepened char) applies exactly once per kill, lazily if needed — see
   * `poseWreck` / `poseHusks`.
   */
  private wreckPosed: boolean[] = [];
  /**
   * Popped-turret debris per unit (tanks only; null otherwise), sized with
   * `damage` and persistent like the kill clock — `clearTransients` never
   * touches it, dispose drops it from the scene.
   */
  private debris: (TurretDebris | null)[] = [];
  /**
   * Fired once per kill with the wreck index so the canvas can hold the
   * mover, drop targeting/selection, and drop the minimap dot. Assigned by
   * the canvas; null in headless tests.
   */
  onUnitKilled: ((index: number) => void) | null = null;
  /**
   * Fired once per surviving hull per splash with the dealt fractional
   * damage and the blast's world X/Z, so the canvas can recoil that hull
   * away from the hit (see `UnitMovement.stunUnit`). The visual jerk back
   * is already posed here through the nudge map; this hook carries the
   * gameplay slide under it. Assigned by the canvas; null in headless
   * tests. Killing blows never fire it (the wreck holds instead) and
   * wrecks never re-fire it.
   */
  onUnitStunned: ((index: number, damageAdd: number, blastX: number, blastZ: number) => void) | null =
    null;
  /**
   * Fired once per surviving hull per hostile splash with the shooter's
   * roster index, its live position, the dealt fractional damage, and whether
   * the wound came from an arcing shell (hammer shells and peewee grenade
   * lobs — indirect fire that outranges the bolt envelope, so the victim may
   * investigate past the retaliation gates), so the canvas can steer that
   * hull's retaliation pursuit (see `UnitMovement.threatenUnit`) and traverse
   * its turret onto the shooter (see `trackThreat`). Killing blows never fire
   * it (the wreck holds instead), wrecks never re-fire it, self-splashes
   * never fire it (a hull shelled by its own blast must not pursue itself),
   * same-team shooters never fire it (friendlies never draw retaliation),
   * and non-hostile bursts (a wreck going up) never fire it. Assigned by the
   * canvas; null in headless tests.
   */
  onUnitThreatened:
    | ((victim: number, attacker: number, ax: number, az: number, damageAdd: number, shell: boolean) => void)
    | null = null;
  /**
   * Fired when a gun cannot engage through its lane: either it holds fire
   * because terrain hides its target (the arc would hit the hillside), or
   * its rounds keep sticking in live wood (`FOREST_STICK_REPOSITION_HITS`
   * consecutive sticks — the lane is blocked, not unlucky). Either way the
   * attacker must reposition toward the target — a higher vantage, closer,
   * or out of the forest — instead of shooting through the hill or feeding
   * the canopy. Carries the attacker's roster index, the intended target
   * index (-1 for a structure), and the target's world X/Z. Assigned by the
   * canvas (which steers the hull through the movement drive); null in
   * headless tests, where obstructed guns just hold fire silently.
   */
  onObstructedShot: ((attacker: number, target: number, x: number, z: number) => void) | null = null;
  /**
   * Consecutive tree-stuck rounds per attacker: every round live wood
   * swallows increments its gunner's count, every round that reaches its
   * impact clears it. On `FOREST_STICK_REPOSITION_HITS` the gun reports an
   * obstructed shot (see `onObstructedShot`) so the hull repositions toward
   * its target instead of firing into the branches forever, and the count
   * re-arms from zero — persistent futility keeps the pursuit fresh without
   * spamming the hook on every ember. Mid-flight terrain kills leave the
   * count alone (the fire-time terrain gate owns terrain); kills drop the
   * gunner's entry and `clearTransients` drops the map with the shots.
   */
  private forestSticks = new Map<number, number>();
  /** Instanced damage smoke + embers over the hulls (transient view). */
  private damageFx: UnitDamageFx;
  /** Reused husk-decay fractions for `poseHusks` (no per-tick array). */
  private huskDecayCache: number[] = [];
  /** Deterministic clock for damage smoke/ember phase (no rng per frame). */
  private elapsed = 0;
  private env: CombatEnv | null;
  private disposed = false;
  /**
   * When true, hulls are driven externally (patrol movement faces travel) and
   * combat only slews turrets relative to the live hull — firing on the move
   * once the turret line is aimed. When false (default, headless tests), the
   * hull does the gross turn via core `aimStep` as before.
   */
  private externalHull = false;
  /** Night toggle: scales struck light peaks + shot-glow via `nightLightScale`. */
  private night = false;

  constructor(
    scene: THREE.Scene,
    units: THREE.Group,
    rng: () => number = Math.random,
    env?: CombatEnv,
  ) {
    this.scene = scene;
    this.units = units;
    this.rng = rng;
    this.env = env ?? null;
    this.timer = nextShotDelay(rng);
    this.scorchGeo.rotateX(-Math.PI / 2);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.glowGeo.rotateX(-Math.PI / 2);
    this.scorchMesh = new THREE.InstancedMesh(this.scorchGeo, this.scorchMat, MAX_SCORCH_MARKS);
    this.scorchMesh.count = 0;
    this.scorchMesh.frustumCulled = false;
    this.scorchMesh.renderOrder = 2;
    this.scene.add(this.scorchMesh);
    this.damageFx = new UnitDamageFx(scene);
    for (let i = 0; i < LIGHT_COUNT; i++) {
      const light = new THREE.PointLight(0xffb36b, 0, 650, 1.8);
      this.scene.add(light);
      this.lights.push(light);
    }
    // Projectile-glow pool: riding lights start dark, ground blobs start
    // hidden; `poseShotGlow` seats them every tick shots fly.
    this.shotGlowGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < SHOT_GLOW_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffc46b, 0, SHOT_GLOW_DISTANCE, 1.8);
      this.scene.add(light);
      this.shotGlowLights.push(light);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffc46b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const blob = new THREE.Mesh(this.shotGlowGeo, mat);
      blob.visible = false;
      blob.frustumCulled = false;
      this.scene.add(blob);
      this.shotGlowMeshes.push(blob);
      this.shotGlowMats.push(mat);
    }
  }

  /** Active transient count (shots + flashes + explosions), for tests/HUD. */
  get activeCount(): number {
    return this.shots.length + this.flashes.length + this.explosions.length;
  }

  get shotCount(): number {
    return this.shots.length;
  }

  /** Live muzzle/impact flash count (cores + halos, bounded by pool). */
  get flashCount(): number {
    return this.flashes.length;
  }

  /** Live layered-explosion count (bounded by MAX_EXPLOSIONS). */
  get explosionCount(): number {
    return this.explosions.length;
  }

  /** Total shots fired since construction (gated by aim, for tests/HUD). */
  get totalFired(): number {
    return this.fired;
  }

  /** Rounds intercepted by live trees (stuck embers + early bursts). */
  get stuckCount(): number {
    return this.stuck;
  }
  /** Consecutive tree-stuck rounds on `attacker`'s gun (0 without a streak), for tests/HUD. */
  forestStickCount(attacker: number): number {
    return this.forestSticks.get(attacker) ?? 0;
  }

  /** Peewee grenade lobs fired since construction (subset of `totalFired`). */
  get grenadeCount(): number {
    return this.lobs;
  }

  /**
   * Glowing in-flight rounds right now: min(live shots, `SHOT_GLOW_LIGHTS`).
   * The pool is fixed — a full volley reuses slots instead of adding lights.
   */
  get shotGlowCount(): number {
    return Math.min(this.shots.length, SHOT_GLOW_LIGHTS);
  }

  /**
   * Riding-light intensity of glow slot `i` (0 while dark), for tests/HUD.
   * Slots 0..`shotGlowCount`-1 ride the first live shots in order.
   */
  shotGlowIntensityAt(i: number): number {
    return this.shotGlowLights[i]?.intensity ?? 0;
  }

  /** Ground-blob opacity of glow slot `i` (0 while hidden), for tests. */
  shotGlowOpacityAt(i: number): number {
    const mesh = this.shotGlowMeshes[i];
    if (!mesh || !mesh.visible) return 0;
    return this.shotGlowMats[i]?.opacity ?? 0;
  }

  /**
   * Ground-blob footprint of glow slot `i` (null while hidden), for tests:
   * the flight-bearing yaw (rotation.y) plus the across/along scale the
   * pose writes from `projectileGlowFootprint` every tick.
   */
  shotGlowFootprintAt(i: number): { yaw: number; width: number; length: number } | null {
    const mesh = this.shotGlowMeshes[i];
    if (!mesh || !mesh.visible) return null;
    return { yaw: mesh.rotation.y, width: mesh.scale.x, length: mesh.scale.z };
  }

  /**
   * Instantaneous velocity of live shot `i` (null when absent), for tests:
   * the analytic `ballisticVelocity` at the clamped flight time — the same
   * vector `advanceShots` orients the head by and `poseShotGlow` seats the
   * ground blob from.
   */
  shotVelocityAt(i: number): { x: number; y: number; z: number } | null {
    const shot = this.shots[i];
    if (!shot) return null;
    return ballisticVelocity(
      { x: shot.vel.x, y: shot.vel.y, z: shot.vel.z },
      Math.min(shot.age, shot.dur),
      shot.gravity,
    );
  }

  /**
   * Warp-tail state of live shot `i` (null when absent), for tests: the
   * tail stretch (world units) and opacity, both posed from the
   * instantaneous speed every tick.
   */
  shotTailAt(i: number): { length: number; opacity: number } | null {
    const shot = this.shots[i];
    if (!shot) return null;
    return { length: shot.tail.scale.z, opacity: shot.tailMat.opacity };
  }

  /**
   * Head-mesh scale of live shot `i` (null when absent), for tests: 1 for
   * every gun except the peewee's rifle (`PEEWEE_BULLET_SCALE`).
   */
  shotScaleAt(i: number): number | null {
    const shot = this.shots[i];
    if (!shot) return null;
    return shot.mesh.scale.x;
  }

  /**
   * Blast-stack visual scale of live explosion `i` (null when absent), for
   * tests: `PEEWEE_BLAST_SCALE` for peewee-fired cracks, 1 otherwise (epic
   * bursts always stage full-size).
   */
  explosionScaleAt(i: number): number | null {
    const ex = this.explosions[i];
    if (!ex) return null;
    return ex.scale;
  }

  /** Staging duration of live explosion `i` (null when absent), for tests. */
  explosionMaxAgeAt(i: number): number | null {
    const ex = this.explosions[i];
    if (!ex) return null;
    return ex.maxAge;
  }

  /** Current aim pose of a unit (hull + turret-relative yaws), for tests. */
  aimState(index: number): { hull: number; turret: number } | null {
    const pose = this.aim[index];
    return pose ? { hull: pose.hull, turret: pose.turret } : null;
  }

  /** Persistent scorch decal count (bounded by MAX_SCORCH_MARKS). */
  get scorchCount(): number {
    return this.scorchMarks.length;
  }

  /** Accumulated damage fraction of a unit (0 pristine .. 1 fully charred). */
  unitDamageAt(index: number): number {
    return this.damage[index] ?? 0;
  }

  /**
   * Live per-unit damage roster (same order as the unit group), for the
   * movement drive's strategic health read. By reference, never mutated by
   * the caller — the canvas feeds it straight into `movement.setDamage`.
   */
  damageList(): readonly number[] {
    return this.damage;
  }

  /** True once the unit has exhausted its health and died (wreck persists). */
  isDestroyedAt(index: number): boolean {
    return this.destroyed[index] ?? false;
  }

  /** Units killed so far this session (wrecks stay in the roster). */
  get killCount(): number {
    return this.deathCount;
  }

  /**
   * Seconds since the unit died (0 while alive). Drives the core husk-decay
   * pacing; never resets except on dispose/regen.
   */
  huskAgeAt(index: number): number {
    const at = this.killedAt[index];
    if (at === null || at === undefined) return 0;
    return Math.max(this.elapsed - at, 0);
  }

  /** Husk decay fraction 0 (fresh wreck) .. 1 (fully gone), 0 while alive. */
  huskDecayAt(index: number): number {
    if (!this.destroyed[index]) return 0;
    return huskDecay(this.huskAgeAt(index));
  }

  /** True once the husk has finished decaying (body hidden, scar remains). */
  isHuskGoneAt(index: number): boolean {
    if (!this.destroyed[index]) return false;
    return isHuskGone(this.huskAgeAt(index));
  }

  /** Husks fully decayed so far (hidden bodies; roster slots retained). */
  get goneCount(): number {
    let gone = 0;
    for (let i = 0; i < this.destroyed.length; i++) {
      if (this.isHuskGoneAt(i)) gone++;
    }
    return gone;
  }

  /** True once the unit's exploded-husk transform has applied (turret popped or torso slumped). */
  isWreckPosedAt(index: number): boolean {
    return this.wreckPosed[index] ?? false;
  }

  /** Live popped-turret debris count (tanks only, hidden husks excluded). */
  get debrisCount(): number {
    let n = 0;
    for (const d of this.debris) {
      if (d && d.group.visible) n++;
    }
    return n;
  }

  /**
   * World position of a unit's popped turret (null while attached, for
   * non-tank wrecks, or once hidden with its husk). For tests.
   */
  debrisAt(index: number): { x: number; y: number; z: number } | null {
    const d = this.debris[index];
    if (!d || !d.group.visible) return null;
    const p = d.group.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Live (targetable, drivable) unit count: roster minus wrecks. */
  get aliveCount(): number {
    let alive = 0;
    for (let i = 0; i < this.units.children.length; i++) {
      if (!this.destroyed[i]) alive++;
    }
    return alive;
  }

  /** Visible damage-smoke puff count (one per smoking hull, capped). */
  get unitSmokeCount(): number {
    return this.damageFx.smokeCount;
  }

  /** Visible damage-ember count (one per heavily-damaged hull, capped). */
  get unitEmberCount(): number {
    return this.damageFx.emberCount;
  }

  /** Drive hulls externally (patrol movement) or let combat turn them. */
  setExternalHull(driven: boolean): void {
    this.externalHull = driven;
  }

  /**
   * Night owns the light budget: muzzle/explosion kicks burn at
   * `NIGHT_LIGHT_BOOST` while night, day peaks otherwise; riding shot
   * glows follow their own subtler `projectileGlowLightScale` (washed out
   * by day, gently boosted by night). Applies to kicks struck after the
   * toggle — a mid-decay kick keeps its struck peak and simply fades.
   */
  setNight(night: boolean): void {
    this.night = night;
  }

  /**
   * Traverse a shelled hull's turret toward its live attacker (the canvas
   * calls this alongside `threatenUnit` on every threat hook): the victim's
   * gun answers the incoming direction even before the scheduler draws the
   * pair, so turrets visibly turn toward shell fire instead of sitting on
   * stale aims. Rides the shared pending traverse (slewed every tick in
   * `slewPending`, turret-only while hulls are externally driven), so it
   * never fires by itself — the range/terrain admission in `launchShot`
   * still gates every round — never fights the scheduler (drawn pairs
   * overwrite the goal, and the aim feeds squad focus + sticky preference
   * like any traverse), and dies with either end. Wrecks, self-tracks, and
   * unknown indices refuse.
   */
  trackThreat(victim: number, attacker: number): void {
    const count = this.units.children.length;
    if (!Number.isInteger(victim) || !Number.isInteger(attacker)) return;
    if (victim < 0 || attacker < 0 || victim >= count || attacker >= count) return;
    if (victim === attacker || this.destroyed[victim] || this.destroyed[attacker]) return;
    this.aimPending(victim, attacker);
  }

  /**
   * Aim an attacker at a hull, releasing the turret-overshoot latch when the
   * goal changes: the latch belongs to one acquisition, so a re-picked target
   * traverses fresh instead of inheriting the old swing's extra travel.
   * Re-setting the live goal keeps the latch (the traverse continues).
   */
  private aimPending(attacker: number, target: number): void {
    if (this.pending.get(attacker) !== target) {
      this.pending.set(attacker, target);
      this.releaseOvershoot(attacker);
    }
  }

  /** Structure-fire twin of `aimPending` (goals keyed by HQ team). */
  private aimPendingHq(attacker: number, team: number): void {
    if (this.pendingHq.get(attacker) !== team) {
      this.pendingHq.set(attacker, team);
      this.releaseOvershoot(attacker);
    }
  }

  /**
   * Release an attacker's turret-overshoot latch: a dropped or re-picked goal
   * aims nowhere yet, so the next acquisition starts unlatched instead of
   * inheriting the old swing's extra travel.
   */
  private releaseOvershoot(attacker: number): void {
    const pose = this.aim[attacker];
    if (pose) pose.overshoot = 0;
  }

  /**
   * Current full-strength hit-reaction kick of a unit (zeros when unrocked),
   * for tests/HUD. Pure recoil kicks read as zeros (straight shove, no rock).
   */
  impactAt(index: number): ImpactKick {
    const nudge = this.nudges.get(index);
    if (!nudge) return zeroImpact();
    return { shoveX: nudge.ox, shoveZ: nudge.oz, pitch: nudge.pitch, roll: nudge.roll };
  }

  /** Nudge the stored seated base so patrol motion never fights the kicks. */
  shiftRecoilBase(index: number, dx: number, dz: number): void {
    const nudge = this.nudges.get(index);
    if (nudge) {
      nudge.base.x += dx;
      nudge.base.z += dz;
    }
  }

  /**
   * Kick the dimmest pooled light (shared with muzzle/explosion pops): fire
   * ignition glows reuse the pool instead of owning lights, so the 2-light
   * budget holds no matter how many trees burn.
   */
  glowAt(at: { x: number; y: number; z: number }, color: number, peak = 1400): void {
    let light = this.lights[0];
    if (!light) return;
    for (const candidate of this.lights) {
      if (candidate.intensity < light.intensity) light = candidate;
    }
    light.color.setHex(color);
    light.position.set(at.x, at.y, at.z);
    light.intensity = Math.max(light.intensity, peak * nightLightScale(this.night));
  }

  update(dt: number): void {
    if (this.disposed || dt <= 0) return;
    this.ensureAim();
    this.ensureDamage();
    this.elapsed += dt;
    this.trackVisibleEnemies();
    this.slewPending(dt);
    // Gun tubes knock down what they touch: a traversing turret sweeps its
    // barrel outside the hull trunk keepout, so without this the cannon
    // would rest inside a bole. Felled before the firing solution runs, the
    // muzzle can never start inside wood it just entered.
    this.crushBarrels();
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.tryFire()) {
        // Per-kind refire: the volley that just left sets the next beat —
        // rapid walker guns quicken the shared cadence, tanks keep it.
        this.timer = this.lastKind ? nextShotDelayFor(this.lastKind, this.rng) : nextShotDelay(this.rng);
      } else {
        // Still traversing (or capped): retry soon so aimed pairs fire
        // without waiting out a full ambient interval.
        this.timer = 0.12 + this.rng() * 0.1;
      }
    }
    this.advanceShots(dt);
    this.poseShotGlow();
    this.advanceFlashes(dt);
    this.advanceExplosions(dt);
    this.advanceNudges(dt);
    this.advanceDebris(dt);
    // Husks decay after every other pose (movement re-seats bodies and recoil
    // restores them above, so the sink must win last); smoke/embers ride the
    // sunk hulls and gutter out through the same decay fractions.
    const husk = this.poseHusks();
    this.damageFx.update(this.damage, this.units.children, this.elapsed, husk);
  }

  /**
   * Drop in-flight shots, flashes, and explosions (e.g. on exaggeration
   * re-snap). Kill flags, the kill clock, wreck dressing, and turret debris
   * persist like scorch — a clear never resurrects or re-dresses a husk.
   */
  clearTransients(): void {
    for (const shot of this.shots) {
      this.removeShotVisuals(shot);
    }
    this.shots = [];
    for (const flash of this.flashes) {
      this.scene.remove(flash.mesh);
      flash.mat.dispose();
    }
    this.flashes = [];
    for (const ex of this.explosions) this.removeExplosion(ex);
    this.explosions = [];
    for (const [index, nudge] of this.nudges) {
      const child = this.units.children[index] as THREE.Group | undefined;
      if (child) {
        child.position.copy(nudge.base);
        child.rotation.x -= nudge.appliedPitch;
        child.rotation.z -= nudge.appliedRoll;
        const turret = getTurret(child);
        if (turret) {
          turret.position.x = 0;
          turret.position.z = 0;
          turret.rotation.x -= nudge.appliedNod;
        }
        const barrel = getBarrel(child);
        if (barrel && nudge.barrelBase) barrel.position.copy(nudge.barrelBase);
      }
    }
    this.nudges.clear();
    this.pending.clear();
    this.pendingHq.clear();
    this.forestSticks.clear();
    for (const pose of this.aim) pose.overshoot = 0;
    for (const light of this.lights) light.intensity = 0;
    // In-flight glow goes dark with the shots (persistent scorch, kill
    // flags, and wreck dressing are untouched — glow is transient).
    for (const light of this.shotGlowLights) light.intensity = 0;
    for (const blob of this.shotGlowMeshes) blob.visible = false;
  }

  /**
   * Re-seat persistent scorch decals on the terrain surface (e.g. after an
   * exaggeration re-snap). Scorch is never cleared by `clearTransients` —
   * it persists for the session and is only dropped on dispose/regen.
   */
  reseatScorch(): void {
    if (!this.env) return;
    this.syncScorch(0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTransients();
    // Wreck dressing reverts with the fx: collars leave their bodies and
    // popped turrets leave the scene (their geometries belong to the body
    // build, owned by the canvas/regen — only shared fx assets dispose here).
    for (let i = 0; i < this.units.children.length; i++) {
      const body = this.units.children[i] as THREE.Group | undefined;
      if (body) this.stripWreckDressing(body);
      const d = this.debris[i];
      if (d) this.scene.remove(d.group);
      this.debris[i] = null;
    }
    this.scene.remove(this.scorchMesh);
    this.scorchMarks = [];
    this.damageFx.dispose();
    for (const light of this.lights) this.scene.remove(light);
    this.lights = [];
    for (const light of this.shotGlowLights) this.scene.remove(light);
    this.shotGlowLights = [];
    for (const blob of this.shotGlowMeshes) this.scene.remove(blob);
    this.shotGlowMeshes = [];
    for (const mat of this.shotGlowMats) mat.dispose();
    this.shotGlowMats = [];
    this.shotGlowGeo.dispose();
    this.boltGeo.dispose();
    this.shellGeo.dispose();
    this.tailGeo.dispose();
    this.flashGeo.dispose();
    this.shockGeo.dispose();
    this.fireGeo.dispose();
    this.smokeGeo.dispose();
    this.ringGeo.dispose();
    this.glowGeo.dispose();
    this.scorchGeo.dispose();
    this.scorchMat.dispose();
    this.wreckCollarGeo.dispose();
    this.wreckCollarMat.dispose();
    disposeScorchTexture();
  }

  private unitKind(index: number): UnitKind | null {
    const placed = this.units.userData.units as PlacedUnit[] | undefined;
    return placed?.[index]?.kind ?? null;
  }

  /** Size the per-unit damage array to the roster (persistent, never reset). */
  private ensureDamage(): void {
    const count = this.units.children.length;
    if (this.damage.length < count) {
      const fresh = createUnitDamage(count - this.damage.length);
      this.damage.push(...fresh);
    } else if (this.damage.length > count) {
      this.damage.length = count;
    }
    while (this.destroyed.length < count) this.destroyed.push(false);
    if (this.destroyed.length > count) this.destroyed.length = count;
    while (this.killedAt.length < count) this.killedAt.push(null);
    if (this.killedAt.length > count) this.killedAt.length = count;
    while (this.wreckPosed.length < count) this.wreckPosed.push(false);
    if (this.wreckPosed.length > count) this.wreckPosed.length = count;
    while (this.debris.length < count) this.debris.push(null);
    if (this.debris.length > count) this.debris.length = count;
  }

  /**
   * Splash a blast onto nearby hulls: accumulate core damage with linear
   * falloff and char the touched bodies in place. Every splash also rocks
   * the hull with a directional nudge — a short shove away from the blast
   * plus a hull-frame pitch/roll rock that decays back to the grade seat
   * (flank hits rock harder, see core `impactKick`). Renderer-side only:
   * blasts never displace movers, so drive/pathing/separation never see the
   * kick — but surviving hulls also recoil: the splash fires
   * `onUnitStunned` with the dealt damage and the blast position, and the
   * canvas slides that hull away from the hit over a damage-scaled beat
   * while the rock plays. On graded
   * ground the wash stretches the splash downhill and shields uphill hulls
   * behind the rise. A hull crossing the kill threshold dies exactly once:
   * its nudge settles first (wrecks hold still), then an epic explosion at
   * the hull, full char, and the `onUnitKilled` hook (movement hold,
   * deselect) — the instance itself lingers as a decaying husk (see
   * `poseHusks`).
   */
  private damageUnits(
    at: THREE.Vector3,
    kind: UnitKind,
    slope?: BlastSlope | null,
    shooter?: number | null,
    hostile = true,
    attack: AttackMode = "round",
  ): void {
    if (this.damage.length === 0) return;
    const bodies = this.units.children as THREE.Group[];
    const before = this.damage.slice();
    const touched = applyBlastToUnits(
      this.damage,
      bodies.map((b) => ({ x: b.position.x, z: b.position.z })),
      at.x,
      at.z,
      kind,
      slope ?? undefined,
      attack,
    );
    for (const i of touched) {
      const body = bodies[i];
      if (body) applyUnitDamageTint(body, this.damage[i]!);
      const added = this.damage[i]! - before[i]!;      if (body && added > 0 && !this.destroyed[i]) {
        this.kickImpact(i, body, at, added);
      }
      if (!this.destroyed[i] && !isDestroyed(before[i]!) && isDestroyed(this.damage[i]!)) {
        this.destroyed[i] = true;
        this.killedAt[i] = this.elapsed;
        this.deathCount += 1;
        // A wreck's gun never fires again: drop its futility streak.
        this.forestSticks.delete(i);
        const wreck = bodies[i];
        if (wreck) {
          this.settleNudge(i, wreck);
          this.explodeDeath(new THREE.Vector3(wreck.position.x, wreck.position.y, wreck.position.z));
          // Exploded husk, not a charred twin: pop/slump the wreck in place
          // (after the nudge settles, so the burst and the husk share the
          // same seated hull).
          this.poseWreck(i, wreck);
        }
        this.onUnitKilled?.(i);
      }
      // Survivors recoil: slide the hull away from the hit over a
      // damage-scaled beat while the nudge rock plays the visible jerk.
      // Killing blows skip it (the wreck holds instead) and wrecks never
      // re-fire it.
      if (added > 0 && !this.destroyed[i]) {
        this.onUnitStunned?.(i, added, at.x, at.z);
        // Survivors retaliate: point the victim at whoever shot it so idle
        // hulls turn and pursue while the memory is fresh (see
        // `onUnitThreatened`). Non-hostile bursts (a wreck going up) blame
        // nobody, and a hull shelled by its own blast never pursues itself.
        // Arcing shells (and grenade lobs) outrange the bolt envelope, so the
        // victim investigates past the retaliation gates (see core
        // `SHELL_ENGAGE_RADIUS`).
        const shell = attack === "grenade" || WEAPON_PROFILES[kind]?.shot === "shell";
        const threat = this.resolveThreat(i, shooter ?? null, hostile);
        if (threat) this.onUnitThreatened?.(i, threat.attacker, threat.x, threat.z, added, shell);
      }
      // Post-death barrages re-tint the wreck through the capped live char —
      // keep the deepened husk char on top (idempotent).
      if (this.destroyed[i] && body) applyWreckChar(body);
    }
  }

  /**
   * Who a splashed survivor should blame: the live shooter when the round
   * threaded one through (dead shooters and self-splashes blame nobody —
   * corpses are not pursued), otherwise the nearest live *enemy* hull to the
   * victim — the most plausible direction the shot came from — inside the
   * engage gate so a far-off barrage never drags a patrol across the map on
   * a guess. Same-team hulls are never blamed: fire only ever comes across
   * team lines, so a nearby mate is never the shooter — and a threaded
   * same-team shooter id (white-box misuse, never organic fire) blames
   * nobody either. Non-hostile bursts blame nobody. Null when retaliation
   * should stay quiet.
   */
  private resolveThreat(
    victim: number,
    shooter: number | null,
    hostile: boolean,
  ): { attacker: number; x: number; z: number } | null {
    if (!hostile) return null;
    const bodies = this.units.children as THREE.Group[];
    const victimBody = bodies[victim];
    if (!victimBody) return null;
    // Legacy headless groups carry no placement (victim team unknown): any
    // live hull is blameable, as before teams existed.
    const placed = this.units.userData.units as PlacedUnit[] | undefined;
    const side = placed?.[victim]?.team;
    if (shooter !== null) {
      if (!Number.isInteger(shooter) || shooter < 0 || shooter >= bodies.length) return null;
      if (shooter === victim || this.destroyed[shooter]) return null;
      if (side !== undefined && placed?.[shooter]?.team === side) return null;
      const gun = bodies[shooter];
      if (!gun) return null;
      return { attacker: shooter, x: gun.position.x, z: gun.position.z };
    }
    // Unknown shooter: blame the nearest live hull on the *opposing* side —
    // never a same-team mate parked nearby — inside the engage gate.
    let best = -1;
    let bestDist = THREAT_ENGAGE_RADIUS;
    for (let i = 0; i < bodies.length; i++) {
      if (i === victim || this.destroyed[i]) continue;
      if (side !== undefined && placed?.[i]?.team === side) continue;
      const other = bodies[i];
      if (!other) continue;
      const d = Math.hypot(
        other.position.x - victimBody.position.x,
        other.position.z - victimBody.position.z,
      );
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const gun = bodies[best];
    if (!gun) return null;
    return { attacker: best, x: gun.position.x, z: gun.position.z };
  }

  /**
   * Rock a live hull from a splash dealing `damageAdd`: shape the
   * directional kick from the blast position against the hull yaw and stack
   * it onto any standing nudge (re-hits refresh the decay envelope).
   * Wrecks never rock — kills settle their entry first (see `settleNudge`).
   */
  private kickImpact(index: number, body: THREE.Group, at: THREE.Vector3, damageAdd: number): void {
    const kick = impactKick(at.x, at.z, body.position.x, body.position.z, body.rotation.y, damageAdd);
    if (kick.shoveX === 0 && kick.shoveZ === 0 && kick.pitch === 0 && kick.roll === 0) return;
    const live = this.nudges.get(index);
    if (live) {
      const stacked = accumulateImpact(
        { shoveX: live.ox, shoveZ: live.oz, pitch: live.pitch, roll: live.roll },
        kick,
      );
      live.ox = stacked.shoveX;
      live.oz = stacked.shoveZ;
      live.pitch = stacked.pitch;
      live.roll = stacked.roll;
      live.age = 0;
      live.dur = IMPACT_DURATION;
      return;
    }
    this.nudges.set(index, {
      base: body.position.clone(),
      ox: kick.shoveX,
      oz: kick.shoveZ,
      pitch: kick.pitch,
      roll: kick.roll,
      age: 0,
      dur: IMPACT_DURATION,
      appliedPitch: 0,
      appliedRoll: 0,
      turret: 0,
      turretAge: 0,
      turretDur: TURRET_RECOIL_DURATION,
      pump: 0,
      barrelBase: null,
      nod: 0,
      appliedNod: 0,
    });
  }

  /**
   * Settle a hull's nudge back to its seated pose and drop the entry:
   * expiry, `clearTransients`, and the kill transition all restore exactly,
   * so a rocked hull never keeps a lean, a recoiled turret never keeps a
   * slide, and a wreck starts from its seat.
   */
  private settleNudge(index: number, body: THREE.Group): void {
    const nudge = this.nudges.get(index);
    if (!nudge) return;
    body.position.copy(nudge.base);
    body.rotation.x -= nudge.appliedPitch;
    body.rotation.z -= nudge.appliedRoll;
    // Recoil only ever slides the turret in X/Z (Y is the wreck-slump axis),
    // so the restore touches only what the kick wrote — plus the walker
    // weapon cycle (pumped tube back to its seat, braced torso level), so a
    // wreck starts from a clean gun before it pops or slumps.
    const turret = getTurret(body);
    if (turret) {
      turret.position.x = 0;
      turret.position.z = 0;
      turret.rotation.x -= nudge.appliedNod;
    }
    const barrel = getBarrel(body);
    if (barrel && nudge.barrelBase) barrel.position.copy(nudge.barrelBase);
    this.nudges.delete(index);
  }

  /**
   * Explode a killed hull into its husk — once per wreck, idempotent.
   * Children-only surgery, so the movement seat (body origin + hull yaw +
   * grade tilt, re-posed every tick) and the husk sink (absolute Y offset in
   * `poseHusks`) both keep working over it, and wrecks still never rock,
   * stun, tremble, or drive:
   *
   * - Tanks (`flash`/`stump`/`hammer`) and the infantry scout (`peewee`):
   *   the turret subgroup detaches into a
   *   ballistic `TurretDebris` chunk (charred, barrel and all), a breached
   *   turret-ring collar stays on the hull, and the hull boxes settle with a
   *   small deterministic slump. The husk reads as a headless breached hull.
   * - Commander (walker): the torso stays aboard but slumps — pitched
   *   forward, dropped, yawed askew — with splayed legs (rotation.z only;
   *   locomotion owns rotation.x/position.y even for wrecks, settling gait
   *   to neutral on zero travel).
   * - Every wreck takes the deepened wreck char (`applyWreckChar`), past the
   *   readable cap live hulls keep.
   *
   * Picking is unaffected (the canvas raycasts `units.children` only, and
   * scene-level debris never intercepts); the occlusion ghost rebuilds from
   * the changed hierarchy, so a turret-less husk ghosts turret-less while it
   * smoulders and hides entirely once gone.
   */
  private poseWreck(index: number, body: THREE.Group): void {
    if (this.wreckPosed[index]) return;
    this.wreckPosed[index] = true;
    // Dead hulls keep no circles: the team ring + selection beacon drop
    // immediately (the husk body itself still renders until decay). This
    // mirrors the health-bar gate (wrecks report no live state) and runs
    // here — not just in the canvas kill hook — so white-box kills that
    // dress via `poseHusks` lose their circles too.
    hideUnitCircles(body);
    const kind = this.unitKind(index);
    applyUnitDamageTint(body, 1);
    applyWreckChar(body);
    if (!kind) return;
    const h = wreckHash(index);
    if (kind === "commander") {
      const torso = getTurret(body);
      if (torso) {
        torso.rotation.x += 0.5;
        torso.rotation.z += 0.3;
        torso.rotation.y += 0.6;
        torso.position.y -= 4;
      }
      const legs = body.children.filter(
        (c): c is THREE.Mesh => c.type === "Mesh" && c.name === "leg",
      );
      legs.forEach((leg, li) => {
        leg.rotation.z += (li === 0 ? 1 : -1) * (0.22 + h * 0.12);
      });
      return;
    }
    // Tanks + scout: pop the turret, breach the ring, settle the hull boxes.
    const turret = getTurret(body);
    if (turret) {
      body.updateMatrixWorld(true);
      const start = new THREE.Vector3();
      turret.getWorldPosition(start);
      const pitch0 = turret.rotation.x;
      body.remove(turret);
      body.userData.turret = undefined;
      this.scene.add(turret);
      turret.position.copy(start);
      const vel = wreckPopVelocity(index);
      this.debris[index] = {
        group: turret,
        start: start.clone(),
        vel: new THREE.Vector3(vel.x, vel.y, vel.z),
        age: 0,
        spin: h < 0.5 ? 1 : -1,
        pitch0,
        landed: false,
      };
      const collar = new THREE.Mesh(this.wreckCollarGeo, this.wreckCollarMat);
      collar.name = "wreck-collar";
      collar.userData.noHighlight = true;
      collar.userData.wreckDressing = true;
      collar.scale.set(WRECK_BREACH_R[kind] ?? 5, 1, WRECK_BREACH_R[kind] ?? 5);
      collar.position.set(0, WRECK_BREACH_Y[kind] ?? 8, WRECK_BREACH_Z[kind] ?? -1);
      body.add(collar);
    }
    for (const child of body.children) {
      if (child.type !== "Mesh" || child.name !== "" || child.userData.wreckDressing) continue;
      const mesh = child as THREE.Mesh;
      mesh.rotation.z += (h - 0.5) * 0.14;
      mesh.rotation.x += (wreckHash(index + 7) - 0.5) * 0.1;
      mesh.position.y -= 1;
    }
  }

  /**
   * Remove wreck dressing from a body (dispose path): breach collars leave,
   * hull/leg/torso slumps stay (bodies are dropped wholesale on regen).
   */
  private stripWreckDressing(body: THREE.Group): void {
    for (let i = body.children.length - 1; i >= 0; i--) {
      const child = body.children[i]!;
      if (child.userData.wreckDressing) body.remove(child);
    }
  }

  /**
   * Fly every popped turret one step: analytic ballistic arc under core
   * `GRAVITY` (frame-rate independent — the same kill replays the same arc
   * for any dt sequence), tumbling in flight, then resting tilted on the
   * live surface once the arc reaches it. Husk-gone debris hides with its
   * husk in `poseHusks`; mid-flight `clearTransients` never touches it.
   */
  private advanceDebris(dt: number): void {
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      if (!d || d.landed) continue;
      d.age += dt;
      const p = ballisticPosition(
        { x: d.start.x, y: d.start.y, z: d.start.z },
        { x: d.vel.x, y: d.vel.y, z: d.vel.z },
        d.age,
        GRAVITY,
      );
      const ground = this.env ? this.env.groundY(p.x, p.z) : d.start.y - 12;
      const rest = ground + WRECK_DEBRIS_REST;
      if (p.y <= rest) {
        d.landed = true;
        d.group.position.set(p.x, rest, p.z);
        // Rest on its side where it fell: frozen tumble + a deterministic
        // lie, so the litter reads as thrown wreckage, not a parked turret.
        d.group.rotation.set(
          d.pitch0 + d.spin * WRECK_TUMBLE * d.age,
          d.group.rotation.y,
          d.spin * 1.25,
        );
        continue;
      }
      d.group.position.set(p.x, p.y, p.z);
      d.group.rotation.x = d.pitch0 + d.spin * WRECK_TUMBLE * d.age;
    }
  }
  /**
   * Sink and retire husks: every wreck lowers by the core sink for its decay
   * fraction (absolute offset — movement re-seats the body from the frozen
   * mover each tick, so re-subtracting never accumulates), and a fully
   * decayed husk hides its body while keeping its roster slot (targeting,
   * movement, and selection already exclude it; the scorch scar stays as the
   * battlefield history). Returns the per-unit decay fractions for the
   * damage-smoke view. Re-applied every tick, so exaggeration re-snaps and
   * `clearTransients` (which never touch the kill clock) cannot resurrect a
   * sunk husk.
   */
  private poseHusks(): number[] {
    const bodies = this.units.children;
    // Reuse the decay scratch (resized + zeroed, never reallocated in the
    // steady state): the caller consumes it synchronously in `update`.
    const decay = this.huskDecayCache;
    decay.length = bodies.length;
    decay.fill(0);
    for (let i = 0; i < bodies.length; i++) {
      if (!this.destroyed[i]) continue;
      const d = huskDecay(this.huskAgeAt(i));
      decay[i] = d;
      const body = bodies[i] as THREE.Group | undefined;
      if (!body) continue;
      // Belt-and-braces: white-box kills that bypass the splash still dress
      // their husk (turret pop included) on the first decay tick.
      if (!this.wreckPosed[i]) this.poseWreck(i, body);
      const gone = d >= 1;
      if (gone) {
        body.visible = false;
      } else {
        body.position.y -= huskSink(d);
      }
      // Popped-turret litter rests beside the wreck (it never sinks) and
      // hides with the husk once fully decayed.
      const debris = this.debris[i];
      if (debris) debris.group.visible = !gone;
    }
    return decay;
  }

  /** Size the aim pose array to the unit roster, seeding from live yaws. */
  private ensureAim(): void {
    const bodies = this.units.children as THREE.Group[];
    while (this.aim.length < bodies.length) {
      const i = this.aim.length;
      this.aim.push({ hull: bodies[i]?.rotation.y ?? 0, turret: 0, overshoot: 0 });
    }
    if (this.aim.length > bodies.length) this.aim.length = bodies.length;
    if (this.externalHull) {
      // Hulls face travel (patrol-owned): re-sync every frame so the turret
      // always slews relative to the live hull, never a stale traverse pose.
      for (let i = 0; i < bodies.length; i++) {
        const pose = this.aim[i];
        if (pose) pose.hull = bodies[i]?.rotation.y ?? pose.hull;
      }
    }
  }

  /** Bearing from one unit body to a world point on the X/Z plane. */
  private bearingToPoint(from: number, x: number, z: number): number | null {
    const a = this.units.children[from] as THREE.Group | undefined;
    if (!a) return null;
    return yawToTarget({ x: a.position.x, z: a.position.z }, { x, z });
  }

  /** Live HQ aim point of a team, or null when it is wrecked/absent. */
  private hqTargetOf(team: number): { x: number; y: number; z: number; team: number } | null {
    const targets = this.env?.hqTargets?.() ?? [];
    return targets.find((t) => t.team === team) ?? null;
  }

  /** Bearing from one unit body to another on the X/Z plane. */
  private bearing(from: number, to: number): number | null {
    const a = this.units.children[from] as THREE.Group | undefined;
    const b = this.units.children[to] as THREE.Group | undefined;
    if (!a || !b) return null;
    return yawToTarget({ x: a.position.x, z: a.position.z }, { x: b.position.x, z: b.position.z });
  }

  /**
   * Slew every pending attacker toward its target at limited hull/turret
   * rates and apply the pose. Hulls do the gross turn, turrets the clamped
   * refine — so traverse motion is visible even before any shot fires — and
   * far turret swings overshoot their goal a little before correcting back
   * (see core `slewTurret`). In external-hull mode (patrol movement) the
   * hull stays on its travel heading and only the turret slews the clamped
   * remainder. Structure goals slew the same way, against the live HQ
   * position by team. Barrels crank toward their elevation goals alongside
   * (see `slewBarrel`), so the tube visibly lays before the round leaves.
   */
  private slewPending(dt: number): void {
    for (const [attacker, target] of this.pending) {
      if (this.destroyed[attacker] || this.destroyed[target]) {
        this.pending.delete(attacker);
        this.elevGoal.delete(attacker);
        this.releaseOvershoot(attacker);
        continue;
      }
      const body = this.units.children[attacker] as THREE.Group | undefined;
      const kind = this.unitKind(attacker);
      const want = this.bearing(attacker, target);
      if (!body || !kind || want === null) {
        this.pending.delete(attacker);
        this.elevGoal.delete(attacker);
        this.releaseOvershoot(attacker);
        continue;
      }
      const pose = this.aim[attacker];
      if (!pose) continue;
      if (this.externalHull) {
        const wantRel = clampTurret(kind, wrapAngle(want - pose.hull));
        const slew = slewTurret(kind, pose.turret, wantRel, dt, pose.overshoot);
        pose.turret = slew.angle;
        pose.overshoot = slew.overshoot;
      } else {
        const next = aimStep(kind, pose.hull, pose.turret, want, dt, pose.overshoot);
        pose.hull = next.hull;
        pose.turret = next.turret;
        pose.overshoot = next.overshoot;
      }
      setUnitAim(body, pose.hull, pose.turret);
      this.slewBarrel(attacker, body, kind, dt);
    }
    for (const [attacker, hqTeam] of this.pendingHq) {
      if (this.destroyed[attacker]) {
        this.pendingHq.delete(attacker);
        this.elevGoal.delete(attacker);
        this.releaseOvershoot(attacker);
        continue;
      }
      const hq = this.hqTargetOf(hqTeam);
      const body = this.units.children[attacker] as THREE.Group | undefined;
      const kind = this.unitKind(attacker);
      const want = hq ? this.bearingToPoint(attacker, hq.x, hq.z) : null;
      if (!body || !kind || want === null) {
        this.pendingHq.delete(attacker);
        this.elevGoal.delete(attacker);
        this.releaseOvershoot(attacker);
        continue;
      }
      const pose = this.aim[attacker];
      if (!pose) continue;
      if (this.externalHull) {
        const wantRel = clampTurret(kind, wrapAngle(want - pose.hull));
        const slew = slewTurret(kind, pose.turret, wantRel, dt, pose.overshoot);
        pose.turret = slew.angle;
        pose.overshoot = slew.overshoot;
      } else {
        const next = aimStep(kind, pose.hull, pose.turret, want, dt, pose.overshoot);
        pose.hull = next.hull;
        pose.turret = next.turret;
        pose.overshoot = next.overshoot;
      }
      setUnitAim(body, pose.hull, pose.turret);
      this.slewBarrel(attacker, body, kind, dt);
    }
  }

  /**
   * Crank one attacker's barrel toward its recorded elevation goal at the
   * kind's `ELEVATION_SLEW_RATE`. No-op without a goal or without an
   * elevating barrel (commanders, legacy headless bodies): those aim poses
   * never gate fire.
   */
  private slewBarrel(attacker: number, body: THREE.Group, kind: UnitKind, dt: number): void {
    const goal = this.elevGoal.get(attacker);
    if (goal === undefined || !getBarrel(body)) return;
    const rate = ELEVATION_SLEW_RATE[kind] ?? 1.0;
    setBarrelElevation(body, stepElevation(barrelElevation(body), goal, rate * dt));
  }

  /**
   * Record the barrel goal from a firing solution and report whether the
   * tube is on it (within `ELEVATION_AIM_TOLERANCE`). The launch path calls
   * this instead of snapping the barrel: while it reports false the pending
   * pair keeps traversing (`slewBarrel` cranks every frame) and the
   * scheduler retries, so fire waits for the lay the way it waits for the
   * yaw traverse. Barrel-less bodies always read aimed.
   */
  private aimBarrel(attacker: number, body: THREE.Group, goal: number): boolean {
    this.elevGoal.set(attacker, goal);
    if (!getBarrel(body)) return true;
    return Math.abs(barrelElevation(body) - goal) <= ELEVATION_AIM_TOLERANCE;
  }

  /**
   * Fell the standing trunks the gun tubes currently touch. The tube is part
   * of the vehicle for collision (hull footprint + barrel = full size), and
   * contact resolves the hull-crush way — the bole falls via the
   * `fellTree` hook, the barrel never clips through it. Wrecks (turrets
   * popped or slumped) and tube-less kinds never fell; without stands or the
   * hook this is a no-op, so headless history without trees is untouched.
   */
  private crushBarrels(): void {
    const env = this.env;
    const fellTree = env?.fellTree;
    if (!env || !fellTree) return;
    const stands = env.treeStands?.() ?? [];
    if (stands.length === 0) return;
    const bodies = this.units.children as THREE.Group[];
    for (let i = 0; i < bodies.length; i++) {
      if (this.destroyed[i]) continue;
      const kind = this.unitKind(i);
      if (!kind) continue;
      const pose = this.aim[i];
      const body = bodies[i];
      if (!pose || !body) continue;
      const seg = barrelSegment(
        { x: body.position.x, y: body.position.y, z: body.position.z },
        pose.hull,
        pose.turret,
        barrelElevation(body),
        kind,
      );
      if (!seg) continue;
      const fids = trunksOnBarrel(seg.a, seg.b, stands);
      for (const fid of fids) fellTree(fid);
    }
  }

  /**
   * Gun admission range for `kind`: the doctrine max range plus the
   * scheduler's +50 aim margin — a live enemy inside this is close enough to
   * react to (proactive traverse) and to draw volleys (engaged-first
   * scheduling). Matches the structure-fire pre-gate scale.
   */
  private admissionFor(kind: UnitKind): number {
    return maxRangeFor(kind) + 50;
  }

  /**
   * Positional roster snapshot for targeting: body X/Z positions, sides
   * (wrecks read as undefined, so destroyed hulls are invisible to
   * targeting — never shot, never counted as sides), and parallel live
   * flags. Shared by the scheduler and proactive engagement.
   */
  private rosterSnapshot(): {
    positions: { x: number; z: number }[];
    teams: (number | undefined)[];
    liveFlags: boolean[];
  } {
    const placed = this.units.userData.units as PlacedUnit[] | undefined;
    const positions = this.units.children.map((body) => ({
      x: (body as THREE.Group).position.x,
      z: (body as THREE.Group).position.z,
    }));
    const teams = this.units.children.map((_, i) =>
      this.destroyed[i] ? undefined : placed?.[i]?.team,
    );
    const liveFlags = this.units.children.map((_, i) => !this.destroyed[i]);
    return { positions, teams, liveFlags };
  }

  /**
   * True when live hull `i` has a live enemy inside its admitted weapon
   * range — the engaged-first scheduler gate (see `pickLivePair`): volleys
   * come from guns that can actually hit something. Pure over the snapshot.
   */
  private hasAdmittedFoe(
    i: number,
    positions: readonly { x: number; z: number }[],
    teams: readonly (number | undefined)[],
    live: readonly boolean[],
  ): boolean {
    const kind = this.unitKind(i);
    if (!kind) return false;
    const side = teams[i];
    if (side === undefined) return false;
    const me = positions[i];
    if (!me) return false;
    const admission = this.admissionFor(kind);
    for (let j = 0; j < positions.length; j++) {
      if (j === i || live[j] === false) continue;
      const foeSide = teams[j];
      if (foeSide === undefined || foeSide === side) continue;
      const foe = positions[j];
      if (!foe) continue;
      if (Math.hypot(foe.x - me.x, foe.z - me.z) <= admission) return true;
    }
    return false;
  }

  /**
   * Proactive engagement: every live gun without a traverse goal turns onto
   * a live enemy inside admitted weapon range — so hulls visibly react to
   * enemies they can hit instead of sitting on stale aims until they take
   * fire (previously only `trackThreat` victims traversed before the
   * scheduler drew them, and the single ambient volley came from a random
   * hull). Rides the shared pending traverse (slewed every tick in
   * `slewPending`), so it never fires by itself — the range/terrain
   * admission in `launchShot` still gates every round — never fights the
   * scheduler (drawn pairs overwrite the goal, and guns already carrying an
   * aim are left alone), and dies with either end. Target choice matches
   * the scheduler (core `pickStrategicTarget`: wounded/focus pulls,
   * distance first), so proactive aims feed squad focus fire like any
   * traverse; legacy headless groups without teams track the nearest other
   * live hull in range. Range-only notice (no line-of-sight): terrain
   * occlusion stays the visibility layer's job.
   */
  private trackVisibleEnemies(): void {
    const count = this.units.children.length;
    if (count < 2) return;
    const { positions, teams, liveFlags } = this.rosterSnapshot();
    const teamed = teams.some((t) => t !== undefined);
    const hp = this.damage.map((d) => 1 - d);
    for (let i = 0; i < count; i++) {
      if (this.destroyed[i]) continue;
      if (this.pending.has(i) || this.pendingHq.has(i)) continue;
      const kind = this.unitKind(i);
      if (!kind) continue;
      const admission = this.admissionFor(kind);
      const me = positions[i]!;
      if (teamed) {
        if (teams[i] === undefined) continue;
        const target = pickStrategicTarget(i, positions, teams, liveFlags, {
          hp,
          // Pending aims are the squad's current focus (structure aims live
          // in a separate map, so only hull-aim values count).
          focusCounts: [...this.pending.values()],
          maxDist: admission,
        });
        if (target < 0) continue;
        // `pickStrategicTarget` falls back to far targets past admission —
        // only admitted enemies are worth reacting to.
        const foe = positions[target]!;
        if (Math.hypot(foe.x - me.x, foe.z - me.z) > admission) continue;
        this.aimPending(i, target);
      } else {
        let best = -1;
        let bestDist = admission;
        for (let j = 0; j < count; j++) {
          if (j === i || this.destroyed[j]) continue;
          const foe = positions[j]!;
          const d = Math.hypot(foe.x - me.x, foe.z - me.z);
          if (d <= bestDist) {
            best = j;
            bestDist = d;
          }
        }
        if (best < 0) continue;
        this.aimPending(i, best);
      }
    }
  }

  /**
   * Draw an attacker/target pair across team lines (wrecks excluded on both
   * ends, friendlies never draw fire). The attacker draws uniformly from
   * *engaged* live hulls — guns with an admitted enemy in range — so the
   * volley comes from a gun that can actually hit something and reaction
   * turns into return fire promptly; with nothing in range anywhere the
   * draw falls back to all live hulls (one rng draw either way, exactly
   * like the old hostile-pair picker, so live rosters replay
   * deterministically). The *target* is chosen, not random: guns finish
   * burning hulls, pile onto the squad's current aims (focus fire over
   * split shots), and stay on their current target instead of thrashing,
   * while distance still dominates so admitted in-range duels keep their
   * pace (see core `pickStrategicTarget`). Null when fewer than two hulls
   * are alive or one side is wiped — the skirmish goes quiet instead of
   * shelling wrecks or turning on its own side.
   */
  private pickLivePair(): { attacker: number; target: number } | null {
    const count = this.units.children.length;
    const placed = this.units.userData.units as PlacedUnit[] | undefined;
    const alive: number[] = [];
    for (let i = 0; i < count; i++) {
      if (!this.destroyed[i]) alive.push(i);
    }
    if (alive.length < 2) return null;
    const teams = alive.map((i) => placed?.[i]?.team);
    if (teams.every((t) => t === undefined)) {
      // Legacy headless groups carry no placement (white-box tests): every
      // other hull is a valid target, as before teams existed.
      const pair = pickSkirmishPair(alive.length, this.rng);
      if (!pair) return null;
      return { attacker: alive[pair.attacker]!, target: alive[pair.target]! };
    }
    const { positions, teams: fullTeams, liveFlags } = this.rosterSnapshot();
    // Engaged guns fire first; far guns never waste the ambient volley while
    // a duel is on. The fallback keeps the old rhythm (traverse-then-retry
    // on far pairs) when nothing is in range anywhere.
    const engaged = alive.filter((i) => this.hasAdmittedFoe(i, positions, fullTeams, liveFlags));
    let attacker: number;
    if (engaged.length > 0) {
      attacker = engaged[Math.floor(this.rng() * engaged.length)]!;
    } else {
      const pair = pickHostilePair(alive.length, teams, this.rng);
      if (!pair) return null;
      attacker = alive[pair.attacker]!;
    }
    // Aim the drawn attacker strategically instead of firing a uniform
    // target: health reads live damage, and the pending aims are the
    // squad's current focus.
    const kind = this.unitKind(attacker);
    const hp = this.damage.map((d) => 1 - d);
    const target = pickStrategicTarget(attacker, positions, fullTeams, liveFlags, {
      hp,
      // Pending aims are the squad's current focus (structure aims live in
      // a separate map keyed by attacker, so only hull-aim values count).
      focusCounts: [...this.pending.values()],
      sticky: this.pending.get(attacker) ?? -1,
      maxDist: kind ? this.admissionFor(kind) : undefined,
    });
    if (target < 0) return null;
    return { attacker, target };
  }

  /**
   * Pick a skirmish pair and fire only when the attacker is aimed: hull
   * faced at the target (or, in external-hull mode, on its patrol heading
   * with the turret slewed onto the target), turret inside its traverse,
   * muzzle down the turret line. About one volley in four instead answers a
   * live enemy HQ inside admitted range (see `pickHqShot`); structure shots
   * traverse, range-gate, solve, and splash through the same path, with the
   * blast routed into the HQ damage state. Returns true when a shot left (or
   * the roster/caps made firing impossible, to keep the ambient schedule);
   * false defers while the attacker is still traversing. Wrecks neither fire
   * nor draw fire and friendlies never draw fire: pairs are drawn from live
   * hulls across team lines only, and fewer than two live enemies means
   * silence (still true, to keep the schedule idle).
   */
  private tryFire(): boolean {
    const count = this.units.children.length;
    if (count < 2) return true;
    if (this.shots.length >= MAX_SHOTS) return true;
    // Self-defense first: an engaged gun's fort aim is stale — drop it so
    // the traverse rejoins the hull duel instead of lingering on the HQ.
    if (this.env?.isEngaged) {
      for (const attacker of [...this.pendingHq.keys()]) {
        if (this.env.isEngaged(attacker)) {
          this.pendingHq.delete(attacker);
          this.releaseOvershoot(attacker);
        }
      }
    }
    const hqPick = this.pickHqShot();
    if (hqPick) {
      const hq = this.hqTargetOf(hqPick.team);
      if (!hq) return true;
      return this.fireAtHq(hqPick.attacker, hq);
    }
    const pair = this.pickLivePair();
    if (!pair) return true;
    return this.fireAtUnit(pair.attacker, pair.target);
  }

  /**
   * Draw an (attacker, HQ-team) structure shot: a live hull firing on a live
   * enemy HQ. Null most volleys (`HQ_TARGET_CHANCE`), when no HQ is fielded
   * (legacy headless groups), when every HQ is wrecked, or when no live
   * enemy hull is even near admitted range — so structure fire only ever
   * answers push-ins, never cross-map pairs. Guns answering a live enemy
   * (`isEngaged`) never draw structure fire: a hull under consistent fire
   * deals with the enemy first through the hull duel, and resumes the fort
   * once the grudge clears. Consumes rng only when it proceeds, so
   * hull-duel streams replay untouched without HQs.
   */
  private pickHqShot(): { attacker: number; team: number } | null {
    const targets = this.env?.hqTargets?.() ?? [];
    if (targets.length === 0) return null;
    const placed = this.units.userData.units as PlacedUnit[] | undefined;
    if (!placed) return null;
    if (this.rng() >= HQ_TARGET_CHANCE) return null;
    const engaged = this.env?.isEngaged;
    const pairs: { attacker: number; team: number }[] = [];
    for (const t of targets) {
      for (let i = 0; i < this.units.children.length; i++) {
        if (this.destroyed[i]) continue;
        if (engaged?.(i)) continue;
        const side = placed[i]?.team;
        if (side === undefined || side === t.team) continue;
        const body = this.units.children[i] as THREE.Group | undefined;
        if (!body) continue;
        const kind = this.unitKind(i);
        if (!kind) continue;
        // Body-distance pre-gate (the exact muzzle gate runs in `fireAtHq`):
        // guns parked across the map never draw structure fire.
        const d = Math.hypot(body.position.x - t.x, body.position.z - t.z);
        if (d > this.admissionFor(kind)) continue;
        pairs.push({ attacker: i, team: t.team });
      }
    }
    if (pairs.length === 0) return null;
    return pairs[Math.floor(this.rng() * pairs.length)] ?? null;
  }

  /** Muzzle-to-mark distance for aim scatter: the same flat-math seed the launch path aims from. */
  private muzzleToTarget(
    attacker: THREE.Group,
    pose: { hull: number; turret: number },
    kind: UnitKind,
    mark: { x: number; y: number; z: number },
  ): number {
    const muzzle = muzzlePoint(attacker.position, muzzleYaw(pose.hull, pose.turret), kind);
    return Math.hypot(mark.x - muzzle.x, mark.y - muzzle.y, mark.z - muzzle.z);
  }

  /** Fire a hull-vs-hull volley through the shared launch path. */
  private fireAtUnit(attackerIdx: number, targetIdx: number): boolean {
    const attacker = this.units.children[attackerIdx] as THREE.Group | undefined;
    const target = this.units.children[targetIdx] as THREE.Group | undefined;
    const kind = this.unitKind(attackerIdx);
    const pose = this.aim[attackerIdx];
    if (!attacker || !target || !kind || !pose) return true;
    this.aimPending(attackerIdx, targetIdx);
    const want = this.bearing(attackerIdx, targetIdx);
    if (want === null || !canFire(want, pose.hull, pose.turret)) return false;
    return this.launchShot(
      attackerIdx,
      attacker,
      kind,
      pose,
      impactPoint(target.position, this.rng, kind, this.muzzleToTarget(attacker, pose, kind, target.position)),
      targetIdx,
    );
  }

  /** Fire a hull-vs-HQ volley through the shared launch path. */
  private fireAtHq(
    attackerIdx: number,
    hq: { x: number; y: number; z: number; team: number },
  ): boolean {
    const attacker = this.units.children[attackerIdx] as THREE.Group | undefined;
    const kind = this.unitKind(attackerIdx);
    const pose = this.aim[attackerIdx];
    if (!attacker || !kind || !pose) return true;
    this.aimPendingHq(attackerIdx, hq.team);
    const want = this.bearingToPoint(attackerIdx, hq.x, hq.z);
    if (want === null || !canFire(want, pose.hull, pose.turret)) return false;
    return this.launchShot(
      attackerIdx,
      attacker,
      kind,
      pose,
      impactPoint({ x: hq.x, y: hq.y, z: hq.z }, this.rng, kind, this.muzzleToTarget(attacker, pose, kind, hq)),
      -1,
    );
  }

  /**
   * Shared launch path for hull and structure volleys: seed the muzzle from
   * the flat math, lay the barrel onto the firing solution at its limited
   * elevation rate, re-solve from the live barrel-tip muzzle, and spawn the
   * analytic shot. `target` is the roster index (-1 for a structure —
   * downstream only the shooter is ever read back). Returns true when the
   * round left, false while still traversing (yaw or barrel lay), past the
   * mount limits, or out of admitted range (retry on a new pair).
   */
  private launchShot(
    attackerIdx: number,
    attacker: THREE.Group,
    kind: UnitKind,
    pose: { hull: number; turret: number },
    impact: { x: number; y: number; z: number },
    target: number,
  ): boolean {
    const profile = WEAPON_PROFILES[kind];

    const gunYaw = muzzleYaw(pose.hull, pose.turret);
    // Seed muzzle from the flat math, then aim the barrel at the firing
    // solution and re-read the exact live muzzle (barrel-tip world matrix,
    // so turret yaw + barrel pitch + hull grade pose all contribute).
    const approx = muzzlePoint(attacker.position, gunYaw, kind);
    const approxDist = Math.hypot(
      impact.x - approx.x,
      impact.y - approx.y,
      impact.z - approx.z,
    );
    // Range admission (cf. retail spec 06 §3.3): too close to depress onto
    // or ballistically unreachable — keep traversing, retry on a new pair.
    if (!inRange(kind, approxDist)) return false;
    // Peewee secondary: inside grenade range the hand-cannon lobs a slow
    // high-arc grenade instead of firing its peashooter bolt (see core
    // `peeweeAttackFor` — lobs start where the knife-fight stand-off ends).
    const lobGrenade = kind === "peewee" && isPeeweeGrenadeRange(approxDist);
    const attack: AttackMode = lobGrenade ? "grenade" : "round";
    const roundColor = lobGrenade ? PEEWEE_GRENADE_COLOR : profile.color;
    const roundFlash = lobGrenade ? PEEWEE_GRENADE_FLASH_TIME : profile.flashTime;
    const roundShell = lobGrenade || profile.shot === "shell";
    const roundGravity = roundShell ? GRAVITY : 0;
    // Canopy admission: shells lob the high root over live wood when it
    // clears and fits the flight-time safety net, else fire flat into the
    // branches (the interception roll may catch the round); flat bolts stay
    // on the target line and accept the stick risk. Grenades always lob —
    // the steep arc is their whole trajectory (see `solveShotClearing`).
    const stands = this.env?.treeStands?.() ?? [];
    const seedClearing = solveShotClearing(
      kind,
      approx,
      impact,
      stands,
      attack,
    );
    if (!seedClearing) return false;
    // Lay the tube onto the seed solution at its limited rate instead of
    // snapping: while the barrel is still cranking the pair keeps traversing
    // and the scheduler retries, the pitch twin of the yaw aim gate.
    const seedGoal = clampElevation(seedClearing.solution.elevation, kind);
    if (!this.aimBarrel(attackerIdx, attacker, seedGoal)) return false;
    // On the lay: seat the tube exactly (≤tolerance away, an invisible seat)
    // so the live muzzle re-read below matches the fired solution.
    setBarrelElevation(attacker, seedGoal);
    attacker.updateMatrixWorld(true);
    const live = muzzleWorld(attacker);
    const start = live
      ? new THREE.Vector3(live.position.x, live.position.y, live.position.z)
      : new THREE.Vector3(approx.x, approx.y, approx.z);
    const clearing = solveShotClearing(
      kind,
      { x: start.x, y: start.y, z: start.z },
      impact,
      stands,
      attack,
    );
    // Shells at max ballistic range fly ~5.3s; canopy lobs hang ~7.4s —
    // anything longer is rejected.
    if (!clearing) return false;
    let sol = clearing.solution;
    if (sol.duration <= 0 || sol.duration > (clearing.elevated ? LOBBED_MAX_TIME : 6)) return false;
    // Terrain admission: the round must clear the live surface all the way
    // to the impact — never through a hillside. Shells whose flat root digs
    // into the grade lob the high root over it when that clears wood and
    // dirt alike (and fits the flight-time safety net); anything still
    // blocked holds fire and asks for a reposition (higher vantage, closer)
    // instead of shooting through the hill. Grenades arrive lobbed already,
    // so a blocked lob holds fire the same way an elevated shell does.
    if (this.env) {
      const from = { x: start.x, y: start.y, z: start.z };
      const gravity = roundGravity;
      const to = { x: impact.x, y: impact.y, z: impact.z };
      if (!flightClearsTerrain(from, sol.velocity, gravity, sol.duration, this.env.groundY)) {
        if (roundShell && !clearing.elevated) {
          const high = solveBallisticHigh(from, to, profile.speed, GRAVITY);
          const mountMax = ELEVATION_MAX[kind] ?? 1.45;
          if (
            high && high.elevation <= mountMax &&
            high.duration > 0 && high.duration <= LOBBED_MAX_TIME &&
            flightClearsTrees(from, high.velocity, GRAVITY, high.duration, stands) &&
            flightClearsTerrain(from, high.velocity, GRAVITY, high.duration, this.env.groundY)
          ) {
            // A within-mount lob still lays at the limited rate: crank up
            // first, fire on a later retry once the tube is on the high root.
            const highGoal = clampElevation(high.elevation, kind);
            if (!this.aimBarrel(attackerIdx, attacker, highGoal)) return false;
            setBarrelElevation(attacker, highGoal);
            sol = high;
          } else {
            this.onObstructedShot?.(attackerIdx, target, impact.x, impact.z);
            return false;
          }
        } else {
          this.onObstructedShot?.(attackerIdx, target, impact.x, impact.z);
          return false;
        }
      }
    }
    const barrelDir = live
      ? new THREE.Vector3(live.direction.x, live.direction.y, live.direction.z)
      : new THREE.Vector3(
          Math.sin(gunYaw) * Math.cos(sol.elevation),
          Math.sin(sol.elevation),
          Math.cos(gunYaw) * Math.cos(sol.elevation),
        );

    const geo = roundShell ? this.shellGeo : this.boltGeo;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: roundColor }),
    );
    mesh.position.copy(start);
    mesh.frustumCulled = false;
    // The peewee's rifle fires small bullets: shrink the shared head geo
    // (the warp tail rides along as a child, so the streak shrinks too).
    if (kind === "peewee") mesh.scale.setScalar(PEEWEE_BULLET_SCALE);
    // Warp tail: a tapered additive cone in the weapon tint, parented to
    // the head so it trails the flight line from the first tick (posed
    // from the muzzle speed here, re-posed from the instantaneous speed
    // every tick in `advanceShots`).
    const tailMat = new THREE.MeshBasicMaterial({
      color: roundColor,
      transparent: true,
      opacity: projectileTailOpacity(Math.hypot(sol.velocity.x, sol.velocity.y, sol.velocity.z)),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tail = new THREE.Mesh(this.tailGeo, tailMat);
    tail.scale.set(1, 1, projectileTailLength(Math.hypot(sol.velocity.x, sol.velocity.y, sol.velocity.z)));
    mesh.add(tail);
    this.scene.add(mesh);
    this.shots.push({
      mesh,
      tail,
      tailMat,
      start,
      vel: new THREE.Vector3(sol.velocity.x, sol.velocity.y, sol.velocity.z),
      gravity: roundGravity,
      age: 0,
      dur: sol.duration,
      kind,
      attack,
      attacker: attackerIdx,
      target,
      tx: impact.x,
      tz: impact.z,
    });
    this.fired += 1;
    this.lastKind = kind;
    if (lobGrenade) this.lobs += 1;

    this.spawnMuzzle(start, roundColor, roundFlash, kind === "peewee" ? PEEWEE_BULLET_SCALE : 1);
    this.kickLight(start, roundColor, kind === "peewee" ? 2600 * PEEWEE_BULLET_SCALE : 2600);
    this.kickRecoil(attackerIdx, attacker, barrelDir);
    return true;
  }

  private kickRecoil(index: number, body: THREE.Group, barrelDir: THREE.Vector3): void {
    // Wrecks never recoil (covers white-box kills that bypass `damageUnits`;
    // organic fire only ever picks live attackers).
    if (this.destroyed[index]) return;
    // Walker weapon cycle: the peewee pumps its hand-cannon tube back along
    // the gun line, the tube-less commander braces its torso back — the
    // walkers' visible "reloading" motion at the weapon, on top of the
    // shared turret slide. Tanks keep the slide alone.
    const kind = this.unitKind(index);
    const barrel = getBarrel(body);
    const pump = kind === "peewee" && barrel ? BARREL_PUMP_KICK : 0;
    const pumpBase = pump > 0 && barrel ? barrel.position.clone() : null;
    const nod = kind === "commander" && getTurret(body) ? COMMANDER_BRACE_KICK : 0;
    const live = this.nudges.get(index);
    if (live) {
      // A rocked hull keeps its rock (hull fields untouched): only the turret
      // re-kicks, so firing through a hit reaction never restarts the rock.
      live.turret = TURRET_RECOIL_KICK;
      live.turretAge = 0;
      live.turretDur = TURRET_RECOIL_DURATION;
      // Re-kicks refresh the walker cycle on the same clock (the barrel seat
      // is captured once — the kick is the sole writer of the tube position).
      if (pump > 0) {
        live.pump = pump;
        if (!live.barrelBase && pumpBase) live.barrelBase = pumpBase;
      }
      if (nod > 0) live.nod = nod;
      return;
    }
    // Recoil opposes the barrel: horizontal projection, normalized. A
    // high-lobbed shell still kicks the hull straight back, not downward.
    const dir = new THREE.Vector3(barrelDir.x, 0, barrelDir.z);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(body.rotation.y), 0, Math.cos(body.rotation.y));
    dir.normalize();
    this.nudges.set(index, {
      base: body.position.clone(),
      ox: -dir.x * RECOIL_KICK,
      oz: -dir.z * RECOIL_KICK,
      pitch: 0,
      roll: 0,
      age: 0,
      dur: RECOIL_DURATION,
      appliedPitch: 0,
      appliedRoll: 0,
      turret: TURRET_RECOIL_KICK,
      turretAge: 0,
      turretDur: TURRET_RECOIL_DURATION,
      pump,
      barrelBase: pumpBase,
      nod,
      appliedNod: 0,
    });
  }

  private spawnFlash(
    at: THREE.Vector3,
    color: number,
    life: number,
    base = 1,
    growth = 1.6,
    peak = 0.95,
  ): void {
    // Bounded pool: the oldest flash is evicted so a muzzle volley plus a
    // burst of impacts can never grow the transient list without limit.
    if (this.flashes.length >= MAX_FLASHES) {
      const oldest = this.flashes.shift();
      if (oldest) {
        this.scene.remove(oldest.mesh);
        oldest.mat.dispose();
      }
    }
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: peak,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.flashGeo, mat);
    mesh.position.copy(at);
    mesh.scale.setScalar(base);
    this.scene.add(mesh);
    this.flashes.push({ mesh, mat, life, maxLife: Math.max(life, 0.05), base, growth, peak });
  }

  /**
   * Layered muzzle flash: a hot white-ish core plus a larger faint halo, both
   * additive so the pop reads against hull paint and against trees/rocks and
   * dirt alike. The pooled point-light kick (see call site) does the actual
   * illumination of whatever is nearby — units or environment.
   */
  private spawnMuzzle(at: THREE.Vector3, color: number, life: number, scale = 1): void {
    this.spawnFlash(at, 0xfff3d6, life, 0.8 * scale, 1.4 * scale, 1);
    this.spawnFlash(at, color, life * 1.4, HALO_SCALE * scale, HALO_GROWTH * scale, HALO_PEAK);
  }

  private kickLight(at: THREE.Vector3, color: number, peak = 2600): void {
    let light = this.lights[0]!;
    for (const candidate of this.lights) {
      if (candidate.intensity < light.intensity) light = candidate;
    }
    light.color.setHex(color);
    light.position.copy(at);
    light.intensity = peak * nightLightScale(this.night);
  }

  /**
   * Epic unit-death burst: the full layered stack at ~1.6× footprint with a
   * longer 1.8 s staging, double smoke puffs, 80 sparks, and a harder light
   * kick — inside the same bounded explosion pool, so a volley of kills
   * evicts oldest-first like any barrage. Scars its own scorch + dent via
   * the shared path, sized up from the hammer's (the wreck deserves the
   * biggest footprint on the field regardless of what killed it).
   */
  private explodeDeath(at: THREE.Vector3): void {
    // A wreck going up is not enemy fire: its burst damages bystanders but
    // blames nobody (non-hostile), so survivors do not pursue each other
    // over a cook-off.
    this.explode(at, 0xff8a3c, "hammer", true, null, false);
  }

  /**
   * Detonate a structure-class blast (HQ death): the full epic stack at the
   * fort — scorch, dent, unit splash, and the structures hook (already
   * wrecked, so the hook is a no-op for the dead HQ itself). Non-hostile, so
   * survivors hesitate at the cook-off but blame nobody.
   */
  detonateStructure(at: THREE.Vector3, kind: UnitKind): void {
    this.explode(at, 0xff8a3c, kind, true, null, false);
  }

  /**
   * Layered AAA explosion (nanolathe flash-shell + smoke-column + sparks
   * pairing, adapted from sprites to three.js meshes): a weapon-tinted
   * additive flash shell, a rising orange fireball, cool-grey smoke puffs, an
   * expanding ground shockwave ring, gravity-driven spark debris, a pooled
   * light kick, and a lingering ground glow seated on the terrain — so the
   * blast reads against dirt, trees, and rocks exactly the way the muzzle
   * flash already reads against hull paint. One extra material per layer
   * (fire/smoke/ring/glow) is owned per explosion and disposed with it;
   * geometries stay shared. Smoke stays cool grey per the gentler-scorch
   * palette (never brown) and unit-damage smoke stays subtle (untouched).
   */
  private explode(
    at: THREE.Vector3,
    color: number,
    kind: UnitKind,
    epic = false,
    shooter: number | null = null,
    hostile = true,
    attack: AttackMode = "round",
  ): void {
    if (this.explosions.length >= MAX_EXPLOSIONS) {
      const oldest = this.explosions.shift();
      if (oldest) this.removeExplosion(oldest);
    }
    const group = new THREE.Group();
    group.position.copy(at);
    const ground = this.env ? this.env.groundY(at.x, at.z) : at.y;
    const slope = this.env?.slopeAt?.(at.x, at.z) ?? null;
    const wash = slope && slope.skew > 0 ? slope : null;
    const shape = scorchForAttack(kind, attack);
    const radiusScale = epic ? EPIC_RADIUS_SCALE : 1;
    const puffCount = epic ? EPIC_SMOKE_PUFFS : SMOKE_PER_EXPLOSION;
    const sparkCount = epic ? EPIC_SPARKS : SPARKS_PER_EXPLOSION;
    // The peewee's rifle cracks: a scaled-down stack with a shorter staging.
    const blastScale = !epic && kind === "peewee" ? PEEWEE_BLAST_SCALE : 1;

    const flashMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flashMesh = new THREE.Mesh(this.shockGeo, flashMat);
    group.add(flashMesh);

    // Fireball: hot orange heart that balloons then collapses as it rises.
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xffa03c,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const fireMesh = new THREE.Mesh(this.fireGeo, fireMat);
    fireMesh.scale.setScalar(0.5);
    group.add(fireMesh);

    // Smoke: cool-grey puffs (shared material, per-puff rise velocities)
    // that climb and swell while the flash dies.
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0x8f959e,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    const smokes: THREE.Mesh[] = [];
    const smokeVel = new Float32Array(puffCount * 3);
    for (let i = 0; i < puffCount; i++) {
      const puff = new THREE.Mesh(this.smokeGeo, smokeMat);
      const theta = this.rng() * Math.PI * 2;
      const r = (4 + this.rng() * 10) * blastScale;
      puff.position.set(Math.cos(theta) * r, this.rng() * 6 * blastScale, Math.sin(theta) * r);
      puff.scale.setScalar((0.5 + this.rng() * 0.4) * blastScale);
      group.add(puff);
      smokes.push(puff);
      // Smoke climbs and drifts downhill with the wash (fixed bias, no extra
      // rng — the plume leans down the fall line instead of rising through
      // the uphill slope).
      const lean = wash ? wash.skew * 30 : 0;
      smokeVel[i * 3] =
        (Math.cos(theta + Math.PI / 2) * (4 + this.rng() * 8) + (wash ? wash.sx * lean : 0)) * blastScale;
      smokeVel[i * 3 + 1] = (26 + this.rng() * 22) * blastScale;
      smokeVel[i * 3 + 2] =
        (Math.sin(theta + Math.PI / 2) * (4 + this.rng() * 8) + (wash ? wash.sz * lean : 0)) * blastScale;
    }

    // Shockwave ring + lingering glow: ground-seated so the blast footprint
    // reads on dirt and undergrowth, not just on hulls. Both tilt to the
    // terrain normal (finite-difference of the seated surface) so the wave
    // races along the slope instead of clipping through the uphill grade as
    // a flat horizontal disc.
    const groundTilt = this.groundTilt(at.x, at.z);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe2b8,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(this.ringGeo, ringMat);
    ringMesh.position.y = ground - at.y + 1.6;
    ringMesh.quaternion.copy(groundTilt);
    ringMesh.scale.setScalar(Math.max(shape.radius * radiusScale * 0.4, 1));
    group.add(ringMesh);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff9a3c,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowMesh = new THREE.Mesh(this.glowGeo, glowMat);
    glowMesh.position.y = ground - at.y + 1.4;
    glowMesh.quaternion.copy(groundTilt);
    glowMesh.scale.setScalar(Math.max(shape.radius * radiusScale * 1.1, 1));
    group.add(glowMesh);

    const positions = new Float32Array(sparkCount * 3);
    const velocities = new Float32Array(sparkCount * 3);
    // Ejecta bias down the fall line (fixed, no extra rng): debris sprays
    // further downhill, cut short uphill — the burst expands outward along
    // the terrain instead of as a flat symmetric fountain.
    const ejecta = wash ? wash.skew * 90 : 0;
    for (let i = 0; i < sparkCount; i++) {
      const theta = this.rng() * Math.PI * 2;
      const up = 0.4 + this.rng() * 1.2;
      const speed = (60 + this.rng() * 160) * blastScale;
      velocities[i * 3] = Math.cos(theta) * speed + (wash ? wash.sx * ejecta * blastScale : 0);
      velocities[i * 3 + 1] = up * speed;
      velocities[i * 3 + 2] = Math.sin(theta) * speed + (wash ? wash.sz * ejecta * blastScale : 0);
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pointsMat = new THREE.PointsMaterial({
      color: 0xffc46b,
      size: 7,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(sparkGeo, pointsMat);
    points.frustumCulled = false;
    group.add(points);

    this.scene.add(group);
    this.explosions.push({
      group,
      flashMat,
      flashMesh,
      fireMat,
      fireMesh,
      smokeMat,
      smokes,
      smokeVel,
      ringMat,
      ringMesh,
      glowMat,
      glowMesh,
      points,
      pointsMat,
      velocities,
      sparks: sparkCount,
      epic,
      age: 0,
      maxAge: epic ? EPIC_MAX_AGE : blastScale < 1 ? PEEWEE_EXPLOSION_MAX_AGE : EXPLOSION_MAX_AGE,
      glowRadius: shape.radius * radiusScale,
      scale: blastScale,
    });
    this.kickLight(at, 0xff8a3c, epic ? EPIC_LIGHT_PEAK : 2600 * blastScale);
    this.scarGround(at, kind, slope ?? undefined, attack);
    this.damageUnits(at, kind, slope, shooter, hostile, attack);
    // Structures share every blast: an HQ near the impact takes honest
    // splash through the canvas-owned damage state (collateral even when the
    // volley aimed at a hull).
    this.env?.damageStructures?.({ x: at.x, y: at.y, z: at.z }, kind, shooter, hostile, attack);
  }

  /**
   * Persistent ground scar + graduated blast damage for an impact. Decals
   * reuse one shared instanced disc (no per-mark geometry/material); only
   * instance matrices/colors are rewritten, and only on impact — never per
   * frame. On graded ground the mark carries its downhill wash (stretched
   * down the fall line in `syncScorch`) and the crater dents asymmetrically.
   * Hulls are splashed with accumulating (visual-only) damage by the
   * caller; a tree flattened under a unit still leaves the unit where it
   * stands.
   */
  private scarGround(at: THREE.Vector3, kind: UnitKind, slope?: BlastSlope | null, attack: AttackMode = "round"): void {
    const shape = scorchForAttack(kind, attack);
    const wash = slope && slope.skew > 0 ? slope : null;
    this.scorchMarks = addScorchMark(this.scorchMarks, {
      x: at.x,
      z: at.z,
      radius: shape.radius,
      intensity: shape.intensity,
      seed: scorchSeed(at.x, at.z),
      ...(wash ? { sx: wash.sx, sz: wash.sz, skew: wash.skew } : {}),
    });
    this.syncScorch(at.y);
    this.env?.blastFeatures(at.x, at.z, blastRadiusFor(kind, attack), slope ?? undefined);
    this.env?.dentTerrain?.(at.x, at.z, shape.radius, craterDepthForIntensity(shape.intensity), slope ?? undefined);
  }

  /**
   * Tilt-from-up quaternion aligning a ground disc (shock ring, scorch,
   * glow) to the seated terrain normal at (x, z), from finite differences
   * of the live surface (map heights minus crater dents, exaggerated).
   * Flat ground returns identity, so flat blasts render exactly as before.
   */
  private groundTilt(x: number, z: number): THREE.Quaternion {
    const tilt = new THREE.Quaternion();
    if (!this.env) return tilt;
    const g = this.env.groundY;
    const t = 8;
    const nx = (g(x - t, z) - g(x + t, z)) / (2 * t);
    const nz = (g(x, z - t) - g(x, z + t)) / (2 * t);
    if (nx === 0 && nz === 0) return tilt;
    return tilt.setFromUnitVectors(UP, new THREE.Vector3(nx, 1, nz).normalize());
  }

  /** Rewrite scorch instance matrices/colors from the mark list. */
  private syncScorch(fallbackY: number): void {
    const dummy = this.scorchDummy;
    for (let i = 0; i < this.scorchMarks.length; i++) {
      const mark = this.scorchMarks[i]!;
      const seed = resolveScorchSeed(mark);
      const radius = Math.max(mark.radius, 0.5);
      // Elliptical squash from the seed: no two blotches share a silhouette.
      const [ax, az] = scorchAnisotropy(seed);
      const skew = mark.skew ?? 0;
      const washed = skew > 0 && ((mark.sx ?? 0) !== 0 || (mark.sz ?? 0) !== 0);
      if (!this.env) {
        // Headless (no terrain): legacy flat stamp at the fallback height.
        dummy.position.set(mark.x, fallbackY, mark.z);
        dummy.rotation.set(0, ((i * 2.39996) % Math.PI) + seed * Math.PI, 0);
        dummy.scale.set(radius * ax, 1, radius * az);
      } else {
        // Drape the decal on the live surface: tilt to the terrain normal
        // so the blotch hugs the grade instead of floating downhill and
        // clipping uphill, and stretch washed marks down the fall line
        // (major axis along the wash, jittered by the seed so parallel
        // hillsides don't read as stamped copies).
        dummy.position.set(mark.x, this.env.groundY(mark.x, mark.z) + 1.2, mark.z);
        const yaw = washed
          ? Math.atan2(-(mark.sz ?? 0), mark.sx ?? 1) + (seed - 0.5) * 0.9
          : ((i * 2.39996) % Math.PI) + seed * Math.PI;
        dummy.quaternion.copy(this.groundTilt(mark.x, mark.z)).multiply(_yawQuat.setFromAxisAngle(UP, yaw));
        dummy.scale.set(
          radius * ax * (washed ? 1 + skew : 1),
          1,
          radius * az * (washed ? 1 - skew * 0.5 : 1),
        );
      }
      dummy.updateMatrix();
      this.scorchMesh.setMatrixAt(i, dummy.matrix);
      // Near-white warm multiplier over the baked char-center texture:
      // heavier blasts scar darker, but the gradient shape always reads.
      const shade = scorchShade(mark.intensity);
      this.scorchTint.setRGB(shade, shade * 0.97, shade * 0.94);
      this.scorchMesh.setColorAt(i, this.scorchTint);
    }
    this.scorchMesh.count = this.scorchMarks.length;
    this.scorchMesh.instanceMatrix.needsUpdate = true;
    if (this.scorchMesh.instanceColor) this.scorchMesh.instanceColor.needsUpdate = true;
  }

  private removeExplosion(ex: Explosion): void {
    this.scene.remove(ex.group);
    ex.flashMat.dispose();
    ex.fireMat.dispose();
    ex.smokeMat.dispose();
    ex.ringMat.dispose();
    ex.glowMat.dispose();
    ex.points.geometry.dispose();
    ex.pointsMat.dispose();
  }

  /**
   * Drop a shot's visuals: the head leaves the scene (its child tail goes
   * with it) and both per-shot materials dispose — the shared head/tail
   * geometries stay with the fx. Every removal path funnels through here.
   */
  private removeShotVisuals(shot: Shot): void {
    this.scene.remove(shot.mesh);
    (shot.mesh.material as THREE.Material).dispose();
    shot.tailMat.dispose();
  }

  private advanceShots(dt: number): void {
    // No rounds in flight: skip the stands fetch + scratch work entirely.
    if (this.shots.length === 0) return;
    const done: Shot[] = [];
    const stands = this.env?.treeStands?.() ?? null;
    for (const shot of this.shots) {
      shot.age += dt;
      const t = Math.min(shot.age, shot.dur);
      // Analytic ballistic flight: exact and frame-rate independent for any
      // dt sequence — the muzzle solution lands on the impact at t = dur.
      const p = ballisticPosition(
        { x: shot.start.x, y: shot.start.y, z: shot.start.z },
        { x: shot.vel.x, y: shot.vel.y, z: shot.vel.z },
        t,
        shot.gravity,
      );
      // Tree interception: the flown segment (previous pose → new pose)
      // enters live crowns/trunks in ascending fid order, rolling the
      // per-kind stick chance per tree on the seeded rng (open flights cost
      // no entropy). Corridor-rejected per tree, so forest flyovers stay
      // cheap. Shells detonate early with the full layered stack (the blast
      // itself damages/ignites the wood); stuck bolts read as an ember
      // caught in the branches (hot pop + pooled-light kick, no blast) and
      // the canvas ignites the struck tree through the damage field.
      if (stands && stands.length > 0 && shot.age < shot.dur) {
        const q = ballisticPosition(
          { x: shot.start.x, y: shot.start.y, z: shot.start.z },
          { x: shot.vel.x, y: shot.vel.y, z: shot.vel.z },
          Math.max(t - dt, 0),
          shot.gravity,
        );
        const crossed = treesOnSegment(q, p, stands);
        const stuckFid = crossed.length > 0 ? rollTreeStick(crossed, shot.kind, this.rng) : -1;
        if (stuckFid >= 0) {
          _shotAt.set(p.x, p.y, p.z);
          const at = _shotAt;
          const color = (shot.mesh.material as THREE.MeshBasicMaterial).color.getHex();
          this.removeShotVisuals(shot);
          this.shots.splice(this.shots.indexOf(shot), 1);
          this.stuck += 1;
          this.env?.strikeTree?.(stuckFid);
          // Forest futility: rounds swallowed in a row prove the lane is
          // blocked, not unlucky — report it so the hull repositions out
          // of the wood (or closer through it) instead of feeding the
          // canopy, then re-arm: persistent futility keeps the pursuit
          // fresh without spamming the hook on every ember.
          const streak = (this.forestSticks.get(shot.attacker) ?? 0) + 1;
          if (streak >= FOREST_STICK_REPOSITION_HITS) {
            this.forestSticks.delete(shot.attacker);
            this.onObstructedShot?.(shot.attacker, shot.target, shot.tx, shot.tz);
          } else {
            this.forestSticks.set(shot.attacker, streak);
          }
          if (shot.gravity > 0) {
            this.explode(at, color, shot.kind, false, shot.attacker, true, shot.attack);
            this.spawnFlash(at, color, FLASH_MAX_AGE * 0.6);
          } else {
            this.spawnFlash(at, 0xffd34d, FLASH_MAX_AGE * 0.6);
            this.spawnFlash(at, color, FLASH_MAX_AGE * 0.9, HALO_SCALE, HALO_GROWTH, HALO_PEAK);
            this.kickLight(at, 0xff8a3c, 1400);
          }
          continue;
        }
      }
      // Terrain sweep: the flown arc window (previous time → new time) is
      // marched against the live surface at ≤8-unit steps, so even a 1300
      // u/s bolt on a long tick cannot tunnel through a ridge it crosses
      // mid-flight — the round detonates on the dirt it hits with the full
      // arrival stack (splash, scorch, structures) instead of flying
      // through the hillside to its aimed impact.
      if (this.env) {
        const tPrev = Math.max(t - dt, 0);
        if (t > tPrev) {
          const hit = flightTerrainHit(
            { x: shot.start.x, y: shot.start.y, z: shot.start.z },
            { x: shot.vel.x, y: shot.vel.y, z: shot.vel.z },
            shot.gravity,
            tPrev,
            t,
            this.env.groundY,
          );
          if (hit) {
            _shotAt.set(hit.x, hit.y, hit.z);
            const at = _shotAt;
            const color = (shot.mesh.material as THREE.MeshBasicMaterial).color.getHex();
            this.removeShotVisuals(shot);
            this.shots.splice(this.shots.indexOf(shot), 1);
            this.explode(at, color, shot.kind, false, shot.attacker, true, shot.attack);
            this.spawnFlash(at, color, FLASH_MAX_AGE * 0.6);
            continue;
          }
        }
      }
      shot.mesh.position.set(p.x, p.y, p.z);
      // Orient bolts head→tail along travel (nanolathe beam-stroke analog);
      // shells are spheres, so orienting them is harmless and free.
      const v = ballisticVelocity(
        { x: shot.vel.x, y: shot.vel.y, z: shot.vel.z },
        t,
        shot.gravity,
      );
      _shotVel.set(v.x, v.y, v.z);
      if (_shotVel.lengthSq() > 1e-6) {
        _shotLook.copy(shot.mesh.position).add(_shotVel);
        shot.mesh.lookAt(_shotLook);
      }
      // Warp tail: stretch + opacity from the instantaneous speed, so a
      // shell's tail breathes along its arc as gravity works (short/faint
      // at the apex, long/bright on the descent) while bolts hold steady.
      // The tail rides the head as a child — position/orientation are free.
      const speed = _shotVel.length();
      shot.tail.scale.set(1, 1, projectileTailLength(speed));
      shot.tailMat.opacity = projectileTailOpacity(speed);
      if (shot.age >= shot.dur) done.push(shot);
    }
    for (const shot of done) {
      _shotAt.copy(shot.mesh.position);
      const at = _shotAt;
      const color = (shot.mesh.material as THREE.MeshBasicMaterial).color.getHex();
      this.removeShotVisuals(shot);
      this.shots.splice(this.shots.indexOf(shot), 1);
      // The lane is open after all: a round that reaches its impact clears
      // the gunner's futility streak (only *consecutive* sticks reposition).
      this.forestSticks.delete(shot.attacker);
      this.explode(at, color, shot.kind, false, shot.attacker, true, shot.attack);
      this.spawnFlash(at, color, FLASH_MAX_AGE * 0.6);
    }
  }

  /**
   * Seat the projectile-glow pool on the live rounds: slot `i` rides
   * `shots[i]` — a weapon-tinted light at the round for Lambert neighbors
   * (trees, rocks, hulls) plus an oriented ground ellipse on `env.groundY`
   * under it for the unlit terrain shader, stretched along the head→tail
   * flight line like the projectile itself (see
   * `projectileGlowFootprint`). Both fade with height above the dirt via
   * `projectileGlowFalloff`, so low skimmers light the undergrowth while
   * high lobbed arcs go quiet. Slots past the live shots go dark/hidden;
   * with no shots (or no env surface) the blobs hide and only the falloff
   * math remains. Runs after `advanceShots` every tick — never touches sim
   * state, muzzle/explosion pools, or wreck dressing.
   */
  private poseShotGlow(): void {
    for (let i = 0; i < SHOT_GLOW_LIGHTS; i++) {
      const light = this.shotGlowLights[i];
      const blob = this.shotGlowMeshes[i];
      const mat = this.shotGlowMats[i];
      if (!light || !blob || !mat) continue;
      const shot = this.shots[i];
      if (!shot) {
        light.intensity = 0;
        blob.visible = false;
        continue;
      }
      const pos = shot.mesh.position;
      const color = (shot.mesh.material as THREE.MeshBasicMaterial).color.getHex();
      light.color.setHex(color);
      light.position.copy(pos);
      mat.color.setHex(color);
      if (!this.env) {
        // Headless (no terrain): lights still ride the rounds (Lambert
        // neighbors), blobs hide — there is no dirt to seat them on.
        light.intensity = SHOT_GLOW_PEAK * projectileGlowLightScale(this.night);
        blob.visible = false;
        continue;
      }
      const ground = this.env.groundY(pos.x, pos.z);
      const falloff = projectileGlowFalloff(pos.y - ground);
      if (falloff <= 0) {
        light.intensity = 0;
        blob.visible = false;
        continue;
      }
      light.intensity = SHOT_GLOW_PEAK * falloff * projectileGlowLightScale(this.night);
      blob.visible = true;
      blob.position.set(pos.x, ground + 1.4, pos.z);
      // Reflection of the round, not a plain circle: the ellipse yaws onto
      // the horizontal flight bearing and stretches along it with the
      // ground-projected warp tail — the same instantaneous vector the head
      // mesh lookAts in `advanceShots`, so the dirt tracks the airframe.
      const v = ballisticVelocity(
        { x: shot.vel.x, y: shot.vel.y, z: shot.vel.z },
        Math.min(shot.age, shot.dur),
        shot.gravity,
      );
      const foot = projectileGlowFootprint(v.x, v.y, v.z, falloff);
      blob.rotation.y = foot.yaw;
      blob.scale.set(foot.width, 1, foot.length);
      mat.opacity = SHOT_GLOW_OPACITY * falloff * projectileGlowLightScale(this.night);
    }
  }

  private advanceFlashes(dt: number): void {    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i]!;
      flash.life -= dt;
      if (flash.life <= 0) {
        this.scene.remove(flash.mesh);
        flash.mat.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const k = 1 - flash.life / flash.maxLife;
      flash.mesh.scale.setScalar(flash.base + k * flash.growth);
      flash.mat.opacity = flash.peak * (1 - k);
    }
    for (const light of this.lights) {
      if (light.intensity > 0) light.intensity = Math.max(0, light.intensity - dt * 14000);
    }
  }

  private advanceExplosions(dt: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i]!;
      ex.age += dt;
      const k = Math.min(ex.age / ex.maxAge, 1);
      const s = ex.epic ? EPIC_RADIUS_SCALE : ex.scale;
      // Flash shell: fast-expanding additive pop.
      ex.flashMesh.scale.setScalar((1 + k * 5) * s);
      ex.flashMat.opacity = 0.9 * (1 - k);
      // Fireball: balloons in the first quarter, then collapses and lifts.
      const fireK = Math.min(k / 0.25, 1);
      const dieK = Math.max((k - 0.25) / 0.75, 0);
      ex.fireMesh.scale.setScalar((0.5 + fireK * 0.9 - dieK * 1.1) * s);
      ex.fireMesh.position.y = k * 14 * s;
      ex.fireMat.opacity = 0.95 * (1 - k);
      // Smoke: climb, drift, and swell while fading with the shared mat.
      for (let s = 0; s < ex.smokes.length; s++) {
        const puff = ex.smokes[s]!;
        puff.position.x += ex.smokeVel[s * 3]! * dt;
        puff.position.y += ex.smokeVel[s * 3 + 1]! * dt;
        puff.position.z += ex.smokeVel[s * 3 + 2]! * dt;
        puff.scale.setScalar(puff.scale.x + dt * 6 * (ex.epic ? 1 : ex.scale));
      }
      ex.smokeMat.opacity = 0.34 * (1 - k);
      // Shockwave ring: ground footprint racing outward past the scorch.
      ex.ringMesh.scale.setScalar(ex.glowRadius * (0.4 + k * 2.0));
      ex.ringMat.opacity = 0.7 * (1 - k);
      // Lingering glow: ground light pooling under the blast, slowest fade.
      ex.glowMesh.scale.setScalar(ex.glowRadius * 1.1 * (0.8 + 0.4 * k));
      ex.glowMat.opacity = 0.5 * (1 - k) * (1 - k * 0.3);
      const pos = ex.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let p = 0; p < ex.sparks; p++) {
        ex.velocities[p * 3 + 1] = ex.velocities[p * 3 + 1]! - 320 * dt;
        pos.setXYZ(
          p,
          pos.getX(p) + ex.velocities[p * 3]! * dt,
          pos.getY(p) + ex.velocities[p * 3 + 1]! * dt,
          pos.getZ(p) + ex.velocities[p * 3 + 2]! * dt,
        );
      }
      pos.needsUpdate = true;
      ex.pointsMat.opacity = 1 - k;
      if (k >= 1) {
        this.removeExplosion(ex);
        this.explosions.splice(i, 1);
      }
    }
  }

  /**
   * Advance every hull nudge one step: recoil kicks and hit-reaction rocks
   * share one entry map, so a hull is only ever posed from a single seated
   * base (no fighting between systems) and every entry restores exactly on
   * expiry. Position rides the base absolutely with a linear return; tilt
   * applies relatively on top of the grade pose movement just seated
   * (un-applying last tick first keeps headless restores exact and live
   * wobble bounded) through the damped back-and-forward rock (core
   * `impactTiltEnvelope`), so the hull is shoved back once but its tilt
   * swings past the seat before settling. The turret-local recoil rides the
   * same entry on its own shorter clock: the turret slides rearward along
   * the live barrel line (re-read from the turret yaw every tick, so
   * traverse during the kick tracks the gun) while aim yaw, hull rock, and
   * idle breathing compose untouched — yaw lives on rotation, recoil on
   * position, tremble on the hull. The walker weapon cycle rides the same
   * turret envelope (peewee tube pump, commander torso brace — posed and
   * restored with the slide). The entry drops only once both envelopes
   * have restored (hull to its base, turret X/Z to zero).
   */
  private advanceNudges(dt: number): void {
    for (const [index, nudge] of this.nudges) {
      const child = this.units.children[index] as THREE.Group | undefined;
      if (!child) {
        this.nudges.delete(index);
        continue;
      }
      child.rotation.x -= nudge.appliedPitch;
      child.rotation.z -= nudge.appliedRoll;
      nudge.appliedPitch = 0;
      nudge.appliedRoll = 0;
      // Wrecks hold still: settle instead of rocking (covers white-box kills
      // that bypass `damageUnits`; organic kills settle in the splash).
      if (this.destroyed[index]) {
        child.position.copy(nudge.base);
        const turret = getTurret(child);
        if (turret) {
          turret.position.x = 0;
          turret.position.z = 0;
          turret.rotation.x -= nudge.appliedNod;
        }
        const barrel = getBarrel(child);
        if (barrel && nudge.barrelBase) barrel.position.copy(nudge.barrelBase);
        this.nudges.delete(index);
        continue;
      }
      nudge.age += dt;
      const k = 1 - nudge.age / nudge.dur;
      let hullDone = false;
      if (k <= 0) {
        child.position.copy(nudge.base);
        hullDone = true;
      } else {
        child.position.set(nudge.base.x + nudge.ox * k, nudge.base.y, nudge.base.z + nudge.oz * k);
        // Tilt rocks back *and* forward past the seat while the shove only
        // returns (pure recoil kicks carry zero tilt, so they pose unchanged).
        const tk = impactTiltEnvelope(nudge.age, nudge.dur);
        child.rotation.x += nudge.pitch * tk;
        child.rotation.z += nudge.roll * tk;
        nudge.appliedPitch = nudge.pitch * tk;
        nudge.appliedRoll = nudge.roll * tk;
      }
      let turretDone = true;
      const turret = getTurret(child);
      if (turret && nudge.turret > 0) {
        nudge.turretAge += dt;
        const tk = 1 - nudge.turretAge / nudge.turretDur;
        // The brace un-applies before every re-pose (aim owns yaw only, so
        // the nod is the sole writer of turret pitch — exact, never stacked).
        turret.rotation.x -= nudge.appliedNod;
        nudge.appliedNod = 0;
        if (tk <= 0) {
          turret.position.x = 0;
          turret.position.z = 0;
          nudge.turret = 0;
          const barrel = getBarrel(child);
          if (barrel && nudge.barrelBase) barrel.position.copy(nudge.barrelBase);
          nudge.pump = 0;
          nudge.nod = 0;
        } else {
          // Rearward along the live barrel: the turret's own yaw in the hull
          // frame, so the slide tracks traverse instead of freezing the
          // firing line (aim yaw itself is never touched).
          const yaw = turret.rotation.y;
          turret.position.x = -Math.sin(yaw) * nudge.turret * tk;
          turret.position.z = -Math.cos(yaw) * nudge.turret * tk;
          // Walker weapon cycle on the same envelope: the peewee's tube
          // pumps back into its mount along the gun line, the commander's
          // torso braces back off its chest cannon.
          const barrel = getBarrel(child);
          if (barrel && nudge.barrelBase && nudge.pump > 0) {
            barrel.position.set(
              nudge.barrelBase.x,
              nudge.barrelBase.y,
              nudge.barrelBase.z - nudge.pump * tk,
            );
          }
          if (nudge.nod > 0) {
            const brace = -nudge.nod * tk;
            turret.rotation.x += brace;
            nudge.appliedNod = brace;
          }
          turretDone = false;
        }
      }
      if (hullDone && turretDone) this.nudges.delete(index);
    }
  }
}
