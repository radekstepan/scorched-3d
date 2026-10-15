import { BLAST_RADIUS, effectiveBlastDist, type BlastSlope } from "./destruction.js";
import { CELL_PIXELS } from "../terrain/types.js";
import { TEAM_IDS } from "./types.js";
import type { TeamId, UnitKind } from "./types.js";

/**
 * Team HQs: one fortified structure per side at its map end (Blue west,
 * Orange east) that periodically releases a reinforcement which drives out
 * of its hall to join the fray. HQs are destructible by enemy fire —
 * splash damage from any blast chips them, and ambient guns deliberately
 * target a live enemy HQ once it is inside their admitted weapons range
 * (see the retuned `WEAPON_MAX_RANGE` caps in `combat.ts`: nothing reaches
 * across the map, so an HQ only takes aimed fire from attackers that push
 * deep into its half). A destroyed HQ stops spawning; its wreck stays as
 * battlefield history like any husk.
 *
 * Nanolathe inspiration (adapted — retail runs per-player build queues and
 * nanoframes with economy costs; this is a deterministic rAF demo with no
 * economy): `research/retail-executable-spec/04-units-orders-scripts-and-movement.md`
 * establishes that factory mobile products are allocated with a heading and
 * delivered at the factory's exit position (`QueryBuildInfo` supplies the
 * position). Mirrored here by fixed per-team exit points (the hall mouth)
 * where each reinforcement appears facing the map center, then drives out
 * through the normal movement pipeline. Deviations are deliberate
 * simplifications: fixed interval + per-team cap instead of build queues and
 * metal/energy costs, and a cycling spawn roster instead of player choice.
 */

/** Seconds between reinforcements from one live HQ. */
export const HQ_SPAWN_INTERVAL = 40;
/** Reinforcements one HQ may ever release (per-team pop cap). */
export const HQ_MAX_SPAWNS = 4;
/** Roster the HQ cycles through, one kind per release (no commanders). */
export const HQ_SPAWN_CYCLE: UnitKind[] = ["flash", "stump", "hammer"];
/** Kind released as the `n`th reinforcement (0-based, deterministic). */
export function spawnKindFor(n: number): UnitKind {
  return HQ_SPAWN_CYCLE[((n % HQ_SPAWN_CYCLE.length) + HQ_SPAWN_CYCLE.length) % HQ_SPAWN_CYCLE.length]!;
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
 * Deterministically site one HQ per team at its map end: the end column,
 * nearest dry gentle ground to the middle row (seed offsets the scan start
 * so regens vary). Pure, no rng draws — replays match exactly.
 */
export function placeHqs(field: HqField, seed: number): HqSite[] {
  return TEAM_IDS.map((team) => {
    const cellX = Math.min(Math.max(hqCellX(field.width, team), 0), field.width - 1);
    const mid = field.height >> 1;
    const start = (mid + (seed >>> 0)) % Math.max(field.height, 1);
    let best = { cellZ: mid, score: -Infinity };
    for (let n = 0; n < field.height; n++) {
      const cellZ = (start + n) % field.height;
      const h = field.heights[cellZ * field.width + cellX] ?? 0;
      if (h <= field.seaLevel + 4) continue;
      const slope = cellSlope(field, cellX, cellZ);
      if (slope > 15) continue;
      // Prefer the middle row (a central gate reads as the map-end fort),
      // secondarily higher ground.
      const score = h - Math.abs(cellZ - mid) * 4 - slope * 2;
      if (score > best.score) best = { cellZ, score };
    }
    return { team, cellX, cellZ: best.cellZ };
  });
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
    y: (field.heights[site.cellZ * field.width + site.cellX] ?? 0) * exaggeration,
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
};

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
): number[] {
  const radius = BLAST_RADIUS[attacker] ?? 0;
  const hit = HQ_HIT_DAMAGE[attacker] ?? 0;
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

/** Per-HQ spawn clock: countdown to the next release + releases so far. */
export interface HqSpawnState {
  /** Seconds until the next reinforcement (counts only while the HQ lives). */
  timer: number;
  /** Reinforcements released so far (caps at `HQ_MAX_SPAWNS`). */
  spawned: number;
}

/** Fresh spawn clocks (first release one full interval after battle start). */
export function createHqSpawns(): HqSpawnState[] {
  return TEAM_IDS.map(() => ({ timer: HQ_SPAWN_INTERVAL, spawned: 0 }));
}

/**
 * Tick one HQ's spawn clock by `dt` seconds. Returns true exactly on the
 * tick a reinforcement is due: the HQ lives, its cap is unreached, and the
 * countdown crossed zero (it then resets for the next interval). Pure —
 * the renderer owns the door animation and the body it releases.
 */
export function tickHqSpawn(state: HqSpawnState, dt: number, hqAlive: boolean): boolean {
  if (!hqAlive || state.spawned >= HQ_MAX_SPAWNS) return false;
  state.timer -= dt;
  if (state.timer > 0) return false;
  state.timer += HQ_SPAWN_INTERVAL;
  state.spawned += 1;
  return true;
}
