import * as THREE from "three";
import {
  addScorchMark,
  aimStep,
  applyBlastToUnits,
  ballisticPosition,
  ballisticVelocity,
  BLAST_RADIUS,
  canFire,
  clampElevation,
  clampTurret,
  craterDepthForIntensity,
  createUnitDamage,
  GRAVITY,
  inRange,
  isDestroyed,
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
 *   embers — hulls are never moved by blasts; a hull that exhausts its
 *   health dies once, epicly, and stays as a smouldering wreck).
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

interface Recoil {
  base: THREE.Vector3;
  dir: THREE.Vector3;
  t: number;
}

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
   * Graduated blast damage to trees/rocks within `radius` of world (x, z):
   * core flattens, fringe ignites/chips. Units are untouched.
   */
  blastFeatures: (x: number, z: number, radius: number) => void;
  /**
   * Optional shallow visual dent of the terrain mesh at world (x, z):
   * `depth` is pre-exaggeration height units (≤0.6 per blast). Implemented by
   * the canvas, which owns the terrain geometry; purely visual — pathing and
   * unit seating read the static core heightfield.
   */
  dentTerrain?: (x: number, z: number, radius: number, depth: number) => void;
}

export class CombatFx {
  private scene: THREE.Scene;
  private units: THREE.Group;
  private rng: () => number;
  private timer: number;
  private shots: Shot[] = [];
  private flashes: Flash[] = [];
  private explosions: Explosion[] = [];
  private recoils = new Map<number, Recoil>();
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

  /** Nudge a stored recoil anchor so patrol motion never fights the kick. */
  shiftRecoilBase(index: number, dx: number, dz: number): void {
    const recoil = this.recoils.get(index);
    if (recoil) {
      recoil.base.x += dx;
      recoil.base.z += dz;
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
    this.advanceRecoil(dt);
    this.damageFx.update(this.damage, this.units.children, this.elapsed);
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
    for (const [index, recoil] of this.recoils) {
      const child = this.units.children[index] as THREE.Group | undefined;
      if (child) child.position.copy(recoil.base);
    }
    this.recoils.clear();
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
  }

  /**
   * Splash a blast onto nearby hulls: accumulate core damage with linear
   * falloff and char the touched bodies in place. Visual only — hulls are
   * never moved (only recoil touches them). A hull crossing the kill
   * threshold dies exactly once: an epic explosion at the hull, full char,
   * and the `onUnitKilled` hook (movement hold, deselect) — the instance
   * itself stays put as a smouldering wreck.
   */
  private damageUnits(at: THREE.Vector3, kind: UnitKind): void {
    if (this.damage.length === 0) return;
    const bodies = this.units.children as THREE.Group[];
    const before = this.damage.slice();
    const touched = applyBlastToUnits(
      this.damage,
      bodies.map((b) => ({ x: b.position.x, z: b.position.z })),
      at.x,
      at.z,
      kind,
    );
    for (const i of touched) {
      const body = bodies[i];
      if (body) applyUnitDamageTint(body, this.damage[i]!);
      if (!this.destroyed[i] && !isDestroyed(before[i]!) && isDestroyed(this.damage[i]!)) {
        this.destroyed[i] = true;
        this.deathCount += 1;
        const wreck = bodies[i];
        if (wreck) {
          this.explodeDeath(new THREE.Vector3(wreck.position.x, wreck.position.y, wreck.position.z));
        }
        this.onUnitKilled?.(i);
      }
    }
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
    if (this.recoils.has(index)) return;
    // Recoil opposes the barrel: horizontal projection, normalized. A
    // high-lobbed shell still kicks the hull straight back, not downward.
    const dir = new THREE.Vector3(barrelDir.x, 0, barrelDir.z);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(body.rotation.y), 0, Math.cos(body.rotation.y));
    dir.normalize();
    this.recoils.set(index, { base: body.position.clone(), dir, t: 1 });
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
      smokeVel[i * 3] = Math.cos(theta + Math.PI / 2) * (4 + this.rng() * 8);
      smokeVel[i * 3 + 1] = 26 + this.rng() * 22;
      smokeVel[i * 3 + 2] = Math.sin(theta + Math.PI / 2) * (4 + this.rng() * 8);
    }

    // Shockwave ring + lingering glow: ground-seated so the blast footprint
    // reads on dirt and undergrowth, not just on hulls.
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
    glowMesh.scale.setScalar(Math.max(shape.radius * radiusScale * 1.1, 1));
    group.add(glowMesh);

    const positions = new Float32Array(sparkCount * 3);
    const velocities = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      const theta = this.rng() * Math.PI * 2;
      const up = 0.4 + this.rng() * 1.2;
      const speed = 60 + this.rng() * 160;
      velocities[i * 3] = Math.cos(theta) * speed;
      velocities[i * 3 + 1] = up * speed;
      velocities[i * 3 + 2] = Math.sin(theta) * speed;
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
    this.scarGround(at, kind);
    this.damageUnits(at, kind);
  }

  /**
   * Persistent ground scar + graduated blast damage for an impact. Decals
   * reuse one shared instanced disc (no per-mark geometry/material); only
   * instance matrices/colors are rewritten, and only on impact — never per
   * frame. Hulls are splashed with accumulating (visual-only) damage by the
   * caller; a tree flattened under a unit still leaves the unit where it
   * stands.
   */
  private scarGround(at: THREE.Vector3, kind: UnitKind): void {
    const shape = scorchForKind(kind);
    this.scorchMarks = addScorchMark(this.scorchMarks, {
      x: at.x,
      z: at.z,
      radius: shape.radius,
      intensity: shape.intensity,
      seed: scorchSeed(at.x, at.z),
    });
    this.syncScorch(at.y);
    this.env?.blastFeatures(at.x, at.z, BLAST_RADIUS[kind]);
    this.env?.dentTerrain?.(at.x, at.z, shape.radius, craterDepthForIntensity(shape.intensity));
  }

  /** Rewrite scorch instance matrices/colors from the mark list. */
  private syncScorch(fallbackY: number): void {
    const dummy = this.scorchDummy;
    for (let i = 0; i < this.scorchMarks.length; i++) {
      const mark = this.scorchMarks[i]!;
      const y = this.env ? this.env.groundY(mark.x, mark.z) + 1.2 : fallbackY;
      dummy.position.set(mark.x, y, mark.z);
      // Deterministic per-mark orientation: golden-angle spread plus the
      // position-hashed seed, so the baked irregular edge never aligns.
      dummy.rotation.set(0, ((i * 2.39996) % Math.PI) + resolveScorchSeed(mark) * Math.PI, 0);
      // Elliptical squash from the seed: no two blotches share a silhouette.
      const [ax, az] = scorchAnisotropy(resolveScorchSeed(mark));
      dummy.scale.set(Math.max(mark.radius, 0.5) * ax, 1, Math.max(mark.radius, 0.5) * az);
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

  private advanceRecoil(dt: number): void {
    for (const [index, recoil] of this.recoils) {
      const child = this.units.children[index] as THREE.Group | undefined;
      if (!child) {
        this.recoils.delete(index);
        continue;
      }
      recoil.t -= dt / 0.28;
      if (recoil.t <= 0) {
        child.position.copy(recoil.base);
        this.recoils.delete(index);
        continue;
      }
      child.position.copy(recoil.base).addScaledVector(recoil.dir, -5 * recoil.t);
    }
  }
}
