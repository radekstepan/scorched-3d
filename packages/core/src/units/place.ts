import { CELL_PIXELS, FEATURE_EMPTY } from "../terrain/types.js";
import { mulberry32 } from "../terrain/noise.js";
import { TEAM_IDS, UNIT_KINDS, type PlacedUnit, type TeamId, type UnitKind } from "./types.js";

/** Demo roster size: a couple of units per side, two sides. */
export const UNIT_COUNT = 6;
/** Sides in the demo battle (Blue west, Orange east). */
export const TEAM_COUNT = TEAM_IDS.length;
/** Keep units away from the map edge so they never clip the skirt. */
const MARGIN = 8;
/** Strict placement wants open, flat, unoccupied ground. */
const STRICT_SLOPE = 12;
const STRICT_SEPARATION = 18;
/**
 * Relaxed pass still guarantees *drivable* land: it tolerates slopes up to
 * the shared climb gate, never above it, so a spawn always sits on ground
 * its hull may legally stand on.
 */
const RELAXED_SLOPE = 15;
const RELAXED_SEPARATION = 10;

/** Minimal heightfield view shared by generateMap and the tests. */
export interface UnitField {
  heights: Uint8Array;
  features: Uint16Array;
  width: number;
  height: number;
  seaLevel: number;
}

/**
 * Which side roster slot `index` fights for: the first half of the roster
 * musters west (team 0), the rest east (team 1). Even rosters split exactly
 * (3v3 at the default size); an odd tail slot joins the east so no hull ever
 * goes unassigned.
 */
export function teamOf(index: number, count: number): TeamId {
  if (!Number.isInteger(index) || index < 0) return 0;
  if (!Number.isInteger(count) || count <= 0) return 0;
  return index < Math.ceil(count / 2) ? 0 : 1;
}

/**
 * Deterministically place `count` units on dry land. The first four slots
 * cover every unit kind (shuffled), the rest are drawn at random, so every
 * regen shows a readable mix. Teams muster on opposite halves (west/east,
 * split at the middle column) so the skirmish opens across the map and the
 * hunt AI has room to close. A strict pass searches for flat, separated,
 * unoccupied cells; a relaxed pass loosens slope/separation; a scoring
 * fallback always returns a cell so the roster is never short.
 */
export function placeUnits(field: UnitField, seed: number, count = UNIT_COUNT): PlacedUnit[] {
  const rng = mulberry32((seed ^ 0x9e37) >>> 0);
  const roster = buildRoster(rng, count);
  const placed: PlacedUnit[] = [];
  roster.forEach((kind, i) => {
    placed.push(dropUnit(field, rng, kind, teamOf(i, roster.length), placed));
  });
  return placed;
}

