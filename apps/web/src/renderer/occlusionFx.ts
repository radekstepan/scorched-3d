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
 * reads as a blue silhouette ghost — the unit's own outline plus a slight
 * transparent fill — so the player can still locate it.
 *
 * Two halves, split for testability:
 *
 * - Pure sampling math (`segmentBlockedByTerrain` / `unitOcclusion`): the
 *   camera→hull ray is tested at a few hull taps (low/mid/high) against the
 *   live `groundY` heightfield plus the standing-tree volumes from core
 *   (`treesOnSegment`: crown sphere + trunk cylinder, felled/stump/snag/gone
 *   wood never intercepts). A unit counts as occluded when *any* tap is
 *   blocked, so a hull nose-down behind a ridge still ghosts.
 * - `OcclusionFx`: one silhouette ghost per roster unit. Each ghost mirrors
 *   its body's mesh hierarchy (shared geometries, x-ray materials,
 *   `depthTest: false`, above the health-bar layer) and copies the live pose
 *   every tick (body origin + turret yaw, barrel pitch, wheels/legs), so the
 *   ghost follows the true hull/turret shape — never a bounding rectangle.
 *   The ghost lives in its own scene group — never a body child — so hull
 *   paint (including damage charring), selection rings/beacons, waypoint
 *   lines, and picking all ignore it, and `userData.noHighlight` keeps the
 *   damage tint off it by construction too.
 *
 * Perf: per tick each unit tests OCCLUSION_TAPS taps × OCCLUSION_SAMPLES
 * terrain samples (one bilinear `groundY` each) plus one broadphase
 * `treesOnSegment` per tap. Rosters are ~6 hulls, so a tick costs a few
 * thousand cheap rejects — no raycaster, no per-pixel work, no allocations
 * past the caller-owned stands array. Pose sync copies transforms only
 * (no geometry rebuilds unless the body hierarchy changes shape).
 */

/** Ghost blue: the selection cyan, so hidden units read in the UI palette. */
export const OCCLUSION_BLUE = SELECTION_CORE;
/** Terrain march samples per camera→tap ray (endpoints excluded). */
export const OCCLUSION_SAMPLES = 16;
/** Hull taps above the body origin: low hull, turret, mast/antenna band. */
export const OCCLUSION_TAPS = [6, 18, 30] as const;
/** Silhouette fill opacity: slight wash so the occluded part reads. */
export const OCCLUSION_FILL_OPACITY = 0.28;
/** Silhouette outline opacity: crisp enough to locate at a glance. */
export const OCCLUSION_OUTLINE_OPACITY = 0.9;
/** Back-compat alias (was the box-ghost opacity; now the outline opacity). */
export const OCCLUSION_OPACITY = OCCLUSION_OUTLINE_OPACITY;
/** Fill layer: above health bars (13) so the ghost wins the x-ray stack. */
export const OCCLUSION_RENDER_ORDER = HEALTH_BAR_RENDER_ORDER + 1;
/** Outline layer: one above the fill so edges composite crisply. */
export const OCCLUSION_OUTLINE_ORDER = OCCLUSION_RENDER_ORDER + 1;
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

/**
 * Box outline size for a unit kind: footprint × ghost height. Kept for the
 * mesh-less fallback ghost (plain test groups with no hull meshes) — real
 * bodies render their true silhouette instead.
 */
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

let sharedFillMat: THREE.MeshBasicMaterial | null = null;
let sharedLineMat: THREE.LineBasicMaterial | null = null;
let sharedFallbackGeo: THREE.BoxGeometry | null = null;

function ghostMats(): { fill: THREE.MeshBasicMaterial; line: THREE.LineBasicMaterial } {
  if (!sharedFillMat || !sharedLineMat) {
    sharedFillMat = new THREE.MeshBasicMaterial({
      color: OCCLUSION_BLUE,
      transparent: true,
      opacity: OCCLUSION_FILL_OPACITY,
      depthTest: false,
      depthWrite: false,
    });
    sharedLineMat = new THREE.LineBasicMaterial({
      color: OCCLUSION_BLUE,
      transparent: true,
      opacity: OCCLUSION_OUTLINE_OPACITY,
      depthTest: false,
      depthWrite: false,
    });
  }
  return { fill: sharedFillMat, line: sharedLineMat };
}

