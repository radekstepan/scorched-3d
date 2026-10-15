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
  /**
   * Deterministic 0..1 variant for the decal's irregular edge (anisotropic
   * squash + texture rotation). Resolved from position when absent so older
   * marks without one still render deterministically.
   */
  seed?: number;
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
 * Graduated collateral damage: trees burn through timed states instead of
 * popping straight to stumps, and rocks chip through damage levels.
 *
 * Tree pipeline: intact → burning (flame + smoke, timed) → smouldering
 * (smoke only, charred crown, timed) → terminal: toppled (knocked on its
 * side), stump (blast-shorn), or snag (charred standing trunk). Terminal
 * states persist for the session like scorch marks. A blast flattens trees
 * near its core (topple/stump/snag immediately) and ignites the fringe;
 * fringe fires can spread a short distance to intact neighbours before they
 * burn out, so damage reads as a graduated burn scar, not a binary hole.
 *
 * Rock pipeline: intact(0) → chipped(1) → cracked/displaced(2) →
 * buried rubble(3). Blasts near the core deal two levels, the fringe one.
 *
 * All state lives in a caller-owned DamageField indexed by feature id, so
 * exaggeration re-snaps (which only re-seat Y poses) trivially preserve it.
 * Flame/smoke meshes are transient views derived from the field each frame;
 * the field itself is never cleared by clearTransients — only by regen.
 */

/** Tree damage state; terminal states (toppled/stump/snag) persist. */
export type TreeDamage = "intact" | "burning" | "smouldering" | "toppled" | "stump" | "snag";

/** Rock damage level: intact → chipped → cracked/displaced → buried. */
export type RockDamage = 0 | 1 | 2 | 3;

/** Seconds a tree burns with open flame before collapsing to smoulder. */
export const BURN_DURATION = 6;
/** Seconds a tree smoulders before resolving to a terminal state. */
export const SMOULDER_DURATION = 8;
/** Perf cap: concurrent burning trees (flame instances + light kicks). */
export const MAX_FIRES = 24;
/** Perf cap: concurrent smoke puffs (burning + smouldering, view only). */
export const MAX_SMOKE = 48;
/** Fringe fires spread only to intact neighbours within this world distance. */
export const FIRE_SPREAD_RADIUS = 70;
/** Per-second ignition probability per eligible burning→intact pair. */
export const SPREAD_RATE = 0.15;
/** Blast fraction inside which trees flatten instantly instead of igniting. */
export const TOPPLE_FRACTION = 0.45;
/** A burning tree must age this long before it can spread fire. */
export const SPREAD_MIN_AGE = 2;

/** Caller-owned graduated damage state, indexed by feature id. */
export interface DamageField {
  trees: TreeDamage[];
  /** Seconds spent in the current timed state (burning/smouldering). */
  treeAge: number[];
  rocks: RockDamage[];
}

/** Fresh all-intact damage state for `treeCount` trees and `rockCount` rocks. */
export function createDamageField(treeCount: number, rockCount: number): DamageField {
  return {
    trees: Array<TreeDamage>(Math.max(treeCount, 0)).fill("intact"),
    treeAge: new Array<number>(Math.max(treeCount, 0)).fill(0),
    rocks: Array<RockDamage>(Math.max(rockCount, 0)).fill(0),
  };
}

/** Currently burning tree count (bounded by MAX_FIRES via igniteTree). */
export function burningCount(field: DamageField): number {
  let n = 0;
  for (const s of field.trees) if (s === "burning") n++;
  return n;
}

/** Terminal tree states persist: never transitioned by ticks or blasts. */
export function isTerminalTree(state: TreeDamage): boolean {
  return state === "toppled" || state === "stump" || state === "snag";
}

/** Roll a terminal successor: blast-flattened or burnt-out. */
export function resolveTerminal(rng: () => number): "toppled" | "stump" | "snag" {
  const r = rng();
  if (r < 0.4) return "toppled";
  if (r < 0.75) return "stump";
  return "snag";
}

/**
 * Ignite an intact tree. When at the MAX_FIRES cap the oldest burning tree
 * is fast-forwarded to smouldering (eviction) so new fringe ignitions still
 * read while the flame-instance budget holds. Returns true when lit.
 */
export function igniteTree(field: DamageField, index: number): boolean {
  if (index < 0 || index >= field.trees.length) return false;
  if (field.trees[index] !== "intact") return false;
  if (burningCount(field) >= MAX_FIRES) {
    // Evict the longest-burning tree into smoulder; state (not visuals).
    let oldest = -1;
    let oldestAge = -1;
    for (let i = 0; i < field.trees.length; i++) {
      if (field.trees[i] === "burning" && field.treeAge[i]! > oldestAge) {
        oldestAge = field.treeAge[i]!;
        oldest = i;
      }
    }
    if (oldest < 0) return false;
    field.trees[oldest] = "smouldering";
    field.treeAge[oldest] = 0;
  }
  field.trees[index] = "burning";
  field.treeAge[index] = 0;
  return true;
}

