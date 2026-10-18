import { TEAM_DEFS, type TeamId } from "./types.js";

/**
 * Team territory: the ground each side considers "theirs", rendered as a
 * toggleable overlay on the 3D map and the minimap.
 *
 * Model: each team owns a coarse grid of last-seen timestamps (seconds).
 * Every tick each live unit stamps a disc around itself (nanolathe's
 * `Grid.AddDisc` precedent: sector resolution, one disc per unit — but
 * timestamps instead of summed integers, so presence decays without any
 * per-tick grid walk). A cell's freshness holds at 1 through
 * `INFLUENCE_FRESH_SECONDS`, then fades linearly to 0 at
 * `INFLUENCE_STALE_SECONDS` (nanolathe's `freshness` precedent: full for
 * seconds, fading across the memory limit — but to 0, not their 0.25
 * floor, so abandoned ground fully clears).
 *
 * Claim rules (see `paintInfluence`): per-team freshness is first smoothed
 * with a 3×3 box blur (the timestamps-compatible analogue of nanolathe's
 * soft `AddDisc` falloff — weights can't live in last-seen cells, so the
 * softening happens at read time instead of write time), then:
 * - claimed by one team: that faction's color, alpha scaled by smoothed
 *   freshness — stale ground (no unit nearby for a long time) fades
 *   toward transparent;
 * - claimed by both (contested): the two faction colors blended, weighted
 *   by relative smoothed freshness — the fresher side leans the mix;
 * - claimed by neither: fully transparent.
 *
 * The blur is what makes territory read as one contiguous blob per side
 * instead of scattered cells: it fills single-cell pinholes, softens the
 * ragged disc edges, and damps the leading-edge pop when a moving unit's
 * disc first covers a cell (a lone fresh cell paints at ~1/9 strength and
 * swells as its neighbours stamp in).
 *
 * Perf: the grid is ~40×32 cells for the shipping map size, updates touch
 * only the discs around live units (~20 cells each), and the full repaint
 * runs at ~4 Hz into a ~5 KB RGBA buffer shared by both surfaces (one
 * `DataTexture` upload for the 3D shader, one `putImageData` for the
 * minimap canvas). Row 0 is north in both the field and the paint, matching
 * the minimap's top row; the 3D texture sets `flipY` so the same buffer
 * lands on the terrain UVs unmirrored.
 */

/** World units per influence cell (nanolathe sectors are 128 wu too). */
export const INFLUENCE_CELL_WORLD = 128;
/** Presence radius stamped around each live unit, world units. */
export const INFLUENCE_RADIUS_WORLD = 384;
/** Full-strength window after a unit was last nearby, seconds. */
export const INFLUENCE_FRESH_SECONDS = 12;
/** Age at which presence has fully faded, seconds. */
export const INFLUENCE_STALE_SECONDS = 90;
/** Peak overlay alpha for fully fresh ground (terrain must read through). */
export const TERRITORY_MAX_ALPHA = 0.38;

/** Last-seen timestamp grid per team. Row 0 is north, col 0 is west. */
export interface InfluenceField {
  cols: number;
  rows: number;
  worldW: number;
  worldD: number;
  /** Per-team last-seen seconds (`seen[team][row * cols + col]`), <0 = never. */
  seen: [Float32Array, Float32Array];
}

export function createInfluenceField(worldW: number, worldD: number): InfluenceField {
  const cols = Math.max(1, Math.round(worldW / INFLUENCE_CELL_WORLD));
  const rows = Math.max(1, Math.round(worldD / INFLUENCE_CELL_WORLD));
  const blank = (): Float32Array => new Float32Array(cols * rows).fill(-1);
  return { cols, rows, worldW, worldD, seen: [blank(), blank()] };
}

function cellRange(
  field: InfluenceField,
  x: number,
  z: number,
  radius: number,
): { c0: number; c1: number; r0: number; r1: number } {
  const colAt = (wx: number): number =>
    Math.floor(((wx + field.worldW / 2) / field.worldW) * field.cols);
  const rowAt = (wz: number): number =>
    Math.floor(((wz + field.worldD / 2) / field.worldD) * field.rows);
  return {
    c0: Math.max(0, colAt(x - radius)),
    c1: Math.min(field.cols - 1, colAt(x + radius)),
    r0: Math.max(0, rowAt(z - radius)),
    r1: Math.min(field.rows - 1, rowAt(z + radius)),
  };
}

/**
 * Stamp `now` onto every cell whose center sits within `radius` of (x, z)
 * for `team`. Off-map and non-finite points stamp nothing (no wrap, no
 * throw). Later stamps overwrite earlier ones — presence underfoot never
 * decays.
 */
export function stampInfluence(
  field: InfluenceField,
  team: TeamId,
  x: number,
  z: number,
  now: number,
  radius: number = INFLUENCE_RADIUS_WORLD,
): void {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(now)) return;
  if (!(radius >= 0)) return;
  const grid = field.seen[team];
  if (!grid) return;
  const { c0, c1, r0, r1 } = cellRange(field, x, z, radius);
  const cw = field.worldW / field.cols;
  const ch = field.worldD / field.rows;
  const r2 = radius * radius;
  for (let r = r0; r <= r1; r++) {
    const cz = -field.worldD / 2 + (r + 0.5) * ch;
    for (let c = c0; c <= c1; c++) {
      const cx = -field.worldW / 2 + (c + 0.5) * cw;
      const dx = cx - x;
      const dz = cz - z;
      if (dx * dx + dz * dz <= r2) grid[r * field.cols + c] = now;
    }
  }
}

