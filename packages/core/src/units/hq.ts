import { BLAST_RADIUS, PEEWEE_GRENADE_BLAST_RADIUS, effectiveBlastDist, type BlastSlope } from "./destruction.js";
import { UNIT_HIT_DAMAGE } from "./unitDamage.js";
import { CELL_PIXELS, FEATURE_EMPTY, worldHeight } from "../terrain/types.js";
import { TEAM_IDS } from "./types.js";
import type { AttackMode, TeamId, UnitKind } from "./types.js";

/**
 * Team HQs: one fortified structure per side at its map end (Blue west,
 * Orange east) that periodically releases a reinforcement which drives out
 * of its hall to join the fray. HQs are destructible by enemy fire —
 * splash damage from any blast chips them, and ambient guns deliberately
 * target a live enemy HQ once it is inside their admitted weapons range
 * (see the retuned `WEAPON_MAX_RANGE` caps in `combat.ts`: nothing reaches
 * across the map, so an HQ only takes aimed fire from attackers that push
 * deep into its half). A destroyed HQ stops spawning; its wreck stays as
 * battlefield history like any husk. The first wreck ends the war: the
 * renderer freezes the surviving HQ's clock too, so neither side reinforces
 * against a dead enemy.
 *
 * Nanolathe inspiration (adapted — retail runs per-player build queues and
 * nanoframes with economy costs; this is a deterministic rAF demo with no
 * economy): `research/retail-executable-spec/04-units-orders-scripts-and-movement.md`
 * establishes that factory mobile products are allocated with a heading and
 * delivered at the factory's exit position (`QueryBuildInfo` supplies the
 * position). Mirrored here by fixed per-team door-side spawn points just
 * outside the hall door where each reinforcement appears facing the map
 * center, then walks the hall out of the mouth into the normal movement
 * pipeline. Deviations are deliberate
 * simplifications: continuous per-kind build times instead of build queues and
 * metal/energy costs, and a weighted-random spawn roster instead of player choice.
 * A live HQ produces indefinitely while both works stand — only destruction
 * stops the clock (either wreck ends the war) — so a late battle never
 * stalls with a lone survivor and silent factories.
 */

/** Seconds from battle start to the first reinforcement (also the unknown-kind fallback). */
export const HQ_SPAWN_INTERVAL = 20;
/** Kinds an HQ may release, weakest first (no commanders — factories build line units). */
export const HQ_SPAWN_ROSTER: UnitKind[] = ["peewee", "flash", "stump", "hammer"];

/**
 * Build strength of a spawnable kind: splash-weighted punch per landed hit
 * (`UNIT_HIT_DAMAGE × BLAST_RADIUS`). Hull health is uniform — damage is a
 * 0..1 fraction for every kind (see `unitDamage.ts`) — so the gun is the
 * whole story: per-hit damage times the splash it drags along. The admitted
 * range order agrees (hammer longest, peewee shortest), so any reasonable
 * metric ranks peewee < flash < stump < hammer; the weights and build times
 * below only rely on that order, not the exact product.
 */
export function hqSpawnStrength(kind: UnitKind): number {
  return (UNIT_HIT_DAMAGE[kind] ?? 0) * (BLAST_RADIUS[kind] ?? 0);
}

/**
 * Spawn weight of a kind: inverse strength against the weakest roster
 * member, so the peewee reads 1 and everything stronger reads a fraction
 * (flash ≈ 0.28, stump ≈ 0.15, hammer ≈ 0.06) — weaker units come out more
 * often. Unknown kinds (commanders) weigh 0: they never spawn.
 */
export function spawnWeightFor(kind: UnitKind): number {
  if (!HQ_SPAWN_ROSTER.includes(kind)) return 0;
  const weakest = hqSpawnStrength("peewee");
  const strength = hqSpawnStrength(kind);
  if (!(weakest > 0) || !(strength > 0)) return 0;
  return weakest / strength;
}

/**
 * Random next reinforcement: one weighted draw over `HQ_SPAWN_ROSTER`.
 * Consumes exactly one `rng` draw, so seeded streams replay exactly.
 */
export function pickNextSpawnUnit(rng: () => number): UnitKind {
  const total = HQ_SPAWN_ROSTER.reduce((sum, kind) => sum + spawnWeightFor(kind), 0);
  let roll = rng() * total;
  for (const kind of HQ_SPAWN_ROSTER) {
    const weight = spawnWeightFor(kind);
    if (roll < weight) return kind;
    roll -= weight;
  }
  return HQ_SPAWN_ROSTER[HQ_SPAWN_ROSTER.length - 1]!;
}

