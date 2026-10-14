import * as THREE from "three";
import {
  aimStep,
  canFire,
  flightDuration,
  MAX_EXPLOSIONS,
  MAX_SHOTS,
  muzzleForward,
  muzzleHeight,
  muzzleYaw,
  nextShotDelay,
  pickSkirmishPair,
  projectilePosition,
  yawToTarget,
  WEAPON_PROFILES,
  type PlacedUnit,
  type UnitKind,
} from "@scorched-3d/core";
import { setUnitAim } from "./units";

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
 *   becomes per-kind `WEAPON_PROFILES` in core (speed/arc/color) plus a
 *   single interval scheduler standing in for per-slot reload timers.
 * - Explosions pair an expanding flash sphere with gravity-driven spark
 *   particles and a short-lived pooled light, echoing nanolathe's
 *   explosion-sprite + art-light pairing.
 */

interface Shot {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  end: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
}

interface Flash {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
}

interface Explosion {
  group: THREE.Group;
  flashMat: THREE.MeshBasicMaterial;
  flashMesh: THREE.Mesh;
  points: THREE.Points;
  pointsMat: THREE.PointsMaterial;
  velocities: Float32Array;
  age: number;
  maxAge: number;
}

interface Recoil {
  base: THREE.Vector3;
  dir: THREE.Vector3;
  t: number;
}

