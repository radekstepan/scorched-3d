import { mulberry32 } from "@scorched-3d/core";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  DAY_FOG_BREATH_FLOOR,
  DAY_FOG_BREATH_SPEED,
  DAY_FOG_COUNT,
  DAY_FOG_DRIFT_RADIUS,
  DAY_FOG_DRIFT_SPEED,
  DAY_FOG_EDGE_MARGIN,
  DAY_FOG_HEIGHT_RATIO,
  DAY_FOG_MAX_LIFT,
  DAY_FOG_MAX_PEAK,
  DAY_FOG_MAX_WIDTH,
  DAY_FOG_MIN_LIFT,
  DAY_FOG_MIN_PEAK,
  DAY_FOG_MIN_SEPARATION,
  DAY_FOG_MIN_WIDTH,
  DAY_FOG_TEX_SIZE,
  DAY_FOG_TINT,
  DayFogFx,
  dayFogAlpha,
  dayFogDrift,
  dayFogOpacity,
  makeDayFogTextureData,
  placeDayFog,
} from "./dayFog";

// Real map footprint: (320-1)*16 x (256-1)*16 world units.
const WORLD_W = 5104;
const WORLD_D = 4080;
const flatSurface = (_x: number, _z: number) => 100;

describe("placeDayFog", () => {
  it("is deterministic for the same seed", () => {
    const a = placeDayFog(mulberry32(7), WORLD_W, WORLD_D, DAY_FOG_COUNT, flatSurface);
    const b = placeDayFog(mulberry32(7), WORLD_W, WORLD_D, DAY_FOG_COUNT, flatSurface);
    expect(a).toEqual(b);
  });

  it("scatters a sparse few banks inside the map, lifted off the surface", () => {
    // Here and there, not a blanket.
    expect(DAY_FOG_COUNT).toBeLessThanOrEqual(24);
    const anchors = placeDayFog(mulberry32(7), WORLD_W, WORLD_D, DAY_FOG_COUNT, flatSurface);
    expect(anchors).toHaveLength(DAY_FOG_COUNT);
    for (const a of anchors) {
      expect(Math.abs(a.x)).toBeLessThanOrEqual(WORLD_W / 2 - DAY_FOG_EDGE_MARGIN);
      expect(Math.abs(a.z)).toBeLessThanOrEqual(WORLD_D / 2 - DAY_FOG_EDGE_MARGIN);
      expect(a.lift).toBeGreaterThanOrEqual(DAY_FOG_MIN_LIFT);
      expect(a.lift).toBeLessThanOrEqual(DAY_FOG_MAX_LIFT);
      expect(a.y).toBeCloseTo(100 + a.lift, 6);
      expect(a.width).toBeGreaterThanOrEqual(DAY_FOG_MIN_WIDTH);
      expect(a.width).toBeLessThanOrEqual(DAY_FOG_MAX_WIDTH);
      expect(a.peak).toBeGreaterThanOrEqual(DAY_FOG_MIN_PEAK);
      expect(a.peak).toBeLessThanOrEqual(DAY_FOG_MAX_PEAK);
      expect(a.phase).toBeGreaterThanOrEqual(0);
      expect(a.phase).toBeLessThan(1);
      expect(a.rate).toBeGreaterThanOrEqual(0.5);
      expect(a.rate).toBeLessThanOrEqual(1.4);
      expect(a.radius).toBeGreaterThan(0);
      expect(a.radius).toBeLessThanOrEqual(DAY_FOG_DRIFT_RADIUS * 1.4);
    }
    // Present but translucent by contract: even the strongest bank stays sheer.
    expect(DAY_FOG_MAX_PEAK).toBeLessThanOrEqual(0.3);
  });

  it("holds banks apart so they read as individuals, not one mass", () => {
    for (const seed of [7, 42, 1337]) {
      const anchors = placeDayFog(mulberry32(seed), WORLD_W, WORLD_D, DAY_FOG_COUNT, flatSurface);
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          const d = Math.hypot(anchors[i]!.x - anchors[j]!.x, anchors[i]!.z - anchors[j]!.z);
          expect(d).toBeGreaterThanOrEqual(DAY_FOG_MIN_SEPARATION);
        }
      }
    }
  });

  it("pools banks in hollows instead of scattering them uniformly", () => {
    // Steep bowl with its pit off-center: hollow-seeking banks should hug
    // the pit far tighter than uniform scatter does.
    const pit = { x: 500, z: -300 };
    const bowl = (x: number, z: number) => (x - pit.x) ** 2 + (z - pit.z) ** 2;
    for (const seed of [7, 42, 1337, 9001]) {
      const anchors = placeDayFog(mulberry32(seed), WORLD_W, WORLD_D, DAY_FOG_COUNT, bowl);
      const fogMean =
        anchors.reduce((s, a) => s + Math.hypot(a.x - pit.x, a.z - pit.z), 0) / anchors.length;
      const rng = mulberry32(seed + 1);
      let uniSum = 0;
      const n = 200;
      for (let i = 0; i < n; i++) {
        const x = (rng() * 2 - 1) * (WORLD_W / 2 - DAY_FOG_EDGE_MARGIN);
        const z = (rng() * 2 - 1) * (WORLD_D / 2 - DAY_FOG_EDGE_MARGIN);
        uniSum += Math.hypot(x - pit.x, z - pit.z);
      }
      expect(fogMean).toBeLessThan((uniSum / n) * 0.7);
    }
  });

  it("degrades gracefully on tiny worlds: full count, in bounds, deterministic", () => {
    const a = placeDayFog(mulberry32(7), 200, 200, DAY_FOG_COUNT, flatSurface);
    const b = placeDayFog(mulberry32(7), 200, 200, DAY_FOG_COUNT, flatSurface);
    expect(a).toEqual(b);
    expect(a).toHaveLength(DAY_FOG_COUNT);
    for (const anchor of a) {
      expect(Math.abs(anchor.x)).toBeLessThanOrEqual(100);
      expect(Math.abs(anchor.z)).toBeLessThanOrEqual(100);
      expect(anchor.y).toBeCloseTo(100 + anchor.lift, 6);
    }
  });
});