/** Build time of the weakest roster member (fast scout reinforcements). */
export const HQ_SPAWN_MIN_INTERVAL = 20;
/**
 * Build time of the strongest roster member (artillery takes a while):
 * legacy 35 s × 4/3, the same factor as the peewee 15 → 20 s move, so
 * every roster member keeps its relative build-time ratio.
 */
export const HQ_SPAWN_MAX_INTERVAL = 140 / 3;

/**
 * Seconds to build one `kind`: linear in strength from the weakest roster
 * member (20 s) to the strongest (≈ 46.7 s), so stronger units take more
 * time to make (peewee 20, flash ≈ 24.3, stump ≈ 29.3, hammer ≈ 46.7 —
 * weighted mean ≈ 22.8 s; each build is 4/3 × the old 15–35 s pacing).
 * Unknown kinds fall back to `HQ_SPAWN_INTERVAL`.
 */
export function spawnIntervalFor(kind: UnitKind): number {
  if (!HQ_SPAWN_ROSTER.includes(kind)) return HQ_SPAWN_INTERVAL;
  const strength = hqSpawnStrength(kind);
  const lo = hqSpawnStrength("peewee");
  const hi = hqSpawnStrength("hammer");
  if (!(strength > 0) || !(hi > lo)) return HQ_SPAWN_INTERVAL;
  const t = Math.min(Math.max((strength - lo) / (hi - lo), 0), 1);
  return HQ_SPAWN_MIN_INTERVAL + t * (HQ_SPAWN_MAX_INTERVAL - HQ_SPAWN_MIN_INTERVAL);
}

/** One HQ site: its side plus its map-end cell. */
export interface HqSite {
  team: TeamId;
  cellX: number;
  cellZ: number;
}

/** Minimal heightfield view for HQ siting (shared with `place.ts`). */
export interface HqField {
  heights: Uint8Array;
  width: number;
  height: number;
  seaLevel: number;
}

/** Map-end column per team (inside the unit margin so walls never clip the skirt). */
export function hqCellX(width: number, team: TeamId): number {
  return team === 0 ? 5 : width - 6;
}

/**
 * Factory siting guards: forts must read as valley-floor industry — never
 * beached in the surf, never perched on a peak. The dry margin keeps the
 * slab (plus a safety ring) above the waterline; the slope gate keeps the
 * wide footprint off cliffs; the high-ground cap (see `hqMaxAboveSea`)
 * keeps forts out of the mountains.
 */
export const HQ_DRY_MARGIN = 8;
/** Strict slope gate for the wide factory footprint (single-cell max-min). */
export const HQ_MAX_SLOPE = 12;
/** Relaxed pass still never touches water and never climbs cliffs. */
export const HQ_FALLBACK_DRY_MARGIN = 4;
export const HQ_FALLBACK_SLOPE = 15;
/**
 * High-ground policy: forts may sit at most this far above sea level on
 * flat maps, or at most `HQ_HIGH_FRACTION` of the map's total relief on
 * mountainous ones — whichever is roomier, so flat battle maps accept
 * their gentle swells while ridge/plateau maps reject their peaks.
 */
export const HQ_HIGH_BASELINE = 50;
export const HQ_HIGH_FRACTION = 0.6;
/** Hall-corridor cells checked toward the map center (exit offset in cells). */
export const HQ_HALL_CELLS = 12;
/**
 * Construction pad around the works: this many cells behind the anchor
 * (under the back wall plus an apron), `HQ_PAD_HALF_WIDTH` each side of the
 * anchor row, and `HQ_PAD_FRONT_EXTRA` past `HQ_HALL_CELLS` toward the map
 * center (mouth margin). The pad is leveled UP to the highest ground it
 * covers (see `levelHqPads`) so the slab and the hall floor sit ON the
 * ground instead of buried in it, then cleared of features and painted dirt
 * so the works reads seated.
 */
export const HQ_PAD_REAR = 4;
export const HQ_PAD_HALF_WIDTH = 3;
export const HQ_PAD_FRONT_EXTRA = 1;
/**
 * Exit-lane cells past the hall corridor toward the map center: graded to a
 * drivable profile (see `gradeHqExits`), cleared of features, but never
 * painted dirt — tiles keep their natural classification so the lane out to
 * the reinforcement staging point reads as open ground. Half-width each
 * side of the anchor row.
 */
export const HQ_ROAD_EXTRA = 20;
export const HQ_ROAD_HALF_WIDTH = 2;
/**
 * Steepest single-cell height step the graded HQ exit driveway may take, up
 * or down. Well inside the shared climb gate (`PATH_MAX_SLOPE` = 15, the
 * same gate `stepBlocked` drives) and at the edge of pathfinding's free
 * tier (slope ≤ 5 costs nothing), so reinforcements always walk the mouth
 * out onto open ground instead of holding against a pass wall.
 */
