// Initial camera pose: start behind a command unit, outside the map looking in.
//
// Pure, framework-free pose computation: given the placed units and the map
// dimensions, pick the start unit (first commander, else the first unit, else
// the map center) and put the camera on the ray from the map center through
// the unit, past the map edge, looking back inward. Kept free of three.js so
// it stays unit-testable in a node environment, mirroring cameraPan.ts.

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
 * Camera height above the start anchor's ground, as a fraction of the larger
 * map dimension. For the standard 160x128 map (2544 world units wide) this is
 * ~636, matching the previous hard-coded eye height.
 */
export const START_HEIGHT_FACTOR = 0.25;
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
  if (!unit) return field.seaLevel * exaggeration;
  return cellGround(field, unit.cellX, unit.cellZ) * exaggeration;
}

function cellToWorldX(field: StartField, cellX: number, cellSize: number): number {
  return (cellX - (field.width - 1) / 2) * cellSize;
}

function cellToWorldZ(field: StartField, cellZ: number, cellSize: number): number {
  return (cellZ - (field.height - 1) / 2) * cellSize;
}

/**
 * Compute the initial camera pose for a map. The orbit target sits on the
 * start unit's ground anchor; the camera sits further out along the
 * center-through-unit ray, past the map edge, so the opening frame looks
 * through the commander toward the map interior. With no units the target is
 * the map center and the camera sits south of the edge.
 */
export function commanderCameraPose(
  field: StartField,
  exaggeration: number,
  cellSize: number = START_CELL_PIXELS,
): CameraPose {
  const worldW = (field.width - 1) * cellSize;
  const worldD = (field.height - 1) * cellSize;
  const height = Math.max(worldW, worldD) * START_HEIGHT_FACTOR;
  const unit = pickStartUnit(field.units);

  if (!unit) {
    const y = field.seaLevel * exaggeration;
    return {
      target: { x: 0, y, z: 0 },
      position: { x: 0, y: y + height, z: worldD / 2 + START_BEYOND_EDGE },
    };
  }

  const ux = cellToWorldX(field, unit.cellX, cellSize);
  const uz = cellToWorldZ(field, unit.cellZ, cellSize);
  const uy = cellGround(field, unit.cellX, unit.cellZ) * exaggeration;

  let dx = ux;
  let dz = uz;
  let len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    // Unit dead center: default to looking in from the south.
    dx = 0;
    dz = 1;
    len = 1;
  }
  dx /= len;
  dz /= len;

  // Ray parameter where center + dir*t exits the map rectangle.
  const hw = worldW / 2;
  const hd = worldD / 2;
  const tx = Math.abs(dx) < 1e-9 ? Infinity : hw / Math.abs(dx);
  const tz = Math.abs(dz) < 1e-9 ? Infinity : hd / Math.abs(dz);
  const tEdge = Math.min(tx, tz);
  const tCam = tEdge + START_BEYOND_EDGE;

  return {
    target: { x: ux, y: uy, z: uz },
    position: { x: dx * tCam, y: uy + height, z: dz * tCam },
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
