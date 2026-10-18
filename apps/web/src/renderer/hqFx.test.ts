import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  HQ_SPAWN_INTERVAL,
  HQ_SPAWN_ROSTER,
  mulberry32,
  pickNextSpawnUnit,
  spawnIntervalFor,
  spawnIntervalScale,
  type UnitKind,
} from "@scorched-3d/core";
import { doorLiftAt, HqFx, HQ_DOOR_CLOSE_T, HQ_DOOR_HOLD_T, HQ_DOOR_OPEN_T } from "./hqFx";
import { NIGHT_LIGHT_BOOST } from "./night";
import { HealthBars } from "./healthBars";
import {
  foundationDepthOf,
  getHqFlag,
  getHqBeaconBeams,
  hqBeaconAngleAt,
  hqBeaconAngleOf,
  HQ_BEACON_PERIOD,
  HQ_DOOR_TRAVEL,
  HQ_EXIT_OFFSET,
  HQ_FOUNDATION_MARGIN,
  HQ_SPAWN_OFFSET,
} from "./hq";

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

  it("releases at the door-side hall start and reports the mouth as the exit", () => {
    const scene = new THREE.Scene();
    const spawns: { team: 0 | 1; x: number; z: number; exit: { x: number; z: number } }[] = [];
    const hq = new HqFx(scene, anchors(), {
      groundY: () => 40,
      rng: mulberry32(11),
      onSpawn: (team, _kind, x, z, exit) => spawns.push({ team, x, z, exit }),
    });
    hq.update(HQ_SPAWN_INTERVAL);
    hq.update(HQ_DOOR_OPEN_T);
    expect(spawns).toHaveLength(2);
    // Door-side hall start, mirrored per team — the release walks the hall
    // out of the mouth instead of popping in at it.
    expect(spawns[0]!.x).toBeCloseTo(-1000 + HQ_SPAWN_OFFSET, 9);
    expect(spawns[0]!.z).toBeCloseTo(0, 9);
    expect(spawns[0]!.exit).toEqual({ x: -1000 + HQ_EXIT_OFFSET, z: 0 });
    expect(spawns[1]!.x).toBeCloseTo(1000 - HQ_SPAWN_OFFSET, 9);
    expect(spawns[1]!.z).toBeCloseTo(0, 9);
    expect(spawns[1]!.exit).toEqual({ x: 1000 - HQ_EXIT_OFFSET, z: 0 });
    // The spawn sits between the anchor and the mouth, toward the center.
    expect(hq.spawnAt(0)).toEqual({ x: -1000 + HQ_SPAWN_OFFSET, z: 0 });
    expect(hq.exitAt(0)).toEqual({ x: -1000 + HQ_EXIT_OFFSET, z: 0 });
    expect(hq.spawnAt(0).x).toBeGreaterThan(-1000);
    expect(hq.exitAt(0).x).toBeGreaterThan(hq.spawnAt(0).x);
    hq.dispose();
  });

  it("produces indefinitely with a seeded, reproducible roster", () => {
    // Regression: a 4-release lifetime cap stalled late battles (lone
    // survivor, silent live HQ). A live HQ now releases indefinitely.
    const scene = new THREE.Scene();
    const seed = 7;
    const kinds: string[] = [];
    const hq = new HqFx(scene, [anchors()[0]!], {
      groundY: () => 40,
      rng: mulberry32(seed),
      onSpawn: (_team, kind) => kinds.push(kind),
    });
    for (let n = 0; n < 3 * (8 + 2); n++) {
      hq.update(HQ_SPAWN_INTERVAL + HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    }
    // Drain any release still sliding the door: `spawned` counts the clock
    // draw while `onSpawn` lands at full-open, and a small tick completes
    // the delivery without firing the next clock (rearm ≥ 20 s).
    hq.update(HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    expect(kinds.length).toBeGreaterThan(4);
    for (const kind of kinds) expect(HQ_SPAWN_ROSTER).toContain(kind);
    // Same seed, same war: a twin HQ draws the identical sequence.
    const twin: string[] = [];
    const hq2 = new HqFx(scene, [anchors()[0]!], {
      groundY: () => 40,
      rng: mulberry32(seed),
      onSpawn: (_team, kind) => twin.push(kind),
    });
    for (let n = 0; n < 3 * (8 + 2); n++) {
      hq2.update(HQ_SPAWN_INTERVAL + HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    }
    hq2.update(HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    expect(twin).toEqual(kinds);
    expect(hq.spawnedAt(0)).toBe(kinds.length);
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
    // Step 1 s at a time until 4 releases (worst case 4 × 46⅔ s).
    for (let n = 0; n < 400 && releases.length < 4; n++) {
      hq.update(1);
      clock += 1;
    }
    expect(releases).toHaveLength(4);
    // The spawn clock pauses while the door slides (2.6 s against ≥20 s
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

  it("reports each side's territory share and spawn pace in its status", () => {
    const scene = new THREE.Scene();
    const hq = new HqFx(scene, anchors(), { groundY: () => 40 });
    // Before the first tick the field is cold: even ground, legacy pace.
    expect(hq.status().map((s) => s.share)).toEqual([0.5, 0.5]);
    expect(hq.status().map((s) => s.pace)).toEqual([1, 1]);
    hq.update(0.5, [0.8, 0.2]);
    const [blue, orange] = hq.status();
    expect(blue!.share).toBe(0.8);
    expect(orange!.share).toBe(0.2);
    expect(blue!.pace).toBeCloseTo(1 / spawnIntervalScale(0.8), 9);
    expect(orange!.pace).toBeCloseTo(1 / spawnIntervalScale(0.2), 9);
    expect(blue!.pace).toBeGreaterThan(1);
    expect(orange!.pace).toBeLessThan(1);
    expect(hq.paceAt(0)).toBe(blue!.pace);
    hq.dispose();
  });

  it("rebuilds faster for the side holding more ground", () => {
    const scene = new THREE.Scene();
    const run = (share: number): { kind: UnitKind; at: number }[] => {
      const releases: { kind: UnitKind; at: number }[] = [];
      let clock = 0;
      const hq = new HqFx(scene, [anchors()[0]!], {
        groundY: () => 40,
        rng: mulberry32(99),
        onSpawn: (_team, kind) => releases.push({ kind, at: clock }),
      });
      for (let n = 0; n < 400 && releases.length < 2; n++) {
        hq.update(1, [share, 1 - share]);
        clock += 1;
      }
      hq.dispose();
      return releases;
    };
    const ahead = run(1);
    const behind = run(0);
    expect(ahead).toHaveLength(2);
    expect(behind).toHaveLength(2);
    // Same seed, same kinds — the territory share only paces the rearm.
    expect(ahead.map((r) => r.kind)).toEqual(behind.map((r) => r.kind));
    const door = HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T;
    const build = spawnIntervalFor(ahead[0]!.kind);
    const gapAhead = ahead[1]!.at - ahead[0]!.at;
    const gapBehind = behind[1]!.at - behind[0]!.at;
    expect(gapAhead).toBeLessThan(gapBehind);
    expect(gapAhead).toBeGreaterThanOrEqual(Math.ceil(build * spawnIntervalScale(1)) - 1);
    expect(gapAhead).toBeLessThanOrEqual(Math.ceil(build * spawnIntervalScale(1)) + Math.ceil(door) + 1);
    expect(gapBehind).toBeGreaterThanOrEqual(Math.ceil(build * spawnIntervalScale(0)) - 1);
    expect(gapBehind).toBeLessThanOrEqual(Math.ceil(build * spawnIntervalScale(0)) + Math.ceil(door) + 1);
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

  it("stands the surviving factory down once the enemy HQ falls", () => {
    // The first wreck ends the war: the survivor stops reinforcing against
    // a dead enemy instead of producing forever after victory.
    const scene = new THREE.Scene();
    const spawns: { team: 0 | 1 }[] = [];
    const hq = new HqFx(scene, anchors(), {
      groundY: () => 40,
      rng: mulberry32(5),
      onSpawn: (team) => spawns.push({ team }),
    });
    // Both forts release on the first interval.
    hq.update(HQ_SPAWN_INTERVAL);
    hq.update(HQ_DOOR_OPEN_T);
    expect(spawns.map((s) => s.team)).toEqual([0, 1]);
    // Flatten the east fort; the west clock must never fire again.
    for (let n = 0; n < 40; n++) hq.splash(1000, 0, "hammer", null);
    expect(hq.isDestroyedAt(1)).toBe(true);
    expect(hq.isDestroyedAt(0)).toBe(false);
    // Drain the survivor's door, then run long past several build times
    // plus a door cycle (a draw only delivers at full-open): no new draws
    // (spawned frozen) and no new deliveries.
    hq.update(HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    hq.update(10 * HQ_SPAWN_INTERVAL);
    hq.update(HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    expect(spawns.map((s) => s.team)).toEqual([0, 1]);
    expect(hq.spawnedAt(0)).toBe(1);
    expect(hq.spawnedAt(1)).toBe(1);
    hq.dispose();
  });

  it("walks an in-flight release out after the enemy HQ falls", () => {
    // Both clocks fire on the same tick; the east wreck cancels its own
    // door (never delivers) but the west door already sliding walks its
    // release out instead of freezing mid-door — then both stay quiet.
    const scene = new THREE.Scene();
    const spawns: { team: 0 | 1 }[] = [];
    const hq = new HqFx(scene, anchors(), {
      groundY: () => 40,
      rng: mulberry32(5),
      onSpawn: (team) => spawns.push({ team }),
    });
    hq.update(HQ_SPAWN_INTERVAL);
    expect(spawns).toHaveLength(0);
    for (let n = 0; n < 40; n++) hq.splash(1000, 0, "hammer", null);
    expect(hq.isDestroyedAt(1)).toBe(true);
    hq.update(HQ_DOOR_OPEN_T);
    expect(spawns.map((s) => s.team)).toEqual([0]);
    // Drain the door, run long past several build times, drain again: the
    // survivor's clock stays frozen and nothing else walks out.
    hq.update(10 * HQ_SPAWN_INTERVAL);
    hq.update(HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    hq.update(10 * HQ_SPAWN_INTERVAL);
    hq.update(HQ_DOOR_OPEN_T + HQ_DOOR_HOLD_T + HQ_DOOR_CLOSE_T);
    expect(spawns.map((s) => s.team)).toEqual([0]);
    expect(hq.spawnedAt(0)).toBe(1);
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

  it("ticks flag wind on live forts and freezes it after destruction or a paused tick", () => {
    const hq = new HqFx(new THREE.Scene(), anchors(), { groundY: () => 40 });
    const flag = getHqFlag(hq.groupAt(0)!)!;
    const positions = () => Array.from(flag.geometry.getAttribute("position").array);
    const initial = positions();
    hq.update(0.25);
    expect(positions()).not.toEqual(initial);
    const moving = positions();
    hq.update(0);
    expect(positions()).toEqual(moving);
    for (let n = 0; n < 40; n++) hq.splash(-1000, 0, "hammer", null);
    expect(hq.groupAt(0)!.userData.hqWrecked).toBe(true);
    hq.update(0.25);
    expect(positions()).toEqual(moving);
    hq.dispose();
  });

  it("sweeps the beacon rotors while the halos hold steady", () => {
    const scene = new THREE.Scene();
    const hq = new HqFx(scene, anchors(), { groundY: () => 40 });
    const groups = [hq.groupAt(0)!, hq.groupAt(1)!];
    const lights = groups.map((g) => g.getObjectByName("hq-beacon-light") as THREE.PointLight);
    const glows = groups.map((g) => g.getObjectByName("hq-beacon-glow") as THREE.Sprite);
    const opacity = (s: THREE.Sprite): number => (s.material as THREE.SpriteMaterial).opacity;
    // Fresh forts start lit with their halos on, rotors parked at zero.
    expect(lights[0]!.intensity).toBeGreaterThan(0);
    expect(lights[1]!.intensity).toBeGreaterThan(0);
    expect(opacity(glows[0]!)).toBeGreaterThan(0);
    expect(opacity(glows[1]!)).toBeCloseTo(opacity(glows[0]!), 9);
    expect(hqBeaconAngleOf(groups[0]!)).toBe(0);
    expect(hqBeaconAngleOf(groups[1]!)).toBe(0);
    for (const g of groups) expect(getHqBeaconBeams(g)).toHaveLength(2);
    // Ticks circle both rotors off the shared clock — the odd fort leads
    // by half a turn, so the sweeps never march in lockstep.
    hq.update(0.5);
    expect(hqBeaconAngleOf(groups[0]!)).toBeCloseTo(hqBeaconAngleAt(0.5), 9);
    expect(hqBeaconAngleOf(groups[1]!)).toBeCloseTo(
      hqBeaconAngleAt(0.5 + HQ_BEACON_PERIOD * 0.5),
      9,
    );
    hq.update(0.5);
    expect(hqBeaconAngleOf(groups[0]!)).toBeCloseTo(hqBeaconAngleAt(1), 9);
    expect(hqBeaconAngleOf(groups[1]!)).toBeCloseTo(hqBeaconAngleAt(1 + HQ_BEACON_PERIOD * 0.5), 9);
    // The sweep never disturbs the burn: same wash, same halo on both.
    expect(lights[0]!.intensity).toBeGreaterThan(0);
    expect(lights[1]!.intensity).toBeCloseTo(lights[0]!.intensity, 9);
    expect(opacity(glows[0]!)).toBeGreaterThan(0);
    expect(opacity(glows[1]!)).toBeCloseTo(opacity(glows[0]!), 9);
    for (const g of groups) {
      for (const beam of getHqBeaconBeams(g)) {
        expect(beam.visible).toBe(true);
        expect(
          ((beam.material as THREE.ShaderMaterial).uniforms.uLevel as { value: number }).value,
        ).toBe(1);
      }
    }
    hq.dispose();
  });

  it("holds the same halo opacity and core burn across many ticks", () => {
    const scene = new THREE.Scene();
    const hq = new HqFx(scene, anchors(), { groundY: () => 40 });
    const groups = [hq.groupAt(0)!, hq.groupAt(1)!];
    const glows = groups.map((g) => g.getObjectByName("hq-beacon-glow") as THREE.Sprite);
    const bulbs = groups.map((g) => g.getObjectByName("hq-beacon-bulb") as THREE.Mesh);
    hq.update(0.25);
    const steadyOpacity = (glows[0]!.material as THREE.SpriteMaterial).opacity;
    const steadyBurn = (bulbs[0]!.material as THREE.MeshLambertMaterial).emissiveIntensity;
    expect(steadyOpacity).toBeGreaterThan(0);
    expect(steadyBurn).toBeGreaterThan(0);
    for (let n = 0; n < 8; n++) hq.update(0.25);
    for (const i of [0, 1]) {
      expect((glows[i]!.material as THREE.SpriteMaterial).opacity).toBeCloseTo(steadyOpacity, 9);
      expect((bulbs[i]!.material as THREE.MeshLambertMaterial).emissiveIntensity).toBeCloseTo(steadyBurn, 9);
      expect(glows[i]!.visible).toBe(true);
    }
    hq.dispose();
  });

  it("burns live beacons hotter by night and drops back by day", () => {
    const scene = new THREE.Scene();
    const hq = new HqFx(scene, anchors(), { groundY: () => 40 });
    hq.update(0.1);
    const light = () => hq.groupAt(0)!.getObjectByName("hq-beacon-light") as THREE.PointLight;
    const day = light().intensity;
    expect(day).toBeGreaterThan(0);
    hq.setNight(true);
    hq.update(0.1);
    expect(light().intensity).toBeCloseTo(day * NIGHT_LIGHT_BOOST, 9);
    hq.setNight(false);
    hq.update(0.1);
    expect(light().intensity).toBeCloseTo(day, 9);
    // Night never re-lights a wreck.
    for (let n = 0; n < 40; n++) hq.splash(-1000, 0, "hammer", null);
    hq.setNight(true);
    hq.update(0.1);
    expect(light().intensity).toBe(0);
    hq.dispose();
  });

  it("kills the beacon on the wreck and keeps it dark", () => {
    const scene = new THREE.Scene();
    const hq = new HqFx(scene, anchors(), { groundY: () => 40 });
    hq.update(0.5);
    for (let n = 0; n < 40; n++) hq.splash(-1000, 0, "hammer", null);
    expect(hq.isDestroyedAt(0)).toBe(true);
    const light = hq.groupAt(0)!.getObjectByName("hq-beacon-light") as THREE.PointLight;
    expect(light.intensity).toBe(0);
    const glow = hq.groupAt(0)!.getObjectByName("hq-beacon-glow") as THREE.Sprite;
    expect(glow.visible).toBe(false);
    expect((glow.material as THREE.SpriteMaterial).opacity).toBe(0);
    const deadBeams = getHqBeaconBeams(hq.groupAt(0)!);
    expect(deadBeams).toHaveLength(2);
    for (const beam of deadBeams) {
      expect(beam.visible).toBe(false);
      expect(
        ((beam.material as THREE.ShaderMaterial).uniforms.uLevel as { value: number }).value,
      ).toBe(0);
    }
    // Ticks never re-light the wreck and its rotor freezes where it died;
    // the survivor keeps burning lit and keeps sweeping.
    const deadAngle = hqBeaconAngleOf(hq.groupAt(0)!);
    const liveAngle = hqBeaconAngleOf(hq.groupAt(1)!);
    hq.update(2);
    expect(light.intensity).toBe(0);
    expect(glow.visible).toBe(false);
    expect(hqBeaconAngleOf(hq.groupAt(0)!)).toBe(deadAngle);
    expect(hqBeaconAngleOf(hq.groupAt(1)!)).not.toBe(liveAngle);
    const survivor = hq.groupAt(1)!.getObjectByName("hq-beacon-light") as THREE.PointLight;
    expect(survivor.intensity).toBeGreaterThan(0);
    const survivorGlow = hq.groupAt(1)!.getObjectByName("hq-beacon-glow") as THREE.Sprite;
    expect(survivorGlow.visible).toBe(true);
    expect((survivorGlow.material as THREE.SpriteMaterial).opacity).toBeGreaterThan(0);
    hq.dispose();
  });
});