export const HQ_EXIT_MAX_STEP = 5;
/**
 * World units the concrete footing extends below the lowest ground sampled
 * under the works footprint. Covers bilinear ripple between sampled cells
 * (anchors sit on cell corners while the renderer seats on bilinear
 * samples) plus shallow crater dents, so no air gap ever shows downhill.
 */
export const HQ_FOUNDATION_MARGIN = 6;
/**
 * End-band columns searched per side (outermost first): island shores step
 * the fort inward off the surf instead of beaching it, while inland maps
 * still take the outermost column. Wide enough to reach past shore ramps
 * onto the inland flats, so the pad-lift price (see `HQ_PAD_LIFT_WEIGHT`)
 * can trade a few map-end columns for honest ground instead of building a
 * works hill.
 */
export const HQ_END_BAND = 48;
/**
 * Siting price per unit of pad fill: a candidate whose pad would need
 * leveling UP by `lift` (pad top minus anchor, see `hqPadTop`) loses
 * `lift * HQ_PAD_LIFT_WEIGHT` score. One unit of fill outweighs one
 * map-end column (the column pull is 50), so a fort on a shore ramp steps
 * inland onto ground that is already there instead of raising a works
 * hill — while flat valley floors (no lift anywhere) still site at the
 * outermost dry column. Strict + relaxed passes; the half-sweep fallbacks
 * keep their valley-floor target scoring.
 */
export const HQ_PAD_LIFT_WEIGHT = 60;

/**
 * Highest height above sea level a fort may sit at: the roomier of the
 * flat-map baseline and the map-relative fraction of total relief. Pure —
 * the same map always yields the same cap, so seeded regens stay stable.
 */
export function hqMaxAboveSea(field: HqField): number {
  let max = field.seaLevel;
  for (let i = 0; i < field.heights.length; i++) {
    const h = field.heights[i] ?? 0;
    if (h > max) max = h;
  }
  const relief = max - field.seaLevel;
  if (!(relief > 0)) return HQ_HIGH_BASELINE;
  return Math.max(HQ_HIGH_BASELINE, relief * HQ_HIGH_FRACTION);
}

/** Single-cell slope (max-min over the +x/+z corner triple), exported for tests. */
export function hqCellSlope(field: HqField, x: number, z: number): number {
  return cellSlope(field, x, z);
}

/**
 * Strict factory ground: dry with margin, below the high-ground cap, and
 * gentle enough for the wide slab. The hall corridor gets its own check
 * (`hqHallClear`) — this is just the anchor cell.
 */
export function isHqGround(field: HqField, x: number, z: number, maxAboveSea: number): boolean {
  const h = field.heights[z * field.width + x] ?? 0;
  if (h <= field.seaLevel + HQ_DRY_MARGIN) return false;
  if (h > field.seaLevel + maxAboveSea) return false;
  if (cellSlope(field, x, z) > HQ_MAX_SLOPE) return false;
  return true;
}

/**
 * The hall runs ~11 cells from the anchor toward the map center and
 * reinforcements walk its length out of the mouth: every corridor cell must
 * be dry land (relaxed margin — the mouth may sit closer to shore than the
 * slab) or the fort would march hulls into the surf. Pure, deterministic.
 */
export function hqHallClear(field: HqField, cellX: number, cellZ: number, team: TeamId): boolean {
  const dir = team === 0 ? 1 : -1;
  for (let i = 0; i <= HQ_HALL_CELLS; i++) {
    const x = cellX + dir * i;
    if (x < 0 || x >= field.width) return false;
    const h = field.heights[cellZ * field.width + x] ?? 0;
    if (h <= field.seaLevel + HQ_FALLBACK_DRY_MARGIN) return false;
  }
  return true;
}

/** One attribute-grid cell of an HQ pad or exit road. */
export interface HqGroundCell {
  cellX: number;
  cellZ: number;
}

/**
 * Construction-pad cells for a site: the slab footprint plus the hall
 * corridor toward the map center, clamped to the grid. Deterministic —
 * the same site always yields the same cells.
 */
export function hqPadCells(site: HqSite, width: number, height: number): HqGroundCell[] {
  const dir = site.team === 0 ? 1 : -1;
  const cells: HqGroundCell[] = [];
  for (let i = -HQ_PAD_REAR; i <= HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA; i++) {
    const cellX = site.cellX + dir * i;
    if (cellX < 0 || cellX >= width) continue;
    for (let dz = -HQ_PAD_HALF_WIDTH; dz <= HQ_PAD_HALF_WIDTH; dz++) {
      const cellZ = site.cellZ + dz;
      if (cellZ < 0 || cellZ >= height) continue;
      cells.push({ cellX, cellZ });
    }
  }
  return cells;
}