function fallbackGeo(): THREE.BoxGeometry {
  if (!sharedFallbackGeo) sharedFallbackGeo = new THREE.BoxGeometry(1, 1, 1);
  return sharedFallbackGeo;
}

/** Drop the shared ghost assets (canvas unmount / regen). */
export function disposeOcclusionAssets(): void {
  sharedFillMat?.dispose();
  sharedLineMat?.dispose();
  sharedFallbackGeo?.dispose();
  sharedFillMat = null;
  sharedLineMat = null;
  sharedFallbackGeo = null;
}

interface PosePair {
  src: THREE.Object3D;
  dst: THREE.Object3D;
}

/** Tag a ghost object: off-hull highlight target, never pickable. */
function tagGhost(obj: THREE.Object3D): void {
  obj.userData.noHighlight = true;
  (obj as unknown as { raycast: () => void }).raycast = () => {};
}

/**
 * Mirror one source child into a ghost clone: meshes share the source
 * geometry (fill mesh + edge outline), groups recurse. Pose pairs sync the
 * live local transforms every tick.
 */
function cloneSilhouette(
  src: THREE.Object3D,
  mats: { fill: THREE.MeshBasicMaterial; line: THREE.LineBasicMaterial },
  pairs: PosePair[],
  edgeGeos: THREE.BufferGeometry[],
  fallbackSize: { w: number; h: number; d: number },
): THREE.Object3D | null {
  if ((src as THREE.Mesh).isMesh) {
    const mesh = src as THREE.Mesh;
    const geo = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geo) return null;
    const wrap = new THREE.Group();
    wrap.name = "occlusion-part";
    wrap.position.copy(src.position);
    wrap.quaternion.copy(src.quaternion);
    wrap.scale.copy(src.scale);
    tagGhost(wrap);
    const fill = new THREE.Mesh(geo, mats.fill);
    fill.name = "occlusion-fill";
    fill.frustumCulled = false;
    fill.renderOrder = OCCLUSION_RENDER_ORDER;
    tagGhost(fill);
    const edges = new THREE.EdgesGeometry(geo, 30);
    edgeGeos.push(edges);
    const outline = new THREE.LineSegments(edges, mats.line);
    outline.name = "occlusion-outline";
    outline.frustumCulled = false;
    outline.renderOrder = OCCLUSION_OUTLINE_ORDER;
    tagGhost(outline);
    wrap.add(fill, outline);
    pairs.push({ src, dst: wrap });
    return wrap;
  }
  if ((src as THREE.LineSegments).isLineSegments || (src as THREE.Line).isLine) {
    return null;
  }
  const group = new THREE.Group();
  group.name = src.name || "occlusion-node";
  group.position.copy(src.position);
  group.quaternion.copy(src.quaternion);
  group.scale.copy(src.scale);
  tagGhost(group);
  for (const child of src.children) {
    if (child.name === "select-marker" || child.name === "healthbar") continue;
    if (child.getObjectByName("occlusion-fill")) continue;
    const clone = cloneSilhouette(child, mats, pairs, edgeGeos, fallbackSize);
    if (clone) group.add(clone);
  }
  // Drop empty marker pivots (muzzle tips); keep structural pivots
  // (turret/barrel) so re-armed hierarchies still pose correctly.
  if (group.children.length === 0 && src.name !== "turret" && src.name !== "barrel") {
    return null;
  }
  pairs.push({ src, dst: group });
  return group;
}

