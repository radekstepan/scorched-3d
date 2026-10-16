import { countTreesOnSegment, type CombatVec3, type TreeStand } from "./combat.js";
import type { UnitKind } from "./types.js";

/**
 * Terrain-aware visibility: who can spot whom. Framework-free (no three.js)
 * so the web renderer and vitest share the same rules.
 *
 * Problem: hunt acquisition was a flat distance gate — a hull in a valley
 * noticed enemies as far as a hull on a ridge, saw straight through
 * mountains, and read a column parked in thick forest as clearly as one on
 * open dirt. Spotting now answers the ground it stands on:
 *
 * - High ground sees farther. The notice gate grows with the observer's
 *   eye-height advantage over the target (`SIGHT_ELEVATION_GAIN` per world
 *   unit, capped at `SIGHT_ELEVATION_MAX_BONUS`). The cap keeps the
 *   elevated gate inside the pursuit disengage bound (1100 + 140 < 1250,
 *   scout 1500 + 140 < 1650), so the hysteresis gap survives: a hull that
 *   acquires from a ridge does not drop the contact on its first step.
 * - Mountains block sight. The eye-to-eye segment is marched against the
 *   live surface (`sightClearsTerrain`, the spotting twin of the firing
 *   admission gate `flightClearsTerrain`): terrain rising above the line
 *   hides the target no matter how close it is.
 * - Thick forest shrinks sight. Each standing tree on the eye-to-eye line
 *   costs notice range (`SIGHT_FOREST_COST`, capped at a fraction of the
 *   base gate), down to a point-blank floor (`SIGHT_MIN_RANGE`) — a
 *   neighbour breathing down your barrel is heard, not just seen.
 *
 * Nanolathe parallel (adapted): retail TA gates acquisition on line of
 * sight over the heightfield with per-unit sight distances — high ground
 * and open ground see farther, ridges and woods hide. Same three answers
 * here, resolved per candidate pair with the caller's surface.
 *
 * Authority rules (decided, documented):
 * - Spotting only. This gates *acquisition* (hunts, HQ spotting) — never
 *   pursuit (a chased contact is remembered, not re-spotted every tick),
 *   never retaliation (taking fire is ground truth), never gun admission
 *   (the firing gates already hold shots into hillsides and wood).
 * - Determinism: no rng, no wall clock. Same roster + surface in, same
 *   sight picture out — replays stay identical.
 * - Backward compatible: every consumer takes an optional `sight` context
 *   and resolves exactly the legacy distance gate without one, so headless
 *   history without a surface is untouched.
 */

/** Eye/optics lift above the hull ground anchor, per kind, world units. */
export const EYE_HEIGHT: Record<UnitKind, number> = {
  // Low hull, roof optics just above the muzzle line.
  flash: 12,
  stump: 15,
  // Tall SPG superstructure; the sight sits high.
  hammer: 24,
  // Biped: the head rides well above any hull.
  commander: 32,
  // Infantry: sharp eyes, short legs (scouts see farther by doctrine, not height).
  peewee: 10,
};

/** Eye lift for `kind` (unknown kinds read as a low hull, never NaN). */
export function eyeHeight(kind?: UnitKind | null): number {
  return (kind != null ? EYE_HEIGHT[kind] : undefined) ?? 12;
}

/**
 * Extra notice range per world unit of eye-height advantage over the
 * target. A +70 ridge lead earns the full capped bonus; valley hulls
 * looking up earn nothing (no negative — low ground is not blindness).
 */
export const SIGHT_ELEVATION_GAIN = 2;
/**
 * Cap on the high-ground notice bonus, world units. Sized under the
 * hysteresis gap on both notice scales (regular 1100 + 140 < 1250,
 * scout 1500 + 140 < 1650), so an elevated acquisition never starts
 * past the disengage bound it must survive.
 */
export const SIGHT_ELEVATION_MAX_BONUS = 140;
/** Notice range lost per standing tree on the eye-to-eye line. */
export const SIGHT_FOREST_COST = 60;
/**
 * Max fraction of the base gate thick forest can remove. A column deep in
 * the woods reads at 40% notice — hidden, not invisible — before the
 * point-blank floor below.
 */
export const SIGHT_FOREST_MAX_FRACTION = 0.6;
/**
 * Floor on the effective notice gate, world units: anything this close is
 * noticeable through any wood (short of a mountain between). Never expands
 * a tighter caller gate — see `effectiveNotice`.
 */
