import { describe, expect, it } from "vitest";
import {
  AIM_SCATTER_MAX,
  AIM_SCATTER_RATE,
  BARREL_MOUNT,
  inRange,
  maxRangeFor,
  muzzleForward,
  muzzleHeight,
  scatterRadius,
  solveShot,
  WEAPON_MAX_RANGE,
  WEAPON_PROFILES,
} from "./combat.js";
import { BLAST_RADIUS, scorchForKind } from "./destruction.js";
import { HULL_TURN_RATE, TURRET_LIMIT, TURRET_SLEW_RATE } from "./facing.js";
import { HQ_HIT_DAMAGE, HQ_SPAWN_CYCLE, spawnKindFor } from "./hq.js";
import { LEG_STRIDE, WHEEL_RADIUS } from "./locomotion.js";
import { MOVE_SPEED } from "./movement.js";
import { placeUnits } from "./place.js";
import { PURSUE_STANDOFF } from "./retaliation.js";
import { generateMap } from "../terrain/generate.js";
import { HULL_FOOTPRINT } from "./terrain.js";
import { UNIT_DEFS, UNIT_KINDS } from "./types.js";
import { UNIT_HIT_DAMAGE } from "./unitDamage.js";

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
    expect(HQ_SPAWN_CYCLE).toContain("peewee");
    expect(HQ_SPAWN_CYCLE).not.toContain("commander");
    expect(spawnKindFor(0)).toBe("peewee");
    expect([0, 1, 2, 3, 4].map(spawnKindFor)).toEqual([
      "peewee",
      "flash",
      "stump",
      "hammer",
      "peewee",
    ]);
  });
});
