import { CELL_PIXELS } from "../terrain/types.js";
import { findCellPath, pathCellToWorld, pathWorldToCell, smoothCellPath } from "./pathfinding.js";
import type { PathPoint } from "./pathfinding.js";
import type { SeatField } from "./terrain.js";

/** Bounded recovery search: keep a chosen side of a small terrain obstacle.
 * Like nanolathe's published routes, these points persist until consumed;
 * choosing a new escape heading every frame makes symmetric obstacles chatter.
 * Large barriers still use the driver's existing hold/skip policy.
 */
export function terrainDetour(field: SeatField, from: PathPoint, target: PathPoint): PathPoint[] | null {
  const center = pathWorldToCell(field, from.x, from.z);
  const radius = 10;
  const minX = Math.max(0, center.cellX - radius);
  const minZ = Math.max(0, center.cellZ - radius);
  const width = Math.min(field.width - 1, center.cellX + radius) - minX + 1;
  const height = Math.min(field.height - 1, center.cellZ + radius) - minZ + 1;
  const heights = new Uint8Array(width * height);
  const features = field.features ? new Uint16Array(width * height) : undefined;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const source = (z + minZ) * field.width + x + minX;
      heights[z * width + x] = field.heights[source]!;
      if (features) features[z * width + x] = field.features![source] ?? 0xffff;
    }
  }
  const grid = { width, height, heights, seaLevel: field.seaLevel, features };
  const distance = Math.hypot(target.x - from.x, target.z - from.z);
  const fraction = Math.min(1, (6 * CELL_PIXELS) / distance);
  const goal = pathWorldToCell(field, from.x + (target.x - from.x) * fraction, from.z + (target.z - from.z) * fraction);
  const cells = findCellPath(grid,
    { cellX: center.cellX - minX, cellZ: center.cellZ - minZ },
    { cellX: goal.cellX - minX, cellZ: goal.cellZ - minZ });
  if (!cells || cells.length < 2) return null;
  // Retain the start center: retreating a few units before rounding a corner
  // gives a hull pinned at a cell boundary room to turn safely.
  return smoothCellPath(grid, cells).map((c) => pathCellToWorld(field,
    { cellX: c.cellX + minX, cellZ: c.cellZ + minZ }));
}