/**
 * Exit-lane cells past the hall mouth toward the map center, clamped to
 * the grid. Reinforcements walk out of the mouth and stage further in, so
 * the lane runs them a cleared path out of the woods — no trees, no
 * repaint: the ground keeps its natural look.
 */
export function hqRoadCells(site: HqSite, width: number, height: number): HqGroundCell[] {
  const dir = site.team === 0 ? 1 : -1;
  const cells: HqGroundCell[] = [];
  for (let i = HQ_HALL_CELLS + 1; i <= HQ_HALL_CELLS + HQ_ROAD_EXTRA; i++) {
    const cellX = site.cellX + dir * i;
    if (cellX < 0 || cellX >= width) continue;
    for (let dz = -HQ_ROAD_HALF_WIDTH; dz <= HQ_ROAD_HALF_WIDTH; dz++) {
      const cellZ = site.cellZ + dz;
      if (cellZ < 0 || cellZ >= height) continue;
      cells.push({ cellX, cellZ });
    }
  }
  return cells;
}

/** Heightfield view for HQ ground works (siting field plus live features). */
export interface HqGroundField extends HqField {
  features: Uint16Array;
}

/**
 * True when (`x`, `z`) falls on the site's exit-lane rectangle past the
 * hall mouth — the same rect `hqRoadCells` enumerates, tested
 * arithmetically so siting can price every candidate without allocating
 * the lane. The driveway columns are the graded ramp's job, never pad
 * fill.
 */
export function isHqRoadCell(site: HqSite, x: number, z: number): boolean {
  const dir = site.team === 0 ? 1 : -1;
  const along = (x - site.cellX) * dir;
  if (along < HQ_HALL_CELLS + 1 || along > HQ_HALL_CELLS + HQ_ROAD_EXTRA) return false;
  return Math.abs(z - site.cellZ) <= HQ_ROAD_HALF_WIDTH;
}

/**
 * Highest natural ground the works pad covers — pad cells plus their
 * immediate apron ring, exit-lane cells excluded: the level-up target
 * `levelHqPads` fills the pad to, and the hill the siter prices into
 * every candidate (see `HQ_PAD_LIFT_WEIGHT`). Always at least the anchor
 * height, so the pad lift (`hqPadTop - anchor`) is never negative. Pure,
 * deterministic.
 */
export function hqPadTop(field: HqField, site: HqSite): number {
  let top = field.heights[site.cellZ * field.width + site.cellX] ?? 0;
  const consider = (x: number, z: number): void => {
    if (x < 0 || z < 0 || x >= field.width || z >= field.height) return;
    if (isHqRoadCell(site, x, z)) return;
    const h = field.heights[z * field.width + x] ?? 0;
    if (h > top) top = h;
  };
  for (const cell of hqPadCells(site, field.width, field.height)) {
    consider(cell.cellX, cell.cellZ);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        consider(cell.cellX + dx, cell.cellZ + dz);
      }
    }
  }
  return top;
}

/**
 * Level every site's construction pad UP to the highest ground it covers
 * (see `hqPadTop`: pad cells plus their apron ring, the exit road
 * excluded — the mouth wall is a ramp job for `gradeHqExits`, not a reason
 * to raise the whole fort). Cut-and-fill in place: leveling down to a low
 * anchor dug the works into a pit with the driveway staring at a pass
 * wall, so leveling up seats the slab and the hall floor ON the ground at
 * the local top instead — the anchor cell itself rises with the pad, so
 * dry margin and hall-clear siting guards still hold afterwards (raising
 * ground can only dry it). Siting now prices the fill (see
 * `HQ_PAD_LIFT_WEIGHT`), so on honest ground this is a gentle touch-up,
 * not a hill — the full lift survives only as the safety net for cramped
 * maps. Deterministic.
 */
export function levelHqPads(field: HqField, sites: readonly HqSite[]): void {
  for (const site of sites) {
    const top = hqPadTop(field, site);
    for (const cell of hqPadCells(site, field.width, field.height)) {
      field.heights[cell.cellZ * field.width + cell.cellX] = top;
    }
  }
}

