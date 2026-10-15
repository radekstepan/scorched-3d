import { CELL_PIXELS } from "../terrain/types.js";
import type { UnitField } from "./place.js";
import type { BlastPoint, BlastSlope, TreeDamage } from "./destruction.js";
import { blastSkewForGrade } from "./destruction.js";
import {
  isTreeCell,
  isWalkable,
  PATH_MAX_SLOPE,
  segmentPointDistSq,
  TRUNK_KEEPOUT,
  TRUNK_RADIUS,
} from "./pathfinding.js";
import type { UnitKind } from "./types.js";

/**
 * Continuous terrain seating for moving hulls. Framework-free (no three.js)
 * so the web renderer and vitest share the same math.
 *
 * Problem: movers used to sit at the nearest corner height with a flat
 * (yaw-only) pose, so hulls clipped into rising ground and floated over
 * falling ground between waypoints. Everything here samples the heightfield
 * bilinearly in world space instead, then pitches/rolls the hull to the
 * local grade and lifts it to the highest tap under its footprint — a rigid
 * hull can only rest on its highest corner, so seating at the max tap is
 * what keeps both tracks out of the dirt.
 *
 * Two height frames, deliberately:
 * - Drive gating (`stepBlocked`) works in raw height units so it agrees
 *   with the `isWalkable` slope gate pathfinding uses (same `PATH_MAX_SLOPE`
 *   over the same cells). A leg the pathfinder blessed must never read as
 *   blocked, and vice versa. Drive *speed* (`terrainSpeedScale`) degrades
 *   below the gate instead: slope-scaled drag plus tree/rock drag.
 * - Posing (`hullPitchRoll` / `seatHull`) works in rendered (exaggerated)
 *   heights because the tilt has to match the mesh the player sees.
 *
 * Nanolathe parallels (adapted — retail stamps fixed-point yard maps under
 * a budgeted scheduler; this samples a float heightfield synchronously):
 * - `internal/path/smooth.go` (`standable` / `clear`): a leg is only kept
 *   when the mover footprint can stand all along it, probing half a
 *   footprint to either side. Mirrored by seating/probing at ±halfLen /
 *   ±halfWid taps instead of a single center sample.
 * - `internal/path/search.go` steep tier (`terrainTerm = 30` for steep
 *   cells): steep ground is not just slower, it is effectively unwalkable
 *   for most movers. Mirrored by the shared `isWalkable` gate plus the
 *   hard `stepBlocked` clamp — binary, not a cost tier, because the demo
 *   roster shares one movement profile and determinism beats nuance here.
 */

/** Minimal heightfield view seating/probing needs (TNTMap satisfies this). */
export type SeatField = Pick<UnitField, "width" | "height" | "heights" | "seaLevel"> & {
  /**
   * Optional attribute-grid feature words (TNTMap.features): 0–2 trees, 3–4
   * rocks, 5 metal deposit. Absent (older synthetic-test fields) reads as
   * open ground, so drag collapses to the slope term alone.
   */
  features?: Uint16Array | readonly number[];
};

/** Hull footprint half-extents per kind, in world units (nose/tail, flank). */
export const HULL_FOOTPRINT: Record<UnitKind, { halfLen: number; halfWid: number }> = {
  // Hull boxes are longer (nose/tail, +Z travel) than wide; the nose
  // overhangs, so bias long. halfLen must exceed halfWid for tanks or the
  // grade seating leans across the hull instead of along it.
  flash: { halfLen: 10, halfWid: 8 },
  stump: { halfLen: 14, halfWid: 10 },
  hammer: { halfLen: 13, halfWid: 9 },
  // Biped: legs spread ±4, torso above — a modest pad reads as planted.
  commander: { halfLen: 8, halfWid: 7 },
};

/** Base clearance of the hull origin above the highest footprint tap. */
export const HULL_CLEARANCE = 0.5;
/** Hull tilt clamp, radians (~29°): posed, never snapped flat, never wild. */
export const MAX_HULL_TILT = 0.5;
/**
 * Fastest hull tilt change, radians per second. The renderer slews posed
 * pitch/roll toward the grade seat at this rate instead of snapping, so
 * cresting a ridge reads as suspension settling (~0.25 s for a full-tilt
 * swing) rather than a teleport. Re-snaps (exaggeration changes) still
 * apply instantly.
 */
