import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HQ_MAX_SPAWNS, HQ_SPAWN_CYCLE, HQ_SPAWN_INTERVAL } from "@scorched-3d/core";
import { doorLiftAt, HqFx, HQ_DOOR_CLOSE_T, HQ_DOOR_HOLD_T, HQ_DOOR_OPEN_T } from "./hqFx";
import { HQ_BEACON_PERIOD } from "./hq";
import { HealthBars } from "./healthBars";
import { foundationDepthOf, HQ_DOOR_TRAVEL, HQ_FOUNDATION_MARGIN } from "./hq";

function anchors() {
  return [
    { x: -1000, y: 40, z: 0, team: 0 as const },
    { x: 1000, y: 40, z: 0, team: 1 as const },
  ];
}

describe("doorLiftAt", () => {
  it("slides up, holds, slides shut", () => {
    expect(doorLiftAt(-1)).toBe(0);
    expect(doorLiftAt(0)).toBe(0);
    expect(doorLiftAt(HQ_DOOR_OPEN_T)).toBeCloseTo(HQ_DOOR_TRAVEL, 9);
    expect(doorLiftAt(HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T)).toBeCloseTo(HQ_DOOR_TRAVEL, 9);
    const mid = doorLiftAt(HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(HQ_DOOR_TRAVEL);
    expect(doorLiftAt(HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T)).toBe(0);
  });
});

describe("HqFx", () => {
  it("releases one reinforcement per interval through the hall mouth", () => {
    const scene = new THREE.Scene();
    const spawns: { team: 0 | 1; kind: string; x: number; z: number }[] = [];
    const hq = new HqFx(scene, anchors(), {
      groundY: () => 40,
      onSpawn: (team, kind, x, z) => spawns.push({ team, kind, x, z }),
    });
    expect(hq.count).toBe(2);
    // Nothing before the first interval.
    hq.update(HQ_SPAWN_INTERVAL - 1);
    expect(spawns).toHaveLength(0);
    expect(hq.doorLift(0)).toBe(0);
    // The interval tick starts the door; the release lands at full-open.
    hq.update(1);
    expect(hq.doorLift(0)).toBe(0);
    hq.update(HQ_DOOR_OPEN_T / 2);
    expect(hq.doorLift(0)).toBeGreaterThan(0);
    expect(spawns).toHaveLength(0);
    hq.update(HQ_DOOR_OPEN_T / 2);
    // Both forts run the same clock, so both release on the same tick.
    expect(spawns).toHaveLength(2);
    expect(spawns[0]!.team).toBe(0);
    expect(spawns[1]!.team).toBe(1);
    expect(spawns[0]!.kind).toBe(HQ_SPAWN_CYCLE[0]);
    // Hall mouth sits outside the bunker, toward the map center.
    expect(spawns[0]!.x).toBeGreaterThan(-1000);
    // Door shuts behind the release; both HQs run their own clocks.
    hq.update(HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    expect(hq.doorLift(0)).toBe(0);
    expect(hq.doorLift(1)).toBe(0);
    expect(spawns.map((s) => s.team)).toEqual([0, 1]);
    hq.dispose();
  });

  it("caps releases per team and cycles the roster", () => {
    const scene = new THREE.Scene();
    const kinds: string[] = [];
    const hq = new HqFx(scene, [anchors()[0]!], {
      groundY: () => 40,
      onSpawn: (_team, kind) => kinds.push(kind),
    });
    for (let n = 0; n < 3 * (HQ_MAX_SPAWNS + 2); n++) {
      hq.update(HQ_SPAWN_INTERVAL + HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    }
    expect(kinds).toHaveLength(HQ_MAX_SPAWNS);
    expect(kinds).toEqual(["peewee", "flash", "stump", "hammer"]);
    expect(hq.spawnedAt(0)).toBe(HQ_MAX_SPAWNS);
    hq.dispose();
  });

  it("wrecks once under fire and stops spawning", () => {
    const scene = new THREE.Scene();
    let kills = 0;
    let damaged = 0;
    const hq = new HqFx(scene, anchors(), {
      groundY: () => 40,
      onKilled: () => kills++,
      onDamaged: () => damaged++,
    });
    // Collateral chips first (no kill yet), then the wall gives.
    hq.splash(-1000, 0, "flash", null);
    expect(hq.isDestroyedAt(0)).toBe(false);
    expect(damaged).toBeGreaterThan(0);
    for (let n = 0; n < 40; n++) hq.splash(-1000, 0, "hammer", null);
    expect(hq.isDestroyedAt(0)).toBe(true);
    expect(kills).toBe(1);
    expect(hq.targets().map((t) => t.team)).toEqual([1]);
    // Post-death barrages never re-kill; the clock never releases again.
    hq.splash(-1000, 0, "hammer", null);
    expect(kills).toBe(1);
    hq.update(10 * HQ_SPAWN_INTERVAL);
    expect(hq.spawnedAt(0)).toBe(0);
    hq.dispose();
  });

  it("re-seats on the live surface", () => {
    const scene = new THREE.Scene();
    let ground = 40;
    const hq = new HqFx(scene, anchors(), { groundY: () => ground });
    ground = 90;
    hq.resnap();
    expect(hq.targets()[0]!.y).toBe(100);
    hq.dispose();
  });

  it("seats the footings into a slope and re-measures on resnap", () => {
    const scene = new THREE.Scene();
    // Hillsides falling toward the map center on both ends: each downhill
    // hall mouth sits `steep` below its anchor.
    let steep = 60;
    const groundY = (x: number): number => 40 - ((1000 - Math.abs(x)) / 178) * steep;
    const hq = new HqFx(scene, anchors(), { groundY });
    const groups = scene.children.filter((c) => c.name === "hq") as THREE.Group[];
    expect(groups).toHaveLength(2);
    // Both forts bridge their own fall plus the burial margin.
    expect(foundationDepthOf(groups[0]!)).toBeCloseTo(steep + HQ_FOUNDATION_MARGIN, 0);
    expect(foundationDepthOf(groups[1]!)).toBeCloseTo(steep + HQ_FOUNDATION_MARGIN, 0);
    // Steepen the hill (exaggeration slider) and re-snap: the footings
    // follow instead of re-opening the air gap.
    steep = 120;
    hq.resnap();
    expect(foundationDepthOf(groups[0]!)).toBeCloseTo(steep + HQ_FOUNDATION_MARGIN, 0);
    expect(foundationDepthOf(groups[1]!)).toBeCloseTo(steep + HQ_FOUNDATION_MARGIN, 0);
    hq.dispose();
  });

  it("exposes groups for the shared health toggle and feeds live damage", () => {
    const scene = new THREE.Scene();
    const hq = new HqFx(scene, anchors(), { groundY: () => 40 });
    // Anchors for bar seating (null past the roster); both forts present.
    expect(hq.groupAt(0)).not.toBeNull();
    expect(hq.groupAt(1)).not.toBeNull();
    expect(hq.groupAt(0)).not.toBe(hq.groupAt(1));
    expect(hq.groupAt(2)).toBeNull();
    // HqFx satisfies the bar source structurally: pristine forts draw full
    // bars, shelled forts drain, wrecked forts hide.
    const bars = new HealthBars(scene, 0);
    const camera = new THREE.PerspectiveCamera();
    bars.setHqCount(hq.count);
    const groups = Array.from({ length: hq.count }, (_, i) => hq.groupAt(i));
    bars.updateHq(hq, groups, camera);
    expect(bars.isHqShown(0)).toBe(true);
    expect(bars.isHqShown(1)).toBe(true);
    expect(bars.hqFraction(0)).toBeCloseTo(1, 6);
    hq.splash(-1000, 0, "hammer", null);
    bars.updateHq(hq, groups, camera);
    expect(bars.hqFraction(0)).toBeLessThan(1);
    expect(bars.isHqShown(0)).toBe(true);
    for (let n = 0; n < 40; n++) hq.splash(-1000, 0, "hammer", null);
    expect(hq.isDestroyedAt(0)).toBe(true);
    bars.updateHq(hq, groups, camera);
    expect(bars.isHqShown(0)).toBe(false);
    expect(bars.isHqShown(1)).toBe(true);
    bars.dispose();
    hq.dispose();
  });

  it("blinks the warning beacons in sync while the works stand", () => {
    const scene = new THREE.Scene();
    const hq = new HqFx(scene, anchors(), { groundY: () => 40 });
    const lights = [hq.groupAt(0)!, hq.groupAt(1)!].map(
      (g) => g.getObjectByName("hq-beacon-light") as THREE.PointLight,
    );
    // Fresh forts start lit.
    expect(lights[0]!.intensity).toBeGreaterThan(0);
    expect(lights[1]!.intensity).toBeGreaterThan(0);
    // Advance into the dark half of the period: both go dark together.
    hq.update(HQ_BEACON_PERIOD * 0.75);
    expect(lights[0]!.intensity).toBe(0);
    expect(lights[1]!.intensity).toBe(0);
    // And back into the lit half a quarter period later.
    hq.update(HQ_BEACON_PERIOD * 0.5);
    expect(lights[0]!.intensity).toBeGreaterThan(0);
    expect(lights[1]!.intensity).toBeGreaterThan(0);
    hq.dispose();
  });

  it("kills the beacon on the wreck and keeps it dark", () => {
    const scene = new THREE.Scene();
    const hq = new HqFx(scene, anchors(), { groundY: () => 40 });
    for (let n = 0; n < 40; n++) hq.splash(-1000, 0, "hammer", null);
    expect(hq.isDestroyedAt(0)).toBe(true);
    const light = hq.groupAt(0)!.getObjectByName("hq-beacon-light") as THREE.PointLight;
    expect(light.intensity).toBe(0);
    // Ticks never re-light the wreck; the survivor keeps flashing.
    hq.update(HQ_BEACON_PERIOD * 2);
    expect(light.intensity).toBe(0);
    const survivor = hq.groupAt(1)!.getObjectByName("hq-beacon-light") as THREE.PointLight;
    expect(survivor.intensity).toBeGreaterThan(0);
    hq.dispose();
  });
});
