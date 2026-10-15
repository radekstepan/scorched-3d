import * as THREE from "three";
import type { Mover, UnitKind } from "@scorched-3d/core";

/**
 * Fading track trails: vehicles leave a subtle compressed-dust trace behind
 * themselves while driving. Each moving hull drops small flat quads at fixed
 * travel intervals; every mark fades to nothing over seconds and is
 * then recycled — so a patrol lane reads as a dotted ribbon, never as
 * scorch. Renderer-side only: movers and simulation never see the marks.
 *
 * Palette discipline (cf. the gentler-scorch tone): cool dark grey at low
 * peak opacity over the live surface, never brown, never opaque — it reads
 * as pressed dust, not a blast scar.
 */

/** Seconds one mark stays visible before it is recycled. */
export const TRACK_LIFETIME = 12;
/** Travel distance (world units) between dropped marks. */
export const TRACK_SPACING = 16;
/** Hard cap on live marks (bounded pool, oldest recycled first). */
export const MAX_TRACKS = 160;
/** Peak opacity of a fresh mark (visible, still well under the scorch layer). */
export const TRACK_PEAK_OPACITY = 0.42;
/** Mark color: cool dark grey (compressed dust, never scorch-brown). */
export const TRACK_COLOR = 0x33302b;
/** Surface lift above the seated terrain (below scorch, above z-fight). */
export const TRACK_LIFT = 0.8;
/** Mark length along travel (overlaps `TRACK_SPACING` so lanes link up). */
export const TRACK_LENGTH = 22;

/** Tread width per kind (tanks wider, the walker just scuffs). */
export const TRACK_WIDTH: Record<UnitKind, number> = {
  flash: 11,
  stump: 13,
  hammer: 12,
  commander: 6,
};

/** Tread width for a kind (falls back to flash for unknown kinds). */
export function trackWidthFor(kind: UnitKind): number {
  return TRACK_WIDTH[kind] ?? TRACK_WIDTH.flash;
}

/**
 * Faded opacity of a mark `age` seconds old (linear to zero at the
 * lifetime). Pure for tests.
 */
export function trackAlpha(age: number): number {
  if (!(age >= 0)) return TRACK_PEAK_OPACITY;
  if (age >= TRACK_LIFETIME) return 0;
  return TRACK_PEAK_OPACITY * (1 - age / TRACK_LIFETIME);
}

/** True when the mover is actually driving (not stunned, held, or wreck-held). */
export function isDriving(mover: Mover | null | undefined, destroyed: boolean): boolean {
  if (!mover || destroyed) return false;
  if (mover.stun !== undefined) return false;
  if (mover.hold) return false;
  return true;
}

/**
 * Minimal drive state the trails poll each tick. `UnitMovement` satisfies
 * `kindAt` / `isDestroyed` / `moverState` structurally; the canvas passes it
 * through with a `unitCount` getter and no per-tick adapter allocation.
 */
export interface TrackSource {
  kindAt(index: number): UnitKind;
  isDestroyed(index: number): boolean;
  moverState(index: number): Mover | null;
  readonly unitCount: number;
}

export interface TrackEnv {
  /** Terrain surface height at world (x, z), tracking live exaggeration. */
  groundY: (x: number, z: number) => number;
}

interface TrackSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  /** Seconds since the mark was dropped. */
  age: number;
  /** True while the mark is fading in the scene. */
  live: boolean;
  x: number;
  z: number;
}

export class TrackTrails {
  private scene: THREE.Scene;
  private env: TrackEnv;
  private geo = new THREE.PlaneGeometry(1, 1);
  private slots: TrackSlot[] = [];
  /** Round-robin cursor: the oldest mark is recycled on overflow. */
  private cursor = 0;
  /** Last emission point per unit (NaN until the unit is first seen). */
  private lastX: number[] = [];
  private lastZ: number[] = [];
  private disposed = false;

  constructor(scene: THREE.Scene, env: TrackEnv) {
    this.scene = scene;
    this.env = env;
    this.geo.rotateX(-Math.PI / 2);
  }

