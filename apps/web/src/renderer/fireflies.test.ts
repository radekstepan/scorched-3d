import { mulberry32 } from "@scorched-3d/core";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  FIREFLY_COUNT,
  FIREFLY_DRIFT_RADIUS,
  FIREFLY_MAX_LIFT,
  FIREFLY_MIN_LIFT,
  FIREFLY_POOL_COUNT,
  FIREFLY_POOL_DECAY,
  FIREFLY_POOL_DISTANCE,
  FIREFLY_POOL_PEAK,
  FIREFLY_POOL_RADIUS,
  FIREFLY_TREE_CLEAR,
  FIREFLY_TREE_SPREAD,
  FireflyFx,
  fireflyBlink,
  fireflyDrift,
  fireflyGlow,
  fireflyPoolGlow,
  placeFireflies,
} from "./fireflies";
import { terrainFragment } from "./shaders";

const flatGround = (_x: number, _z: number) => 100;
const trees = [
  { x: -200, z: 50 },
  { x: 300, z: -100 },
  { x: 0, z: 400 },
];

function nearestTreeDistance(x: number, z: number): number {
  return Math.min(...trees.map((t) => Math.hypot(x - t.x, z - t.z)));
}

describe("placeFireflies", () => {
  it("is deterministic for the same seed", () => {
    const a = placeFireflies(mulberry32(7), trees, FIREFLY_COUNT, flatGround);
    const b = placeFireflies(mulberry32(7), trees, FIREFLY_COUNT, flatGround);
    expect(a).toEqual(b);
  });

  it("clusters the swarm around forest stands, lifted above the ground", () => {
    const anchors = placeFireflies(mulberry32(7), trees, FIREFLY_COUNT, flatGround);
    expect(anchors).toHaveLength(FIREFLY_COUNT);
    for (const anchor of anchors) {
      expect(nearestTreeDistance(anchor.x, anchor.z)).toBeLessThanOrEqual(FIREFLY_TREE_SPREAD);
      expect(anchor.lift).toBeGreaterThanOrEqual(FIREFLY_MIN_LIFT);
      expect(anchor.lift).toBeLessThanOrEqual(FIREFLY_MAX_LIFT);
      expect(anchor.y).toBeCloseTo(100 + anchor.lift, 6);
      expect(anchor.phase).toBeGreaterThanOrEqual(0);
      expect(anchor.phase).toBeLessThan(1);
    }
  });

  it("keeps every anchor clear of the trunks so no mote sits inside a crown", () => {
    // Crowns reach ~18 units out; anchors must hold the clearance ring.
    expect(FIREFLY_TREE_CLEAR).toBeGreaterThanOrEqual(18);
    for (const seed of [7, 42, 1337]) {
      const anchors = placeFireflies(mulberry32(seed), trees, FIREFLY_COUNT, flatGround);
      for (const anchor of anchors) {
        expect(nearestTreeDistance(anchor.x, anchor.z)).toBeGreaterThanOrEqual(FIREFLY_TREE_CLEAR);
      }
    }
  });

  it("degrades gracefully in dense stands: deterministic, bounded, never in a trunk", () => {
    // 8-unit grid: crowns overlap, so no point clears every tree.
    const dense: { x: number; z: number }[] = [];
    for (let gx = 0; gx < 6; gx++) for (let gz = 0; gz < 6; gz++) dense.push({ x: gx * 8, z: gz * 8 });
    const a = placeFireflies(mulberry32(7), dense, 20, flatGround);
    const b = placeFireflies(mulberry32(7), dense, 20, flatGround);
    expect(a).toEqual(b);
    expect(a).toHaveLength(20);
    for (const anchor of a) {
      const nearest = Math.min(...dense.map((t) => Math.hypot(anchor.x - t.x, anchor.z - t.z)));
      // Push-out lands on the clearance ring of the nearest trunk at most
      // one spread past the anchor tree — never inside a trunk, never flung.
      expect(nearest).toBeLessThanOrEqual(FIREFLY_TREE_SPREAD + FIREFLY_TREE_CLEAR);
      expect(anchor.y).toBeCloseTo(100 + anchor.lift, 6);
    }
    // And at least some motes still found genuinely clear gaps.
    const clear = a.filter((anchor) =>
      dense.every((t) => Math.hypot(anchor.x - t.x, anchor.z - t.z) >= FIREFLY_TREE_CLEAR),
    );
    expect(clear.length).toBeGreaterThan(0);
  });

  it("falls back to a loose ring around the map when there are no trees", () => {
    const anchors = placeFireflies(mulberry32(7), [], 20, flatGround);
    expect(anchors).toHaveLength(20);
    for (const anchor of anchors) {
      const r = Math.hypot(anchor.x, anchor.z);
      expect(r).toBeGreaterThanOrEqual(120);
      expect(r).toBeLessThanOrEqual(540);
    }
  });
});