export const HULL_TILT_SLEW = 2.0;
/**
 * Steepest raw grade a hull will drive: the same rise/run the walkability
 * gate tolerates (`PATH_MAX_SLOPE` over one cell edge). Steps steeper than
 * this hold position instead of clipping into the hillside.
 */
export const MAX_DRIVE_GRADE = PATH_MAX_SLOPE / CELL_PIXELS;
/**
 * Slowest slope drag: a hull climbing the steepest still-walkable grade
 * keeps this fraction of its speed. Linear between flat (1) and here.
 */
export const ROUGH_SLOPE_FLOOR = 0.45;
/** Speed fraction while pushing through standing trees (cell or neighbour). */
export const TREE_DRAG = 0.6;
/** Speed fraction while picking through rocks or metal deposits. */
export const ROCK_DRAG = 0.5;
/**
 * Speed fraction while a step crushes standing wood (see
 * `treesCrushedByStep`): far slower than the `TREE_DRAG` canopy brush, so
 * ploughing a fresh lane through forest reads as labouring — while a second
 * pass over the already-fallen trunks rides the lighter proximity drag.
 */
export const CRUSH_DRAG = 0.25;

/** Seated pose for one hull: surface height plus hull-frame tilt. */
export interface HullSeat {
  y: number;
  /** three.js `rotation.x` under a `YXZ` order: negative = nose up. */
  pitch: number;
  /** three.js `rotation.z` under a `YXZ` order: positive = right side up. */
  roll: number;
}

