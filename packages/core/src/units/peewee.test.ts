import { describe, expect, it } from "vitest";
import {
  AIM_SCATTER_MAX,
  AIM_SCATTER_RATE,
  BARREL_MOUNT,
  ballisticPosition,
  GRAVITY,
  inRange,
  isPeeweeGrenadeRange,
  maxRangeFor,
  muzzleForward,
  muzzleHeight,
  nextShotDelayFor,
  PEEWEE_GRENADE_RANGE,
  PEEWEE_GRENADE_SPEED,
  peeweeAttackFor,
  scatterRadius,
  SHOT_DELAY,
  SHOT_DELAY_MAX,
  SHOT_DELAY_MIN,
  shotDelayFor,
  solveBallistic,
  solvePeeweeGrenade,
  solveShot,
  WEAPON_MAX_RANGE,
  WEAPON_PROFILES,
} from "./combat.js";
import { BLAST_RADIUS, blastRadiusFor, PEEWEE_GRENADE_BLAST_RADIUS, scorchForAttack, scorchForKind } from "./destruction.js";
import { mulberry32 } from "../terrain/noise.js";
import { HULL_TURN_RATE, TURRET_LIMIT, TURRET_SLEW_RATE } from "./facing.js";
import { HQ_HIT_DAMAGE, HQ_SPAWN_ROSTER, hqHitDamage, PEEWEE_GRENADE_HQ_DAMAGE, pickNextSpawnUnit, spawnIntervalFor } from "./hq.js";
import { LEG_STRIDE, WHEEL_RADIUS } from "./locomotion.js";
import { MOVE_SPEED } from "./movement.js";
import { placeUnits } from "./place.js";
import { PURSUE_STANDOFF } from "./retaliation.js";
import { generateMap } from "../terrain/generate.js";
import { HULL_FOOTPRINT } from "./terrain.js";
import { UNIT_DEFS, UNIT_KINDS } from "./types.js";
import { createUnitDamage, applyBlastToUnits, PEEWEE_GRENADE_UNIT_DAMAGE, unitHitDamage, UNIT_HIT_DAMAGE } from "./unitDamage.js";
import { applyBlastToHqs, createHqDamage } from "./hq.js";

/**
 * Peewee (ARMPW) infantry scout: the small fast fragile fifth kind. Pins the
 * doctrine — shortest reach, smallest splash, weakest gun, quickest feet —
 * plus roster/HQ wiring (even teams, reinforcement cycle).
 */
