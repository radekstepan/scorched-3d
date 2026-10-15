import * as THREE from "three";
import {
  applyBlastToHqs,
  createHqDamage,
  createHqSpawns,
  isHqDestroyed,
  spawnKindFor,
  tickHqSpawn,
  type HqSpawnState,
  type AttackMode,
  type UnitKind,
} from "@scorched-3d/core";
import {
  buildHq,
  doorLiftOf,
  hqExitWorld,
  hqFacingFor,
  hqFoundationDropWorld,
  poseHqWreck,
  setDoorLift,
  setHqFoundation,
  HQ_DOOR_TRAVEL,
  type HqFacing,
} from "./hq";

/**
 * HQ manager: owns one bunker group per team (see `hq.ts`), its accumulated
 * damage, its reinforcement clock, and its sliding-door animation. Runs
 * inside the TerrainCanvas tick; the canvas wires the callbacks that touch
 * unit systems (spawn release adds a body, kills detonate the epic burst,
 * damage points nearby defenders at the shooter).
 *
 * Release sequence per reinforcement: the door slides up over `DOOR_OPEN_T`,
 * the reinforcement is released at the hall mouth the moment the door seats
 * fully open (facing the map center, so it drives straight out of the hall
 * and into the hunt pipeline), the door holds briefly, then slides shut.
 * A destroyed HQ slams its door, poses its wreck, and never releases again.
 */

/** Door slides up over this long, seconds. */
export const HQ_DOOR_OPEN_T = 1.0;
/** Door holds fully open this long (the release lands at the hold start). */
export const HQ_DOOR_HOLD_T = 0.6;
/** Door slides shut over this long, seconds. */
export const HQ_DOOR_CLOSE_T = 1.0;

export interface HqAnchorInput {
  x: number;
  y: number;
  z: number;
  team: 0 | 1;
}

export interface HqEnv {
  /** Terrain surface height at world (x, z), tracking live exaggeration. */
  groundY: (x: number, z: number) => number;
  /** Fired at full-open with the hall-mouth position of the reinforcement. */
  onSpawn?: (team: 0 | 1, kind: UnitKind, x: number, z: number) => void;
  /** Fired once when an HQ's health exhausts (canvas detonates the burst). */
  onKilled?: (index: number) => void;
  /** Fired per splash that chips a live HQ (canvas rallies defenders). */
  onDamaged?: (index: number, shooter: number | null) => void;
}

/**
 * Door lift `t` seconds into a release: ease up, hold, ease down. Pure, so
 * headless tests can pin the slide without a scene.
 */
export function doorLiftAt(t: number): number {
  if (t < 0) return 0;
  if (t < HQ_DOOR_OPEN_T) return HQ_DOOR_TRAVEL * (t / HQ_DOOR_OPEN_T);
  if (t < HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T) return HQ_DOOR_TRAVEL;
  const k = (t - HQ_DOOR_OPEN_T - HQ_DOOR_HOLD_T) / HQ_DOOR_CLOSE_T;
  if (k >= 1) return 0;
  return HQ_DOOR_TRAVEL * (1 - k);
}

/** HUD status of one HQ (minimap marker + Units-box row). */
export interface HqStatus {
  x: number;
  z: number;
  team: 0 | 1;
  alive: boolean;
  spawned: number;
}

export class HqFx {
  private scene: THREE.Scene;
  private groups: THREE.Group[] = [];
  private facings: HqFacing[] = [];
  private anchors: { x: number; z: number }[] = [];
  private damage: number[] = createHqDamage();
  private destroyed: boolean[] = [false, false];
  private spawns: HqSpawnState[] = createHqSpawns();
  /** Seconds since the door started opening (-1 while idle), per HQ. */
  private anim: number[] = [-1, -1];
  /** True once the running release fired `onSpawn`. */
  private released: boolean[] = [false, false];
  private env: HqEnv;
  private disposed = false;

  constructor(scene: THREE.Scene, anchors: readonly HqAnchorInput[], env: HqEnv) {
    this.scene = scene;
    this.env = env;
    for (const a of anchors) {
      const facing = hqFacingFor(a.team);
      const group = buildHq(a.team);
      if (facing < 0) group.rotation.y = Math.PI;
      group.position.set(a.x, a.y, a.z);
      // Seat the works into the hill: size the footings from the live
      // surface under the footprint so the downhill side shows concrete
      // instead of an air gap (flat ground just buries them invisibly).
      setHqFoundation(group, hqFoundationDropWorld({ x: a.x, y: a.y, z: a.z }, facing, env.groundY));
      this.scene.add(group);
      this.groups.push(group);
      this.facings.push(facing);
      this.anchors.push({ x: a.x, z: a.z });
    }
  }

  /** HQ count (one per team). */
  get count(): number {
    return this.groups.length;
  }

  /** Accumulated damage fraction of an HQ (0 pristine .. 1 destroyed). */
  damageAt(index: number): number {
    return this.damage[index] ?? 0;
  }

  /** True once the HQ is wrecked (stops spawning, stays as history). */
  isDestroyedAt(index: number): boolean {
    return this.destroyed[index] ?? false;
  }

  /** Reinforcements released by an HQ so far (pop-cap readout for the HUD). */
  spawnedAt(index: number): number {
    return this.spawns[index]?.spawned ?? 0;
  }