function clampCell(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/**
 * Raw corner height sampled bilinearly at world (x, z). Continuous across
 * cell edges, unlike the old nearest-corner snap that popped hulls up and
 * down by whole height steps mid-leg.
 */
export function sampleHeightBilinear(field: SeatField, x: number, z: number): number {
  const fx = clampCell(x / CELL_PIXELS + (field.width - 1) / 2, field.width - 1);
  const fz = clampCell(z / CELL_PIXELS + (field.height - 1) / 2, field.height - 1);
  const x0 = Math.min(Math.floor(fx), field.width - 2);
  const z0 = Math.min(Math.floor(fz), field.height - 2);
  const tx = Math.min(Math.max(fx - x0, 0), 1);
  const tz = Math.min(Math.max(fz - z0, 0), 1);
  const w = field.width;
  const h00 = field.heights[z0 * w + x0] ?? 0;
  const h10 = field.heights[z0 * w + x0 + 1] ?? 0;
  const h01 = field.heights[(z0 + 1) * w + x0] ?? 0;
  const h11 = field.heights[(z0 + 1) * w + x0 + 1] ?? 0;
  return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
}

/** Rendered (exaggerated) surface height at world (x, z). */
export function groundHeight(field: SeatField, x: number, z: number, exaggeration: number): number {
  return sampleHeightBilinear(field, x, z) * exaggeration;
}

/** Downhill fall-line sample: unit vector plus raw grade (rise/run). */
export interface Downslope {
  /** Unit downhill X (0 when flat). */
  dx: number;
  /** Unit downhill Z (0 when flat). */
  dz: number;
  /** Raw grade ≥ 0 (height units per world unit). */
  grade: number;
}

/** Finite-difference tap for `downslopeAt`, in world units (one cell). */
export const DOWNSLOPE_TAP = CELL_PIXELS;

/**
 * Fall line at world (x, z) from bilinear taps one cell apart: the
 * downhill unit vector plus the raw grade. Flat ground reads
 * `{0, 0, 0}` exactly (no direction, no grade), so callers can branch to
 * legacy circular behavior bit-identically on the flat.
 */
export function downslopeAt(field: SeatField, x: number, z: number): Downslope {
  const t = DOWNSLOPE_TAP;
  const gx = -(sampleHeightBilinear(field, x + t, z) - sampleHeightBilinear(field, x - t, z)) / (2 * t);
  const gz = -(sampleHeightBilinear(field, x, z + t) - sampleHeightBilinear(field, x, z - t)) / (2 * t);
  const mag = Math.hypot(gx, gz);
  if (!(mag > 0)) return { dx: 0, dz: 0, grade: 0 };
  return { dx: gx / mag, dz: gz / mag, grade: mag };
}

/**
 * Blast wash at world (x, z): the fall line mapped through
 * `blastSkewForGrade`. Flat ground reads `FLAT_BLAST_SLOPE`-equal
 * (zero skew), so blasts there stay perfectly circular.
 */
export function blastSlopeAt(field: SeatField, x: number, z: number): BlastSlope {
  const d = downslopeAt(field, x, z);
  const skew = blastSkewForGrade(d.grade);
  if (!(skew > 0)) return { sx: 0, sz: 0, skew: 0 };
  return { sx: d.dx, sz: d.dz, skew };
}

function clampTilt(v: number): number {
  const c = v < -MAX_HULL_TILT ? -MAX_HULL_TILT : v > MAX_HULL_TILT ? MAX_HULL_TILT : v;
  // Normalize -0 (from -atan2 on flat ground) so flat poses read exactly 0.
  return c + 0;
}

/**
 * One slew-limited tilt step: move `prev` toward `next` by at most
 * `maxStep` radians (non-positive steps hold). Pitch/roll never wrap, so
 * this is a plain clamp, not an angular wrap — the hull can't take the
 * "long way around" a tilt. Pure, so the renderer and vitest share it.
 */
export function slewTilt(prev: number, next: number, maxStep: number): number {
  if (!(maxStep > 0)) return prev;
  const d = next - prev;
  if (d > maxStep) return prev + maxStep;
  if (d < -maxStep) return prev - maxStep;
  return next;
}

/**
 * Hull-frame tilt at world (x, z) facing `hull` yaw, from rendered heights
 * tapped at the footprint corners. Nose rises uphill (negative `rotation.x`
 * under three.js `YXZ`: `Rx(θ)` sends `+Z` to `(0, −sinθ, cosθ)`), right
 * flank rises on right-high ground (positive `rotation.z` lifts `+X`).
 */
export function hullPitchRoll(
  field: SeatField,
  kind: UnitKind,
  x: number,
  z: number,
  hull: number,
  exaggeration: number,
): { pitch: number; roll: number } {
  const fp = HULL_FOOTPRINT[kind] ?? HULL_FOOTPRINT.flash;
  const fx = Math.sin(hull);
  const fz = Math.cos(hull);
  // Local +X (right flank) under yaw: (cos h, −sin h) in (x, z).
  const rx = Math.cos(hull);
  const rz = -Math.sin(hull);
  const hFront = groundHeight(field, x + fx * fp.halfLen, z + fz * fp.halfLen, exaggeration);
  const hBack = groundHeight(field, x - fx * fp.halfLen, z - fz * fp.halfLen, exaggeration);
  const hRight = groundHeight(field, x + rx * fp.halfWid, z + rz * fp.halfWid, exaggeration);
  const hLeft = groundHeight(field, x - rx * fp.halfWid, z - rz * fp.halfWid, exaggeration);
  return {
    pitch: clampTilt(-Math.atan2(hFront - hBack, fp.halfLen * 2)),
    roll: clampTilt(Math.atan2(hRight - hLeft, fp.halfWid * 2)),
  };
}

/**
 * Full seated pose: tilt from `hullPitchRoll`, height from the highest of
 * the center + four footprint taps (plus `HULL_CLEARANCE`). On flat ground
 * every tap agrees and this collapses to the old `groundY + 0.5` exactly,
 * so flat-field behavior is byte-identical to before.
 */
export function seatHull(
  field: SeatField,
  kind: UnitKind,
  x: number,
  z: number,
  hull: number,
  exaggeration: number,
): HullSeat {
  const fp = HULL_FOOTPRINT[kind] ?? HULL_FOOTPRINT.flash;
  const fx = Math.sin(hull);
  const fz = Math.cos(hull);
  const rx = Math.cos(hull);
  const rz = -Math.sin(hull);
  const taps = [
    groundHeight(field, x, z, exaggeration),
    groundHeight(field, x + fx * fp.halfLen, z + fz * fp.halfLen, exaggeration),
    groundHeight(field, x - fx * fp.halfLen, z - fz * fp.halfLen, exaggeration),
    groundHeight(field, x + rx * fp.halfWid, z + rz * fp.halfWid, exaggeration),
    groundHeight(field, x - rx * fp.halfWid, z - rz * fp.halfWid, exaggeration),
  ];
  const { pitch, roll } = hullPitchRoll(field, kind, x, z, hull, exaggeration);
  return { y: Math.max(...taps) + HULL_CLEARANCE, pitch, roll };
}

/**
 * True when a hull must not step from (fromX, fromZ) to (toX, toZ) for
 * terrain reasons alone: the destination cell is unwalkable (water/steep,
 * the same gate pathfinding uses) or the raw point-to-point grade exceeds
 * what the gate tolerates. Trunk keepouts are NOT considered here — see
 * `stepBlocked` for the full gate. Split out so drivers can tell a hard
 * terrain wall (hold position) from wood (slide around it).
 */
export function terrainStepBlocked(
  field: SeatField,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): boolean {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const dist = Math.hypot(dx, dz);
  if (!(dist > 0)) return false;
  const cellX = Math.min(
    Math.max(Math.round(toX / CELL_PIXELS + (field.width - 1) / 2), 0),
    field.width - 1,
  );
  const cellZ = Math.min(
    Math.max(Math.round(toZ / CELL_PIXELS + (field.height - 1) / 2), 0),
    field.height - 1,
  );
  if (!isWalkable(field, cellX, cellZ)) return true;
  const grade = Math.abs(sampleHeightBilinear(field, toX, toZ) - sampleHeightBilinear(field, fromX, fromZ)) / dist;
  return grade > MAX_DRIVE_GRADE;
}

/**
 * Full drive gate: unwalkable/too-steep ground (see `terrainStepBlocked`).
 * Standing trunks do NOT block: hulls crush through forest (felling the
 * trees they touch — see `treesCrushedByStep` — at `CRUSH_DRAG` crawl)
 * instead of grinding on wood. A blocked mover holds position and keeps
 * turning toward its target (retail's blocked-mover behavior) instead of
 * clipping into the slope. The `kind` parameter is retained for call-site
 * compatibility only; keepout sizing now lives with the crush test.
 */
export function stepBlocked(
  field: SeatField,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  _kind?: UnitKind,
): boolean {
  return terrainStepBlocked(field, fromX, fromZ, toX, toZ);
}

/**
 * Standing-tree fids a drive step crushes: intact/burning trees (indexed
 * like the caller's `DamageField` — e.g. the renderer's fid-ordered tree
 * positions) whose trunk keepout the step's segment enters. Felled
 * (`toppled`/`stump`/`snag`) and decayed (`gone`) trees are already flat and
 * never re-counted, so a crushed lane stays crushed and later passes ride
 * free of crush drag. Without `states` every point counts as standing (pure
 * terrain drag estimate). Deterministic ascending fid order; pure, shared by
 * the drive drag and the fell pass so both agree on which trees a step
 * touches.
 */
export function treesCrushedByStep(
  points: readonly BlastPoint[],
  states: readonly TreeDamage[] | undefined,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  kind?: UnitKind,
): number[] {
  const keepout = trunkKeepoutFor(kind);
  const r2 = keepout * keepout;
  const crushed: number[] = [];
  const n = Math.min(points.length, states?.length ?? points.length);
  for (let i = 0; i < n; i++) {
    const state = states?.[i];
    if (state !== undefined && state !== "intact" && state !== "burning") continue;
    const p = points[i]!;
    if (segmentPointDistSq(fromX, fromZ, toX, toZ, p.x, p.z) < r2) crushed.push(i);
  }
  return crushed;
}

/** Hull body radius for trunk keepout: the flank half-width it turns with. */
export function hullBodyRadius(kind: UnitKind): number {
  return (HULL_FOOTPRINT[kind] ?? HULL_FOOTPRINT.flash)?.halfWid ?? 8;
}

/**
 * Trunk keepout for a kind: hull body radius plus the trunk radius, so the
 * hull's flank (not just its center) clears the wood. Without a kind this
 * is the widest hull's margin — the same `TRUNK_KEEPOUT` smoothing steers
 * with, keeping drive and pathing in agreement.
 */
export function trunkKeepoutFor(kind?: UnitKind): number {
  if (kind === undefined) return TRUNK_KEEPOUT;
  return hullBodyRadius(kind) + TRUNK_RADIUS;
}

/** World-space center of an attribute-grid cell. */
function cellCenterWorld(field: SeatField, cellX: number, cellZ: number): { x: number; z: number } {
  return {
    x: (cellX - (field.width - 1) / 2) * CELL_PIXELS,
    z: (cellZ - (field.height - 1) / 2) * CELL_PIXELS,
  };
}

/**
 * True when world (x, z) sits inside a standing trunk's keepout. Standing
 * means the static attribute-grid word: blast-felled trees keep their
 * stump/snag/toppled trunk instance (fell, don't remove), so the wood is
 * still there and still blocks — which also keeps collision out of the
 * renderer-owned `DamageField` and the deterministic core untouched by
 * live damage.
 */
export function trunkBlockedAt(field: SeatField, x: number, z: number, kind?: UnitKind): boolean {
  if (!field.features) return false;
  const keepout = trunkKeepoutFor(kind);
  const r2 = keepout * keepout;
  const cx = Math.round(x / CELL_PIXELS + (field.width - 1) / 2);
  const cz = Math.round(z / CELL_PIXELS + (field.height - 1) / 2);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cellX = cx + dx;
      const cellZ = cz + dz;
      if (cellX < 0 || cellZ < 0 || cellX >= field.width || cellZ >= field.height) continue;
      if (!isTreeCell(field, cellX, cellZ)) continue;
      const c = cellCenterWorld(field, cellX, cellZ);
      const ox = x - c.x;
      const oz = z - c.z;
      if (ox * ox + oz * oz < r2) return true;
    }
  }
  return false;
}