describe("dayFogDrift", () => {
  it("wanders within the drift radius with only a small vertical bob", () => {
    for (let i = 0; i < 60; i++) {
      const d = dayFogDrift(DAY_FOG_DRIFT_RADIUS, 0.31, i * 2.3);
      expect(Math.abs(d.x)).toBeLessThanOrEqual(DAY_FOG_DRIFT_RADIUS);
      expect(Math.abs(d.z)).toBeLessThanOrEqual(DAY_FOG_DRIFT_RADIUS);
      expect(Math.abs(d.y)).toBeLessThanOrEqual(DAY_FOG_DRIFT_RADIUS * 0.1 + 1e-9);
    }
  });

  it("lifts every bank clear of its own vertical bob", () => {
    // Max bob = max radius * 0.1; the lift floor must clear it or low-lift
    // banks dip under the surface at the bottom of the wander.
    expect(DAY_FOG_MIN_LIFT).toBeGreaterThan(DAY_FOG_DRIFT_RADIUS * 1.4 * 0.1);
  });

  it("drifts slowly: one second barely moves a bank", () => {
    const a = dayFogDrift(DAY_FOG_DRIFT_RADIUS, 0.31, 10);
    const b = dayFogDrift(DAY_FOG_DRIFT_RADIUS, 0.31, 11);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(DAY_FOG_DRIFT_RADIUS * 0.12);
    // A full wander takes on the order of a minute, not seconds.
    expect((Math.PI * 2) / DAY_FOG_DRIFT_SPEED).toBeGreaterThan(60);
  });
});

describe("dayFogOpacity", () => {
  it("breathes between the floor fraction and peak, and actually varies", () => {
    const samples = Array.from({ length: 60 }, (_, i) => dayFogOpacity(0.16, 0.13, 0.8, i * 2));
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0.16 * DAY_FOG_BREATH_FLOOR - 1e-9);
      expect(s).toBeLessThanOrEqual(0.16 + 1e-9);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.16 * 0.2);
    expect(dayFogOpacity(0.16, 0.13, 0.8, 2 + (Math.PI * 2) / (DAY_FOG_BREATH_SPEED * 0.8))).toBeCloseTo(
      dayFogOpacity(0.16, 0.13, 0.8, 2),
      9,
    );
  });
});