export class OcclusionFx {
  private scene: THREE.Scene;
  private kinds: readonly UnitKind[];
  private ghosts: THREE.Group[] = [];
  private pairs: PosePair[][] = [];
  private edgeGeos: THREE.BufferGeometry[][] = [];
  private childCounts: number[] = [];
  private disposed = false;
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene, kinds: readonly UnitKind[]) {
    this.scene = scene;
    this.kinds = kinds;
    this.group.name = "occlusion-ghosts";
    this.scene.add(this.group);
    kinds.forEach((kind) => {
      void kind;
      const ghost = new THREE.Group();
      ghost.name = "occlusion-ghost";
      ghost.visible = false;
      ghost.frustumCulled = false;
      tagGhost(ghost);
      this.group.add(ghost);
      this.ghosts.push(ghost);
      this.pairs.push([]);
      this.edgeGeos.push([]);
      this.childCounts.push(-1);
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
   * Per-tick refresh: mirror each body pose into its silhouette ghost and
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
      this.ensureBuilt(i, body);
      this.syncPose(i, body);
      ghost.visible = unitOcclusion(cam, body.position, env).occluded;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geos of this.edgeGeos) {
      for (const geo of geos) geo.dispose();
    }
    this.edgeGeos = [];
    this.pairs = [];
    this.scene.remove(this.group);
    this.group.clear();
    this.ghosts = [];
  }

  /** Build (or rebuild) the silhouette mirror for one body. */
  private ensureBuilt(index: number, body: THREE.Object3D): void {
    const ghost = this.ghosts[index]!;
    const count = descendantCount(body);
    if (this.childCounts[index] === count && ghost.children.length > 0) return;
    // Hierarchy changed shape (or first build): drop stale clones + edges.
    for (const geo of this.edgeGeos[index]!) geo.dispose();
    this.edgeGeos[index] = [];
    this.pairs[index] = [];
    ghost.clear();
    const mats = ghostMats();
    const kind = this.kinds[index] ?? "flash";
    const size = ghostBoxFor(kind);
    let added = 0;
    for (const child of body.children) {
      if (child.name === "select-marker") continue;
      const clone = cloneSilhouette(child, mats, this.pairs[index]!, this.edgeGeos[index]!, size);
      if (clone) {
        ghost.add(clone);
        added++;
      }
    }
    if (added === 0) {
      // Mesh-less body (plain test groups): footprint-sized fill + outline
      // box so the signal still reads; real hulls never take this path.
      const geo = fallbackGeo();
      const fill = new THREE.Mesh(geo, mats.fill);
      fill.name = "occlusion-fill";
      fill.frustumCulled = false;
      fill.renderOrder = OCCLUSION_RENDER_ORDER;
      fill.position.y = size.h / 2;
      fill.scale.set(size.w, size.h, size.d);
      tagGhost(fill);
      const edges = new THREE.EdgesGeometry(geo);
      this.edgeGeos[index]!.push(edges);
      const outline = new THREE.LineSegments(edges, mats.line);
      outline.name = "occlusion-outline";
      outline.frustumCulled = false;
      outline.renderOrder = OCCLUSION_OUTLINE_ORDER;
      outline.position.copy(fill.position);
      outline.scale.copy(fill.scale);
      tagGhost(outline);
      const wrap = new THREE.Group();
      wrap.name = "occlusion-fallback";
      tagGhost(wrap);
      wrap.add(fill, outline);
      ghost.add(wrap);
    }
    this.childCounts[index] = count;
  }

  /** Copy the live body pose into its ghost mirror (transforms only). */
  private syncPose(index: number, body: THREE.Object3D): void {
    const ghost = this.ghosts[index]!;
    ghost.position.copy(body.position);
    ghost.quaternion.copy(body.quaternion);
    ghost.scale.copy(body.scale);
    const pairs = this.pairs[index]!;
    for (const pair of pairs) {
      pair.dst.position.copy(pair.src.position);
      pair.dst.quaternion.copy(pair.src.quaternion);
      pair.dst.scale.copy(pair.src.scale);
    }
  }
}

/** Total node count under `root` (rebuild signal for hierarchy changes). */
function descendantCount(root: THREE.Object3D): number {
  let n = 0;
  root.traverse(() => {
    n++;
  });
  return n;
}