/**
 * True when the world-space step from→to would clip a standing trunk:
 * the destination lands inside a keepout, or the segment passes through
 * one. A step that starts inside a keepout is exempt from that trunk's
 * pass-through test — the hull is already there, and refusing would pin
 * the final exit step, whose segment necessarily begins inside the
 * circle. Entering from outside, passing through, and milling around
 * deeper inside stay refused. Feature-less fields never clip, keeping
 * terrain-less history byte-identical.
 */
export function segmentClipsTrunk(
  field: SeatField,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  kind?: UnitKind,
): boolean {
  if (!field.features) return false;
  const keepout = trunkKeepoutFor(kind);
  const r2 = keepout * keepout;
  const minCellX = Math.min(
    Math.max(Math.floor((Math.min(fromX, toX) - keepout) / CELL_PIXELS + (field.width - 1) / 2), 0),
    field.width - 1,
  );
  const maxCellX = Math.min(
    Math.max(Math.ceil((Math.max(fromX, toX) + keepout) / CELL_PIXELS + (field.width - 1) / 2), 0),
    field.width - 1,
  );
  const minCellZ = Math.min(
    Math.max(Math.floor((Math.min(fromZ, toZ) - keepout) / CELL_PIXELS + (field.height - 1) / 2), 0),
    field.height - 1,
  );
  const maxCellZ = Math.min(
    Math.max(Math.ceil((Math.max(fromZ, toZ) + keepout) / CELL_PIXELS + (field.height - 1) / 2), 0),
    field.height - 1,
  );
  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      if (!isTreeCell(field, cellX, cellZ)) continue;
      const c = cellCenterWorld(field, cellX, cellZ);
      const sx = fromX - c.x;
      const sz = fromZ - c.z;
      const start2 = sx * sx + sz * sz;
      // Already inside this trunk's keepout: only the destination decides —
      // leaving (or holding still, decided by the caller) is allowed, going
      // deeper is not.
      if (start2 < r2) {
        const ex = toX - c.x;
        const ez = toZ - c.z;
        if (ex * ex + ez * ez < start2) return true;
        continue;
      }
      const ex = toX - c.x;
      const ez = toZ - c.z;
      if (ex * ex + ez * ez < r2) return true;
      if (segmentPointDistSq(fromX, fromZ, toX, toZ, c.x, c.z) < r2) return true;
    }
  }
  return false;
}