function buildRoster(rng: () => number, count: number): UnitKind[] {
  const shuffled = [...UNIT_KINDS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const roster: UnitKind[] = shuffled.slice(0, Math.min(count, shuffled.length));
  while (roster.length < count) {
    roster.push(shuffled[Math.floor(rng() * shuffled.length)] ?? "flash");
  }
  return roster;
}

function dropUnit(
  field: UnitField,
  rng: () => number,
  kind: UnitKind,
  team: TeamId,
  placed: PlacedUnit[],
): PlacedUnit {
  const [x0, x1] = teamSpan(field.width, team);
  const strict = tryDrop(field, rng, kind, team, placed, 220, STRICT_SLOPE, STRICT_SEPARATION, true, x0, x1);
  if (strict) return strict;
  const relaxed = tryDrop(field, rng, kind, team, placed, 220, RELAXED_SLOPE, RELAXED_SEPARATION, false, x0, x1);
  if (relaxed) return relaxed;
  return fallbackDrop(field, rng, kind, team, x0, x1);
}

/**
 * Column span a team may muster in: the map split at the middle column with
 * a 2-cell demilitarized gap, so the sides never spawn intermingled. Team 0
 * takes the west half, team 1 the east half.
 */
export function teamSpan(width: number, team: TeamId): [number, number] {
  const mid = Math.floor(width / 2);
  return team === 0 ? [MARGIN, Math.max(MARGIN, mid - 2)] : [Math.min(width - MARGIN, mid + 2), width - MARGIN];
}

function tryDrop(
  field: UnitField,
  rng: () => number,
  kind: UnitKind,
  team: TeamId,
  placed: PlacedUnit[],
  attempts: number,
  maxSlope: number,
  minSeparation: number,
  requireEmpty: boolean,
  x0: number,
  x1: number,
): PlacedUnit | null {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  for (let n = 0; n < attempts; n++) {
    const cellX = lo + Math.floor(rng() * (hi - lo + 1));
    const cellZ = MARGIN + Math.floor(rng() * (field.height - MARGIN * 2));
    if (!isDry(field, cellX, cellZ)) continue;
    if (cellSlope(field, cellX, cellZ) > maxSlope) continue;
    if (requireEmpty && field.features[cellZ * field.width + cellX] !== FEATURE_EMPTY) continue;
    if (!isSeparated(cellX, cellZ, placed, minSeparation)) continue;
    return { kind, team, cellX, cellZ, rotation: rng() * Math.PI * 2 };
  }
  return null;
}

/** Last resort: the highest dry cell sampled, preferring unoccupied ground. */
function fallbackDrop(
  field: UnitField,
  rng: () => number,
  kind: UnitKind,
  team: TeamId,
  x0: number,
  x1: number,
): PlacedUnit {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  const homeX = Math.min(Math.max((lo + hi) >> 1, 0), field.width - 1);
  let best = { cellX: homeX, cellZ: field.height >> 1, score: -Infinity };
  for (let n = 0; n < 300; n++) {
    const cellX = lo + Math.floor(rng() * (hi - lo + 1));
    const cellZ = MARGIN + Math.floor(rng() * (field.height - MARGIN * 2));
    const h = field.heights[cellZ * field.width + cellX] ?? 0;
    if (h <= field.seaLevel) continue;
    const empty = field.features[cellZ * field.width + cellX] === FEATURE_EMPTY;
    const score = h - cellSlope(field, cellX, cellZ) * 2 + (empty ? 1000 : 0);
    if (score > best.score) best = { cellX, cellZ, score };
  }
  return { kind, team, cellX: best.cellX, cellZ: best.cellZ, rotation: rng() * Math.PI * 2 };
}

function isDry(field: UnitField, x: number, z: number): boolean {
  return (field.heights[z * field.width + x] ?? 0) > field.seaLevel + 4;
}

function isSeparated(x: number, z: number, placed: PlacedUnit[], min: number): boolean {
  return placed.every((u) => Math.hypot(u.cellX - x, u.cellZ - z) >= min);
}

function cellSlope(field: UnitField, x: number, z: number): number {
  const h00 = field.heights[z * field.width + x] ?? 0;
  const h10 = field.heights[z * field.width + Math.min(field.width - 1, x + 1)] ?? 0;
  const h01 = field.heights[Math.min(field.height - 1, z + 1) * field.width + x] ?? 0;
  return Math.max(h00, h10, h01) - Math.min(h00, h10, h01);
}

export interface WorldAnchor {
  x: number;
  y: number;
  z: number;
}

/**
 * World-space anchor for a unit: grid-to-world mapping from the terrain mesh
 * (Y-up, +Z south), with Y snapped to the corner height times the current
 * height exaggeration. The renderer re-evaluates this when the slider moves.
 */
export function unitAnchor(field: UnitField, unit: PlacedUnit, exaggeration: number): WorldAnchor {
  return {
    x: (unit.cellX - (field.width - 1) / 2) * CELL_PIXELS,
    y: (field.heights[unit.cellZ * field.width + unit.cellX] ?? 0) * exaggeration,
    z: (unit.cellZ - (field.height - 1) / 2) * CELL_PIXELS,
  };
}
