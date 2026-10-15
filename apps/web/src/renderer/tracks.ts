import * as THREE from "three";
import { HULL_FOOTPRINT, WHEEL_RADIUS, type Mover, type UnitKind } from "@scorched-3d/core";

/**
 * Fading track trails: vehicles leave a compressed-dust trace behind
 * themselves while driving. Tracked hulls (flash/stump/hammer) stamp two
 * parallel treads — one per side, offset to the hull's flank footprint —
 * while walkers (commander, peewee) stamp small alternating footsteps with gaps
 * between them. Every mark fades to nothing over seconds and is then
 * recycled, so a patrol lane reads as a tread/footprint ribbon, never as
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
/**
 * Hard cap on live marks (bounded pool, oldest recycled first). Doubled
 * from the single-trail 160: each tank stamp drops two tread quads, so 320
 * slots hold the same lane length as before.
 */
export const MAX_TRACKS = 320;
/** Peak opacity of a fresh mark (visible, still well under the scorch layer). */
export const TRACK_PEAK_OPACITY = 0.42;
/** Mark color: cool dark grey (compressed dust, never scorch-brown). */
export const TRACK_COLOR = 0x33302b;
/** Surface lift above the seated terrain (below scorch, above z-fight). */
export const TRACK_LIFT = 0.8;
/** Tread length along travel (overlaps `TRACK_SPACING` so lanes link up). */
export const TRACK_LENGTH = 22;
/**
 * Footstep length along travel for the walker. Shorter than
 * `TRACK_SPACING`, so footsteps read as dashes with gaps between them
 * instead of a linked ribbon.
 */
export const FOOTSTEP_LENGTH = 10;
/**
 * Lateral footstep offset for the walker: matches the leg spread (±4 in
 * the body build), so left/right steps land under the striding feet.
 */
export const FOOTSTEP_OFFSET = 4;

/**
 * Single-tread width per kind (one quad of a tank's pair, or one walker
 * footstep). Tanks tread wider than the walker scuffs; the stump runs the
 * widest pair. Outer tread edges sit flush with the hull flank footprint
 * (see `trackOffsetFor`).
 */
export const TRACK_WIDTH: Record<UnitKind, number> = {
  flash: 4,
  stump: 5,
  hammer: 4.5,
  commander: 3.5,
  // Infantry scuff: narrower than any tank tread.
  peewee: 2.5,
};

/** Single-tread width for a kind (falls back to flash for unknown kinds). */
export function trackWidthFor(kind: UnitKind): number {
  return TRACK_WIDTH[kind] ?? TRACK_WIDTH.flash;
}

/**
 * True for walker kinds (no road wheels): they stamp alternating footsteps
 * instead of tread pairs. Keyed off `WHEEL_RADIUS` (not a kind list) so new
 * legged kinds read correctly without touching this file.
 */
function isWalker(kind: UnitKind): boolean {
  return (WHEEL_RADIUS[kind] ?? 0) <= 0;
}

/**
 * Lateral center distance of one tread from the hull centerline. Tanks: the
 * outer tread edge lands flush with the flank footprint
 * (`offset + tread/2 = halfWid`). Walkers stamp on the centerline here
 * (their alternation lives in `trackOffsetsFor`, not in a fixed gauge).
 * Pure for tests.
 */
export function trackOffsetFor(kind: UnitKind): number {
  if (isWalker(kind)) return 0;
  const fp = HULL_FOOTPRINT[kind] ?? HULL_FOOTPRINT.flash;
  return fp.halfWid - trackWidthFor(kind) / 2;
}

/**
 * Lateral tread offsets for one stamp of `kind` at stride `step` (strides
 * count stamps, starting at 0). Tanks return the symmetric pair
 * `[-offset, +offset]` every stride; the commander alternates a single
 * footstep left/right (`-FOOTSTEP_OFFSET` on even strides, `+` on odd) so
 * the lane reads as alternating prints with gaps. Pure for tests.
 */
export function trackOffsetsFor(kind: UnitKind, step: number): number[] {
  if (isWalker(kind)) {
    return [step % 2 === 0 ? -FOOTSTEP_OFFSET : FOOTSTEP_OFFSET];
  }
  const off = trackOffsetFor(kind);
  return [-off, off];
}

/** Mark length along travel for a kind (treads link, footsteps gap). */
export function trackLengthFor(kind: UnitKind): number {
  return isWalker(kind) ? FOOTSTEP_LENGTH : TRACK_LENGTH;
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
  /** Stamp (stride) count per unit: drives the walker's left/right alternation. */
  private strides: number[] = [];
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
   * spacing drop their footprint marks (a tread pair for tanks, one
   * alternating footstep for walkers); stunned/held/wreck hulls never
   * emit (even when a separation shove jostles a stunned hull — the gate is
   * the mover state, not the displacement). Ages every live mark toward
   * expiry. Roster-sized work per tick (one small mover snapshot per hull);
   * meshes/materials are pooled, so the frame never allocates scene objects.
   */
  update(source: TrackSource, dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    const n = source.unitCount;
    while (this.lastX.length < n) {
      this.lastX.push(Number.NaN);
      this.lastZ.push(Number.NaN);
      this.strides.push(0);
    }
    if (this.lastX.length > n) {
      this.lastX.length = n;
      this.lastZ.length = n;
      this.strides.length = n;
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
        const kind = source.kindAt(i);
        this.emit(m.x, m.z, m.hull, kind, this.strides[i]!);
        this.strides[i] = (this.strides[i] ?? 0) + 1;
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

  /**
   * Stamp one stride at (x, z) facing `yaw`: a tread pair for tanks, one
   * alternating footstep for walkers. Lateral offsets run across the
   * hull (local +X under yaw: `(cos yaw, -sin yaw)` in (x, z)), matching the
   * flank taps the grade seating uses.
   */
  private emit(x: number, z: number, yaw: number, kind: UnitKind, step: number): void {
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const width = trackWidthFor(kind);
    const length = trackLengthFor(kind);
    for (const off of trackOffsetsFor(kind, step)) {
      const mx = x + rx * off;
      const mz = z + rz * off;
      this.emitMark(mx, mz, yaw, width, length);
    }
  }

  private emitMark(x: number, z: number, yaw: number, width: number, length: number): void {
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
    mesh.scale.set(width, 1, length);
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