describe("peewee infantry kind", () => {
  it("registers the retail ARMPW catalog entry with distinct paint", () => {
    expect(UNIT_KINDS).toContain("peewee");
    const def = UNIT_DEFS.peewee;
    expect(def.unitName).toBe("ARMPW");
    expect(def.name).toBe("Peewee");
    const colors = new Set(UNIT_KINDS.map((k) => UNIT_DEFS[k].color));
    expect(colors.size).toBe(UNIT_KINDS.length);
  });

  it("musters in the default roster on even teams", () => {
    const map = generateMap("greenreach", 9);
    const kinds = placeUnits(
      {
        heights: map.heights,
        features: map.features,
        width: map.width,
        height: map.height,
        seaLevel: map.seaLevel,
      },
      9,
    );
    expect(new Set(kinds.map((u) => u.kind))).toContain("peewee");
    const west = kinds.filter((u) => u.team === 0);
    const east = kinds.filter((u) => u.team === 1);
    expect(west.length).toBe(east.length);
  });

  it("fires a light bolt with the shortest admitted reach", () => {
    expect(WEAPON_PROFILES.peewee.shot).toBe("bolt");
    expect(maxRangeFor("peewee")).toBe(550);
    expect(WEAPON_MAX_RANGE.peewee).toBeLessThan(WEAPON_MAX_RANGE.commander);
    expect(inRange("peewee", 549)).toBe(true);
    expect(inRange("peewee", 551)).toBe(false);
    // Direct-flight bolt solves flat, like every other bolt kind.
    const shot = solveShot("peewee", { x: 0, y: 9, z: 0 }, { x: 400, y: 9, z: 0 });
    expect(shot).not.toBeNull();
  });

  it("scatters less than artillery at long range", () => {
    expect(AIM_SCATTER_RATE.peewee).toBeLessThan(AIM_SCATTER_RATE.hammer);
    expect(AIM_SCATTER_MAX.peewee).toBeLessThan(AIM_SCATTER_MAX.hammer);
    expect(scatterRadius("peewee", 800)).toBeLessThan(scatterRadius("hammer", 800));
  });

  it("mounts its hand-cannon low with a positive muzzle offset", () => {
    expect(muzzleHeight("peewee")).toBeGreaterThan(0);
    expect(muzzleForward("peewee")).toBeGreaterThan(0);
    expect(BARREL_MOUNT.peewee).toEqual({ pivotY: 8, pivotZ: 2, length: 10 });
  });

  it("splashes smallest, chips lightest", () => {
    for (const kind of UNIT_KINDS) {
      if (kind === "peewee") continue;
      expect(BLAST_RADIUS.peewee).toBeLessThan(BLAST_RADIUS[kind]!);
      expect(UNIT_HIT_DAMAGE.peewee).toBeLessThan(UNIT_HIT_DAMAGE[kind]!);
      expect(HQ_HIT_DAMAGE.peewee).toBeLessThan(HQ_HIT_DAMAGE[kind]!);
    }
    const scorch = scorchForKind("peewee");
    expect(scorch.radius).toBeLessThan(scorchForKind("flash").radius);
  });

  it("runs the fastest feet with the smallest footprint", () => {
    for (const kind of UNIT_KINDS) {
      if (kind === "peewee") continue;
      expect(MOVE_SPEED.peewee).toBeGreaterThan(MOVE_SPEED[kind]!);
    }
    const fp = HULL_FOOTPRINT.peewee;
    expect(fp.halfLen).toBeLessThan(HULL_FOOTPRINT.flash.halfLen);
    expect(fp.halfWid).toBeLessThan(HULL_FOOTPRINT.flash.halfWid);
    // Nimble traverse: turns and slews faster than every tank.
    expect(HULL_TURN_RATE.peewee).toBeGreaterThan(HULL_TURN_RATE.flash);
    expect(TURRET_SLEW_RATE.peewee).toBeGreaterThan(TURRET_SLEW_RATE.flash);
    expect(TURRET_LIMIT.peewee).toBeGreaterThanOrEqual(Math.PI / 2 - 1e-9);
  });

  it("walks on legs, never wheels", () => {
    expect(WHEEL_RADIUS.peewee).toBe(0);
    expect(LEG_STRIDE.peewee).toBeGreaterThan(0);
  });

  it("closes to knife-fight range inside its own reach", () => {
    expect(PURSUE_STANDOFF.peewee).toBeLessThan(PURSUE_STANDOFF.flash);
    expect(PURSUE_STANDOFF.peewee).toBeLessThan(maxRangeFor("peewee"));
  });

  it("reinforces from live HQs but never musters as a commander", () => {
    expect(HQ_SPAWN_ROSTER).toContain("peewee");
    expect(HQ_SPAWN_ROSTER).not.toContain("commander");
    // The weakest roster member is the likeliest draw and the quickest
    // build; artillery is the rarest and slowest.
    expect(pickNextSpawnUnit(() => 0)).toBe("peewee");
    expect(spawnIntervalFor("peewee")).toBeLessThan(spawnIntervalFor("hammer"));
  });

  it("fires faster than the tanks, commander-quick", () => {
    // Walker guns cycle quicker: both ends of their window sit under the
    // corresponding tank end, and the peewee is the quickest gun on the field.
    for (const tank of ["flash", "stump", "hammer"] as const) {
      expect(shotDelayFor("peewee").min).toBeLessThan(shotDelayFor(tank).min);
      expect(shotDelayFor("peewee").max).toBeLessThan(shotDelayFor(tank).max);
      expect(shotDelayFor("commander").min).toBeLessThan(shotDelayFor(tank).min);
      expect(shotDelayFor("commander").max).toBeLessThan(shotDelayFor(tank).max);
    }
    expect(shotDelayFor("peewee").max).toBeLessThanOrEqual(shotDelayFor("commander").max);
    // Tank windows are the legacy global window exactly.
    for (const tank of ["flash", "stump", "hammer"] as const) {
      expect(shotDelayFor(tank)).toEqual({ min: SHOT_DELAY_MIN, max: SHOT_DELAY_MAX });
    }
    expect(SHOT_DELAY.peewee.min).toBeGreaterThan(0);
  });

  it("draws its refire inside its own window", () => {
    for (const seed of [1, 2, 3]) {
      const rng = mulberry32(seed);
      for (let n = 0; n < 100; n++) {
        const d = nextShotDelayFor("peewee", rng);
        expect(d).toBeGreaterThanOrEqual(SHOT_DELAY.peewee.min);
        expect(d).toBeLessThanOrEqual(SHOT_DELAY.peewee.max);
      }
    }
    // Mean peewee refire (~0.19 s) is roughly four times as quick as the
    // tank mean (~0.72 s): automatic-rifle beat, lighter hit — the per-hit
    // damage below stays the weakest on the field to compensate.
    const mean = (kind: "peewee" | "flash"): number => {
      const rng = mulberry32(9);
      let total = 0;
      for (let n = 0; n < 400; n++) total += nextShotDelayFor(kind, rng);
      return total / 400;
    };
    expect(mean("peewee")).toBeLessThan(mean("flash") / 1.5);
  });

  it("fires an automatic-rifle beat: small fast bullets, light hits", () => {
    // Rapid light gun: the whole refire window sits well under the tank
    // window, and the mean beat is ~4x the tank mean.
    expect(SHOT_DELAY.peewee).toEqual({ min: 0.09, max: 0.28 });
    const mean = (kind: "peewee" | "flash"): number => {
      const rng = mulberry32(9);
      let total = 0;
      for (let n = 0; n < 400; n++) total += nextShotDelayFor(kind, rng);
      return total / 400;
    };
    expect(mean("peewee")).toBeLessThan(mean("flash") / 3);
    // Fast small bullet: the quickest muzzle velocity on the field with the
    // shortest flash, a rifle crack rather than a cannon boom.
    for (const kind of UNIT_KINDS) {
      if (kind === "peewee") continue;
      expect(WEAPON_PROFILES.peewee.speed).toBeGreaterThanOrEqual(WEAPON_PROFILES[kind].speed);
      expect(WEAPON_PROFILES.peewee.flashTime).toBeLessThanOrEqual(WEAPON_PROFILES[kind].flashTime);
    }
    expect(WEAPON_PROFILES.peewee.speed).toBe(1300);
    // Light hits to compensate: the weakest per-hit damage on the field,
    // against hulls and structures alike, with the smallest splash.
    expect(UNIT_HIT_DAMAGE.peewee).toBe(0.03);
    expect(HQ_HIT_DAMAGE.peewee).toBe(0.015);
    expect(BLAST_RADIUS.peewee).toBe(20);
    expect(PEEWEE_GRENADE_UNIT_DAMAGE).toBe(2 * UNIT_HIT_DAMAGE.peewee);
    expect(PEEWEE_GRENADE_HQ_DAMAGE).toBe(2 * HQ_HIT_DAMAGE.peewee);
  });

  it("lobs grenades inside grenade range, bolts past it", () => {
    expect(PEEWEE_GRENADE_RANGE).toBeLessThan(maxRangeFor("peewee"));
    expect(PEEWEE_GRENADE_RANGE).toBeGreaterThan(PURSUE_STANDOFF.peewee);
    expect(peeweeAttackFor(PEEWEE_GRENADE_RANGE)).toBe("grenade");
    expect(peeweeAttackFor(PEEWEE_GRENADE_RANGE + 1)).toBe("round");
    expect(isPeeweeGrenadeRange(100)).toBe(true);
    expect(isPeeweeGrenadeRange(549)).toBe(false);
    // Too close to depress onto: the muzzle gate still holds fire.
    expect(isPeeweeGrenadeRange(10)).toBe(false);
  });

  it("solves the grenade as a slow high-arc lob, not a cannon flat", () => {
    const from = { x: 0, y: 9, z: 0 };
    const to = { x: 200, y: 9, z: 0 };
    const lob = solvePeeweeGrenade(from, to)!;
    expect(lob).not.toBeNull();
    // Slow lob: much longer hang than any bolt over the same ground.
    expect(lob.duration).toBeGreaterThan(200 / WEAPON_PROFILES.peewee.speed + 1);
    expect(lob.duration).toBeLessThanOrEqual(8);
    // High root: steeper than the cannon's flat low root at full speed.
    const flat = solveBallistic(from, to, WEAPON_PROFILES.hammer.speed, GRAVITY)!;
    expect(lob.elevation).toBeGreaterThan(flat.elevation);
    expect(lob.elevation).toBeGreaterThan(Math.PI / 4);
    expect(PEEWEE_GRENADE_SPEED).toBeLessThan(WEAPON_PROFILES.hammer.speed);
    // Lands on the mark by construction.
    const landed = ballisticPosition(from, lob.velocity, lob.duration, GRAVITY);
    expect(landed.x).toBeCloseTo(to.x, 6);
    expect(landed.y).toBeCloseTo(to.y, 6);
    expect(landed.z).toBeCloseTo(to.z, 6);
  });

  it("splashes grenades harder than bolts but lighter than artillery", () => {
    expect(PEEWEE_GRENADE_UNIT_DAMAGE).toBeGreaterThan(UNIT_HIT_DAMAGE.peewee);
    expect(PEEWEE_GRENADE_UNIT_DAMAGE).toBeLessThan(UNIT_HIT_DAMAGE.hammer);
    expect(unitHitDamage("peewee", "grenade")).toBe(PEEWEE_GRENADE_UNIT_DAMAGE);
    expect(unitHitDamage("peewee")).toBe(UNIT_HIT_DAMAGE.peewee);
    expect(unitHitDamage("flash", "grenade")).toBe(UNIT_HIT_DAMAGE.flash);
    expect(PEEWEE_GRENADE_BLAST_RADIUS).toBeGreaterThan(BLAST_RADIUS.peewee);
    expect(PEEWEE_GRENADE_BLAST_RADIUS).toBeLessThan(BLAST_RADIUS.flash);
    expect(blastRadiusFor("peewee", "grenade")).toBe(PEEWEE_GRENADE_BLAST_RADIUS);
    expect(blastRadiusFor("peewee")).toBe(BLAST_RADIUS.peewee);
    expect(blastRadiusFor("hammer", "grenade")).toBe(BLAST_RADIUS.hammer);
    // Point-blank grenade splash deals exactly the lob damage.
    const damage = createUnitDamage(1);
    applyBlastToUnits(damage, [{ x: 0, z: 0 }], 0, 0, "peewee", undefined, "grenade");
    expect(damage[0]).toBeCloseTo(PEEWEE_GRENADE_UNIT_DAMAGE, 12);
    // Structures chip double the bolt, still lightest after it.
    expect(PEEWEE_GRENADE_HQ_DAMAGE).toBeGreaterThan(HQ_HIT_DAMAGE.peewee);
    expect(hqHitDamage("peewee", "grenade")).toBe(PEEWEE_GRENADE_HQ_DAMAGE);
    const hq = createHqDamage();
    applyBlastToHqs(hq, [{ x: 0, z: 0 }], 0, 0, "peewee", undefined, "grenade");
    expect(hq[0]).toBeCloseTo(PEEWEE_GRENADE_HQ_DAMAGE, 12);
    // Grenade scorch reads bigger than the bolt's, smaller than a tank's.
    const boltScorch = scorchForKind("peewee");
    const lobScorch = scorchForAttack("peewee", "grenade");
    expect(lobScorch.radius).toBeGreaterThan(boltScorch.radius);
    expect(lobScorch.radius).toBeLessThan(scorchForKind("flash").radius);
    expect(scorchForAttack("flash", "grenade")).toEqual(scorchForKind("flash"));
  });
});
