import { BLAST_RADIUS, PEEWEE_GRENADE_BLAST_RADIUS, effectiveBlastDist, type BlastSlope } from "./destruction.js";
import type { AttackMode, UnitKind } from "./types.js";

/**
 * Per-unit battle damage from ambient skirmish fire.
 *
 * Framework-free (no three.js): the web renderer owns the char/smoke/ember
 * visuals while all damage state lives here so vitest can cover it without
 * WebGL. Damage is a per-unit 0..1 fraction (0 pristine, 1 fully charred)
 * that only ever accumulates — units never heal. A hull that reaches 1 is
 * destroyed (see `isDestroyed`): the renderer keeps its instance as a
 * smouldering wreck (fell, don't remove) and drops it from targeting,
 * movement, and selection. Blasts that already scar
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
  // Infantry automatic rifle: light chips at a rapid beat — takes a squad
  // (or a sustained burst) to finish.
  peewee: 0.03,
};

/**
 * Point-blank hull damage of one landed peewee grenade: double the
 * rifle bullet (the close-range payoff for closing to knife-fight range)
 * but still well under the hammer's 0.16 — light infantry never out-hits
 * artillery, burst-for-burst or otherwise.
 */
export const PEEWEE_GRENADE_UNIT_DAMAGE = 0.06;

/** Point-blank hull damage for a shot: grenade lobs read their lob table. */
export function unitHitDamage(kind: UnitKind, attack: AttackMode = "round"): number {
  if (attack === "grenade" && kind === "peewee") return PEEWEE_GRENADE_UNIT_DAMAGE;
  return UNIT_HIT_DAMAGE[kind] ?? 0;
}

/** Damage fraction where a hull starts trailing smoke. */
export const UNIT_SMOKE_DAMAGE = 0.2;
/** Damage fraction where smoke turns dark and embers/sparks show. */
export const UNIT_HEAVY_DAMAGE = 0.55;
/** Damage fraction at which charring saturates (further hits still count). */
export const UNIT_CHAR_SATURATE = 0.8;
/**
 * Damage fraction at which a hull is destroyed: `applyBlastToUnits` clamps
 * at 1, so exhaustion == reaching the clamp. The wreck keeps its 1.0 damage
 * (smouldering smoke/embers views keep reading it as heavy) while the
 * renderer drops the index from targeting, movement, and selection.
 */
export const UNIT_KILL_DAMAGE = 1;

/** Fresh all-pristine damage state for `count` units. */
export function createUnitDamage(count: number): number[] {
  return new Array<number>(Math.max(count, 0)).fill(0);
}

/**
 * Husks: a destroyed hull lingers as a wreck, then slowly decays into the
 * ground (TA parallel: retail units leave corpse features that persist as
 * reclaimable wrecks; here the demo has no economy, so the husk instead
 * sinks, gutters out, and finally vanishes — leaving only its scorch scar).
 *
 * Framework-free like the rest of this module: the renderer owns the
 * sinking/hiding while every threshold lives here so vitest can cover the
 * pacing without WebGL. All husk state derives from one clock — seconds
 * since the kill — so replays and exaggeration re-snaps cannot disturb it.
 */

/**
 * Seconds from the kill until the husk is fully gone. Slow on purpose: a
 * wreck should smoulder on the field for a full minute of skirmish before
 * it finishes sinking.
 */
export const HUSK_DECAY_DURATION = 60;
/** World units the husk sinks below its death seat when fully decayed. */
export const HUSK_SINK_DEPTH = 9;
/**
 * Decay fraction past which the ember spark gutters out (fire dies first,
 * smoke lingers).
 */
export const HUSK_EMBER_END = 0.2;
/** Decay fraction past which even the smoke wisps stop. */
export const HUSK_SMOKE_END = 0.6;

/**
 * Husk decay fraction 0 (fresh wreck) .. 1 (fully gone) for `ageSeconds`
 * since the kill. Clamped, so negative clocks read fresh and over-long
 * clocks read gone.
 */
export function huskDecay(ageSeconds: number): number {
  if (!(ageSeconds > 0)) return 0;
  return Math.min(ageSeconds / HUSK_DECAY_DURATION, 1);
}

/** World units to lower a husk body at `decay` 0..1 (linear sink). */
export function huskSink(decay: number): number {
  const clamped = Math.min(Math.max(decay, 0), 1);
  return clamped * HUSK_SINK_DEPTH;
}

/** True once the husk has finished decaying and may be hidden. */
export function isHuskGone(ageSeconds: number): boolean {
  return ageSeconds >= HUSK_DECAY_DURATION;
}

/** True while a husk at `decay` 0..1 still trails smoke wisps. */
export function huskSmokes(decay: number): boolean {
  return decay < HUSK_SMOKE_END;
}

/** True while a husk at `decay` 0..1 still flickers its ember spark. */
export function huskEmbers(decay: number): boolean {
  return decay < HUSK_EMBER_END;
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

/**
 * True once a hull has exhausted its health (damage reached the clamp).
 * Pure threshold so the renderer can derive the kill transition from the
 * before/after pair of one splash: `!isDestroyed(prev) && isDestroyed(next)`
 * fires exactly once per hull, with no extra state and no rng.
 */
export function isDestroyed(damage: number): boolean {
  return damage >= UNIT_KILL_DAMAGE;
}

export interface UnitBlastPoint {
  x: number;
  z: number;
}

/**
 * Splash a blast onto nearby hulls: every unit inside the firing kind's
 * `BLAST_RADIUS` of (`cx`, `cz`) takes its point-blank hit scaled by linear
 * falloff `1 - dist/radius`, clamped at 1. With a wash the radius stretches
 * downhill and shrinks uphill (effective distance drives both inclusion
 * and falloff, so a hull above the blast is shielded by the rise). Mutates
 * `damage` in place and returns the touched indices (nearest first). Pure
 * apart from the mutation: no rng, so replays stay deterministic.
 */
export function applyBlastToUnits(
  damage: number[],
  positions: readonly UnitBlastPoint[],
  cx: number,
  cz: number,
  attacker: UnitKind,
  slope?: BlastSlope,
  attack: AttackMode = "round",
  damageScale = 1,
): number[] {
  const grenade = attack === "grenade" && attacker === "peewee";
  const radius = grenade ? PEEWEE_GRENADE_BLAST_RADIUS : (BLAST_RADIUS[attacker] ?? 0);
  // `damageScale` carries the shooter's veterancy bonus (see
  // `damageMultiplierForRank`); the default 1 keeps legacy splashes
  // byte-identical. Only the point-blank hit scales — the blast radius and
  // falloff shape never change, so veterans hit harder, not wider.
  const scale = damageScale > 0 ? damageScale : 1;
  const hit =
    (grenade ? PEEWEE_GRENADE_UNIT_DAMAGE : (UNIT_HIT_DAMAGE[attacker] ?? 0)) * scale;
  if (!(radius > 0) || !(hit > 0)) return [];
  const scored: { index: number; d: number }[] = [];
  const n = Math.min(damage.length, positions.length);
  for (let i = 0; i < n; i++) {
    const p = positions[i]!;
    const d = effectiveBlastDist(p.x - cx, p.z - cz, slope);
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