export interface TreeBlastResult {
  /** Indices flattened instantly (terminal states). */
  flattened: number[];
  /** Indices newly ignited (fringe + spread seeds). */
  ignited: number[];
}

/**
 * Apply a blast to trees: inside TOPPLE_FRACTION of the radius trees
 * flatten immediately to a terminal state; the fringe ignites (cap-aware).
 * Terminal trees are never re-touched. Mutates `field` in place; the
 * renderer re-poses only the returned indices (no full-buffer rewrite).
 */
export function applyBlastToTrees(
  field: DamageField,
  points: readonly BlastPoint[],
  cx: number,
  cz: number,
  radius: number,
  rng: () => number,
  cap: number = MAX_FELLED_PER_BLAST,
): TreeBlastResult {
  const result: TreeBlastResult = { flattened: [], ignited: [] };
  for (const i of indicesInBlast(points, cx, cz, radius, cap)) {
    if (i >= field.trees.length) continue;
    if (field.trees[i] !== "intact" && field.trees[i] !== "burning") continue;
    const p = points[i]!;
    const dist = Math.hypot(p.x - cx, p.z - cz);
    if (dist <= radius * TOPPLE_FRACTION) {
      field.trees[i] = resolveTerminal(rng);
      field.treeAge[i] = 0;
      result.flattened.push(i);
    } else if (field.trees[i] === "intact") {
      if (igniteTree(field, i)) result.ignited.push(i);
    }
  }
  return result;
}

/**
 * Apply a blast to rocks: the inner half-radius deals two damage levels
 * (chip → buried), the fringe one. Clamped at buried(3). Mutates in place.
 */
export function applyBlastToRocks(
  field: DamageField,
  points: readonly BlastPoint[],
  cx: number,
  cz: number,
  radius: number,
  cap: number = MAX_FELLED_PER_BLAST,
): number[] {
  const changed: number[] = [];
  for (const i of indicesInBlast(points, cx, cz, radius, cap)) {
    if (i >= field.rocks.length) continue;
    const level = field.rocks[i]!;
    if (level >= 3) continue;
    const p = points[i]!;
    const dist = Math.hypot(p.x - cx, p.z - cz);
    const next = Math.min(3, level + (dist <= radius * 0.5 ? 2 : 1)) as RockDamage;
    if (next !== level) {
      field.rocks[i] = next;
      changed.push(i);
    }
  }
  return changed;
}

export interface DamageEvents {
  /** Newly ignited by spread this tick (blast ignitions return separately). */
  ignited: number[];
  /** Burning → smouldering transitions. */
  enteredSmoulder: number[];
  /** Smouldering → terminal resolutions. */
  resolved: { index: number; terminal: "toppled" | "stump" | "snag" }[];
}

/**
 * Advance timed damage states by `dt` seconds. Burning trees age into
 * smoulder; smouldering trees resolve to a rolled terminal state; burning
 * trees older than SPREAD_MIN_AGE may ignite intact neighbours inside
 * FIRE_SPREAD_RADIUS at SPREAD_RATE per pair per second (cap-aware, so
 * spread never exceeds the flame budget). Mutates `field` in place.
 */
export function tickDamage(
  field: DamageField,
  treePoints: readonly BlastPoint[],
  dt: number,
  rng: () => number,
): DamageEvents {
  const events: DamageEvents = { ignited: [], enteredSmoulder: [], resolved: [] };
  if (!(dt > 0)) return events;
  for (let i = 0; i < field.trees.length; i++) {
    const state = field.trees[i]!;
    if (state === "burning") {
      field.treeAge[i] = field.treeAge[i]! + dt;
      if (field.treeAge[i]! >= BURN_DURATION) {
        field.trees[i] = "smouldering";
        field.treeAge[i] = 0;
        events.enteredSmoulder.push(i);
      }
    } else if (state === "smouldering") {
      field.treeAge[i] = field.treeAge[i]! + dt;
      if (field.treeAge[i]! >= SMOULDER_DURATION) {
        const terminal = resolveTerminal(rng);
        field.trees[i] = terminal;
        field.treeAge[i] = 0;
        events.resolved.push({ index: i, terminal });
      }
    }
  }
  // Fringe spread: old-enough fires seed intact neighbours. Distance first
  // (cheap reject), rng only on candidates, so quiet ticks cost no entropy.
  const r2 = FIRE_SPREAD_RADIUS * FIRE_SPREAD_RADIUS;
  const p = Math.min(SPREAD_RATE * dt, 1);
  for (let i = 0; i < field.trees.length; i++) {
    if (field.trees[i] !== "burning" || field.treeAge[i]! < SPREAD_MIN_AGE) continue;
    const src = treePoints[i];
    if (!src) continue;
    for (let j = 0; j < field.trees.length; j++) {
      if (field.trees[j] !== "intact") continue;
      const dst = treePoints[j];
      if (!dst) continue;
      const dx = dst.x - src.x;
      const dz = dst.z - src.z;
      if (dx * dx + dz * dz > r2) continue;
      if (rng() < p && igniteTree(field, j)) events.ignited.push(j);
    }
  }
  return events;
}
/**
 * Append a scorch mark, evicting the oldest when at cap. Pure: returns a new
 * array, never mutates the input. Marks persist for the session (no decay).
 */
