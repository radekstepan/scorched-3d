import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  skyFragment,
  skyVertex,
  terrainFragment,
  terrainVertex,
  WATER_SWELL_LAYERS,
  waterFoamNoise,
  waterFragment,
  waterRipple,
  waterSurfaceHeight,
  waterVertex,
} from "./shaders";

const here = dirname(fileURLToPath(import.meta.url));
const canvasSource = readFileSync(join(here, "TerrainCanvas.tsx"), "utf8");

describe("shader sources", () => {
  it("exports non-empty GLSL for terrain, water and sky", () => {
    for (const src of [terrainVertex, waterVertex, skyVertex]) {
      expect(typeof src).toBe("string");
      expect(src.trim().length).toBeGreaterThan(0);
      expect(src).toContain("void main()");
      expect(src).toContain("gl_Position");
    }
    for (const src of [terrainFragment, waterFragment, skyFragment]) {
      expect(typeof src).toBe("string");
      expect(src.trim().length).toBeGreaterThan(0);
      expect(src).toContain("void main()");
      expect(src).toContain("gl_FragColor");
    }
  });

  it("declares the uniforms TerrainCanvas wires up", () => {
    expect(terrainFragment).toContain("mapTex");
    expect(terrainFragment).toContain("heightTex");
    expect(terrainFragment).toContain("seaLevel");
    expect(terrainFragment).toContain("exaggeration");
    expect(waterFragment).toContain("heightTex");
    expect(waterFragment).toContain("seaLevel");
    expect(waterVertex).toContain("time");
    expect(skyFragment).toContain("sunDir");
  });

  it("is consumed by TerrainCanvas for all three materials", () => {
    for (const name of [
      "terrainVertex",
      "terrainFragment",
      "waterVertex",
      "waterFragment",
      "skyVertex",
      "skyFragment",
    ]) {
      expect(canvasSource).toContain(name);
    }
  });
});

describe("random water", () => {
  it("swell layers scroll in mutually non-parallel directions", () => {
    expect(WATER_SWELL_LAYERS.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < WATER_SWELL_LAYERS.length; i++) {
      for (let j = i + 1; j < WATER_SWELL_LAYERS.length; j++) {
        const a = WATER_SWELL_LAYERS[i]!;
        const b = WATER_SWELL_LAYERS[j]!;
        const dot =
          (a.dx * b.dx + a.dz * b.dz) /
          (Math.hypot(a.dx, a.dz) * Math.hypot(b.dx, b.dz));
        expect(Math.abs(dot)).toBeLessThan(0.95);
      }
    }
  });

  it("surface height is deterministic, bounded, and varies in x, z and time", () => {
    const t = 3.7;
    expect(waterSurfaceHeight(11, -7, t)).toBe(
      waterSurfaceHeight(11, -7, t),
    );
    const maxAmp = WATER_SWELL_LAYERS.reduce((s, l) => s + Math.abs(l.amp), 0);
    for (const [x, z, time] of [
      [0, 0, 0],
      [120, -45, 9.3],
      [-300, 210, 41.2],
    ] as const) {
      expect(Math.abs(waterSurfaceHeight(x, z, time))).toBeLessThanOrEqual(
        maxAmp,
      );
    }
    const h = waterSurfaceHeight(11, -7, t);
    expect(waterSurfaceHeight(26, -7, t)).not.toBe(h);
    expect(waterSurfaceHeight(11, 9, t)).not.toBe(h);
    expect(waterSurfaceHeight(11, -7, t + 2.5)).not.toBe(h);
  });

  it("ripple normal is bounded and responds on both axes to both coordinates", () => {
    const t = 5.1;
    const base = waterRipple(13, -4, t);
    expect(base).toEqual(waterRipple(13, -4, t));
    expect(Math.hypot(base.nx, base.nz)).toBeLessThanOrEqual(0.2);
    // Not a single-axis sheet: moving in x alone and in z alone must tilt
    // both normal components somewhere in the field.
    let nxMovedByX = false;
    let nzMovedByX = false;
    let nxMovedByZ = false;
    let nzMovedByZ = false;
    for (let s = 0; s < 40; s++) {
      const x = s * 7.3 - 100;
      const z = s * 3.1 + 20;
      if (waterRipple(x + 5, z, t).nx !== waterRipple(x, z, t).nx)
        nxMovedByX = true;
      if (waterRipple(x + 5, z, t).nz !== waterRipple(x, z, t).nz)
        nzMovedByX = true;
      if (waterRipple(x, z + 5, t).nx !== waterRipple(x, z, t).nx)
        nxMovedByZ = true;
      if (waterRipple(x, z + 5, t).nz !== waterRipple(x, z, t).nz)
        nzMovedByZ = true;
    }
    expect(nxMovedByX && nzMovedByX && nxMovedByZ && nzMovedByZ).toBe(true);
    expect(waterRipple(13, -4, t + 1.7)).not.toEqual(base);
  });

  it("foam noise is deterministic, bounded, and varies in x, z and time", () => {
    const t = 2.2;
    expect(waterFoamNoise(8, 3, t)).toBe(waterFoamNoise(8, 3, t));
    for (let s = 0; s < 50; s++) {
      const v = waterFoamNoise(s * 3.7 - 60, s * 1.9 - 20, t + s * 0.13);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    const f = waterFoamNoise(8, 3, t);
    expect(waterFoamNoise(19, 3, t)).not.toBe(f);
    expect(waterFoamNoise(8, 14, t)).not.toBe(f);
    expect(waterFoamNoise(8, 3, t + 1.1)).not.toBe(f);
  });

  it("GLSL samples along multiple directions with phase-warped layers", () => {
    const dots = waterFragment.match(/dot\(vWorld\.xz/g) ?? [];
    expect(dots.length).toBeGreaterThanOrEqual(4);
    expect(waterFragment).toContain("+ r1 * 1.3");
    expect(waterFragment).toContain("+ f1 * 1.1");
    // Old axis-aligned rectangle grids are gone.
    expect(waterFragment).not.toContain("sin(vWorld.x *");
    expect(waterFragment).not.toContain("sin(vWorld.z *");
    expect(terrainFragment).not.toContain("sin(vWorld.x * 0.12");
  });

  it("vertex swell matches the JS mirror layer for layer", () => {
    for (const l of WATER_SWELL_LAYERS) {
      expect(waterVertex).toContain(`vec2(${l.dx}, ${l.dz})`);
      expect(waterVertex).toContain(`time * ${l.speed}`);
      expect(waterVertex).toContain(`* ${l.amp}`);
    }
  });
});