export const SIGHT_MIN_RANGE = 200;
/** Longest sight-line step when marching against terrain, world units. */
export const SIGHT_SAMPLE_STEP = 8;
/**
 * Surface grace: terrain within this height below the sight line still
 * reads as clear (bilinear sampling noise, not a ridge).
 */
export const SIGHT_GRAZE = 3;
/** Hard cap on sight-line samples per call. */
export const SIGHT_MAX_SAMPLES = 512;
/**
 * Target lift above the fort's ground seat for HQ spotting, world units:
 * the bunker roof/door a ranging scout picks out, not the dirt it sits on.
 */
export const STRUCTURE_SIGHT_LIFT = 18;

/**
 * The seeing surface: live terrain plus the wood standing on it. Eye
 * heights resolve per roster index from `eyeY` when provided, else from
 * `groundY` at the position plus the kind's `eyeHeight` (`kinds`, with a
 * caller fallback for pipelines that already know the roster kinds).
 */
export interface SightContext {
  /** Terrain surface height at world (x, z). */
  groundY: (x: number, z: number) => number;
  /** Live tree stands (only `standing` wood blocks sight). */
  trees?: readonly TreeStand[] | null;
  /** Precomputed eye world-Y per roster index. */
  eyeY?: readonly (number | undefined)[] | null;
  /** Kind per roster index (eye-height fallback). */
  kinds?: readonly (UnitKind | undefined)[] | null;
  /**
   * Memoized spot verdicts for one immutable snapshot (see `SpotCache`):
   * the hunt sweep asks the same pair twice per tick (once to share the
   * sighting team-wide, once to acquire on it), and the second ask replays
   * the first instead of re-marching the terrain. Absent, every call
   * resolves from scratch, exactly as before.
   */
  cache?: SpotCache | null;
}

/**
 * One memoized spot verdict: the exact inputs the call resolved, plus the
 * answer. Hits replay only when every input matches exactly — same notice
 * gate, same endpoints, same eye heights — so a moved hull or a different
 * gate never reads a stale verdict.
 */
export interface SpotVerdict {
  base: number;
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  hit: boolean;
}

/**
 * Memoized spot verdicts for one immutable sight snapshot. The cache never
 * changes admission — a hit replays the exact predicate's answer for
 * identical inputs, and anything else (moved endpoints, a different gate
 * or eye height, a swapped surface or tree snapshot) recomputes from
 * scratch. Use one fresh cache per snapshot (the sweep builds one per
 * tick): entries are only valid while `groundY` and `trees` read the same
 * world the verdicts were computed against.
 */
export interface SpotCache {
  /** Surface the entries were computed against (identity-rebound on swap). */
  groundY: ((x: number, z: number) => number) | null;
  /** Tree snapshot the entries were computed against (identity-rebound). */
  trees: readonly TreeStand[] | null | undefined;
  /** Hull-pair verdicts by observer, then candidate (sparse — exact indices). */
  pairs: SpotVerdict[][];
  /** Fixed-point verdicts by observer (few forts — scanned, never keyed). */
  points: SpotVerdict[][];
}

/** A fresh, unbound spot cache (see `SightContext.cache`). */
export function createSpotCache(): SpotCache {
  return { groundY: null, trees: undefined, pairs: [], points: [] };
}

/**
 * True while `entry` answers this exact spot question: same notice gate,
 * same endpoints, same eye heights.
 */
function verdictMatches(
  entry: SpotVerdict,
  base: number,
  ax: number,
  az: number,
  ay: number,
  bx: number,
  bz: number,
  by: number,
): boolean {
  return (
    entry.base === base &&
    entry.ax === ax &&
    entry.az === az &&
    entry.ay === ay &&
    entry.bx === bx &&
    entry.bz === bz &&
    entry.by === by
  );
}

/**
 * Rebind the cache to this snapshot when the surface or the tree list was
 * swapped underneath it (entries from the old world drop), or bind a fresh
 * cache on its first use. Returns false while unbound work remains — the
 * caller recomputes and stores.
 */
function cacheBound(cache: SpotCache, sight: SightContext): boolean {
  if (cache.groundY !== sight.groundY || cache.trees !== sight.trees) {
    cache.groundY = sight.groundY;
    cache.trees = sight.trees;
    cache.pairs.length = 0;
    cache.points.length = 0;
    return false;
  }
  return true;
}