describe("fireflyBlink", () => {
  it("stays in 0..1, pulses with period 1/rate, and actually varies", () => {
    const samples = Array.from({ length: 40 }, (_, i) => fireflyBlink(0.13, 0.8, i * 0.05));
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
    expect(fireflyBlink(0.13, 0.8, 2 + 1 / 0.8)).toBeCloseTo(fireflyBlink(0.13, 0.8, 2), 9);
  });
});

describe("fireflyDrift", () => {
  it("wanders within the drift radius around the anchor", () => {
    for (let i = 0; i < 40; i++) {
      const d = fireflyDrift(FIREFLY_DRIFT_RADIUS, 0.31, i * 0.23);
      expect(Math.abs(d.x)).toBeLessThanOrEqual(FIREFLY_DRIFT_RADIUS);
      expect(Math.abs(d.z)).toBeLessThanOrEqual(FIREFLY_DRIFT_RADIUS);
      expect(Math.abs(d.y)).toBeLessThanOrEqual(FIREFLY_DRIFT_RADIUS * 0.25 + 1e-9);
    }
  });
});

describe("fireflyGlow", () => {
  it("rides the blink curve with an ember floor, staying in 0..1", () => {
    const samples = Array.from({ length: 40 }, (_, i) => fireflyGlow(0.13, 0.8, i * 0.05));
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0.08);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
    expect(fireflyGlow(0.13, 0.8, 1.25)).toBeCloseTo(0.08 + 0.92 * fireflyBlink(0.13, 0.8, 1.25), 9);
  });
});

describe("fireflyPoolGlow", () => {
  it("peaks at the pool, halves at the falloff radius, fades far away", () => {
    expect(fireflyPoolGlow(0)).toBe(1);
    expect(fireflyPoolGlow(FIREFLY_POOL_RADIUS)).toBeCloseTo(0.5, 9);
    expect(fireflyPoolGlow(FIREFLY_POOL_RADIUS * 4)).toBeLessThan(0.06);
    expect(fireflyPoolGlow(-5)).toBe(1);
  });

  it("covers a small area: the half-glow radius stays tight", () => {
    expect(FIREFLY_POOL_RADIUS).toBeLessThanOrEqual(40);
    expect(FIREFLY_POOL_DISTANCE).toBeLessThanOrEqual(200);
  });

  it("is mirrored by the terrain shader's additive pool term", () => {
    expect(terrainFragment).toContain("fireflyPools");
    expect(terrainFragment).toContain("fireflyGlows");
    expect(terrainFragment).toContain(String(FIREFLY_POOL_RADIUS));
    expect(terrainFragment).toContain(`fireflyPools[${FIREFLY_POOL_COUNT}]`);
    expect(terrainFragment).toContain(`fireflyGlows[${FIREFLY_POOL_COUNT}]`);
    // Soft lamplight tint — gentle on dark dirt, never floodlit.
    expect(terrainFragment).toContain("0.30, 0.40, 0.14");
    expect(terrainFragment).not.toContain("0.66, 0.88, 0.32");
  });
});

