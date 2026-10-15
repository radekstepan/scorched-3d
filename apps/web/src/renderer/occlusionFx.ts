import * as THREE from "three";
import {
  HULL_FOOTPRINT,
  treesOnSegment,
  type TreeStand,
  type UnitKind,
} from "@scorched-3d/core";
import { SELECTION_CORE } from "./selectionFx";
import { HEALTH_BAR_RENDER_ORDER } from "./healthBars";

/**
 * Occlusion x-ray: when a unit (or part of it) hides behind the terrain
 * heightfield or a live tree canopy from the current camera, the hidden hull
 * reads as a blue outline ghost so the player can still locate it.
 *
 * Two halves, split for testability:
 *
 * - Pure sampling math (`segmentBlockedByTerrain` / `unitOcclusion`): the
 *   camera→hull ray is tested at a few hull taps (low/mid/high) against the
 *   live `groundY` heightfield plus the standing-tree volumes from core
 *   (`treesOnSegment`: crown sphere + trunk cylinder, felled/stump/snag/gone
 *   wood never intercepts). A unit counts as occluded when *any* tap is
 *   blocked, so a hull nose-down behind a ridge still ghosts.
 * - `OcclusionFx`: one shared-geometry blue box outline per roster unit
 *   (`depthTest: false`, above the health-bar layer), parked on the body
 *   origin and shown only while occluded. The ghost lives in its own scene
 *   group — never a body child — so hull paint (including damage charring),
 *   selection rings/beacons, waypoint lines, and picking all ignore it, and
 *   `userData.noHighlight` keeps the damage tint off it by construction too.
 *
 * Perf: per tick each unit tests OCCLUSION_TAPS taps × OCCLUSION_SAMPLES
 * terrain samples (one bilinear `groundY` each) plus one broadphase
 * `treesOnSegment` per tap. Rosters are ~6 hulls, so a tick costs a few
 * thousand cheap rejects — no raycaster, no per-pixel work, no allocations
 * past the caller-owned stands array.
 */

/** Ghost blue: the selection cyan, so hidden units read in the UI palette. */
export const OCCLUSION_BLUE = SELECTION_CORE;
/** Terrain march samples per camera→tap ray (endpoints excluded). */
export const OCCLUSION_SAMPLES = 16;
/** Hull taps above the body origin: low hull, turret, mast/antenna band. */
export const OCCLUSION_TAPS = [6, 18, 30] as const;
/** Ghost opacity: solid enough to locate, thin enough to ignore. */
export const OCCLUSION_OPACITY = 0.85;
/** Above health bars (13) so the ghost wins the x-ray stack. */
export const OCCLUSION_RENDER_ORDER = HEALTH_BAR_RENDER_ORDER + 1;
/** Ghost outline height per kind (footprint comes from `HULL_FOOTPRINT`). */
export const GHOST_HEIGHT: Record<UnitKind, number> = {
  flash: 16,
  stump: 20,
  hammer: 24,
  commander: 48,
};

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface OcclusionEnv {
  /** Live terrain surface height at world (x, z), tracking exaggeration. */
  groundY: (x: number, z: number) => number;
  /** Standing-tree volumes for this tick (caller-owned, shared with combat). */
  stands: readonly TreeStand[];
}

/** Box outline size for a unit kind: footprint × ghost height. */
export function ghostBoxFor(kind: UnitKind): { w: number; h: number; d: number } {
  const fp = HULL_FOOTPRINT[kind] ?? HULL_FOOTPRINT.flash;
  return { w: fp.halfWid * 2, h: GHOST_HEIGHT[kind] ?? 16, d: fp.halfLen * 2 };
}

/**
 * True when terrain hides `target` from `cam`: any interior march sample
 * rides below the live surface (plus a 1-unit grace so hulls seated on the
 * grade never self-occlude). Pure for tests.
 */
export function segmentBlockedByTerrain(
  cam: Vec3Like,
  target: Vec3Like,
  groundY: (x: number, z: number) => number,
  samples: number = OCCLUSION_SAMPLES,
): boolean {
  const n = Math.max(Math.floor(samples), 1);
  for (let i = 1; i <= n; i++) {
    const k = i / (n + 1);
    const x = cam.x + (target.x - cam.x) * k;
    const y = cam.y + (target.y - cam.y) * k;
    const z = cam.z + (target.z - cam.z) * k;
    if (y < groundY(x, z) + 1) return true;
  }
  return false;
}

/**
 * True when live wood hides `target` from `cam` (standing crowns/trunks
 * only — felled wood never intercepts, matching projectile rules). Pure.
 */
