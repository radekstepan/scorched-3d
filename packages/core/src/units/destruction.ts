import type { UnitKind } from "./types.js";

/**
 * Persistent environment destruction from fire/explosions.
 * Framework-free (no three.js): the web renderer owns the visuals while all
 * state transitions live here so vitest can cover them without WebGL.
 *
 * Nanolathe parallels (adapted, no retail assets):
 * - `internal/platform/gpurender/scorch*` keeps fading scorch quads as a
 *   bounded ground-effect layer (cross kind 1 = scorch in
 *   `retained_effect_types.go`); here scorch marks are a bounded world-space
 *   list with oldest-eviction instead of a GPU quad buffer.
 * - `research/retail-executable-spec/05-*.md` §feature definition: live
 *   features carry damage and resolve to burnt/dead successors; here a blast
 *   fells nearby tree/rock instances into stumps/rubble (no per-feature HP
 *   — one blast inside the radius fells, outside it spares).
 */

/** A persistent scorch/crater decal: world X/Z, radius, and darkness. */
export interface ScorchMark {
  x: number;
  z: number;
  /** Decal radius in world units. */
  radius: number;
  /** Darkness 0..1 (higher = blacker). */
  intensity: number;
}

/** Perf cap: persistent scorch decals (separate from shot/explosion caps). */
export const MAX_SCORCH_MARKS = 48;
/** Perf cap: features felled by a single blast. */
export const MAX_FELLED_PER_BLAST = 12;

/** Blast radius in world units: artillery scars widest, bolts local. */
export const BLAST_RADIUS: Record<UnitKind, number> = {
  flash: 44,
  stump: 52,
  hammer: 80,
  commander: 60,
};

/** Scorch decal size/darkness per firing kind: shells scar big and black. */
export function scorchForKind(kind: UnitKind): { radius: number; intensity: number } {
  switch (kind) {
    case "hammer":
      return { radius: 46, intensity: 0.8 };
    case "commander":
      return { radius: 34, intensity: 0.7 };
    case "stump":
      return { radius: 28, intensity: 0.6 };
    case "flash":
      return { radius: 24, intensity: 0.55 };
  }
}

/**
 * Append a scorch mark, evicting the oldest when at cap. Pure: returns a new
 * array, never mutates the input. Marks persist for the session (no decay).
 */
export function addScorchMark(marks: ScorchMark[], mark: ScorchMark): ScorchMark[] {
  if (marks.length >= MAX_SCORCH_MARKS) return [...marks.slice(1), mark];
  return [...marks, mark];
}

export interface BlastPoint {
  x: number;
  z: number;
}

/**
 * Indices of points within `radius` of (`cx`, `cz`), in ascending order,
 * capped at `cap` entries (nearest first when capped). Pure helper used to
 * pick which tree/rock instances a blast fells.
 */
export function indicesInBlast(
  points: readonly BlastPoint[],
  cx: number,
  cz: number,
  radius: number,
  cap: number = MAX_FELLED_PER_BLAST,
): number[] {
  if (!(radius > 0) || cap <= 0) return [];
  const r2 = radius * radius;
  const scored: { index: number; d2: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 <= r2) scored.push({ index: i, d2 });
  }
  scored.sort((a, b) => a.d2 - b.d2 || a.index - b.index);
  return scored.slice(0, cap).map((s) => s.index);
}