/**
 * Easing speed for the trunk push-out in `movement.ts`: faster than the
 * unit separation shove (22) so a hull parked on a trunk exits promptly,
 * still slow enough to read as jostling rather than teleporting.
 */
export const TRUNK_PUSH_SPEED = 30;

/**
 * Nearest position outside every nearby trunk keepout. Marches out along
 * the escape heading (away from the nearest trunk center, fixed +X when
 * exactly coincident) and returns the first trunk-clear sample, so
 * overlapping keepouts in dense stands can't ping-pong a sequential
 * snapper back and forth. Returns the input unchanged when already clear,
 * and a best-effort step clear of the nearest trunk when no clear sample
 * exists within range (deep forest interiors have no trunk-free ground —
 * the hull then holds honestly instead of clipping). Deterministic: fixed
 * scan order with first-wins ties, bounded march, no RNG. The caller eases
 * toward this target instead of snapping, and gates the ease with
 * `stepBlocked`, so the exit never clips into water or steep ground.
 */
export function pushOutOfTrunks(
  field: SeatField,
  x: number,
  z: number,
  kind?: UnitKind,
): { x: number; z: number } {
  if (!field.features || !trunkBlockedAt(field, x, z, kind)) return { x, z };
  const keepout = trunkKeepoutFor(kind);
  const cx = Math.round(x / CELL_PIXELS + (field.width - 1) / 2);
  const cz = Math.round(z / CELL_PIXELS + (field.height - 1) / 2);
  let nx = 0;
  let nz = 0;
  let best = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cellX = cx + dx;
      const cellZ = cz + dz;
      if (cellX < 0 || cellZ < 0 || cellX >= field.width || cellZ >= field.height) continue;
      if (!isTreeCell(field, cellX, cellZ)) continue;
      const c = cellCenterWorld(field, cellX, cellZ);
      const ox = x - c.x;
      const oz = z - c.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < best) {
        best = d2;
        nx = c.x;
        nz = c.z;
      }
    }
  }
  let hx = x - nx;
  let hz = z - nz;
  const d = Math.hypot(hx, hz);
  if (d > 1e-6) {
    hx /= d;
    hz /= d;
  } else {
    hx = 1;
    hz = 0;
  }
  for (let step = keepout + 0.5; step <= keepout + 64.5; step += 2) {
    const px = x + hx * step;
    const pz = z + hz * step;
    if (!trunkBlockedAt(field, px, pz, kind)) return { x: px, z: pz };
  }
  return { x: x + hx * (keepout + 0.5), z: z + hz * (keepout + 0.5) };
}