export function addScorchMark(marks: ScorchMark[], mark: ScorchMark): ScorchMark[] {
  if (marks.length >= MAX_SCORCH_MARKS) return [...marks.slice(1), mark];
  return [...marks, mark];
}

/**
 * Believable blast scorch: a charred center fading to a scorched rim with an
 * irregular (wobbling, non-circular) edge, plus a tiny terrain dent. The old
 * flat brown disc read as mud because it was one solid tone with a hard
 * circular silhouette; the renderer bakes the two-tone gradient + wobble into
 * a shared texture, tints per-mark from `scorchDisplayRGB`, squashes each
 * mark elliptically from its seed, and dents the visual heightfield only.
 * Pathing and unit seating read the static core heightfield, so scorch and
 * craters stay purely visual and can never trap a unit.
 */

/** Charred center of the baked scorch gradient (sRGB 0..1, near-black warm). */
export const SCORCH_CORE_RGB: [number, number, number] = [0.09, 0.066, 0.047];
/** Scorched rim of the baked scorch gradient (sRGB 0..1, dark burnt brown). */
export const SCORCH_RIM_RGB: [number, number, number] = [0.29, 0.18, 0.11];

/**
 * Per-mark brightness multiplier from blast intensity: heavier shells scar
 * darker. Multiplies the baked texture, so the charred-center gradient keeps
 * its shape while kinds still read differently.
 */
export function scorchShade(intensity: number): number {
  const clamped = Math.min(Math.max(intensity, 0), 1);
  return 1 - clamped * 0.3;
}

/**
 * Effective displayed center color of a scorch mark (baked char core times
 * the per-mark shade), for contrast policy + tests. Red > green > blue:
 * burnt ground, not mud.
 */
export function scorchDisplayRGB(intensity: number): [number, number, number] {
  const s = scorchShade(intensity);
  return [SCORCH_CORE_RGB[0]! * s, SCORCH_CORE_RGB[1]! * s, SCORCH_CORE_RGB[2]! * s];
}

/**
 * Deterministic 0..1 variant seed from a blast position (integer hash, no
 * trig/rng — stable across sessions and replays).
 */
export function scorchSeed(x: number, z: number): number {
  const xi = Math.floor(x * 13.7 + 0.5);
  const zi = Math.floor(z * 7.3 + 0.5);
  let h = (xi * 374761393 + zi * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  h = (h ^ (h >> 16)) >>> 0;
  return (h % 100000) / 100000;
}

/** Seed of a mark, falling back to the position hash when absent. */
export function resolveScorchSeed(mark: ScorchMark): number {
  return typeof mark.seed === "number" ? mark.seed : scorchSeed(mark.x, mark.z);
}

/**
 * Elliptical squash for a mark's silhouette from its seed: +14% along one
 * axis, −14% along the other (area-preserving, so radii stay comparable).
 * Combined with per-mark rotation, no two blotches share a silhouette.
 */
export function scorchAnisotropy(seed: number): [number, number] {
  const clamped = Math.min(Math.max(seed, 0), 1);
  const d = (clamped - 0.5) * 0.28;
  return [1 + d, 1 - d];
}

/** Deepest a single blast dents the visual heightfield (pre-exaggeration height units). */
export const MAX_CRATER_DEPTH = 1.0;
/** Cap on accumulated dent at one spot (overlapping bowls never dig a pit). */
export const MAX_CRATER_TOTAL = 2.0;

/**
 * Dent depth for a blast intensity: hammer shells dig the full 1.0 height
 * unit (~2 world units at the default exaggeration — a shallow bowl, not a
 * pit), lighter bolts barely dimple the ground.
 */
export function craterDepthForIntensity(intensity: number): number {
  const clamped = Math.min(Math.max(intensity, 0), 1);
  return 0.25 + clamped * 0.75;
}

/** Smooth bowl profile: 1 at ground zero, 0 past the rim (t = dist/radius). */
export function craterFalloff(t: number): number {
  if (!(t < 1)) return 0;
  if (!(t > 0)) return 1;
  const u = 1 - t * t;
  return u * u;
}

export interface Crater {
  x: number;
  z: number;
  radius: number;
  /** Dent depth in pre-exaggeration height units. */
  depth: number;
}

/**
 * Total visual dent at world (x, z) from nearby blast bowls, capped so
 * overlapping impacts never dig a pit. Pure + deterministic; feeds the
 * renderer mesh displacement and scorch seating only — never pathing.
 */
export function craterDepthAt(craters: readonly Crater[], x: number, z: number): number {
  let total = 0;
  for (const c of craters) {
    if (!(c.radius > 0) || !(c.depth > 0)) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const t = Math.sqrt(dx * dx + dz * dz) / c.radius;
    const f = craterFalloff(t);
    if (f > 0) total += c.depth * f;
  }
  return Math.min(total, MAX_CRATER_TOTAL);
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