/**
 * Grade every site's exit driveway from the pad mouth out to the road end
 * so reinforcements can always climb out. Walks the corridor outward from
 * the pad-front seam (flat pad height after `levelHqPads`), following the
 * center row's natural ground but clamping each step to `HQ_EXIT_MAX_STEP`
 * up or down, and benches the full road width to that one profile — flat
 * across, gentle along, like a graded dirt road. Cuts cliff walls down to a
 * ramp, fills drops and wet dips up to a causeway; flat ground passes
 * through untouched. Runs after `levelHqPads`, before tile classification,
 * so tiles and units see the finished driveway. Deterministic.
 *
 * Nanolathe inspiration (adapted): `docs/DESIGN_ECONOMY_CONSTRUCTION.md`
 * C17 validates the factory exit with the same per-cell gates (water,
 * depth, height, slope) as a chosen site — here the exit is *graded* to
 * the same climb gate the movers drive (`PATH_MAX_SLOPE`), with margin.
 */
export function gradeHqExits(field: HqField, sites: readonly HqSite[]): void {
  for (const site of sites) {
    const dir = site.team === 0 ? 1 : -1;
    const seamX = Math.min(
      Math.max(site.cellX + dir * (HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA), 0),
      field.width - 1,
    );
    let prev = field.heights[site.cellZ * field.width + seamX] ?? 0;
    for (let i = HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA + 1; i <= HQ_HALL_CELLS + HQ_ROAD_EXTRA; i++) {
      const x = site.cellX + dir * i;
      if (x < 0 || x >= field.width) break;
      const natural = field.heights[site.cellZ * field.width + x] ?? 0;
      const lo = prev - HQ_EXIT_MAX_STEP;
      const hi = prev + HQ_EXIT_MAX_STEP;
      const graded = Math.min(Math.max(natural < lo ? lo : natural > hi ? hi : natural, 0), 255);
      for (let dz = -HQ_ROAD_HALF_WIDTH; dz <= HQ_ROAD_HALF_WIDTH; dz++) {
        const z = site.cellZ + dz;
        if (z < 0 || z >= field.height) continue;
        field.heights[z * field.width + x] = graded;
      }
      prev = graded;
    }
  }
}

/**
 * Clear every site's pad and exit road of features (trees, rocks, metal,
 * fringe) in place, so reinforcements drive out of the hall onto an open
 * lane instead of into standing trunks. Cells outside the lanes are
 * untouched. Deterministic.
 */
export function clearHqLanes(field: HqGroundField, sites: readonly HqSite[]): void {
  for (const site of sites) {
    for (const cell of hqPadCells(site, field.width, field.height)) {
      field.features[cell.cellZ * field.width + cell.cellX] = FEATURE_EMPTY;
    }
    for (const cell of hqRoadCells(site, field.width, field.height)) {
      field.features[cell.cellZ * field.width + cell.cellX] = FEATURE_EMPTY;
    }
  }
}

/**
 * Deterministically site one factory per team at its map end: a band of
 * end columns (outermost preferred, so the fort still reads as the map-end
 * works), nearest dry gentle LOW ground to the middle row (seed offsets
 * the scan start so regens vary). Low ground wins within the allowed
 * band — the old scorer preferred higher cells, which marched forts up
 * every ridge — but never a shore ramp the pad would have to fill into a
 * hill: the pad lift is priced per unit (see `HQ_PAD_LIFT_WEIGHT`), so the
 * fort steps inland onto ground that is already there. Pure, no rng
 * draws — replays match exactly.
 *
 * Two passes over the band: a strict valley-floor pass (margin + cap +
 * gentle + clear hall), then a relaxed pass (shore margin, steeper, cap +
 * headroom) so cramped maps still find honest ground. An island fallback
 * sweeps the team's half toward a valley-floor target, and a last resort
 * takes the lowest gentle hall-clear ground in the half with no cap — so
 * all-high halves (Ashen Pass east is all plateau) still get their valley
 * floor instead of their peak, and no fort ever beaches while dry ground
 * exists anywhere in its half.
 */