/**
 * Trees past which the forest penalty cannot grow: `forestPenalty` caps at
 * `base * SIGHT_FOREST_MAX_FRACTION`, so counting stops here — anything
 * more reads the same saturated gate. A generous cap only moves the
 * early-out, never the verdict.
 */
function forestSaturation(base: number): number {
  return Math.max(0, Math.ceil((base * SIGHT_FOREST_MAX_FRACTION) / SIGHT_FOREST_COST));
}

/** High-ground notice bonus for eyes at `eyeY` over a target at `targetY`. */
export function elevationBonus(eyeY: number, targetY: number): number {
  const advantage = eyeY - targetY;
  if (!(advantage > 0)) return 0;
  return Math.min(advantage * SIGHT_ELEVATION_GAIN, SIGHT_ELEVATION_MAX_BONUS);
}

/** Notice range thick forest removes: per-tree cost capped at a base fraction. */
export function forestPenalty(crossedCount: number, base: number): number {
  const n = Math.floor(crossedCount);
  if (!(n > 0) || !(base > 0)) return 0;
  return Math.min(n * SIGHT_FOREST_COST, base * SIGHT_FOREST_MAX_FRACTION);
}

/**
 * Effective notice gate: the base gate plus the high-ground bonus minus
 * the forest penalty, floored at point-blank range. The floor never
 * expands a tighter caller gate (`min(base, SIGHT_MIN_RANGE)`), so a
 * close-in admission bound stays close-in.
 */
export function effectiveNotice(
  base: number,
  eyeY: number,
  targetY: number,
  crossedTrees: number,
): number {
  if (!(base > 0)) return 0;
  return Math.max(
    base + elevationBonus(eyeY, targetY) - forestPenalty(crossedTrees, base),
    Math.min(base, SIGHT_MIN_RANGE),
  );
}

export interface SightPoint {
  x: number;
  z: number;
}

/**
 * Eye world-Y for roster index `i`: the explicit `eyeY` entry when finite,
 * else the surface at the position plus the kind's eye lift. Falls back to
 * a low hull on unknown ground, never NaN.
 */
export function eyeYFor(
  index: number,
  positions: readonly SightPoint[],
  sight: SightContext,
  kindFallback?: UnitKind | null,
): number {
  const explicit = sight.eyeY?.[index];
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  const p = positions[index];
  const kind = sight.kinds?.[index] ?? kindFallback ?? undefined;
  const g =
    p && Number.isFinite(p.x) && Number.isFinite(p.z) ? sight.groundY(p.x, p.z) : Number.NaN;
  return (Number.isFinite(g) ? (g as number) : 0) + eyeHeight(kind);
}

/**
 * True when the straight eye-to-eye segment `a`→`b` stays above the
 * surface — the spotting twin of `flightClearsTerrain`, without ballistics:
 * marches at ≤`SIGHT_SAMPLE_STEP` arc-length steps and refuses the moment
 * terrain rises within `SIGHT_GRAZE` of the line. Endpoints are excluded
 * (eyes sit above their own dirt by construction). Pure; the caller owns
 * the surface.
 */
export function sightClearsTerrain(
  a: CombatVec3,
  b: CombatVec3,
  groundY: (x: number, z: number) => number,
): boolean {
  if (
    !(
      Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z) &&
      Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z)
    )
  ) {
    return false;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist > 0)) return true;
  const steps = Math.min(Math.max(Math.ceil(dist / SIGHT_SAMPLE_STEP), 1), SIGHT_MAX_SAMPLES);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const z = a.z + dz * t;
    if (y < groundY(x, z) + SIGHT_GRAZE) return false;
  }
  return true;
}

/**
 * True when roster hull `self` spots roster hull `foe` through `sight`:
 * the eye-to-eye line clears the terrain (mountains hide at any range)
 * and the planar distance fits the effective gate (high ground extends
 * it, forest on the line shrinks it). The cheap distance reject runs
 * first — even the full high-ground bonus cannot admit past
 * `base + SIGHT_ELEVATION_MAX_BONUS` — so far pairs cost no surface
 * probes. Pure; `kinds` is the caller roster fallback for eye heights.
 * With `sight.cache`, a repeat ask for identical inputs replays the stored
 * verdict instead of re-marching the terrain (see `SpotCache`).
 */
