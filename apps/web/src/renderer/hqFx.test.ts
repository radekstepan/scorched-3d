import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HQ_MAX_SPAWNS, HQ_SPAWN_CYCLE, HQ_SPAWN_INTERVAL } from "@scorched-3d/core";
import { doorLiftAt, HqFx, HQ_DOOR_CLOSE_T, HQ_DOOR_HOLD_T, HQ_DOOR_OPEN_T } from "./hqFx";
import { HQ_DOOR_TRAVEL } from "./hq";

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
    expect(kinds).toEqual(["flash", "stump", "hammer", "flash"]);
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
});
