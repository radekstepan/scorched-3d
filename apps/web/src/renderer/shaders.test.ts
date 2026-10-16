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
  waterAmpMod,
  waterCaustic,
  waterFoamBand,
  waterFoamNoise,
  waterFoamPatch,
  waterFragment,
  waterHash,
  waterNoise,
  waterRipple,
  waterSurfaceHeight,
  waterVertex,
  waterWarp,
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
    const maxAmp =
      WATER_SWELL_LAYERS.reduce((s, l) => s + Math.abs(l.amp), 0) * 1.3;
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
    const dots = waterFragment.match(/dot\((vWorld\.xz|rp|fp),/g) ?? [];
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

describe("natural water variation", () => {
  it("noise helpers are deterministic, bounded, and spatially varying", () => {
    expect(waterHash(3, -7)).toBe(waterHash(3, -7));
    for (let s = 0; s < 60; s++) {
      const h = waterHash(s - 30, s * 2 - 11);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      const n = waterNoise(s * 1.7 - 40, s * 0.9 + 5);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
    expect(waterNoise(0, 0)).toBe(waterNoise(0, 0));
    expect(new Set([0, 1, 2, 3, 4, 5].map((s) => waterNoise(s * 13.1, s * 7.7))).size).toBeGreaterThan(1);
    // Smooth value noise: neighbors stay close (no white-noise speckle).
    expect(Math.abs(waterNoise(10.1, 4.2) - waterNoise(10.2, 4.2))).toBeLessThan(0.1);
  });

  it("swell envelope varies across the map (no uniform wave height)", () => {
    const mods = [0, 400, 900, 1500, 2200].map((x) => waterAmpMod(x, x * 0.6, 4.0));
    for (const m of mods) {
      expect(m).toBeGreaterThanOrEqual(0.7);
      expect(m).toBeLessThanOrEqual(1.3);
    }
    expect(Math.max(...mods) - Math.min(...mods)).toBeGreaterThan(0.05);
    // The warp bends crests: the same local phase reads differently per region.
    const a = waterSurfaceHeight(100, 50, 2.0);
    const b = waterSurfaceHeight(100 + 500, 50 + 311, 2.0);
    expect(a).not.toBe(b);
    expect(waterWarp(7, -3)).toEqual(waterWarp(7, -3));
    const w = waterWarp(500, -200);
    expect(Math.abs(w.wx - 500)).toBeLessThanOrEqual(45);
    expect(Math.abs(w.wz + 200)).toBeLessThanOrEqual(45);
  });

  it("ripple field does not repeat on a sine period", () => {
    // Pure sines with k=0.033 repeat every ~190 units; the warped field must not.
    const t = 5.1;
    const base = waterRipple(13, -4, t);
    const shifted = waterRipple(13 + ((2 * Math.PI) / 0.033) * 3, -4, t);
    expect(Math.hypot(shifted.nx - base.nx, shifted.nz - base.nz)).toBeGreaterThan(1e-4);
  });

  it("foam band width and patch mask vary spatially", () => {
    const bands = [0, 150, 420, 900, 1600].map((x) => waterFoamBand(x, -x * 0.4));
    for (const b of bands) {
      expect(b).toBeGreaterThanOrEqual(8.4 - 1e-9);
      expect(b).toBeLessThanOrEqual(19.6 + 1e-9);
    }
    expect(Math.max(...bands) - Math.min(...bands)).toBeGreaterThan(0.5);
    const patches = [0, 150, 420, 900, 1600].map((x) => waterFoamPatch(x, x * 0.3, 2.0));
    for (const p of patches) {
      expect(p).toBeGreaterThanOrEqual(0.5);
      expect(p).toBeLessThanOrEqual(1.3);
    }
    expect(Math.max(...patches) - Math.min(...patches)).toBeGreaterThan(0.05);
  });

  it("caustic webs are deterministic, bounded, and drift with time", () => {
    const t = 1.4;
    expect(waterCaustic(20, -9, t)).toBe(waterCaustic(20, -9, t));
    for (let s = 0; s < 40; s++) {
      const v = waterCaustic(s * 9.1 - 120, s * 4.3 + 30, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.5);
    }
    expect(waterCaustic(20, -9, t + 1.3)).not.toBe(waterCaustic(20, -9, t));
    expect(waterCaustic(400, 130, t)).not.toBe(waterCaustic(20, -9, t));
  });

  it("GLSL carries the noise helpers and warp without new uniforms", () => {
    for (const src of [waterVertex, waterFragment, terrainFragment]) {
      expect(src).toContain("wHash");
      expect(src).toContain("wNoise");
    }
    expect(waterVertex).toContain("warp * 90.0");
    expect(waterVertex).toContain("ampMod");
    expect(waterFragment).toContain("rp = vWorld.xz");
    expect(waterFragment).toContain("fp = vWorld.xz");
    expect(waterFragment).toContain("0.6 + 0.8 * wNoise");
    expect(terrainFragment).toContain("cp = vWorld.xz");
    // No canvas/uniform churn: same uniform declarations as before.
    expect(waterVertex.match(/uniform\s+/g)?.length ?? 0).toBe(1);
    expect(waterFragment).toContain("uniform float time;");
    expect(waterFragment).not.toContain("uniform float seed");
    expect(terrainFragment).not.toContain("uniform float seed");
  });
});

describe("gated calm water", () => {
  it("terrain underwater tint + caustics render only with water on", () => {
    expect(terrainFragment).toContain("uniform float showWater;");
    expect(terrainFragment).toContain("showWater > 0.5 && vWorld.y < waterY");
  });

  it("canvas drives the terrain water toggle with the surface visibility", () => {
    expect(canvasSource).toContain(
      "showWater: { value: options.showWater && map.seaLevel > 0 ? 1 : 0 }",
    );
    expect(canvasSource).toContain(
      "terrainMat.uniforms.showWater!.value = opt.showWater && map.seaLevel > 0 ? 1 : 0;",
    );
  });

  it("swell runs low and slow (halved chop)", () => {
    for (const l of WATER_SWELL_LAYERS) {
      expect(l.speed).toBeLessThanOrEqual(0.8);
      expect(l.amp).toBeLessThanOrEqual(0.7);
    }
    const totalAmp = WATER_SWELL_LAYERS.reduce((s, l) => s + l.amp, 0);
    expect(totalAmp).toBeLessThanOrEqual(1.6);
    // Worst-case crest stays well under the old ~3.8-unit chop.
    for (let s = 0; s < 60; s++) {
      const h = waterSurfaceHeight(s * 37.7 - 900, s * 21.3 + 140, s * 0.31);
      expect(Math.abs(h)).toBeLessThanOrEqual(2.1);
    }
  });

  it("fragment ripple, foam, and caustic terms run at half pace", () => {
    for (const lit of ["time * 0.55", "time * 0.45", "time * 0.85", "time * 1.0", "time * 0.8"]) {
      expect(waterFragment).toContain(lit);
    }
    expect(terrainFragment).toContain("time * 0.5");
    expect(terrainFragment).toContain("time * 0.35");
    // Old fast paces are gone.
    for (const lit of ["time * 1.15", "time * 1.6", "* 1.35", "* 1.05"]) {
      expect(waterVertex).not.toContain(lit);
    }
    for (const lit of ["time * 1.1", "time * 1.7", "time * 2.0"]) {
      expect(waterFragment).not.toContain(lit);
    }
  });
});