export function canSpot(
  self: number,
  foe: number,
  positions: readonly SightPoint[],
  base: number,
  sight: SightContext,
  kinds?: readonly (UnitKind | undefined)[] | null,
): boolean {
  const me = positions[self];
  const him = positions[foe];
  if (!me || !him) return false;
  if (
    !(
      Number.isFinite(me.x) && Number.isFinite(me.z) &&
      Number.isFinite(him.x) && Number.isFinite(him.z)
    )
  ) {
    return false;
  }
  if (!(base > 0)) return false;
  const dist = Math.hypot(him.x - me.x, him.z - me.z);
  if (dist > base + SIGHT_ELEVATION_MAX_BONUS) return false;
  const eyeA = eyeYFor(self, positions, sight, kinds?.[self]);
  const eyeB = eyeYFor(foe, positions, sight, kinds?.[foe]);
  const cache = sight.cache ?? null;
  if (cache && cacheBound(cache, sight)) {
    const prior = cache.pairs[self]?.[foe];
    if (prior && verdictMatches(prior, base, me.x, me.z, eyeA, him.x, him.z, eyeB)) {
      return prior.hit;
    }
  }
  const a = { x: me.x, y: eyeA, z: me.z };
  const b = { x: him.x, y: eyeB, z: him.z };
  const hit = sightClearsTerrain(a, b, sight.groundY) && dist <= effectiveNotice(base, eyeA, eyeB, crossedTrees(a, b, base, sight));
  if (cache) {
    const row = (cache.pairs[self] ??= []);
    row[foe] = { base, ax: me.x, az: me.z, ay: eyeA, bx: him.x, bz: him.z, by: eyeB, hit };
  }
  return hit;
}

/**
 * Wood on the sight line, counted only up to the forest-penalty saturation
 * (see `forestSaturation`): past it the gate cannot shrink further, so the
 * scan stops early instead of walking the rest of the forest.
 */
function crossedTrees(
  a: CombatVec3,
  b: CombatVec3,
  base: number,
  sight: SightContext,
): number {
  const trees = sight.trees ?? [];
  if (trees.length === 0) return 0;
  return countTreesOnSegment(a, b, trees, forestSaturation(base));
}

/**
 * Spot a fixed point (an HQ fort, not a roster row): the same gate as
 * `canSpot` with an explicit target position and world-Y. Pure. With
 * `sight.cache`, a repeat ask for identical inputs replays the stored
 * verdict instead of re-marching the terrain (see `SpotCache`).
 */
export function canSpotPoint(
  self: number,
  positions: readonly SightPoint[],
  tx: number,
  tz: number,
  targetY: number,
  base: number,
  sight: SightContext,
  kinds?: readonly (UnitKind | undefined)[] | null,
): boolean {
  const me = positions[self];
  if (!me) return false;
  if (!(Number.isFinite(me.x) && Number.isFinite(me.z))) return false;
  if (!(Number.isFinite(tx) && Number.isFinite(tz) && Number.isFinite(targetY))) return false;
  if (!(base > 0)) return false;
  const dist = Math.hypot(tx - me.x, tz - me.z);
  if (dist > base + SIGHT_ELEVATION_MAX_BONUS) return false;
  const eyeA = eyeYFor(self, positions, sight, kinds?.[self]);
  const cache = sight.cache ?? null;
  if (cache && cacheBound(cache, sight)) {
    const priors = cache.points[self];
    if (priors) {
      for (const prior of priors) {
        if (verdictMatches(prior, base, me.x, me.z, eyeA, tx, tz, targetY)) return prior.hit;
      }
    }
  }
  const a = { x: me.x, y: eyeA, z: me.z };
  const b = { x: tx, y: targetY, z: tz };
  const hit = sightClearsTerrain(a, b, sight.groundY) && dist <= effectiveNotice(base, eyeA, targetY, crossedTrees(a, b, base, sight));
  if (cache) {
    const verdict: SpotVerdict = { base, ax: me.x, az: me.z, ay: eyeA, bx: tx, bz: tz, by: targetY, hit };
    const priors = (cache.points[self] ??= []);
    const at = priors.findIndex((prior) =>
      verdictMatches(prior, base, me.x, me.z, eyeA, tx, tz, targetY),
    );
    if (at >= 0) priors[at] = verdict;
    else priors.push(verdict);
  }
  return hit;
}