describe("dayFogAlpha", () => {
  it("is a soft puff: dense center, empty corners, smooth in between", () => {
    expect(dayFogAlpha(0, 0)).toBeGreaterThan(0.9);
    expect(dayFogAlpha(1, 1)).toBe(0);
    expect(dayFogAlpha(-1, 0.5)).toBe(0);
    expect(dayFogAlpha(0.9, 0)).toBeLessThan(0.1);
    // Mid-disc holds visible mist well past halfway out.
    expect(dayFogAlpha(0.5, 0)).toBeGreaterThan(0.3);
    for (let ix = 0; ix <= 20; ix++) {
      for (let iz = 0; iz <= 20; iz++) {
        const a = dayFogAlpha((ix / 20) * 2 - 1, (iz / 20) * 2 - 1);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("makeDayFogTextureData", () => {
  it("builds white RGBA bytes sampling the puff curve", () => {
    const data = makeDayFogTextureData(DAY_FOG_TEX_SIZE);
    expect(data).toHaveLength(DAY_FOG_TEX_SIZE * DAY_FOG_TEX_SIZE * 4);
    const at = (ix: number, iz: number): number[] => {
      const o = (iz * DAY_FOG_TEX_SIZE + ix) * 4;
      return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!];
    };
    // White texel color throughout; only alpha carries the shape.
    for (const [ix, iz] of [[0, 0], [7, 31], [32, 32], [63, 63]] as const) {
      const [r, g, b] = at(ix, iz);
      expect(r).toBe(255);
      expect(g).toBe(255);
      expect(b).toBe(255);
    }
    const mid = Math.floor(DAY_FOG_TEX_SIZE / 2);
    expect(at(mid, mid)[3]).toBeGreaterThan(200);
    expect(at(0, 0)[3]).toBe(0);
    expect(at(DAY_FOG_TEX_SIZE - 1, DAY_FOG_TEX_SIZE - 1)[3]).toBe(0);
    // Alpha bytes track the pure curve at the sampled texel centers.
    const u = (mid / (DAY_FOG_TEX_SIZE - 1)) * 2 - 1;
    expect(at(mid, mid)[3]).toBe(Math.round(dayFogAlpha(u, u) * 255));
  });
});

describe("DayFogFx", () => {
  function build(): { scene: THREE.Scene; fx: DayFogFx } {
    const scene = new THREE.Scene();
    const fx = new DayFogFx(
      scene,
      placeDayFog(mulberry32(7), WORLD_W, WORLD_D, DAY_FOG_COUNT, flatSurface),
      flatSurface,
    );
    return { scene, fx };
  }

  it("shows white banks by day and hides the mist at night", () => {
    expect(DAY_FOG_TINT).toBe(0xffffff);
    const { fx } = build();
    expect(fx.visible).toBe(true);
    fx.setNight(true);
    expect(fx.visible).toBe(false);
    fx.setNight(false);
    expect(fx.visible).toBe(true);
  });

  it("lays banks out low and translucent, never depth-carving", () => {
    const { fx } = build();
    const sprites = fx["sprites" as never] as THREE.Sprite[];
    expect(sprites).toHaveLength(DAY_FOG_COUNT);
    const anchors = fx["anchors" as never] as { width: number; peak: number }[];
    sprites.forEach((sprite, i) => {
      const mat = sprite.material as THREE.SpriteMaterial;
      expect(mat.color.getHex()).toBe(0xffffff);
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      expect(sprite.scale.x).toBeCloseTo(anchors[i]!.width, 9);
      expect(sprite.scale.y).toBeCloseTo(anchors[i]!.width * DAY_FOG_HEIGHT_RATIO, 9);
      // Low banks: much wider than tall.
      expect(sprite.scale.y).toBeLessThan(sprite.scale.x * 0.5);
      expect(mat.opacity).toBeGreaterThanOrEqual(anchors[i]!.peak * DAY_FOG_BREATH_FLOOR - 1e-9);
      expect(mat.opacity).toBeLessThanOrEqual(anchors[i]!.peak + 1e-9);
    });
  });

  it("drifts banks and breathes their opacity while visible", () => {
    const { fx } = build();
    fx.update(1.5);
    const sprites = fx["sprites" as never] as THREE.Sprite[];
    const anchors = fx["anchors" as never] as {
      x: number;
      y: number;
      z: number;
      peak: number;
      radius: number;
    }[];
    sprites.forEach((sprite, i) => {
      const a = anchors[i]!;
      // Near its anchor (each axis within its own drift radius), hovering
      // above the surface.
      expect(Math.abs(sprite.position.x - a.x)).toBeLessThanOrEqual(a.radius + 1e-9);
      expect(Math.abs(sprite.position.z - a.z)).toBeLessThanOrEqual(a.radius + 1e-9);
      expect(sprite.position.y).toBeGreaterThan(100);
      const mat = sprite.material as THREE.SpriteMaterial;
      expect(mat.opacity).toBeGreaterThanOrEqual(a.peak * DAY_FOG_BREATH_FLOOR - 1e-9);
      expect(mat.opacity).toBeLessThanOrEqual(a.peak + 1e-9);
    });
    // Time passes: banks wander and opacity breathes.
    const before = sprites.map((s) => s.position.x);
    const opBefore = sprites.map((s) => (s.material as THREE.SpriteMaterial).opacity);
    fx.update(30);
    expect(sprites.some((s, i) => s.position.x !== before[i])).toBe(true);
    expect(sprites.some((s, i) => (s.material as THREE.SpriteMaterial).opacity !== opBefore[i])).toBe(
      true,
    );
  });

  it("re-seats on exaggeration resnap and cleans up on dispose", () => {
    const { scene, fx } = build();
    expect(scene.getObjectByName("day-fog")).toBeDefined();
    fx.resnap();
    fx.update(0.5);
    const sprites = fx["sprites" as never] as THREE.Sprite[];
    for (const sprite of sprites) {
      expect(sprite.position.y).toBeGreaterThan(100 + DAY_FOG_MIN_LIFT - DAY_FOG_DRIFT_RADIUS);
      expect(sprite.position.y).toBeLessThan(100 + DAY_FOG_MAX_LIFT + DAY_FOG_DRIFT_RADIUS);
    }
    const materials = sprites.map((s) => s.material as THREE.Material);
    const texture = fx["texture" as never] as THREE.DataTexture;
    const matSpies = materials.map((m) => vi.spyOn(m, "dispose"));
    const texSpy = vi.spyOn(texture, "dispose");
    fx.dispose();
    expect(scene.getObjectByName("day-fog")).toBeUndefined();
    for (const spy of matSpies) expect(spy).toHaveBeenCalledOnce();
    expect(texSpy).toHaveBeenCalledOnce();
  });
});
