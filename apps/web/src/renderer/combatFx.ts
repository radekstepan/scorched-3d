import * as THREE from "three";
import {
  accumulateImpact,
  addScorchMark,
  aimStep,
  applyBlastToUnits,
  ballisticPosition,
  ballisticVelocity,
  BLAST_RADIUS,
  type BlastSlope,
  canFire,
  clampElevation,
  clampTurret,
  craterDepthForIntensity,
  createUnitDamage,
  GRAVITY,
  huskDecay,
  huskSink,
  IMPACT_DURATION,
  impactKick,
  inRange,
  isDestroyed,
  isHuskGone,
  MAX_EXPLOSIONS,
  MAX_SCORCH_MARKS,
  MAX_SHOTS,
  muzzleForward,
  muzzleHeight,
  muzzleYaw,
  nextShotDelay,
  pickSkirmishPair,
  resolveScorchSeed,
  scorchAnisotropy,
  scorchForKind,
  scorchSeed,
  scorchShade,
  solveShot,
  stepAngle,
  TURRET_SLEW_RATE,
  wrapAngle,
  yawToTarget,
  WEAPON_PROFILES,
  zeroImpact,
  type ImpactKick,
  type PlacedUnit,
  type ScorchMark,
  type UnitKind,
} from "@scorched-3d/core";
import { muzzleWorld, setBarrelElevation, setUnitAim } from "./units";
import { applyUnitDamageTint, UnitDamageFx } from "./unitDamageFx";
import { disposeScorchTexture, getScorchTexture } from "./craters";

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
 *   along their velocity and pooling point lights for muzzle/explosion pops.
 * - Retail turret aim is yaw-relative-to-heading from the AimFrom piece
 *   (spec 06 §3.3), traversed by the COB script within its limits: hulls
 *   turn to face the target at a limited rate while the turret/barrel
 *   subgroup slews the remainder inside a clamped traverse, and the muzzle
 *   + projectile always leave down the turret line. Shots only fire once
 *   aimed; otherwise the pair keeps traversing and the scheduler retries.
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
 *   embers — hulls are rocked by every splash (decaying directional shove + tilt); a hull that exhausts its
 *   health dies once, epicly, and lingers as a smouldering husk that slowly sinks, gutters out, and vanishes).
 */

interface Shot {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  age: number;
  dur: number;
  kind: UnitKind;
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
}

/**
 * Transient hull nudge: one entry per rocked hull, covering both the
 * attacker's straight-back recoil kick and a victim's directional hit
 * reaction (blast shove + hull-frame pitch/roll rock from core
 * `impactKick`). Position is absolute from the seated `base` (shifted by
 * patrol motion like recoil anchors, so the kick restore never snaps a
 * driving unit backward); tilt is relative, applied on top of whatever
 * grade pose movement just seated. The envelope decays linearly to zero
 * over `dur` and re-hits refresh it — sustained fire keeps the hull
 * rocking instead of restarting it. Wrecks never hold entries (cleared on
 * the kill), and movers never move: this is renderer-side only, restored
 * exactly on expiry/clear, so drive/pathing/separation never see it.
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
}

/** Attacker recoil: straight-back kick, world units at full envelope. */
const RECOIL_KICK = 5;
/** Attacker recoil envelope, seconds (snappy kick, faster than hit rock). */
const RECOIL_DURATION = 0.28;
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
/** Muzzle + impact flashes share one bounded pool (cores + halos). */
const MAX_FLASHES = 24;
/** Muzzle halo: large faint shell around the hot core. */
const HALO_SCALE = 1.9;
const HALO_GROWTH = 2.4;
const HALO_PEAK = 0.4;
/** World up (scratch tilt quaternions align ground discs from this). */
const UP = new THREE.Vector3(0, 1, 0);
/** Scratch yaw quaternion for scorch instance orientation (no per-mark alloc). */
const _yawQuat = new THREE.Quaternion();

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

