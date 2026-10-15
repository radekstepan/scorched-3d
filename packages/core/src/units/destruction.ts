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
  /**
   * Optional downhill wash (see `BlastSlope`): the renderer stretches the
   * decal down the fall line instead of stamping a flat circle. Absent
   * reads as flat.
   */
  sx?: number;
  sz?: number;
  skew?: number;
}

/** Perf cap: persistent scorch decals (separate from shot/explosion caps). */
export const MAX_SCORCH_MARKS = 48;
/** Perf cap: features felled by a single blast. */
export const MAX_FELLED_PER_BLAST = 12;

/** Blast radius in world units: artillery scars widest, bolts local. */
export const BLAST_RADIUS: Record<UnitKind, number> = {
  flash: 36,
  stump: 44,
  hammer: 64,
  commander: 48,
};

/** Scorch decal size/darkness per firing kind: shells scar big and black. */
export function scorchForKind(kind: UnitKind): { radius: number; intensity: number } {
  switch (kind) {
    case "hammer":
      return { radius: 34, intensity: 0.62 };
    case "commander":
      return { radius: 26, intensity: 0.55 };
    case "stump":
      return { radius: 22, intensity: 0.5 };
    case "flash":
      return { radius: 18, intensity: 0.45 };
  }
}

/**
 * Graduated collateral damage: trees burn through timed states instead of
 * popping straight to stumps, and rocks chip through damage levels.
 *
 * Tree pipeline: intact → burning (flame + smoke, timed) → smouldering
 * (smoke only, charred crown, timed) → terminal: toppled (knocked on its
 * side), stump (blast-shorn), or snag (charred standing trunk). Fallen trees
 * then slowly decay like husks — sinking over FALLEN_DECAY_DURATION into
 * `gone` (hidden instance) — whether blast-flattened, burnt out, or
 * hull-crushed. A blast flattens trees
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

/** Tree damage state; terminal states (toppled/stump/snag/gone) persist. */
export type TreeDamage = "intact" | "burning" | "smouldering" | "toppled" | "stump" | "snag" | "gone";

/** Rock damage level: intact → chipped → cracked/displaced → buried. */
export type RockDamage = 0 | 1 | 2 | 3;

/** Seconds a tree burns with open flame before collapsing to smoulder. */
export const BURN_DURATION = 14;
/** Seconds a tree smoulders before resolving to a terminal state. */
export const SMOULDER_DURATION = 22;
/** Perf cap: concurrent burning trees (flame instances + light kicks). */
export const MAX_FIRES = 24;
/** Perf cap: concurrent smoke puffs (burning + smouldering, view only). */
export const MAX_SMOKE = 48;
/** Fringe fires spread only to intact neighbours within this world distance. */
export const FIRE_SPREAD_RADIUS = 45;
/** Per-second ignition probability per eligible burning→intact pair. */
export const SPREAD_RATE = 0.05;
/** Blast fraction inside which trees flatten instantly instead of igniting. */
export const TOPPLE_FRACTION = 0.32;
/** A burning tree must age this long before it can spread fire. */
export const SPREAD_MIN_AGE = 6;

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
  return state === "toppled" || state === "stump" || state === "snag" || state === "gone";
}

/** Roll a terminal successor: blast-flattened or burnt-out. */
export function resolveTerminal(rng: () => number): "toppled" | "stump" | "snag" {
  const r = rng();
  if (r < 0.4) return "toppled";
  if (r < 0.75) return "stump";
  return "snag";
}

/**
 * Hull crush: a unit driving over a standing tree knocks it flat instead of
 * stopping (see `treesCrushedByStep` in `terrain.ts`). Intact and burning
 * trees both fall to `toppled` — bulldozing a burning tree puts its fire out
 * — with the fell clock (`treeAge`) restarted so the decay below measures
 * from the crush. Terminal trees (including `gone`) are never re-touched.
 * Returns true when the tree fell.
 */
