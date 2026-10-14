import { BLAST_RADIUS } from "./destruction.js";
import type { UnitKind } from "./types.js";

/**
 * Per-unit battle damage from ambient skirmish fire.
 *
 * Framework-free (no three.js): the web renderer owns the char/smoke/ember
 * visuals while all damage state lives here so vitest can cover it without
 * WebGL. Damage is a per-unit 0..1 fraction (0 pristine, 1 fully charred)
 * that only ever accumulates — units never heal and never die (no wreck
 * removal; the roster drives on, visibly battered). Blasts that already scar
 * the ground and fell trees also splash nearby hulls with linear falloff, so
 * damage state stays a pure function of impact positions: deterministic given
 * the same shot sequence, no rng consumed.
 */

/** Point-blank fractional damage per landed hit, by firing kind. */
export const UNIT_HIT_DAMAGE: Record<UnitKind, number> = {
  // Light tracer bolt: chips the paint.
  flash: 0.06,
  // Medium bolt: dents armour.
  stump: 0.09,
  // Artillery shell: the main battering — a handful of direct hits wrecks.
  hammer: 0.16,
  // Commander heavy bolt.
  commander: 0.11,
};

/** Damage fraction where a hull starts trailing smoke. */
export const UNIT_SMOKE_DAMAGE = 0.2;
/** Damage fraction where smoke turns dark and embers/sparks show. */
export const UNIT_HEAVY_DAMAGE = 0.55;
/** Damage fraction at which charring saturates (further hits still count). */
export const UNIT_CHAR_SATURATE = 0.8;

/** Fresh all-pristine damage state for `count` units. */
export function createUnitDamage(count: number): number[] {
  return new Array<number>(Math.max(count, 0)).fill(0);
}

/** Char mix 0..1 for a damage fraction (linear to saturation, then pinned). */
export function charMix(damage: number): number {
  if (!(damage > 0)) return 0;
  return Math.min(damage / UNIT_CHAR_SATURATE, 1);
}

/** True once a hull should trail smoke. */
export function isSmoking(damage: number): boolean {
  return damage >= UNIT_SMOKE_DAMAGE;
}

/** True once a hull should trail dark smoke plus embers/sparks. */
export function isHeavilyDamaged(damage: number): boolean {
  return damage >= UNIT_HEAVY_DAMAGE;
}

export interface UnitBlastPoint {
  x: number;
  z: number;
}

/**
 * Splash a blast onto nearby hulls: every unit inside the firing kind's
 * `BLAST_RADIUS` of (`cx`, `cz`) takes its point-blank hit scaled by linear
 * falloff `1 - dist/radius`, clamped at 1. Mutates `damage` in place and
 * returns the touched indices (nearest first). Pure apart from the mutation:
 * no rng, so replays stay deterministic.
 */
export function applyBlastToUnits(
  damage: number[],
  positions: readonly UnitBlastPoint[],
  cx: number,
  cz: number,
  attacker: UnitKind,
): number[] {
  const radius = BLAST_RADIUS[attacker] ?? 0;
  const hit = UNIT_HIT_DAMAGE[attacker] ?? 0;
  if (!(radius > 0) || !(hit > 0)) return [];
  const scored: { index: number; d: number }[] = [];
  const n = Math.min(damage.length, positions.length);
  for (let i = 0; i < n; i++) {
    const p = positions[i]!;
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d <= radius) scored.push({ index: i, d });
  }
  scored.sort((a, b) => a.d - b.d || a.index - b.index);
  const touched: number[] = [];
  for (const { index, d } of scored) {
    const add = hit * (1 - d / radius);
    if (!(add > 0)) continue;
    damage[index] = Math.min(1, damage[index]! + add);
    touched.push(index);
  }
  return touched;
}