const LIGHT_COUNT = 2;
const FLASH_MAX_AGE = 0.35;
const EXPLOSION_MAX_AGE = 0.8;
const SPARKS_PER_EXPLOSION = 26;

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
  private disposed = false;

  constructor(scene: THREE.Scene, units: THREE.Group, rng: () => number = Math.random) {
    this.scene = scene;
    this.units = units;
    this.rng = rng;
    this.timer = nextShotDelay(rng);
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

  /** Total shots fired since construction (gated by aim, for tests/HUD). */
  get totalFired(): number {
    return this.fired;
  }

  /** Current aim pose of a unit (hull + turret-relative yaws), for tests. */
  aimState(index: number): { hull: number; turret: number } | null {
    return this.aim[index] ? { ...this.aim[index]! } : null;
  }

  update(dt: number): void {
    if (this.disposed || dt <= 0) return;
    this.ensureAim();
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTransients();
    for (const light of this.lights) this.scene.remove(light);
    this.lights = [];
    this.boltGeo.dispose();
    this.shellGeo.dispose();
    this.flashGeo.dispose();
    this.shockGeo.dispose();
  }

  private unitKind(index: number): UnitKind | null {
    const placed = this.units.userData.units as PlacedUnit[] | undefined;
    return placed?.[index]?.kind ?? null;
  }

  /** Size the aim pose array to the unit roster, seeding from live yaws. */
  private ensureAim(): void {
    const bodies = this.units.children as THREE.Group[];
    while (this.aim.length < bodies.length) {
      const i = this.aim.length;
      this.aim.push({ hull: bodies[i]?.rotation.y ?? 0, turret: 0 });
    }
    if (this.aim.length > bodies.length) this.aim.length = bodies.length;
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
   * refine — so traverse motion is visible even before any shot fires.
   */
  private slewPending(dt: number): void {
    for (const [attacker, target] of this.pending) {
      const body = this.units.children[attacker] as THREE.Group | undefined;
      const kind = this.unitKind(attacker);
      const want = this.bearing(attacker, target);
      if (!body || !kind || want === null) {
        this.pending.delete(attacker);
        continue;
      }
      const pose = this.aim[attacker];
      if (!pose) continue;
      const next = aimStep(kind, pose.hull, pose.turret, want, dt);
      pose.hull = next.hull;
      pose.turret = next.turret;
      setUnitAim(body, next.hull, next.turret);
    }
  }

  /**
   * Pick a skirmish pair and fire only when the attacker is aimed: hull
   * faced at the target, turret inside its traverse, muzzle down the turret
   * line. Returns true when a shot left (or the roster/caps made firing
   * impossible, to keep the ambient schedule); false defers while the
   * attacker is still traversing.
   */
  private tryFire(): boolean {
    const count = this.units.children.length;
    if (count < 2) return true;
    if (this.shots.length >= MAX_SHOTS) return true;
    const pair = pickSkirmishPair(count, this.rng);
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
    const muzzle = muzzlePoint(attacker.position, gunYaw, kind);
    const impact = impactPoint(target.position, this.rng);
    const start = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
    const end = new THREE.Vector3(impact.x, impact.y, impact.z);
    if (start.distanceTo(end) < 1) return true;
    const dur = flightDuration(start.distanceTo(end), profile.speed);

    const geo = profile.shot === "bolt" ? this.boltGeo : this.shellGeo;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: profile.color }),
    );
    mesh.position.copy(start);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.shots.push({ mesh, start, end, t: 0, dur, arc: profile.arc });
    this.fired += 1;

    this.spawnFlash(start, profile.color, profile.flashTime);
    this.kickLight(start, profile.color);
    this.kickRecoil(pair.attacker, attacker, gunYaw);
    return true;
  }

  private kickRecoil(index: number, body: THREE.Group, gunYaw: number): void {
    if (this.recoils.has(index)) return;
    const dir = new THREE.Vector3(Math.sin(gunYaw), 0, Math.cos(gunYaw));
    this.recoils.set(index, { base: body.position.clone(), dir, t: 1 });
  }

  private spawnFlash(at: THREE.Vector3, color: number, life: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.flashGeo, mat);
    mesh.position.copy(at);
    this.scene.add(mesh);
    this.flashes.push({ mesh, mat, life, maxLife: Math.max(life, 0.05) });
  }

  private kickLight(at: THREE.Vector3, color: number): void {
    let light = this.lights[0]!;
    for (const candidate of this.lights) {
      if (candidate.intensity < light.intensity) light = candidate;
    }
    light.color.setHex(color);
    light.position.copy(at);
    light.intensity = 2600;
  }

  private explode(at: THREE.Vector3, color: number): void {
    if (this.explosions.length >= MAX_EXPLOSIONS) {
      const oldest = this.explosions.shift();
      if (oldest) this.removeExplosion(oldest);
    }
    const group = new THREE.Group();
    group.position.copy(at);

    const flashMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flashMesh = new THREE.Mesh(this.shockGeo, flashMat);
    group.add(flashMesh);

    const positions = new Float32Array(SPARKS_PER_EXPLOSION * 3);
    const velocities = new Float32Array(SPARKS_PER_EXPLOSION * 3);
    for (let i = 0; i < SPARKS_PER_EXPLOSION; i++) {
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
      points,
      pointsMat,
      velocities,
      age: 0,
      maxAge: EXPLOSION_MAX_AGE,
    });
    this.kickLight(at, 0xff8a3c);
  }

  private removeExplosion(ex: Explosion): void {
    this.scene.remove(ex.group);
    ex.flashMat.dispose();
    ex.points.geometry.dispose();
    ex.pointsMat.dispose();
  }

  private advanceShots(dt: number): void {
    const done: Shot[] = [];
    for (const shot of this.shots) {
      shot.t += dt / shot.dur;
      const t = Math.min(shot.t, 1);
      const prev = shot.mesh.position.clone();
      const p = projectilePosition(
        { x: shot.start.x, y: shot.start.y, z: shot.start.z },
        { x: shot.end.x, y: shot.end.y, z: shot.end.z },
        t,
        shot.arc,
      );
      shot.mesh.position.set(p.x, p.y, p.z);
      // Orient bolts head→tail along travel (nanolathe beam-stroke analog).
      const vel = shot.mesh.position.clone().sub(prev);
      if (vel.lengthSq() > 1e-6) {
        shot.mesh.lookAt(shot.mesh.position.clone().add(vel));
      }
      if (shot.t >= 1) done.push(shot);
    }
    for (const shot of done) {
      const color = (shot.mesh.material as THREE.MeshBasicMaterial).color.getHex();
      this.scene.remove(shot.mesh);
      (shot.mesh.material as THREE.Material).dispose();
      this.shots.splice(this.shots.indexOf(shot), 1);
      this.explode(shot.end, color);
      this.spawnFlash(shot.end, color, FLASH_MAX_AGE * 0.6);
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
      flash.mesh.scale.setScalar(1 + k * 1.6);
      flash.mat.opacity = 0.95 * (1 - k);
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
      ex.flashMesh.scale.setScalar(1 + k * 5);
      ex.flashMat.opacity = 0.9 * (1 - k);
      const pos = ex.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let p = 0; p < SPARKS_PER_EXPLOSION; p++) {
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