export function placeHqs(field: HqField, seed: number): HqSite[] {
  const cap = hqMaxAboveSea(field);
  return TEAM_IDS.map((team) => {
    const endX = Math.min(Math.max(hqCellX(field.width, team), 0), field.width - 1);
    const band: number[] = [];
    for (let k = 0; k < HQ_END_BAND; k++) {
      const x = endX + (team === 0 ? k : -k);
      if (x < 0 || x >= field.width) break;
      band.push(x);
    }
    const mid = field.height >> 1;
    const start = (mid + (seed >>> 0)) % Math.max(field.height, 1);
    const scoreCell = (x: number, cellZ: number): number => {
      const h = field.heights[cellZ * field.width + x] ?? 0;
      const slope = cellSlope(field, x, cellZ);
      // Outermost column first (map-end fort), then the central gate,
      // then gentle, then LOW: factories sit on the valley floor. And no
      // works hill: ground the pad would have to fill UP to is priced per
      // unit, so a shore ramp loses to the inland flat behind it.
      const colOffset = Math.abs(x - endX);
      const lift = hqPadTop(field, { team, cellX: x, cellZ }) - h;
      return (
        -colOffset * 50 - Math.abs(cellZ - mid) * 4 - slope * 2 - (h - field.seaLevel) * 0.25 -
        lift * HQ_PAD_LIFT_WEIGHT
      );
    };
    let best = { cellX: -1, cellZ: -1, score: -Infinity };
    for (const x of band) {
      for (let n = 0; n < field.height; n++) {
        const cellZ = (start + n) % field.height;
        if (!isHqGround(field, x, cellZ, cap)) continue;
        if (!hqHallClear(field, x, cellZ, team)) continue;
        const score = scoreCell(x, cellZ);
        if (score > best.score) best = { cellX: x, cellZ, score };
      }
    }
    if (best.cellZ >= 0) return { team, cellX: best.cellX, cellZ: best.cellZ };
    // Relaxed: shore margin, cliff edge, cap headroom — still dry, still
    // hall-clear, still deterministic.
    let soft = { cellX: -1, cellZ: -1, score: -Infinity };
    for (const x of band) {
      for (let n = 0; n < field.height; n++) {
        const cellZ = (start + n) % field.height;
        const h = field.heights[cellZ * field.width + x] ?? 0;
        if (h <= field.seaLevel + HQ_FALLBACK_DRY_MARGIN) continue;
        if (h > field.seaLevel + cap + 20) continue;
        if (cellSlope(field, x, cellZ) > HQ_FALLBACK_SLOPE) continue;
        if (!hqHallClear(field, x, cellZ, team)) continue;
        const score = scoreCell(x, cellZ);
        if (score > soft.score) soft = { cellX: x, cellZ, score };
      }
    }
    if (soft.cellZ >= 0) return { team, cellX: soft.cellX, cellZ: soft.cellZ };
    // Island fallback: sweep the team's whole half (map end → middle) so
    // wide island shores still find honest ground instead of beaching.
    // Outermost still wins, so inland maps never reach this pass.
    const halfLo = team === 0 ? 0 : Math.floor(field.width / 2);
    const halfHi = team === 0 ? Math.ceil(field.width / 2) : field.width - 1;
    let far = { cellX: -1, cellZ: -1, score: -Infinity };
    const x0 = team === 0 ? halfLo : halfHi;
    const x1 = team === 0 ? halfHi : halfLo;
    const step = x0 <= x1 ? 1 : -1;
    // Valley-floor target: when the whole map end is a plateau (or the
    // sea), height honesty outweighs map-end pride — score closeness to a
    // low valley floor (~20 above sea: dry with margin, below every cap)
    // instead of raw lowness, so the fort takes the pass, not the beach
    // nor the peak. The end column still wins ties.
    const valleyH = field.seaLevel + 20;
    for (let x = x0; ; x += step) {
      for (let n = 0; n < field.height; n++) {
        const cellZ = (start + n) % field.height;
        const h = field.heights[cellZ * field.width + x] ?? 0;
        if (h <= field.seaLevel + HQ_FALLBACK_DRY_MARGIN) continue;
        if (h > field.seaLevel + cap + 20) continue;
        const slope = cellSlope(field, x, cellZ);
        if (slope > HQ_FALLBACK_SLOPE) continue;
        if (!hqHallClear(field, x, cellZ, team)) continue;
        const score =
          -Math.abs(x - endX) * 1 - Math.abs(cellZ - mid) * 4 - slope * 2 - Math.abs(h - valleyH) * 1;
        if (score > far.score) far = { cellX: x, cellZ, score };
      }
      if (x === x1) break;
    }
    if (far.cellZ >= 0) return { team, cellX: far.cellX, cellZ: far.cellZ };
    // Last resort: lowest gentle hall-clear ground in the half — no cap.
    // All-high halves (Ashen Pass east is all plateau) still get their
    // valley floor instead of their peak: height leads, slope follows.
    let dry = { cellX: endX, cellZ: -1, score: -Infinity };
    for (let x = x0; ; x += step) {
      for (let n = 0; n < field.height; n++) {
        const cellZ = (start + n) % field.height;
        const h = field.heights[cellZ * field.width + x] ?? 0;
        if (h <= field.seaLevel + HQ_FALLBACK_DRY_MARGIN) continue;
        if (!hqHallClear(field, x, cellZ, team)) continue;
        const score =
          -(h - field.seaLevel) * 2 -
          cellSlope(field, x, cellZ) * 3 -
          Math.abs(cellZ - mid) * 1 -
          Math.abs(x - endX) * 0.5;
        if (score > dry.score) dry = { cellX: x, cellZ, score };
      }
      if (x === x1) break;
    }
    if (dry.cellZ >= 0) return { team, cellX: dry.cellX, cellZ: dry.cellZ };
    return { team, cellX: endX, cellZ: mid };
  });
}