describe("FireflyFx", () => {
  function build(): { scene: THREE.Scene; fx: FireflyFx } {
    const scene = new THREE.Scene();
    const fx = new FireflyFx(scene, placeFireflies(mulberry32(7), trees, FIREFLY_COUNT, flatGround), flatGround);
    return { scene, fx };
  }

  it("starts hidden by day and shows on the night toggle", () => {
    const { fx } = build();
    expect(fx.visible).toBe(false);
    fx.setNight(true);
    expect(fx.visible).toBe(true);
    fx.setNight(false);
    expect(fx.visible).toBe(false);
  });

  it("drifts motes and breathes the ground pools while visible", () => {
    const { fx } = build();
    fx.setNight(true);
    fx.update(1.5);
    const points = fx["points" as never] as THREE.Points;
    const pos = (points.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const col = (points.geometry.getAttribute("color") as THREE.BufferAttribute).array as Float32Array;
    // Anchors sit near trees (hundreds of units out), so seated X/Z are far
    // from the zeroed buffers of a never-updated swarm.
    expect(Math.abs(pos[0]!) + Math.abs(pos[2]!)).toBeGreaterThan(10);
    const brightness = Array.from({ length: FIREFLY_COUNT }, (_, i) => col[i * 3]! + col[i * 3 + 1]! + col[i * 3 + 2]!);
    expect(Math.max(...brightness)).toBeGreaterThan(0);
    expect(new Set(brightness.map((b) => b.toFixed(4))).size).toBeGreaterThan(1);
    // One frame later the swarm has moved.
    const before = pos[0]!;
    fx.update(1.6);
    expect(pos[0]).not.toBe(before);
    for (const pool of fx["pools" as never] as THREE.PointLight[]) {
      expect(pool.intensity).toBeGreaterThan(0);
      expect(pool.intensity).toBeLessThanOrEqual(FIREFLY_POOL_PEAK);
    }
  });

  it("breathes each ground pool with its own mote's blink", () => {
    const { fx } = build();
    fx.setNight(true);
    const anchors = fx["anchors" as never] as { phase: number; rate: number }[];
    for (const t of [0.5, 1.5, 2.5]) {
      fx.update(t);
      const glows = fx.poolGlows();
      expect(glows).toHaveLength(FIREFLY_POOL_COUNT);
      fx.poolLights().forEach((pool, i) => {
        const anchor = anchors[Math.floor((anchors.length * i) / FIREFLY_POOL_COUNT)]!;
        const expected = fireflyGlow(anchor.phase, anchor.rate, t);
        expect(glows[i]).toBeCloseTo(expected, 9);
        expect(pool.intensity).toBeCloseTo(FIREFLY_POOL_PEAK * expected, 9);
      });
    }
    // The pools genuinely pulse: dim embers and bright flashes both occur.
    const seen: number[] = [];
    for (let s = 0; s < 40; s++) {
      fx.update(s * 0.23);
      seen.push(...fx.poolGlows());
    }
    expect(Math.min(...seen)).toBeLessThan(0.3);
    expect(Math.max(...seen)).toBeGreaterThan(0.8);
  });

  it("rides gentle ground-pool lights and re-seats on exaggeration resnap", () => {
    const { scene, fx } = build();
    expect(fx.poolLights()).toHaveLength(FIREFLY_POOL_COUNT);
    expect(FIREFLY_POOL_COUNT).toBeGreaterThan(2);
    // Gentle lamplight: far below muzzle-kick order, short throw, physical decay.
    for (const pool of fx.poolLights()) {
      expect(pool.distance).toBe(FIREFLY_POOL_DISTANCE);
      expect(pool.decay).toBe(FIREFLY_POOL_DECAY);
    }
    expect(FIREFLY_POOL_PEAK).toBeLessThanOrEqual(500);
    expect(FIREFLY_POOL_DISTANCE).toBeLessThanOrEqual(200);
    expect(FIREFLY_POOL_DECAY).toBe(2);
    expect(fx.glowLevel).toBe(0);
    expect(scene.getObjectByName("fireflies")).toBeDefined();
    fx.resnap();
    fx.setNight(true);
    fx.update(0.5);
    const pos = (
      (fx["points" as never] as THREE.Points).geometry.getAttribute("position") as THREE.BufferAttribute
    ).array as Float32Array;
    // Flat ground at 100 + lift band + small vertical wander.
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      expect(pos[i * 3 + 1]!).toBeGreaterThan(100 + FIREFLY_MIN_LIFT - FIREFLY_DRIFT_RADIUS);
      expect(pos[i * 3 + 1]!).toBeLessThan(100 + FIREFLY_MAX_LIFT + FIREFLY_DRIFT_RADIUS);
    }
    expect(fx.glowLevel).toBeGreaterThan(0);
    expect(fx.glowLevel).toBeLessThanOrEqual(1);
    fx.setNight(false);
    expect(fx.glowLevel).toBe(0);
    fx.dispose();
    expect(scene.getObjectByName("fireflies")).toBeUndefined();
  });
});
