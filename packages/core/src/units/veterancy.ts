/**
 * Unit veterancy: hulls that survive kills earn ranks with small
 * deterministic combat bonuses. Kill counting lives in the renderer's
 * `CombatFx` roster (next to damage); this module owns only the pure
 * thresholds → ranks → multipliers math so both the damage path and the
 * range gates read one source of truth and vitest covers it without WebGL.
 *
 * Values (kept bounded so one ace never snowballs the battle): ranks 0..3
 * (Rookie/Veteran/Elite/Ace) at 0/1/3/6 kills; damage ×1.00/×1.10/×1.20/
 * ×1.30; range ×1.00/×1.05/×1.10/×1.15. The curve promotes on the first
 * kill for the emotional payoff and caps at three pips so the badge stays
 * small. Nanolathe retail paces slower (level = kills/5, cap 5 — see
 * `internal/combat/rules.go` StrictRules.VeteranLevel — with level-scaled
 * damage in `damage.go` and 6%-per-tier reload in `slots.go`); small
 * skirmish rosters here rarely bank five kills per hull, so the curve is
 * faster but the shape (threshold ranks, bounded combat bonus) is borrowed.
 */

/** Kills needed to reach each rank: index = rank 0..3. */
export const VETERAN_KILL_THRESHOLDS = [0, 1, 3, 6];

/** Highest rank: further kills keep counting but grant nothing more. */
export const MAX_VETERAN_RANK = VETERAN_KILL_THRESHOLDS.length - 1;

/** Display name per rank (rookie is the unbadged default). */
export const VETERAN_RANK_NAMES = ["Rookie", "Veteran", "Elite", "Ace"];

/** Damage multiplier per rank: +10% per pip, capped at ×1.30. */
export const VETERAN_DAMAGE_MULTIPLIERS = [1, 1.1, 1.2, 1.3];

/** Range multiplier per rank: +5% per pip, capped at ×1.15. */
export const VETERAN_RANGE_MULTIPLIERS = [1, 1.05, 1.1, 1.15];

/** Rank 0..3 for a kill count (garbage reads rookie, streaks cap at ace). */
export function rankForKills(kills: number): number {
  if (!(kills >= 1)) return 0;
  let rank = 0;
  for (let r = 1; r < VETERAN_KILL_THRESHOLDS.length; r++) {
    if (kills >= (VETERAN_KILL_THRESHOLDS[r] ?? Infinity)) rank = r;
  }
  return rank;
}

/** Display name for a rank (clamped to the table). */
export function rankNameFor(rank: number): string {
  const clamped = Math.min(Math.max(Math.floor(rank), 0), MAX_VETERAN_RANK);
  return VETERAN_RANK_NAMES[clamped] ?? VETERAN_RANK_NAMES[0]!;
}

/** Damage multiplier for a rank (clamped to the table). */
export function damageMultiplierForRank(rank: number): number {
  const clamped = Math.min(Math.max(Math.floor(rank), 0), MAX_VETERAN_RANK);
  return VETERAN_DAMAGE_MULTIPLIERS[clamped] ?? 1;
}

/** Range multiplier for a rank (clamped to the table). */
export function rangeMultiplierForRank(rank: number): number {
  const clamped = Math.min(Math.max(Math.floor(rank), 0), MAX_VETERAN_RANK);
  return VETERAN_RANGE_MULTIPLIERS[clamped] ?? 1;
}
