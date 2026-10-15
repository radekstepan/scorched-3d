import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  HQ_MAX_SPAWNS,
  HQ_SPAWN_INTERVAL,
  HQ_SPAWN_ROSTER,
  mulberry32,
  pickNextSpawnUnit,
  spawnIntervalFor,
  type UnitKind,
} from "@scorched-3d/core";
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
    // Seeded draw stream: both forts release the kinds a fresh stream draws.
    const seed = 41;
    const hq = new HqFx(scene, anchors(), {
      groundY: () => 40,
      rng: mulberry32(seed),
      onSpawn: (team, kind, x, z) => spawns.push({ team, kind, x, z }),
    });
    const expectRng = mulberry32(seed);
    const kind0 = pickNextSpawnUnit(expectRng);
    const kind1 = pickNextSpawnUnit(expectRng);
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
    // Both forts run the same clock, so both release on the same tick —
    // each its own weighted draw, in team order.
    expect(spawns).toHaveLength(2);
    expect(spawns[0]!.team).toBe(0);
    expect(spawns[1]!.team).toBe(1);
    expect(spawns[0]!.kind).toBe(kind0);
    expect(spawns[1]!.kind).toBe(kind1);
    // Hall mouth sits outside the bunker, toward the map center.
    expect(spawns[0]!.x).toBeGreaterThan(-1000);
    // Door shuts behind the release; both HQs run their own clocks.
    hq.update(HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    expect(hq.doorLift(0)).toBe(0);
    expect(hq.doorLift(1)).toBe(0);
    expect(spawns.map((s) => s.team)).toEqual([0, 1]);
    hq.dispose();
  });

  it("caps releases per team with a seeded, reproducible roster", () => {
    const scene = new THREE.Scene();
    const seed = 7;
    const kinds: string[] = [];
    const hq = new HqFx(scene, [anchors()[0]!], {
      groundY: () => 40,
      rng: mulberry32(seed),
      onSpawn: (_team, kind) => kinds.push(kind),
    });
    for (let n = 0; n < 3 * (HQ_MAX_SPAWNS + 2); n++) {
      hq.update(HQ_SPAWN_INTERVAL + HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    }
    expect(kinds).toHaveLength(HQ_MAX_SPAWNS);
    for (const kind of kinds) expect(HQ_SPAWN_ROSTER).toContain(kind);
    // Same seed, same war: a twin HQ draws the identical sequence.
    const twin: string[] = [];
    const hq2 = new HqFx(scene, [anchors()[0]!], {
      groundY: () => 40,
      rng: mulberry32(seed),
      onSpawn: (_team, kind) => twin.push(kind),
    });
    for (let n = 0; n < 3 * (HQ_MAX_SPAWNS + 2); n++) {
      hq2.update(HQ_SPAWN_INTERVAL + HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    }
    expect(twin).toEqual(kinds);
    expect(hq.spawnedAt(0)).toBe(HQ_MAX_SPAWNS);
    hq.dispose();
    hq2.dispose();
  });

  it("waits longer after stronger releases (per-kind build times)", () => {
    const scene = new THREE.Scene();
    const releases: { kind: UnitKind; at: number }[] = [];
    let clock = 0;
    const hq = new HqFx(scene, [anchors()[0]!], {
      groundY: () => 40,
      rng: mulberry32(99),
      onSpawn: (_team, kind) => releases.push({ kind, at: clock }),
    });
    // Step 1 s at a time until the cap releases (worst case 4 × 70 s).
    for (let n = 0; n < 400 && releases.length < HQ_MAX_SPAWNS; n++) {
      hq.update(1);
      clock += 1;
    }
    expect(releases).toHaveLength(HQ_MAX_SPAWNS);
    // The spawn clock pauses while the door slides (2.6 s against ≥30 s
    // build times), so the gap between two releases is the previous kind's
    // build time plus the door overhead (±1 step of 1 s granularity).
    const door = HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T;
    for (let n = 0; n + 1 < releases.length; n++) {
      const gap = releases[n + 1]!.at - releases[n]!.at;
      const build = spawnIntervalFor(releases[n]!.kind);
      expect(gap).toBeGreaterThanOrEqual(Math.ceil(build) + Math.floor(door) - 1);
      expect(gap).toBeLessThanOrEqual(Math.ceil(build) + Math.ceil(door) + 1);
    }
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

  it("sweeps the warning beacons in sync while the works stand", () => {
    const scene = new THREE.Scene();
    const hq = new HqFx(scene, anchors(), { groundY: () => 40 });
    const groups = [hq.groupAt(0)!, hq.groupAt(1)!];
    const lights = groups.map((g) => g.getObjectByName("hq-beacon-light") as THREE.PointLight);
    const rotors = groups.map((g) => g.getObjectByName("hq-beacon-rotor") as THREE.Group);
    // Fresh forts start lit, rotors parked.
    expect(lights[0]!.intensity).toBeGreaterThan(0);
    expect(lights[1]!.intensity).toBeGreaterThan(0);
    expect(rotors[0]!.rotation.y).toBeCloseTo(0, 9);
    // A quarter period turns both rotors a quarter turn, in sync — and the
    // wash stays on while the rotor sweeps (no blink dark half).
    hq.update(HQ_BEACON_PERIOD * 0.25);
    expect(rotors[0]!.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    expect(rotors[1]!.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    expect(lights[0]!.intensity).toBeGreaterThan(0);
    expect(lights[1]!.intensity).toBeGreaterThan(0);
    // Another quarter turn keeps them locked together.
    hq.update(HQ_BEACON_PERIOD * 0.25);
    expect(rotors[0]!.rotation.y).toBeCloseTo(Math.PI, 6);
    expect(rotors[1]!.rotation.y).toBeCloseTo(rotors[0]!.rotation.y, 9);
    hq.dispose();
  });

  it("kills the beacon on the wreck and keeps it dark", () => {
    const scene = new THREE.Scene();
    const hq = new HqFx(scene, anchors(), { groundY: () => 40 });
    for (let n = 0; n < 40; n++) hq.splash(-1000, 0, "hammer", null);
    expect(hq.isDestroyedAt(0)).toBe(true);
    const light = hq.groupAt(0)!.getObjectByName("hq-beacon-light") as THREE.PointLight;
    expect(light.intensity).toBe(0);
    // Ticks never re-light the wreck; the survivor keeps sweeping lit.
    const rotor = hq.groupAt(0)!.getObjectByName("hq-beacon-rotor") as THREE.Group;
    const parked = rotor.rotation.y;
    hq.update(HQ_BEACON_PERIOD * 2);
    expect(light.intensity).toBe(0);
    expect(rotor.rotation.y).toBe(parked);
    const survivor = hq.groupAt(1)!.getObjectByName("hq-beacon-light") as THREE.PointLight;
    expect(survivor.intensity).toBeGreaterThan(0);
    hq.dispose();
  });
});