/** Roster row the territory sweep reads (units + live HQ forts). */
export interface InfluenceUnit {
  x: number;
  z: number;
  team: TeamId;
  alive: boolean;
}

/** Stamp every live roster row; dead rows keep their fading history. */
export function stampRoster(
  field: InfluenceField,
  units: readonly InfluenceUnit[],
  now: number,
  radius: number = INFLUENCE_RADIUS_WORLD,
): void {
  for (const u of units) {
    if (!u || u.alive === false) continue;
    stampInfluence(field, u.team, u.x, u.z, now, radius);
  }
}

/** Freshness in [0, 1]: 1 through the fresh window, 0 once stale or never. */
export function influenceFreshness(lastSeen: number, now: number): number {
  if (!Number.isFinite(lastSeen) || !Number.isFinite(now)) return 0;
  // Negative stamps mean "never visited" — without this guard a fresh map
  // at small `now` reads the -1 sentinel as a recent visit (age = now + 1).
  if (lastSeen < 0) return 0;
  // Clamp, never zero: stamps live in a Float32Array while `now` is float64,
  // so a stamp taken this very tick rounds *up* past `now` on ~half of all
  // ticks — reading that as "future, therefore stale" strobed fresh ground
  // transparent on ~1 in 9 repaints. A future stamp means "just seen".
  const age = Math.max(0, now - lastSeen);
  if (age <= INFLUENCE_FRESH_SECONDS) return 1;
  if (age >= INFLUENCE_STALE_SECONDS) return 0;
  return 1 - (age - INFLUENCE_FRESH_SECONDS) / (INFLUENCE_STALE_SECONDS - INFLUENCE_FRESH_SECONDS);
}

export interface RgbBytes {
  r: number;
  g: number;
  b: number;
}

/**
 * Per-team share of claimed ground at `now` (TEAM_IDS order, each in
 * [0, 1], summing to 1): each side's summed cell freshness over the
 * field total. Contested cells credit both sides' sums, stale ground
 * credits nobody, and a cold field (no claims yet) splits 50/50 so the
 * opening plays symmetric. The economy-lite spawn clock reads this to
 * build faster for the side holding more ground; `now` is sim seconds,
 * never wall-clock.
 */
export function territoryShare(field: InfluenceField, now: number): [number, number] {
  const [a0, a1] = [field.seen[0]!, field.seen[1]!];
  const n = Math.min(a0.length, a1.length, field.cols * field.rows);
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += influenceFreshness(a0[i]!, now);
    sb += influenceFreshness(a1[i]!, now);
  }
  const total = sa + sb;
  if (!(total > 0)) return [0.5, 0.5];
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  const share = clamp01(sa / total);
  return [share, clamp01(1 - share)];
}

/** Faction color as bytes (the same hex the HUD chips and rings use). */
export function factionColorBytes(team: TeamId): RgbBytes {
  const hex = TEAM_DEFS[team].color;
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

/**
 * Paint the field into `out` (cols*rows RGBA, row 0 north) at `now`:
 * per-team freshness is smoothed with a 3×3 box blur (edge-clamped), then
 * single-team ground takes its faction color, contested ground blends both
 * weighted by relative smoothed freshness, and alpha scales with the
 * strongest smoothed claim so stale ground fades out. One buffer feeds
 * both surfaces.
 */
export function paintInfluence(
  field: InfluenceField,
  now: number,
  out: Uint8ClampedArray | Uint8Array,
  colors: readonly [RgbBytes, RgbBytes],
): void {
  const [a0, a1] = [field.seen[0]!, field.seen[1]!];
  const [c0, c1] = colors;
  const { cols, rows } = field;
  // Mean freshness over the 3×3 neighbourhood (edges replicate outward).
  const smooth = (grid: Float32Array, r: number, c: number): number => {
    let sum = 0;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = Math.min(rows - 1, Math.max(0, r + dr));
      for (let dc = -1; dc <= 1; dc++) {
        const cc = Math.min(cols - 1, Math.max(0, c + dc));
        sum += influenceFreshness(grid[rr * cols + cc]!, now);
      }
    }
    return sum / 9;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const fa = smooth(a0, r, c);
      const fb = smooth(a1, r, c);
      const o = i * 4;
      const peak = Math.max(fa, fb);
      if (!(peak > 0)) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0;
        continue;
      }
      // Contested: lean the mix toward the fresher side (even strengths meet
      // halfway); single-team: the weight collapses to that faction exactly.
      const w = fb / (fa + fb);
      out[o] = Math.round(c0.r + (c1.r - c0.r) * w);
      out[o + 1] = Math.round(c0.g + (c1.g - c0.g) * w);
      out[o + 2] = Math.round(c0.b + (c1.b - c0.b) * w);
      out[o + 3] = Math.round(255 * TERRITORY_MAX_ALPHA * peak);
    }
  }
}