/** Feature word at a cell, or 0xffff (empty) when out of bounds / unknown. */
function featureWord(field: SeatField, cellX: number, cellZ: number): number {
  if (!field.features) return 0xffff;
  if (cellX < 0 || cellZ < 0 || cellX >= field.width || cellZ >= field.height) return 0xffff;
  return field.features[cellZ * field.width + cellX] ?? 0xffff;
}

/**
 * Vegetation/rock drag at world (x, z): the destination cell plus its 8
 * neighbours are probed, so a hull threading between trunks still labours
 * under the canopy overhang. Any rock/metal nearby reads `ROCK_DRAG`, else
 * any tree reads `TREE_DRAG`, else 1. Feature-less fields return 1 exactly,
 * keeping terrain-less history byte-identical.
 */
export function featureDrag(field: SeatField, x: number, z: number): number {
  if (!field.features) return 1;
  const cx = Math.round(x / CELL_PIXELS + (field.width - 1) / 2);
  const cz = Math.round(z / CELL_PIXELS + (field.height - 1) / 2);
  let trees = false;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const word = featureWord(field, cx + dx, cz + dz);
      if (word >= 3 && word <= 5) return ROCK_DRAG;
      if (word <= 2) trees = true;
    }
  }
  return trees ? TREE_DRAG : 1;
}

/**
 * Speed fraction for a drive step: slope drag (linear from 1 on the flat to
 * `ROUGH_SLOPE_FLOOR` at the steepest still-walkable grade, from the
 * bilinear rise over the step) times the destination's `featureDrag`.
 * Returns exactly 1 on flat open ground, so flat-field behavior matches
 * terrain-less stepping bit for bit. Uphill and downhill drag equally —
 * the hull labours over the grade either way.
 */
export function terrainSpeedScale(
  field: SeatField,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): number {
  const dist = Math.hypot(toX - fromX, toZ - fromZ);
  if (!(dist > 0)) return 1;
  const grade =
    Math.abs(sampleHeightBilinear(field, toX, toZ) - sampleHeightBilinear(field, fromX, fromZ)) / dist;
  const ratio = Math.min(Math.max(grade / MAX_DRIVE_GRADE, 0), 1);
  return (1 - (1 - ROUGH_SLOPE_FLOOR) * ratio) * featureDrag(field, toX, toZ);
}