export function segmentBlockedByTrees(
  cam: Vec3Like,
  target: Vec3Like,
  stands: readonly TreeStand[],
): boolean {
  if (stands.length === 0) return false;
  return treesOnSegment(cam, target, stands).length > 0;
}

/**
 * Occlusion of one body origin: each `OCCLUSION_TAPS` tap is tested against
 * terrain, then trees (terrain first — the cheaper reject). Returns the
 * blocked-tap count; `occluded` is true when any tap hides, so partial
 * cover (nose behind a ridge, hull under one crown) still ghosts.
 */
export function unitOcclusion(
  cam: Vec3Like,
  body: Vec3Like,
  env: OcclusionEnv,
): { blocked: number; total: number; occluded: boolean } {
  let blocked = 0;
  const total = OCCLUSION_TAPS.length;
  for (const lift of OCCLUSION_TAPS) {
    const target = { x: body.x, y: body.y + lift, z: body.z };
    if (
      segmentBlockedByTerrain(cam, target, env.groundY) ||
      segmentBlockedByTrees(cam, target, env.stands)
    ) {
      blocked++;
    }
  }
  return { blocked, total, occluded: blocked > 0 };
}

/** Minimal wreck-state source (`CombatFx` satisfies this structurally). */
export interface OcclusionHealth {
  isDestroyedAt(index: number): boolean;
  isHuskGoneAt?(index: number): boolean;
}

let sharedGhostGeo: THREE.EdgesGeometry | null = null;
let sharedGhostMat: THREE.LineBasicMaterial | null = null;

function ghostAssets(): { geo: THREE.EdgesGeometry; mat: THREE.LineBasicMaterial } {
  if (!sharedGhostGeo || !sharedGhostMat) {
    sharedGhostGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    sharedGhostMat = new THREE.LineBasicMaterial({
      color: OCCLUSION_BLUE,
      transparent: true,
      opacity: OCCLUSION_OPACITY,
      depthTest: false,
      depthWrite: false,
    });
  }
  return { geo: sharedGhostGeo, mat: sharedGhostMat };
}

/** Drop the shared ghost assets (canvas unmount / regen). */
export function disposeOcclusionAssets(): void {
  sharedGhostGeo?.dispose();
  sharedGhostMat?.dispose();
  sharedGhostGeo = null;
  sharedGhostMat = null;
}

export class OcclusionFx {
  private scene: THREE.Scene;
  private ghosts: THREE.LineSegments[] = [];
  private sizes: { w: number; h: number; d: number }[] = [];
  private disposed = false;
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene, kinds: readonly UnitKind[]) {
    this.scene = scene;
    this.group.name = "occlusion-ghosts";
    this.scene.add(this.group);
    const { geo, mat } = ghostAssets();
    kinds.forEach((kind) => {
      const size = ghostBoxFor(kind);
      const ghost = new THREE.LineSegments(geo, mat);
      ghost.name = "occlusion-ghost";
      ghost.visible = false;
      ghost.frustumCulled = false;
      ghost.renderOrder = OCCLUSION_RENDER_ORDER;
      ghost.userData.noHighlight = true;
      this.group.add(ghost);
      this.ghosts.push(ghost);
      this.sizes.push(size);
    });
  }

  /** Ghost count (one per roster unit). */
  get count(): number {
    return this.ghosts.length;
  }

  /** Whether a unit's ghost is currently drawn (for tests). */
  isShown(index: number): boolean {
    return this.ghosts[index]?.visible ?? false;
  }

  /**
   * Per-tick refresh: park each ghost on its body (yawed footprint box) and
   * show it exactly while occluded. Gone husks (fully decayed) show nothing;
   * live units, damaged units, and present (smouldering/sinking) husks all
   * ghost alike — wreck state never gates the signal, only full decay does.
   */
  update(
    cam: Vec3Like,
    bodies: readonly THREE.Object3D[],
    env: OcclusionEnv,
    health: OcclusionHealth,
  ): void {
    if (this.disposed) return;
    for (let i = 0; i < this.ghosts.length; i++) {
      const ghost = this.ghosts[i]!;
      const body = bodies[i];
      const gone = health.isHuskGoneAt?.(i) ?? false;
      if (!body || gone) {
        ghost.visible = false;
        continue;
      }
      const size = this.sizes[i]!;
      ghost.position.set(body.position.x, body.position.y + size.h / 2, body.position.z);
      ghost.rotation.set(0, body.rotation.y, 0);
      ghost.scale.set(size.w, size.h, size.d);
      ghost.visible = unitOcclusion(cam, body.position, env).occluded;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.group.clear();
    this.ghosts = [];
  }
}