/**
 * How far the works footing must reach below its anchor so the HQ reads as
 * set into the ground instead of floating over a downhill air gap. Samples
 * the footprint cells — the base slab (96×76 world ≈ ±3 cells each way) plus
 * the hall corridor (`HQ_HALL_CELLS` toward the map center, ±2 cells wide)
 * — takes the lowest ground under it, and returns the world-space drop from
 * the anchor to that low corner plus `HQ_FOUNDATION_MARGIN`, so the skirt
 * stays buried even on the steepest admitted slope. Pure, deterministic.
 */
export function hqFoundationDrop(field: HqField, site: HqSite, exaggeration: number): number {
  const anchorH = field.heights[site.cellZ * field.width + site.cellX] ?? 0;
  const dir = site.team === 0 ? 1 : -1;
  let low = anchorH;
  const at = (x: number, z: number): void => {
    if (x < 0 || x >= field.width || z < 0 || z >= field.height) return;
    const h = field.heights[z * field.width + x] ?? 0;
    if (h < low) low = h;
  };
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) at(site.cellX + dx, site.cellZ + dz);
  }
  for (let i = 0; i <= HQ_HALL_CELLS; i++) {
    for (let dz = -2; dz <= 2; dz++) at(site.cellX + dir * i, site.cellZ + dz);
  }
  return worldHeight(Math.max(0, anchorH - low), exaggeration) + HQ_FOUNDATION_MARGIN;
}

function cellSlope(field: HqField, x: number, z: number): number {
  const h00 = field.heights[z * field.width + x] ?? 0;
  const h10 = field.heights[z * field.width + Math.min(field.width - 1, x + 1)] ?? 0;
  const h01 = field.heights[Math.min(field.height - 1, z + 1) * field.width + x] ?? 0;
  return Math.max(h00, h10, h01) - Math.min(h00, h10, h01);
}

/** World-space anchor for an HQ site (Y-up, +Z south, like `unitAnchor`). */
export interface HqAnchor {
  x: number;
  y: number;
  z: number;
}

/**
 * World-space anchor for an HQ: grid-to-world mapping with Y snapped to
 * the corner height times the current height exaggeration. The renderer
 * re-evaluates this when the slider moves.
 */
export function hqAnchor(field: HqField, site: HqSite, exaggeration: number): HqAnchor {
  return {
    x: (site.cellX - (field.width - 1) / 2) * CELL_PIXELS,
    y: worldHeight(field.heights[site.cellZ * field.width + site.cellX] ?? 0, exaggeration),
    z: (site.cellZ - (field.height - 1) / 2) * CELL_PIXELS,
  };
}

/** Point-blank fractional damage per landed hit on an HQ, by firing kind. */
export const HQ_HIT_DAMAGE: Record<UnitKind, number> = {
  // Structures take the same TRACER chips as hulls, scaled down: an HQ is a
  // hard target — roughly twice the beating of one hull to bring down.
  flash: 0.03,
  stump: 0.045,
  // Artillery remains the wall-breaker, but one shell no longer decides it.
  hammer: 0.08,
  commander: 0.05,
  // Infantry automatic rifle: the lightest chip on the field.
  peewee: 0.015,
};

/**
 * Point-blank HQ damage of one landed peewee grenade: double the rifle
 * chip, matching the hull-damage doubling above — at most a light tank
 * chip, never a wall-breaker.
 */
export const PEEWEE_GRENADE_HQ_DAMAGE = 0.03;

/** Point-blank HQ damage for a shot: grenade lobs read their lob table. */
export function hqHitDamage(kind: UnitKind, attack: AttackMode = "round"): number {
  if (attack === "grenade" && kind === "peewee") return PEEWEE_GRENADE_HQ_DAMAGE;
  return HQ_HIT_DAMAGE[kind] ?? 0;
}

/** Fresh all-pristine HQ damage state (one entry per team, TEAM_IDS order). */
export function createHqDamage(): number[] {
  return TEAM_IDS.map(() => 0);
}

/** True once an HQ has exhausted its health (wreck persists, spawning stops). */
export function isHqDestroyed(damage: number): boolean {
  return damage >= 1;
}

