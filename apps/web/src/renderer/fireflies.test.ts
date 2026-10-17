import { mulberry32 } from "@scorched-3d/core";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  FIREFLY_COUNT,
  FIREFLY_DRIFT_RADIUS,
  FIREFLY_DRIFT_SPEED,
  FIREFLY_GLOW_AMP,
  FIREFLY_GLOW_FLOOR,
  FIREFLY_MAX_LIFT,
  FIREFLY_MIN_LIFT,
  FIREFLY_POOL_COUNT,
  FIREFLY_POOL_DECAY,
  FIREFLY_POOL_DISTANCE,
  FIREFLY_POOL_PEAK,
  FIREFLY_POOL_RADIUS,
  FIREFLY_POOL_SHARE,
  FIREFLY_POOL_TINT_GLSL,
  FIREFLY_RATE_MAX,
  FIREFLY_RATE_MIN,
  FIREFLY_TREE_CLEAR,
  FIREFLY_TREE_SPREAD,
  applyFireflyTreeGlow,
  FireflyFx,
  fireflyBlink,
  fireflyDrift,
  fireflyGlow,
  fireflyPoolGlow,
  placeFireflies,
  spliceFireflyTreeFragment,
  spliceFireflyTreeVertex,
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

  it("deals slow pulse rates: breathing, never strobing", () => {
    // Gentle pulsation needs slow rates — sub-Hz, so a full breath takes
    // seconds. Anything near 1 Hz reads as flashing.
    expect(FIREFLY_RATE_MIN).toBeGreaterThan(0);
    expect(FIREFLY_RATE_MAX).toBeLessThanOrEqual(0.35);
    const anchors = placeFireflies(mulberry32(7), trees, FIREFLY_COUNT, flatGround);
    for (const anchor of anchors) {
      expect(anchor.rate).toBeGreaterThanOrEqual(FIREFLY_RATE_MIN);
      expect(anchor.rate).toBeLessThanOrEqual(FIREFLY_RATE_MAX);
    }
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

  it("breathes evenly: half the cycle bright, no brief-flash duty cycle", () => {
    // A cubed sine spends most of its cycle dim and flashes briefly; a
    // pure sine splits the cycle evenly — the gentle pulsation we want.
    const samples = Array.from({ length: 200 }, (_, i) => fireflyBlink(0.13, 0.2, i * 0.05));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    const bright = samples.filter((s) => s > 0.5).length / samples.length;
    expect(bright).toBeGreaterThan(0.4);
    expect(bright).toBeLessThan(0.6);
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

  it("drifts slightly faster than the legacy amble, on the same orbit shape", () => {
    // Legacy wander: 0.42 rad/s (itself a retune of the original hardcoded
    // 0.35 amble). This retune lifts the named speed slightly again —
    // livelier motes, same lissajous shape + radius.
    const LEGACY_SPEED = 0.42;
    expect(FIREFLY_DRIFT_SPEED).toBeGreaterThan(LEGACY_SPEED);
    expect(FIREFLY_DRIFT_SPEED / LEGACY_SPEED).toBeLessThan(1.3);
    // fireflyDrift actually runs at the named speed (phase 0: x = cos(w*t)*r).
    expect(fireflyDrift(9, 0, 1).x).toBeCloseTo(Math.cos(FIREFLY_DRIFT_SPEED) * 9, 9);
    // ...and covers more ground per second than the legacy curve.
    const legacyDrift = (radius: number, phase: number, t: number) => {
      const a = t * LEGACY_SPEED + phase * Math.PI * 2;
      return {
        x: Math.cos(a) * radius,
        y: Math.sin(a * 1.7 + phase * 4) * radius * 0.25,
        z: Math.sin(a * 0.8 + phase * 2) * radius,
      };
    };
    const travel = (d: (r: number, p: number, t: number) => { x: number; y: number; z: number }) => {
      const a = d(9, 0.31, 0);
      const b = d(9, 0.31, 1);
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    };
    const ratio = travel(fireflyDrift) / travel(legacyDrift);
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.5);
  });
});

describe("fireflyGlow", () => {
  it("breathes gently on a high floor: always glowing, never dark", () => {
    // Gentle pulsation = a narrow band near full brightness (nanolathe's
    // fire-flicker precedent), not an ember floor with brief flashes.
    expect(FIREFLY_GLOW_FLOOR).toBeGreaterThanOrEqual(0.7);
    expect(FIREFLY_GLOW_FLOOR + FIREFLY_GLOW_AMP).toBeLessThanOrEqual(1);
    const samples = Array.from({ length: 40 }, (_, i) => fireflyGlow(0.13, 0.8, i * 0.05));
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(FIREFLY_GLOW_FLOOR);
      expect(s).toBeLessThanOrEqual(FIREFLY_GLOW_FLOOR + FIREFLY_GLOW_AMP);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.15);
    expect(fireflyGlow(0.13, 0.8, 1.25)).toBeCloseTo(
      FIREFLY_GLOW_FLOOR + FIREFLY_GLOW_AMP * fireflyBlink(0.13, 0.8, 1.25),
      9,
    );
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

  it("pools tighter per mote while the roaming light travels further", () => {
    // Legacy tune: 38-radius pools, 150-cutoff roaming lights. The retune
    // shrinks each mote's illuminated patch slightly and extends the
    // PointLight throw slightly — peak and decay untouched, so the
    // near-field halo reads the same and only the footprint changes.
    const LEGACY_RADIUS = 38;
    const LEGACY_DISTANCE = 150;
    expect(FIREFLY_POOL_PEAK).toBe(320);
    expect(FIREFLY_POOL_DECAY).toBe(2);
    // Smaller area: the half-glow point pulls in, and the old half-glow
    // distance now reads below half.
    expect(FIREFLY_POOL_RADIUS).toBeLessThan(LEGACY_RADIUS);
    expect(FIREFLY_POOL_RADIUS / LEGACY_RADIUS).toBeGreaterThan(0.8);
    expect(fireflyPoolGlow(LEGACY_RADIUS)).toBeLessThan(0.5);
    expect(fireflyPoolGlow(FIREFLY_POOL_RADIUS)).toBeCloseTo(0.5, 9);
    // Further travel: the roaming-light cutoff pushes out, slightly.
    expect(FIREFLY_POOL_DISTANCE).toBeGreaterThan(LEGACY_DISTANCE);
    expect(FIREFLY_POOL_DISTANCE / LEGACY_DISTANCE).toBeLessThan(1.3);
    // Both surfaces mirror the tighter radius — terrain's hand-authored
    // pool term moves with the constant, leaving no stale 38 behind.
    expect(terrainFragment).toContain(`${FIREFLY_POOL_RADIUS}.0`);
    expect(terrainFragment).not.toContain(`${LEGACY_RADIUS}.0`);
  });

  it("is mirrored by the terrain shader's one-slot-per-mote pool term", () => {
    expect(terrainFragment).toContain("fireflyPools");
    expect(terrainFragment).toContain("fireflyGlows");
    expect(terrainFragment).toContain(String(FIREFLY_POOL_RADIUS));
    // Every mote gets a slot — the field spans the whole swarm, not just
    // the few motes near a roaming PointLight.
    expect(terrainFragment).toContain(`fireflyPools[${FIREFLY_COUNT}]`);
    expect(terrainFragment).toContain(`fireflyGlows[${FIREFLY_COUNT}]`);
    expect(terrainFragment).toContain(`i < ${FIREFLY_COUNT}`);
    // Soft lamplight tint — gentle on dark dirt, never floodlit.
    expect(terrainFragment).toContain(FIREFLY_POOL_TINT_GLSL);
    expect(terrainFragment).not.toContain("0.66, 0.88, 0.32");
    // ...at the old-slot budget share, so the full-swarm total stays at
    // the tuned lamplight level instead of multiplying ~15x.
    expect(FIREFLY_POOL_SHARE * FIREFLY_COUNT).toBeCloseTo(FIREFLY_POOL_COUNT, 12);
    expect(terrainFragment).toContain(`(${FIREFLY_POOL_COUNT}.0 / ${FIREFLY_COUNT}.0)`);
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
    // The pools genuinely breathe within the gentle band: neither dark
    // embers nor hard flashes, just a soft swell around near-full glow.
    const seen: number[] = [];
    for (let s = 0; s < 40; s++) {
      fx.update(s * 0.23);
      seen.push(...fx.poolGlows());
    }
    for (const g of seen) {
      expect(g).toBeGreaterThanOrEqual(FIREFLY_GLOW_FLOOR);
      expect(g).toBeLessThanOrEqual(FIREFLY_GLOW_FLOOR + FIREFLY_GLOW_AMP);
    }
    expect(Math.min(...seen)).toBeLessThan(0.85);
    expect(Math.max(...seen)).toBeGreaterThan(0.95);
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

  it("mirrors every mote's live position and pulse into the shader field", () => {
    const { fx } = build();
    fx.setNight(true);
    fx.update(1.5);
    const poolU = Array.from({ length: FIREFLY_COUNT }, () => new THREE.Vector3());
    const glowU = new Array<number>(FIREFLY_COUNT).fill(-1);
    fx.writeField(poolU, glowU, true);
    const anchors = fx["anchors" as never] as { phase: number; rate: number }[];
    const pos = (
      (fx["points" as never] as THREE.Points).geometry.getAttribute("position") as THREE.BufferAttribute
    ).array as Float32Array;
    // One slot per mote: positions match the live sprite buffers exactly,
    // and each glow tracks its own mote's pulse — no mote left unmirrored.
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      expect(poolU[i]!.x).toBeCloseTo(pos[i * 3]!, 9);
      expect(poolU[i]!.y).toBeCloseTo(pos[i * 3 + 1]!, 9);
      expect(poolU[i]!.z).toBeCloseTo(pos[i * 3 + 2]!, 9);
      const anchor = anchors[i]!;
      expect(glowU[i]).toBeCloseTo(fireflyGlow(anchor.phase, anchor.rate, 1.5), 9);
    }
    // The field tracks drift: one frame later the slots have moved.
    fx.update(1.6);
    const before = poolU[0]!.x;
    fx.writeField(poolU, glowU, true);
    expect(poolU[0]!.x).not.toBe(before);
  });

  it("gates the whole field by night and zeroes slots past the anchors", () => {
    const { fx } = build();
    fx.setNight(true);
    fx.update(1.5);
    const poolU = Array.from({ length: FIREFLY_COUNT + 4 }, () => new THREE.Vector3());
    const glowU = new Array<number>(FIREFLY_COUNT + 4).fill(-1);
    fx.writeField(poolU, glowU, false);
    for (const g of glowU) expect(g).toBe(0);
    fx.writeField(poolU, glowU, true);
    for (let i = 0; i < FIREFLY_COUNT; i++) expect(glowU[i]).toBeGreaterThan(0);
    for (let i = FIREFLY_COUNT; i < glowU.length; i++) expect(glowU[i]).toBe(0);
  });
});
describe("firefly tree glow", () => {
  it("splices a world-position varying into the Lambert vertex shader", () => {
    const out = spliceFireflyTreeVertex("prefix\n#include <project_vertex>\nsuffix");
    expect(out).toContain("varying vec3 vFireflyWorld;");
    expect(out).toContain("#include <project_vertex>");
    // Instanced trees fold instanceMatrix in (guarded: the same chunk must
    // also compile for non-instanced meshes), then modelMatrix to world.
    expect(out).toContain("#ifdef USE_INSTANCING");
    expect(out).toContain("instanceMatrix * ffWorldPos");
    expect(out).toContain("( modelMatrix * ffWorldPos ).xyz");
  });

  it("splices the full-swarm pool loop into the Lambert fragment shader", () => {
    const out = spliceFireflyTreeFragment("prefix\n#include <emissivemap_fragment>\nsuffix");
    expect(out).toContain(`uniform vec3 fireflyPools[${FIREFLY_COUNT}]`);
    expect(out).toContain(`uniform float fireflyGlows[${FIREFLY_COUNT}]`);
    expect(out).toContain("varying vec3 vFireflyWorld;");
    expect(out).toContain(`i < ${FIREFLY_COUNT}`);
    // Same falloff shape, tint, and budget share as the terrain term.
    expect(out).toContain(`${FIREFLY_POOL_RADIUS}.0`);
    expect(out).toContain(FIREFLY_POOL_TINT_GLSL);
    expect(out).toContain(`(${FIREFLY_POOL_COUNT}.0 / ${FIREFLY_COUNT}.0)`);
    expect(out).toContain("totalEmissiveRadiance +=");
    expect(out).toContain("#include <emissivemap_fragment>");
  });

  it("aliases the shared field uniforms and keys its own program", () => {
    const mat = new THREE.MeshLambertMaterial({ color: 0x2d5a22 });
    const plain = new THREE.MeshLambertMaterial({ color: 0x2d5a22 });
    const pools = { value: [new THREE.Vector3(1, 2, 3)] };
    const glows = { value: [0.5] };
    applyFireflyTreeGlow(mat, { pools, glows });
    // Distinct program from unmodified Lambert materials (rocks, units).
    expect(mat.customProgramCacheKey()).toBe("firefly-tree-glow");
    expect(plain.customProgramCacheKey()).not.toBe("firefly-tree-glow");
    // onBeforeCompile wires the SAME uniform objects (single-tick mirror
    // updates trees and terrain together) and splices both shaders.
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: "#include <project_vertex>",
      fragmentShader: "#include <emissivemap_fragment>",
    };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms.fireflyPools).toBe(pools);
    expect(shader.uniforms.fireflyGlows).toBe(glows);
    expect(shader.vertexShader).toContain("vFireflyWorld");
    expect(shader.fragmentShader).toContain("totalEmissiveRadiance +=");
  });
});
