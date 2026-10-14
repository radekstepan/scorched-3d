import { CELL_PIXELS } from "../terrain/types.js";
import type { UnitField } from "./place.js";
import { isWalkable, PATH_MAX_SLOPE } from "./pathfinding.js";
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

function clampTilt(v: number): number {
  const c = v < -MAX_HULL_TILT ? -MAX_HULL_TILT : v > MAX_HULL_TILT ? MAX_HULL_TILT : v;
  // Normalize -0 (from -atan2 on flat ground) so flat poses read exactly 0.
  return c + 0;
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
 * True when a hull must not step from (fromX, fromZ) to (toX, toZ): the
 * destination cell is unwalkable (water/steep, the same gate pathfinding
 * uses) or the raw point-to-point grade exceeds what the gate tolerates.
 * A blocked mover holds position and keeps turning toward its target
 * (retail's blocked-mover behavior) instead of clipping into the slope.
 */
export function stepBlocked(
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