export interface HqBlastPoint {
  x: number;
  z: number;
}

/**
 * Splash a blast onto the HQs: each HQ inside the firing kind's blast
 * radius takes its point-blank hit scaled by linear falloff `1 - d/radius`,
 * clamped at 1. Same honesty as hull splashes (see `applyBlastToUnits`):
 * no rng, so replays stay deterministic. Returns the touched HQ indices.
 */
export function applyBlastToHqs(
  damage: number[],
  positions: readonly HqBlastPoint[],
  cx: number,
  cz: number,
  attacker: UnitKind,
  slope?: BlastSlope,
  attack: AttackMode = "round",
): number[] {
  const grenade = attack === "grenade" && attacker === "peewee";
  const radius = grenade ? PEEWEE_GRENADE_BLAST_RADIUS : (BLAST_RADIUS[attacker] ?? 0);
  const hit = grenade ? PEEWEE_GRENADE_HQ_DAMAGE : (HQ_HIT_DAMAGE[attacker] ?? 0);
  if (!(radius > 0) || !(hit > 0)) return [];
  const touched: number[] = [];
  const n = Math.min(damage.length, positions.length);
  for (let i = 0; i < n; i++) {
    const p = positions[i]!;
    const d = effectiveBlastDist(p.x - cx, p.z - cz, slope);
    if (d > radius) continue;
    const add = hit * (1 - d / radius);
    if (!(add > 0)) continue;
    damage[i] = Math.min(1, damage[i]! + add);
    touched.push(i);
  }
  return touched;
}

/**
 * Economy-lite spawn pacing: build times scale with the territory share
 * the side holds (see `territoryShare` in `influence.ts`) — hold more
 * ground, reinforce faster. Full map control builds at 0.6× the listed
 * time, a shut-out side at 1.4× (slower but never shut out: the clock
 * always rearms, so even a cornered factory keeps trickling hulls out),
 * and even ground (0.5) replays the legacy pacing exactly at 1.0×.
 */
export const HQ_SPAWN_SHARE_FAST = 0.6;
export const HQ_SPAWN_SHARE_SLOW = 1.4;

/**
 * Interval multiplier for one `share` of the map in [0, 1]: linear from
 * `HQ_SPAWN_SHARE_SLOW` (no ground) through 1.0 at even ground to
 * `HQ_SPAWN_SHARE_FAST` (the whole map). Clamped, so out-of-range or
 * non-finite input degrades to the nearest bound instead of stalling or
 * rushing the clock. Pure — the share itself is sim-time derived.
 */
export function spawnIntervalScale(share: number): number {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0.5;
  return HQ_SPAWN_SHARE_SLOW + (HQ_SPAWN_SHARE_FAST - HQ_SPAWN_SHARE_SLOW) * s;
}

/** Per-HQ spawn clock: countdown to the next release + releases so far. */
export interface HqSpawnState {
  /** Seconds until the next reinforcement (counts only while both HQs live). */
  timer: number;
  /** Reinforcements released so far (running total — a live HQ never caps out). */
  spawned: number;
}

/** Fresh spawn clocks (first release one full interval after battle start). */
export function createHqSpawns(): HqSpawnState[] {
  return TEAM_IDS.map(() => ({ timer: HQ_SPAWN_INTERVAL, spawned: 0 }));
}

/**
 * Tick one HQ's spawn clock by `dt` seconds. Returns the released kind
 * exactly on the tick a reinforcement is due — the HQ lives and the
 * countdown crossed zero — else null. Production is indefinite while the
 * HQ stands: only destruction stops the clock (callers pass `hqAlive`
 * false once ANY HQ falls, so the survivor stands down too). The kind is a
 * weighted random draw (`pickNextSpawnUnit`: weaker units more often) and
 * the clock rearms for that kind's own build time (`spawnIntervalFor`: the
 * stronger the unit, the longer the wait), scaled by the side's territory
 * share (`spawnIntervalScale`: more ground, faster builds). Consumes one
 * `rng` draw per release only; pass a seeded stream for deterministic
 * replays. Pure apart from the state mutation — the renderer owns the
 * door animation and the body it releases.
 */
export function tickHqSpawn(
  state: HqSpawnState,
  dt: number,
  hqAlive: boolean,
  rng: () => number = Math.random,
  share = 0.5,
): UnitKind | null {
  if (!hqAlive) return null;
  state.timer -= dt;
  if (state.timer > 0) return null;
  const kind = pickNextSpawnUnit(rng);
  state.timer += spawnIntervalFor(kind) * spawnIntervalScale(share);
  state.spawned += 1;
  return kind;
}
