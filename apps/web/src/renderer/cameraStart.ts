// Initial camera pose: start due south of a command unit, outside the map
// looking north in at the sibling RTS elevation.
//
// Pure, framework-free pose computation: given the placed units and the map
// dimensions, pick the start unit (first commander, else the first unit, else
// the map center) and put the camera due south of it, past the south map
// edge, looking north. The fixed south-behind yaw matches the minimap
// orientation (u left→right is world −X→+X, v top→bottom is world −Z→+Z),
// so minimap-right pans the main view right from the opening frame, and the
// elevation matches the "RTS" study from the sibling
// redesign-stumpy-tank-model viewer (Battlefield scale / GAMEPLAY
// READABILITY). Kept free of three.js so it stays unit-testable in a node
// environment, mirroring cameraPan.ts.
import { worldHeight } from "@scorched-3d/core";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface StartUnit {
  kind: string;
  cellX: number;
  cellZ: number;
}

export interface StartField {
  width: number;
  height: number;
  heights: ArrayLike<number>;
  seaLevel: number;
  units: StartUnit[];
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

/** World units past the map edge the start camera sits. */
export const START_BEYOND_EDGE = 350;
/**
 * Sibling "RTS" camera offset off its focus, taken verbatim from
 * `POSES.rts` in redesign-stumpy-tank-model's `src/viewer.ts`:
 * `rts: { position: [116, 165, 146], target: [0, 0, 0] }`.
 */
export const RTS_VIEW_OFFSET = { x: 116, y: 165, z: 146 } as const;
/**
 * Opening-frame elevation angle above the horizon (radians), derived from
 * the sibling RTS offset: atan(165 / hypot(116, 146)) ≈ 41.5°.
 *
 * Only the elevation transfers. The viewer's southeast yaw is a
 * single-model 3/4 framing with no compass meaning, while the game's
 * due-south yaw matches the minimap orientation (task 139) — so the
 * opening frame keeps its yaw and gains the RTS pitch instead.
 */
export const RTS_ELEVATION = Math.atan2(
  RTS_VIEW_OFFSET.y,
  Math.hypot(RTS_VIEW_OFFSET.x, RTS_VIEW_OFFSET.z),
);
/** World units per attribute cell (matches core CELL_PIXELS; kept local). */
export const START_CELL_PIXELS = 16;

/**
 * Pick the unit the camera starts behind: the first commander in roster
 * order, falling back to the first unit of any kind, then null when the map
 * has no units. Roster order is seeded, so this is deterministic per map
 * seed.
 */
export function pickStartUnit<T extends StartUnit>(units: readonly T[]): T | null {
  if (units.length === 0) return null;
  return units.find((u) => u.kind === "commander") ?? units[0] ?? null;
}

/** Ground height (before exaggeration lift) under a cell. */
export function cellGround(field: StartField, cellX: number, cellZ: number): number {
  const x = Math.min(field.width - 1, Math.max(0, Math.round(cellX)));
  const z = Math.min(field.height - 1, Math.max(0, Math.round(cellZ)));
  return field.heights[z * field.width + x] ?? 0;
}

/** Exaggerated ground height of the start anchor (or sea level fallback). */
export function startGroundY(field: StartField, unit: StartUnit | null, exaggeration: number): number {
  if (!unit) return worldHeight(field.seaLevel, exaggeration);
  return worldHeight(cellGround(field, unit.cellX, unit.cellZ), exaggeration);
}

function cellToWorldX(field: StartField, cellX: number, cellSize: number): number {
  return (cellX - (field.width - 1) / 2) * cellSize;
}

function cellToWorldZ(field: StartField, cellZ: number, cellSize: number): number {
  return (cellZ - (field.height - 1) / 2) * cellSize;
}

/**
 * Compute the initial camera pose for a map. The orbit target sits on the
 * start unit's ground anchor; the camera sits due south of it, past the
 * south map edge, so the opening frame looks due north through the
 * commander toward the map interior with screen-right on world +X —
 * matching the minimap orientation — at the sibling RTS elevation above
 * the horizon. With no units the target is the map center and the camera
 * sits south of the edge (same pose family).
 */
export function commanderCameraPose(
  field: StartField,
  exaggeration: number,
  cellSize: number = START_CELL_PIXELS,
): CameraPose {
  const worldD = (field.height - 1) * cellSize;
  const camZ = worldD / 2 + START_BEYOND_EDGE;
  const unit = pickStartUnit(field.units);

  if (!unit) {
    const y = worldHeight(field.seaLevel, exaggeration);
    return {
      target: { x: 0, y, z: 0 },
      position: { x: 0, y: y + camZ * Math.tan(RTS_ELEVATION), z: camZ },
    };
  }

  const ux = cellToWorldX(field, unit.cellX, cellSize);
  const uz = cellToWorldZ(field, unit.cellZ, cellSize);
  const uy = worldHeight(cellGround(field, unit.cellX, unit.cellZ), exaggeration);

  // Due south of the anchor, past the south map edge: the anchor's X is
  // always within the map, so the camera is always outside the rectangle,
  // and the fixed yaw (looking due north) matches the minimap orientation.
  // The eye height follows the ground distance so the elevation stays at
  // the RTS angle whatever side the commander spawned on (the anchor sits
  // inside the map, so the ground run is always ≥ START_BEYOND_EDGE > 0).
  return {
    target: { x: ux, y: uy, z: uz },
    position: { x: ux, y: uy + (camZ - uz) * Math.tan(RTS_ELEVATION), z: camZ },
  };
}

/**
 * Vertical shift to apply to both camera position and orbit target when the
 * height exaggeration changes, so the view keeps its geometry while the
 * terrain re-snaps underneath. Returns the delta; callers add it to Y.
 */
export function resnapHeightDelta(
  field: StartField,
  unit: StartUnit | null,
  oldExaggeration: number,
  newExaggeration: number,
): number {
  return startGroundY(field, unit, newExaggeration) - startGroundY(field, unit, oldExaggeration);
}