export function crushTree(field: DamageField, index: number): boolean {
  if (index < 0 || index >= field.trees.length) return false;
  const state = field.trees[index]!;
  if (state !== "intact" && state !== "burning") return false;
  field.trees[index] = "toppled";
  field.treeAge[index] = 0;
  return true;
}

/**
 * Fallen-tree decay (husk-decay parallel: retail wrecks persist as
 * reclaimable corpse features; this demo has no economy, so both husks and
 * fallen trees instead sink and vanish, leaving only the scorch scar).
 * Framework-free like the rest of this module: the renderer owns the
 * sinking/hiding while every threshold lives here so vitest can cover the
 * pacing without WebGL. All state derives from `treeAge` at the terminal
 * state — seconds since the fell — so replays and exaggeration re-snaps
 * cannot disturb it.
 */

/** Seconds from the fell until a fallen tree finishes decaying. */
export const FALLEN_DECAY_DURATION = 45;
/** World units a fallen tree sinks below its fell seat when fully decayed. */
export const FALLEN_SINK_DEPTH = 6;

/**
 * Fallen-tree decay fraction 0 (fresh fall) .. 1 (fully gone) for
 * `ageSeconds` since the fell. Clamped, so negative clocks read fresh and
 * over-long clocks read gone.
 */
export function fallenDecay(ageSeconds: number): number {
  if (!(ageSeconds > 0)) return 0;
  return Math.min(ageSeconds / FALLEN_DECAY_DURATION, 1);
}

/** World units to lower a fallen tree at `decay` 0..1 (linear sink). */
export function fallenSink(decay: number): number {
  const clamped = Math.min(Math.max(decay, 0), 1);
  return clamped * FALLEN_SINK_DEPTH;
}