  /** Live (fading) mark count, for tests/HUD. */
  get count(): number {
    let n = 0;
    for (const slot of this.slots) if (slot.live) n++;
    return n;
  }

  /** Pool size (allocated meshes, live or idle), for tests. */
  get poolSize(): number {
    return this.slots.length;
  }

  /**
   * Poll every unit once per tick: driving hulls that travelled past the
   * spacing drop a mark; stunned/held/wreck hulls never emit (even when a
   * separation shove jostles a stunned hull — the gate is the mover state,
   * not the displacement). Ages every live mark toward expiry. Roster-sized
   * work per tick (one small mover snapshot per hull); meshes/materials are
   * pooled, so the frame never allocates scene objects.
   */
  update(source: TrackSource, dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    const n = source.unitCount;
    while (this.lastX.length < n) {
      this.lastX.push(Number.NaN);
      this.lastZ.push(Number.NaN);
    }
    if (this.lastX.length > n) {
      this.lastX.length = n;
      this.lastZ.length = n;
    }
    for (let i = 0; i < n; i++) {
      const mover = source.moverState(i);
      if (!isDriving(mover, source.isDestroyed(i))) continue;
      const m = mover!;
      const px = this.lastX[i]!;
      if (Number.isNaN(px)) {
        // First sighting: anchor without stamping, so spawns never burst.
        this.lastX[i] = m.x;
        this.lastZ[i] = m.z;
        continue;
      }
      const dx = m.x - px;
      const dz = m.z - this.lastZ[i]!;
      if (dx * dx + dz * dz >= TRACK_SPACING * TRACK_SPACING) {
        this.emit(m.x, m.z, m.hull, source.kindAt(i));
        this.lastX[i] = m.x;
        this.lastZ[i] = m.z;
      }
    }
    this.age(dt);
  }

  /**
   * Re-seat every live mark on the terrain surface (exaggeration change).
   * Marks never move in X/Z — only their seating height follows the snap.
   */
  resnap(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (!slot.live) continue;
      slot.mesh.position.y = this.env.groundY(slot.x, slot.z) + TRACK_LIFT;
    }
  }

  /** Remove every mark and free pooled assets. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      this.scene.remove(slot.mesh);
      slot.mat.dispose();
    }
    this.slots = [];
    this.geo.dispose();
  }

  /** Opacity of a pooled slot (tests assert the fade envelope). */
  opacityAt(slot: number): number {
    return this.slots[slot]?.mat.opacity ?? 0;
  }

  /** World position of a pooled slot (tests assert seating/recycling). */
  slotAt(slot: number): { x: number; y: number; z: number; live: boolean } | null {
    const s = this.slots[slot];
    if (!s) return null;
    return { x: s.mesh.position.x, y: s.mesh.position.y, z: s.mesh.position.z, live: s.live };
  }

  private emit(x: number, z: number, yaw: number, kind: UnitKind): void {
    let slot: TrackSlot | undefined;
    if (this.slots.length < MAX_TRACKS) {
      const mat = new THREE.MeshBasicMaterial({
        color: TRACK_COLOR,
        transparent: true,
        opacity: TRACK_PEAK_OPACITY,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.visible = false;
      this.scene.add(mesh);
      slot = { mesh, mat, age: 0, live: false, x: 0, z: 0 };
      this.slots.push(slot);
    } else {
      slot = this.slots[this.cursor];
      this.cursor = (this.cursor + 1) % this.slots.length;
    }
    slot!.age = 0;
    slot!.live = true;
    slot!.x = x;
    slot!.z = z;
    const mesh = slot!.mesh;
    mesh.visible = true;
    mesh.position.set(x, this.env.groundY(x, z) + TRACK_LIFT, z);
    mesh.rotation.set(0, yaw, 0);
    mesh.scale.set(trackWidthFor(kind), 1, TRACK_LENGTH);
    slot!.mat.opacity = TRACK_PEAK_OPACITY;
  }

  private age(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.live) continue;
      slot.age += dt;
      if (slot.age >= TRACK_LIFETIME) {
        slot.live = false;
        slot.mesh.visible = false;
        continue;
      }
      slot.mat.opacity = trackAlpha(slot.age);
    }
  }
}
