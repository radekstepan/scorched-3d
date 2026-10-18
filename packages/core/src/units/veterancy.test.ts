import { describe, expect, it } from "vitest";

// Unit veterancy: thresholds → ranks → multipliers. Kill counting lives in
// the renderer-owned CombatFx roster next to damage; badges + the promotion
// flourish live in VeterancyFx. Curve is faster than nanolathe retail
// (kills/5, cap 5) because small skirmish rosters rarely bank five kills
// per hull — but the shape (threshold ranks, bounded combat bonus) carries
// over.
import {
  MAX_VETERAN_RANK,
  VETERAN_DAMAGE_MULTIPLIERS,
  VETERAN_KILL_THRESHOLDS,
  VETERAN_RANGE_MULTIPLIERS,
  VETERAN_RANK_NAMES,
  damageMultiplierForRank,
  rangeMultiplierForRank,
  rankForKills,
  rankNameFor,
} from "./veterancy.js";

describe("rankForKills", () => {
  it("promotes on the first kill, then at 3 and 6", () => {
    expect(VETERAN_KILL_THRESHOLDS).toEqual([0, 1, 3, 6]);
    expect(rankForKills(0)).toBe(0);
    expect(rankForKills(1)).toBe(1);
    expect(rankForKills(2)).toBe(1);
    expect(rankForKills(3)).toBe(2);
    expect(rankForKills(5)).toBe(2);
    expect(rankForKills(6)).toBe(3);
  });

  it("caps at the ace rank no matter how long the streak runs", () => {
    expect(MAX_VETERAN_RANK).toBe(3);
    expect(rankForKills(60)).toBe(MAX_VETERAN_RANK);
    expect(rankForKills(6000)).toBe(MAX_VETERAN_RANK);
  });

  it("reads garbage kill counts as rookie", () => {
    expect(rankForKills(-1)).toBe(0);
    expect(rankForKills(NaN)).toBe(0);
    expect(rankForKills(2.5)).toBe(1);
  });

  it("names every rank", () => {
    expect(VETERAN_RANK_NAMES).toEqual(["Rookie", "Veteran", "Elite", "Ace"]);
    expect(rankNameFor(0)).toBe("Rookie");
    expect(rankNameFor(3)).toBe("Ace");
    expect(rankNameFor(99)).toBe("Ace");
    expect(rankNameFor(-2)).toBe("Rookie");
  });
});

describe("veterancy multipliers", () => {
  it("leaves rookies exactly at parity (legacy balance untouched)", () => {
    expect(damageMultiplierForRank(0)).toBe(1);
    expect(rangeMultiplierForRank(0)).toBe(1);
  });

  it("scales damage +10% per pip, capped at ×1.30", () => {
    expect(VETERAN_DAMAGE_MULTIPLIERS).toEqual([1, 1.1, 1.2, 1.3]);
    expect(damageMultiplierForRank(1)).toBe(1.1);
    expect(damageMultiplierForRank(2)).toBe(1.2);
    expect(damageMultiplierForRank(3)).toBe(1.3);
    expect(damageMultiplierForRank(99)).toBe(1.3);
    expect(damageMultiplierForRank(-1)).toBe(1);
  });

  it("scales range +5% per pip, capped at ×1.15", () => {
    expect(VETERAN_RANGE_MULTIPLIERS).toEqual([1, 1.05, 1.1, 1.15]);
    expect(rangeMultiplierForRank(1)).toBe(1.05);
    expect(rangeMultiplierForRank(2)).toBe(1.1);
    expect(rangeMultiplierForRank(3)).toBe(1.15);
    expect(rangeMultiplierForRank(99)).toBe(1.15);
    expect(rangeMultiplierForRank(-1)).toBe(1);
  });
});