/** True once the fallen tree has finished decaying and may be hidden. */
export function isFallenGone(ageSeconds: number): boolean {
  return ageSeconds >= FALLEN_DECAY_DURATION;
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
 * With a wash the flatten/ignite boundary stretches downhill and shrinks
 * uphill (effective distance, not plan distance). Terminal trees are never
 * re-touched. Mutates `field` in place; the renderer re-poses only the
 * returned indices (no full-buffer rewrite).
 */
export function applyBlastToTrees(
  field: DamageField,
  points: readonly BlastPoint[],
  cx: number,
  cz: number,
  radius: number,
  rng: () => number,
  cap: number = MAX_FELLED_PER_BLAST,
  slope?: BlastSlope,
): TreeBlastResult {
  const result: TreeBlastResult = { flattened: [], ignited: [] };
  for (const i of indicesInBlast(points, cx, cz, radius, cap, slope)) {
    if (i >= field.trees.length) continue;
    if (field.trees[i] !== "intact" && field.trees[i] !== "burning") continue;
    const p = points[i]!;
    const dist = effectiveBlastDist(p.x - cx, p.z - cz, slope);
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
 * (chip → buried), the fringe one. Washed blasts chip further downhill.
 * Clamped at buried(3). Mutates in place.
 */
export function applyBlastToRocks(
  field: DamageField,
  points: readonly BlastPoint[],
  cx: number,
  cz: number,
  radius: number,
  cap: number = MAX_FELLED_PER_BLAST,
  slope?: BlastSlope,
): number[] {
  const changed: number[] = [];
  for (const i of indicesInBlast(points, cx, cz, radius, cap, slope)) {
    if (i >= field.rocks.length) continue;
    const level = field.rocks[i]!;
    if (level >= 3) continue;
    const p = points[i]!;
    const dist = effectiveBlastDist(p.x - cx, p.z - cz, slope);
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
  /** Terminal → gone decays (fallen trees finished sinking away). */
  decayed: number[];
}

/**
 * Advance timed damage states by `dt` seconds. Burning trees age into
 * smoulder; smouldering trees resolve to a rolled terminal state; burning
 * trees older than SPREAD_MIN_AGE may ignite intact neighbours inside
 * FIRE_SPREAD_RADIUS at SPREAD_RATE per pair per second (cap-aware, so
 * spread never exceeds the flame budget). Fallen (terminal, non-gone) trees
 * age from their fell toward `gone`, decaying into the ground like husks —
 * whether blast-flattened, burnt out, or hull-crushed. Mutates `field` in
 * place.
 */
export function tickDamage(
  field: DamageField,
  treePoints: readonly BlastPoint[],
  dt: number,
  rng: () => number,
): DamageEvents {
  const events: DamageEvents = { ignited: [], enteredSmoulder: [], resolved: [], decayed: [] };
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
    } else if (state === "toppled" || state === "stump" || state === "snag") {
      field.treeAge[i] = field.treeAge[i]! + dt;
      if (field.treeAge[i]! >= FALLEN_DECAY_DURATION) {
        field.trees[i] = "gone";
        field.treeAge[i] = 0;
        events.decayed.push(i);
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

/** Charred center of the baked scorch gradient (sRGB 0..1, cool charcoal). */
export const SCORCH_CORE_RGB: [number, number, number] = [0.08, 0.078, 0.086];
/** Scorched rim of the baked scorch gradient (sRGB 0..1, desaturated grey). */
export const SCORCH_RIM_RGB: [number, number, number] = [0.2, 0.185, 0.175];

/**
 * Per-mark brightness multiplier from blast intensity: heavier shells scar
 * darker. Multiplies the baked texture, so the charred-center gradient keeps
 * its shape while kinds still read differently.
 */
export function scorchShade(intensity: number): number {
  const clamped = Math.min(Math.max(intensity, 0), 1);
  return 1 - clamped * 0.22;
}

/**
 * Effective displayed center color of a scorch mark (baked char core times
 * the per-mark shade), for contrast policy + tests. Cool desaturated grey:
 * channels track within ~0.02, never saturated brown.
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
export const MAX_CRATER_DEPTH = 0.6;
/** Cap on accumulated dent at one spot (overlapping bowls never dig a pit). */
export const MAX_CRATER_TOTAL = 1.2;

/**
 * Downhill wash of a blast on graded terrain. A flat blast is circular;
 * on a gradient the same energy reaches further downhill (ejecta and the
 * fire front run with the fall line) and is cut short uphill (the rise
 * shields it) — so scorch, dents, and damage stretch downhill instead of
 * reading as a flat stamp. `sx`/`sz` is the unit downhill vector in world
 * XZ (0,0 when flat); `skew` 0 (circular) .. `MAX_BLAST_SKEW` scales the
 * asymmetry. Absent wash reads as flat, keeping old marks byte-identical.
 */
export interface BlastSlope {
  sx: number;
  sz: number;
  skew: number;
}

/** Strongest directional skew: ±45% blast reach along the fall line. */
export const MAX_BLAST_SKEW = 0.45;
/** Raw grade (rise/run) at which the wash saturates (~the drive gate). */
export const BLAST_SKEW_FULL_GRADE = 0.9;

/** Circular (flat-ground) wash: zero skew, no direction. */
export const FLAT_BLAST_SLOPE: BlastSlope = { sx: 0, sz: 0, skew: 0 };

/**
 * Directional skew for a raw terrain grade (rise over run, ≥0): linear
 * from circular on the flat to saturated past `BLAST_SKEW_FULL_GRADE`.
 * Clamped, so negative grades and absurd cliffs read as flat/full.
 */
export function blastSkewForGrade(grade: number): number {
  if (!(grade > 0)) return 0;
  return Math.min(grade / BLAST_SKEW_FULL_GRADE, 1) * MAX_BLAST_SKEW;
}

/**
 * Normalize a raw downslope sample into a `BlastSlope`: the direction is
 * unitized (degenerate/zero input reads flat) and the grade maps through
 * `blastSkewForGrade`.
 */
export function blastSlope(sx: number, sz: number, grade: number): BlastSlope {
  const skew = blastSkewForGrade(grade);
  if (!(skew > 0)) return { sx: 0, sz: 0, skew: 0 };
  const mag = Math.hypot(sx, sz);
  if (!(mag > 0)) return { sx: 0, sz: 0, skew: 0 };
  return { sx: sx / mag, sz: sz / mag, skew };
}

/**
 * Effective blast distance of the world offset (`dx`, `dz`) under a wash:
 * downhill offsets shrink (further reach), uphill offsets grow (cut short).
 * `eff = dist / (1 + skew·cosθ)` with θ to the fall line — at most ±45%,
 * and exactly `dist` when flat, so flat-field behavior is bit-identical.
 */
export function effectiveBlastDist(dx: number, dz: number, slope?: BlastSlope): number {
  const dist = Math.hypot(dx, dz);
  if (!(dist > 0)) return 0;
  const skew = slope?.skew ?? 0;
  if (!(skew > 0)) return dist;
  const cos = Math.min(Math.max(((dx * slope!.sx + dz * slope!.sz) / dist), -1), 1);
  return dist / Math.max(1 + skew * cos, 1e-3);
}

/**
 * Dent depth for a blast intensity: hammer shells dig the full 0.6 height
 * units (a shallow dimple, not a pit), lighter bolts barely dimple the ground.
 */
export function craterDepthForIntensity(intensity: number): number {
  const clamped = Math.min(Math.max(intensity, 0), 1);
  return 0.15 + clamped * 0.45;
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
  /**
   * Optional downhill wash (see `BlastSlope`): the bowl stretches down the
   * fall line instead of denting a flat circle. Absent reads as flat.
   */
  sx?: number;
  sz?: number;
  skew?: number;
}

/**
 * Total visual dent at world (x, z) from nearby blast bowls, capped so
 * overlapping impacts never dig a pit. Washed bowls reach further downhill
 * and are cut short uphill (same `effectiveBlastDist` warp as damage, so
 * the dent and the scar agree); flat bowls are untouched. Pure +
 * deterministic; feeds the renderer mesh displacement and scorch seating
 * only — never pathing.
 */
export function craterDepthAt(craters: readonly Crater[], x: number, z: number): number {
  let total = 0;
  for (const c of craters) {
    if (!(c.radius > 0) || !(c.depth > 0)) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const skew = c.skew ?? 0;
    const t =
      skew > 0
        ? effectiveBlastDist(dx, dz, { sx: c.sx ?? 0, sz: c.sz ?? 0, skew }) / c.radius
        : Math.sqrt(dx * dx + dz * dz) / c.radius;
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
 * capped at `cap` entries (nearest first when capped). With a wash the
 * reach is directional (further downhill), and ordering is by effective
 * distance so the hardest-hit still come first. Pure helper used to pick
 * which tree/rock instances a blast fells.
 */
export function indicesInBlast(
  points: readonly BlastPoint[],
  cx: number,
  cz: number,
  radius: number,
  cap: number = MAX_FELLED_PER_BLAST,
  slope?: BlastSlope,
): number[] {
  if (!(radius > 0) || cap <= 0) return [];
  const r2 = radius * radius;
  const scored: { index: number; d2: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const dx = p.x - cx;
    const dz = p.z - cz;
    if (slope && slope.skew > 0) {
      const eff = effectiveBlastDist(dx, dz, slope);
      if (eff <= radius) scored.push({ index: i, d2: eff * eff });
    } else {
      const d2 = dx * dx + dz * dz;
      if (d2 <= r2) scored.push({ index: i, d2 });
    }
  }
  scored.sort((a, b) => a.d2 - b.d2 || a.index - b.index);
  return scored.slice(0, cap).map((s) => s.index);
}