/** Impact point: just above the target hull with a small random scatter. */
export function impactPoint(
  pos: { x: number; y: number; z: number },
  rng: () => number,
): { x: number; y: number; z: number } {
  return {
    x: pos.x + (rng() - 0.5) * 22,
    y: pos.y + 6 + rng() * 8,
    z: pos.z + (rng() - 0.5) * 22,
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
  private fired = 0;
  /** Per-unit aim pose: hull yaw + turret-relative yaw (core `aimStep`). */
  private aim: { hull: number; turret: number }[] = [];
  /** Attacker → target traverse goals, slewed every frame until aimed. */
  private pending = new Map<number, number>();
  private boltGeo = new THREE.BoxGeometry(3, 3, 18);
  private shellGeo = new THREE.SphereGeometry(3.2, 8, 6);
  private flashGeo = new THREE.SphereGeometry(7, 10, 8);
  private shockGeo = new THREE.SphereGeometry(10, 14, 10);
  /** Layered-explosion shared geos: fireball, smoke puff, shock ring, glow. */
  private fireGeo = new THREE.SphereGeometry(9, 12, 10);
  private smokeGeo = new THREE.SphereGeometry(8, 8, 6);
  private ringGeo = new THREE.RingGeometry(1, 1.32, 40);
  private glowGeo = new THREE.CircleGeometry(1, 24);
  /** Persistent scorch decals: one shared instanced textured disc, capped in core. */
  private scorchGeo = new THREE.CircleGeometry(1, 28);
  private scorchMat = new THREE.MeshBasicMaterial({
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
   * Fired once per kill with the wreck index so the canvas can hold the
   * mover, drop targeting/selection, and dim the minimap dot. Assigned by
   * the canvas; null in headless tests.
   */
  onUnitKilled: ((index: number) => void) | null = null;
  /** Instanced damage smoke + embers over the hulls (transient view). */
  private damageFx: UnitDamageFx;
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

  /** Current aim pose of a unit (hull + turret-relative yaws), for tests. */
  aimState(index: number): { hull: number; turret: number } | null {
    return this.aim[index] ? { ...this.aim[index]! } : null;
  }

  /** Persistent scorch decal count (bounded by MAX_SCORCH_MARKS). */
  get scorchCount(): number {
    return this.scorchMarks.length;
  }

  /** Accumulated damage fraction of a unit (0 pristine .. 1 fully charred). */
  unitDamageAt(index: number): number {
    return this.damage[index] ?? 0;
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
    light.intensity = Math.max(light.intensity, peak);
  }

  update(dt: number): void {
    if (this.disposed || dt <= 0) return;
    this.ensureAim();
    this.ensureDamage();
    this.elapsed += dt;
    this.slewPending(dt);
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.tryFire()) {
        this.timer = nextShotDelay(this.rng);
      } else {
        // Still traversing (or capped): retry soon so aimed pairs fire
        // without waiting out a full ambient interval.
        this.timer = 0.12 + this.rng() * 0.1;
      }
    }
    this.advanceShots(dt);
    this.advanceFlashes(dt);
    this.advanceExplosions(dt);
    this.advanceNudges(dt);
    // Husks decay after every other pose (movement re-seats bodies and recoil
    // restores them above, so the sink must win last); smoke/embers ride the
    // sunk hulls and gutter out through the same decay fractions.
    const husk = this.poseHusks();
    this.damageFx.update(this.damage, this.units.children, this.elapsed, husk);
  }

  /** Drop in-flight shots, flashes, and explosions (e.g. on exaggeration re-snap). */
  clearTransients(): void {
    for (const shot of this.shots) {
      this.scene.remove(shot.mesh);
      (shot.mesh.material as THREE.Material).dispose();
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
      }
    }
    this.nudges.clear();
    this.pending.clear();
    for (const light of this.lights) light.intensity = 0;
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
    this.scene.remove(this.scorchMesh);
    this.scorchMarks = [];
    this.damageFx.dispose();
    for (const light of this.lights) this.scene.remove(light);
    this.lights = [];
    this.boltGeo.dispose();
    this.shellGeo.dispose();
    this.flashGeo.dispose();
    this.shockGeo.dispose();
    this.fireGeo.dispose();
    this.smokeGeo.dispose();
    this.ringGeo.dispose();
    this.glowGeo.dispose();
    this.scorchGeo.dispose();
    this.scorchMat.dispose();
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
  }

  /**
   * Splash a blast onto nearby hulls: accumulate core damage with linear
   * falloff and char the touched bodies in place. Every splash also rocks
   * the hull with a directional nudge — a short shove away from the blast
   * plus a hull-frame pitch/roll rock that decays back to the grade seat
   * (flank hits rock harder, see core `impactKick`). Renderer-side only:
   * movers never move, so drive/pathing/separation never see it. On graded
   * ground the wash stretches the splash downhill and shields uphill hulls
   * behind the rise. A hull crossing the kill threshold dies exactly once:
   * its nudge settles first (wrecks hold still), then an epic explosion at
   * the hull, full char, and the `onUnitKilled` hook (movement hold,
   * deselect) — the instance itself lingers as a decaying husk (see
   * `poseHusks`).
   */
  private damageUnits(at: THREE.Vector3, kind: UnitKind, slope?: BlastSlope | null): void {
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
    );
    for (const i of touched) {
      const body = bodies[i];
      if (body) applyUnitDamageTint(body, this.damage[i]!);
      const added = this.damage[i]! - before[i]!;
      if (body && added > 0 && !this.destroyed[i]) {
        this.kickImpact(i, body, at, added);
      }
      if (!this.destroyed[i] && !isDestroyed(before[i]!) && isDestroyed(this.damage[i]!)) {
        this.destroyed[i] = true;
        this.killedAt[i] = this.elapsed;
        this.deathCount += 1;
        const wreck = bodies[i];
        if (wreck) {
          this.settleNudge(i, wreck);
          this.explodeDeath(new THREE.Vector3(wreck.position.x, wreck.position.y, wreck.position.z));
        }
        this.onUnitKilled?.(i);
      }
    }
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
    });
  }

  /**
   * Settle a hull's nudge back to its seated pose and drop the entry:
   * expiry, `clearTransients`, and the kill transition all restore exactly,
   * so a rocked hull never keeps a lean and a wreck starts from its seat.
   */
  private settleNudge(index: number, body: THREE.Group): void {
    const nudge = this.nudges.get(index);
    if (!nudge) return;
    body.position.copy(nudge.base);
    body.rotation.x -= nudge.appliedPitch;
    body.rotation.z -= nudge.appliedRoll;
    this.nudges.delete(index);
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
    const decay: number[] = new Array<number>(bodies.length).fill(0);
    for (let i = 0; i < bodies.length; i++) {
      if (!this.destroyed[i]) continue;
      const d = huskDecay(this.huskAgeAt(i));
      decay[i] = d;
      const body = bodies[i] as THREE.Group | undefined;
      if (!body) continue;
      if (d >= 1) {
        body.visible = false;
      } else {
        body.position.y -= huskSink(d);
      }
    }
    return decay;
  }

  /** Size the aim pose array to the unit roster, seeding from live yaws. */
  private ensureAim(): void {
    const bodies = this.units.children as THREE.Group[];
    while (this.aim.length < bodies.length) {
      const i = this.aim.length;
      this.aim.push({ hull: bodies[i]?.rotation.y ?? 0, turret: 0 });
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
   * refine — so traverse motion is visible even before any shot fires. In
   * external-hull mode (patrol movement) the hull stays on its travel
   * heading and only the turret slews the clamped remainder.
   */
  private slewPending(dt: number): void {
    for (const [attacker, target] of this.pending) {
      if (this.destroyed[attacker] || this.destroyed[target]) {
        this.pending.delete(attacker);
        continue;
      }
      const body = this.units.children[attacker] as THREE.Group | undefined;
      const kind = this.unitKind(attacker);
      const want = this.bearing(attacker, target);
      if (!body || !kind || want === null) {
        this.pending.delete(attacker);
        continue;
      }
      const pose = this.aim[attacker];
      if (!pose) continue;
      if (this.externalHull) {
        const slewRate = TURRET_SLEW_RATE[kind] ?? 2.4;
        const wantRel = clampTurret(kind, wrapAngle(want - pose.hull));
        pose.turret = stepAngle(pose.turret, wantRel, slewRate * dt);
      } else {
        const next = aimStep(kind, pose.hull, pose.turret, want, dt);
        pose.hull = next.hull;
        pose.turret = next.turret;
      }
      setUnitAim(body, pose.hull, pose.turret);
    }
  }

  /**
   * Draw an attacker/target pair uniformly from live hulls (wrecks excluded
   * on both ends). Null when fewer than two hulls are alive — the skirmish
   * goes quiet instead of shelling wrecks. Consumes rng exactly like the
   * core pair picker so live rosters replay deterministically.
   */
  private pickLivePair(): { attacker: number; target: number } | null {
    const count = this.units.children.length;
    const alive: number[] = [];
    for (let i = 0; i < count; i++) {
      if (!this.destroyed[i]) alive.push(i);
    }
    if (alive.length < 2) return null;
    const pair = pickSkirmishPair(alive.length, this.rng);
    if (!pair) return null;
    return { attacker: alive[pair.attacker]!, target: alive[pair.target]! };
  }

  /**
   * Pick a skirmish pair and fire only when the attacker is aimed: hull
   * faced at the target (or, in external-hull mode, on its patrol heading
   * with the turret slewed onto the target), turret inside its traverse,
   * muzzle down the turret line. Returns true when a shot left (or the
   * roster/caps made firing impossible, to keep the ambient schedule); false
   * defers while the attacker is still traversing. Wrecks neither fire nor
   * draw fire: pairs are drawn from live hulls only, and fewer than two
   * live hulls means silence (still true, to keep the schedule idle).
   */
  private tryFire(): boolean {
    const count = this.units.children.length;
    if (count < 2) return true;
    if (this.shots.length >= MAX_SHOTS) return true;
    const pair = this.pickLivePair();
    if (!pair) return true;
    const attacker = this.units.children[pair.attacker] as THREE.Group | undefined;
    const target = this.units.children[pair.target] as THREE.Group | undefined;
    const kind = this.unitKind(pair.attacker);
    const pose = this.aim[pair.attacker];
    if (!attacker || !target || !kind || !pose) return true;
    this.pending.set(pair.attacker, pair.target);
    const want = this.bearing(pair.attacker, pair.target);
    if (want === null || !canFire(want, pose.hull, pose.turret)) return false;
    const profile = WEAPON_PROFILES[kind];

    const gunYaw = muzzleYaw(pose.hull, pose.turret);
    // Seed muzzle from the flat math, then aim the barrel at the firing
    // solution and re-read the exact live muzzle (barrel-tip world matrix,
    // so turret yaw + barrel pitch + hull grade pose all contribute).
    const approx = muzzlePoint(attacker.position, gunYaw, kind);
    const impact = impactPoint(target.position, this.rng);
    const approxDist = Math.hypot(
      impact.x - approx.x,
      impact.y - approx.y,
      impact.z - approx.z,
    );
    // Range admission (cf. retail spec 06 §3.3): too close to depress onto
    // or ballistically unreachable — keep traversing, retry on a new pair.
    if (!inRange(kind, approxDist)) return false;
    const seed = solveShot(kind, approx, impact);
    if (!seed) return false;
    setBarrelElevation(attacker, clampElevation(seed.elevation));
    attacker.updateMatrixWorld(true);
    const live = muzzleWorld(attacker);
    const start = live
      ? new THREE.Vector3(live.position.x, live.position.y, live.position.z)
      : new THREE.Vector3(approx.x, approx.y, approx.z);
    const sol = solveShot(
      kind,
      { x: start.x, y: start.y, z: start.z },
      impact,
    );
    // Shells at max ballistic range fly ~5.3s; anything longer is rejected.
    if (!sol || sol.duration <= 0 || sol.duration > 6) return false;
    const barrelDir = live
      ? new THREE.Vector3(live.direction.x, live.direction.y, live.direction.z)
      : new THREE.Vector3(
          Math.sin(gunYaw) * Math.cos(sol.elevation),
          Math.sin(sol.elevation),
          Math.cos(gunYaw) * Math.cos(sol.elevation),
        );

    const geo = profile.shot === "bolt" ? this.boltGeo : this.shellGeo;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: profile.color }),
    );
    mesh.position.copy(start);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.shots.push({
      mesh,
      start,
      vel: new THREE.Vector3(sol.velocity.x, sol.velocity.y, sol.velocity.z),
      gravity: profile.shot === "shell" ? GRAVITY : 0,
      age: 0,
      dur: sol.duration,
      kind,
    });
    this.fired += 1;

    this.spawnMuzzle(start, profile.color, profile.flashTime);
    this.kickLight(start, profile.color);
    this.kickRecoil(pair.attacker, attacker, barrelDir);
    return true;
  }

  private kickRecoil(index: number, body: THREE.Group, barrelDir: THREE.Vector3): void {
    if (this.nudges.has(index)) return;
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
  private spawnMuzzle(at: THREE.Vector3, color: number, life: number): void {
    this.spawnFlash(at, 0xfff3d6, life, 0.8, 1.4, 1);
    this.spawnFlash(at, color, life * 1.4, HALO_SCALE, HALO_GROWTH, HALO_PEAK);
  }

  private kickLight(at: THREE.Vector3, color: number, peak = 2600): void {
    let light = this.lights[0]!;
    for (const candidate of this.lights) {
      if (candidate.intensity < light.intensity) light = candidate;
    }
    light.color.setHex(color);
    light.position.copy(at);
    light.intensity = peak;
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
    this.explode(at, 0xff8a3c, "hammer", true);
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
  private explode(at: THREE.Vector3, color: number, kind: UnitKind, epic = false): void {
    if (this.explosions.length >= MAX_EXPLOSIONS) {
      const oldest = this.explosions.shift();
      if (oldest) this.removeExplosion(oldest);
    }
    const group = new THREE.Group();
    group.position.copy(at);
    const ground = this.env ? this.env.groundY(at.x, at.z) : at.y;
    const slope = this.env?.slopeAt?.(at.x, at.z) ?? null;
    const wash = slope && slope.skew > 0 ? slope : null;
    const shape = scorchForKind(kind);
    const radiusScale = epic ? EPIC_RADIUS_SCALE : 1;
    const puffCount = epic ? EPIC_SMOKE_PUFFS : SMOKE_PER_EXPLOSION;
    const sparkCount = epic ? EPIC_SPARKS : SPARKS_PER_EXPLOSION;

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
      const r = 4 + this.rng() * 10;
      puff.position.set(Math.cos(theta) * r, this.rng() * 6, Math.sin(theta) * r);
      puff.scale.setScalar(0.5 + this.rng() * 0.4);
      group.add(puff);
      smokes.push(puff);
      // Smoke climbs and drifts downhill with the wash (fixed bias, no extra
      // rng — the plume leans down the fall line instead of rising through
      // the uphill slope).
      const lean = wash ? wash.skew * 30 : 0;
      smokeVel[i * 3] =
        Math.cos(theta + Math.PI / 2) * (4 + this.rng() * 8) + (wash ? wash.sx * lean : 0);
      smokeVel[i * 3 + 1] = 26 + this.rng() * 22;
      smokeVel[i * 3 + 2] =
        Math.sin(theta + Math.PI / 2) * (4 + this.rng() * 8) + (wash ? wash.sz * lean : 0);
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
      const speed = 60 + this.rng() * 160;
      velocities[i * 3] = Math.cos(theta) * speed + (wash ? wash.sx * ejecta : 0);
      velocities[i * 3 + 1] = up * speed;
      velocities[i * 3 + 2] = Math.sin(theta) * speed + (wash ? wash.sz * ejecta : 0);
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
      maxAge: epic ? EPIC_MAX_AGE : EXPLOSION_MAX_AGE,
      glowRadius: shape.radius * radiusScale,
    });
    this.kickLight(at, 0xff8a3c, epic ? EPIC_LIGHT_PEAK : 2600);
    this.scarGround(at, kind, slope);
    this.damageUnits(at, kind, slope);
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
  private scarGround(at: THREE.Vector3, kind: UnitKind, slope?: BlastSlope | null): void {
    const shape = scorchForKind(kind);
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
    this.env?.blastFeatures(at.x, at.z, BLAST_RADIUS[kind], slope ?? undefined);
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

  private advanceShots(dt: number): void {
    const done: Shot[] = [];
    const vel = new THREE.Vector3();
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
      shot.mesh.position.set(p.x, p.y, p.z);
      // Orient bolts head→tail along travel (nanolathe beam-stroke analog);
      // shells are spheres, so orienting them is harmless and free.
      const v = ballisticVelocity(
        { x: shot.vel.x, y: shot.vel.y, z: shot.vel.z },
        t,
        shot.gravity,
      );
      vel.set(v.x, v.y, v.z);
      if (vel.lengthSq() > 1e-6) {
        shot.mesh.lookAt(shot.mesh.position.clone().add(vel));
      }
      if (shot.age >= shot.dur) done.push(shot);
    }
    for (const shot of done) {
      const at = shot.mesh.position.clone();
      const color = (shot.mesh.material as THREE.MeshBasicMaterial).color.getHex();
      this.scene.remove(shot.mesh);
      (shot.mesh.material as THREE.Material).dispose();
      this.shots.splice(this.shots.indexOf(shot), 1);
      this.explode(at, color, shot.kind);
      this.spawnFlash(at, color, FLASH_MAX_AGE * 0.6);
    }
  }

  private advanceFlashes(dt: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
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
      const s = ex.epic ? EPIC_RADIUS_SCALE : 1;
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
        puff.scale.setScalar(puff.scale.x + dt * 6);
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
   * expiry. Position rides the base absolutely; tilt applies relatively on
   * top of the grade pose movement just seated (un-applying last tick first
   * keeps headless restores exact and live wobble bounded).
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
        this.nudges.delete(index);
        continue;
      }
      nudge.age += dt;
      const k = 1 - nudge.age / nudge.dur;
      if (k <= 0) {
        child.position.copy(nudge.base);
        this.nudges.delete(index);
        continue;
      }
      child.position.set(nudge.base.x + nudge.ox * k, nudge.base.y, nudge.base.z + nudge.oz * k);
      child.rotation.x += nudge.pitch * k;
      child.rotation.z += nudge.roll * k;
      nudge.appliedPitch = nudge.pitch * k;
      nudge.appliedRoll = nudge.roll * k;
    }
  }
}