  /** Current door lift of an HQ, world units (for tests). */
  doorLift(index: number): number {
    const group = this.groups[index];
    return group ? doorLiftOf(group) : 0;
  }

  /** Scene group of an HQ (health-bar anchoring), or null past the roster. */
  groupAt(index: number): THREE.Group | null {
    return this.groups[index] ?? null;
  }

  /** Hall-mouth world position where an HQ's reinforcements appear. */
  exitAt(index: number): { x: number; z: number } {
    return hqExitWorld(this.anchors[index] ?? { x: 0, z: 0 }, this.facings[index] ?? 1);
  }

  /** Seated world position of an HQ (wrecks included — history stays). */
  positionAt(index: number): { x: number; y: number; z: number } | null {
    const group = this.groups[index];
    if (!group) return null;
    return { x: group.position.x, y: group.position.y, z: group.position.z };
  }

  /** HUD status of every HQ (minimap markers + Units-box rows). */
  status(): HqStatus[] {
    return this.groups.map((group, i) => ({
      x: group.position.x,
      z: group.position.z,
      team: (group.userData.hqTeam as 0 | 1 | undefined) ?? 0,
      alive: !this.destroyed[i],
      spawned: this.spawns[i]?.spawned ?? 0,
    }));
  }

  /** Live aim points for ambient structure fire (wrecks excluded). */
  targets(): { x: number; y: number; z: number; team: 0 | 1 }[] {
    const out: { x: number; y: number; z: number; team: 0 | 1 }[] = [];
    for (let i = 0; i < this.groups.length; i++) {
      if (this.destroyed[i]) continue;
      const group = this.groups[i]!;
      const team = (group.userData.hqTeam as 0 | 1 | undefined) ?? 0;
      out.push({ x: group.position.x, y: group.position.y + 10, z: group.position.z, team });
    }
    return out;
  }

  /**
   * Splash a blast onto the HQs: accumulate core damage with linear falloff
   * (same honesty as hull splashes — no rng). A crossing threshold wrecks
   * exactly once (door slams via `poseHqWreck`, `onKilled` detonates the
   * epic burst through combat); chips fire `onDamaged` so the canvas can
   * point nearby defenders at the shooter.
   */
  splash(x: number, z: number, kind: UnitKind, shooter: number | null, attack: AttackMode = "round"): void {
    if (this.disposed || this.groups.length === 0) return;
    const before = this.damage.slice();
    const touched = applyBlastToHqs(
      this.damage,
      this.groups.map((g) => ({ x: g.position.x, z: g.position.z })),
      x,
      z,
      kind,
      undefined,
      attack,
    );
    for (const i of touched) {
      if (this.destroyed[i]) continue;
      const added = this.damage[i]! - before[i]!;
      if (!(added > 0)) continue;
      if (isHqDestroyed(this.damage[i]!)) {
        this.destroyed[i] = true;
        this.anim[i] = -1;
        const group = this.groups[i];
        if (group) poseHqWreck(group);
        this.onKilledRef(i);
      } else {
        this.env.onDamaged?.(i, shooter);
      }
    }
  }

  private onKilledRef(index: number): void {
    // Indirect call (not inlined above) so headless tests can observe hook
    // ordering: wreck pose first, burst request second.
    this.env.onKilled?.(index);
  }

  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    for (let i = 0; i < this.groups.length; i++) {
      if (this.destroyed[i]) continue;
      const group = this.groups[i];
      if (!group) continue;
      if (this.anim[i]! < 0) {
        // Idle: tick the reinforcement clock (a due release starts the door).
        const state = this.spawns[i]!;
        if (tickHqSpawn(state, dt, true)) {
          this.anim[i] = 0;
          this.released[i] = false;
        }
        continue;
      }
      // Releasing: advance the slide, release at full-open, shut after.
      this.anim[i]! += dt;
      const t = this.anim[i]!;
      if (!this.released[i] && t >= HQ_DOOR_OPEN_T) {
        this.released[i] = true;
        const state = this.spawns[i]!;
        const exit = this.exitAt(i);
        const team = (group.userData.hqTeam as 0 | 1 | undefined) ?? 0;
        this.env.onSpawn?.(team, spawnKindFor(state.spawned - 1), exit.x, exit.z);
      }
      const total = HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T;
      if (t >= total) {
        this.anim[i] = -1;
        setDoorLift(group, 0);
      } else {
        setDoorLift(group, doorLiftAt(t));
      }
    }
  }

  /** Re-seat every HQ on the terrain surface (exaggeration change). */
  resnap(): void {
    if (this.disposed) return;
    for (let i = 0; i < this.groups.length; i++) {
      const group = this.groups[i]!;
      const a = this.anchors[i]!;
      const y = this.env.groundY(a.x, a.z);
      group.position.set(a.x, y, a.z);
      // The exaggeration change steepens every slope, so re-measure the
      // footing drop — otherwise a taller hill re-opens the air gap.
      setHqFoundation(group, hqFoundationDropWorld({ x: a.x, y, z: a.z }, this.facings[i] ?? 1, this.env.groundY));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const group of this.groups) {
      this.scene.remove(group);
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.type === "Mesh") {
          mesh.geometry?.dispose();
          const mat = mesh.material as THREE.Material | undefined;
          mat?.dispose();
        }
      });
    }
    this.groups = [];
  }
}
