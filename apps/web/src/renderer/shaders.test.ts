import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyFogDrift,
  applyValleyFog,
  FOG_DRIFT_AMP,
  FOG_DRIFT_SCALE,
  FOG_DRIFT_WIND_X,
  FOG_DRIFT_WIND_Z,
  fogDriftFactor,
  VALLEY_FOG_SPAN,
  valleyFogFactor,
  skyFragment,
  skyVertex,
  terrainFragment,
  terrainVertex,
  WATER_SWELL_LAYERS,
  waterAmpMod,
  waterCaustic,
  waterCausticMask,
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
});

describe("view-independent ground tint", () => {
  it("terrain slope/rock blend reads a world-up normal, not a view-space one", () => {
    // The fragment shader treats N.y as world-up: slope drives the brown
    // rock blend and the hemisphere mix. If the vertex shader fed a
    // view-space normal (normalMatrix), N.y would rotate with the camera —
    // top-down, flat ground reads N.y ~= 0 (full brown); oblique, the same
    // ground reads greener. The varying must be world-space instead.
    expect(terrainFragment).toContain("float slope = 1.0 - clamp(N.y, 0.0, 1.0);");
    expect(terrainVertex).toContain("mat3(modelMatrix) * normal");
    // The vNormal assignment must be view-independent (gl_Position below it
    // still legitimately uses viewMatrix — scope the check to that line).
    const vNormalLine =
      terrainVertex.split("\n").find((l) => l.includes("vNormal =")) ?? "";
    expect(vNormalLine).not.toContain("normalMatrix");
    expect(vNormalLine).not.toContain("modelViewMatrix");
    expect(vNormalLine).not.toContain("viewMatrix");
    expect(vNormalLine).not.toContain("cameraPosition");
  });

  it("terrain sun lighting stays in world space with the sun direction", () => {
    // sunDir is a world-space uniform (SUN in TerrainCanvas); dotting it
    // against a view-space normal would swing the light with the camera.
    expect(terrainFragment).toContain("dot(N, normalize(sunDir))");
    expect(terrainFragment).toContain("mix(groundColor, skyColor, N.y * 0.5 + 0.5)");
    const vNormalLine =
      terrainVertex.split("\n").find((l) => l.includes("vNormal =")) ?? "";
    expect(vNormalLine).toContain("modelMatrix");
    expect(vNormalLine).not.toContain("normalMatrix");
  });
});

describe("canvas wiring", () => {
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

describe("drifting distance fog", () => {
  it("haze factor is deterministic, bounded, and varies in x, z and time", () => {
    const t = 12.4;
    expect(fogDriftFactor(300, -150, t)).toBe(fogDriftFactor(300, -150, t));
    const lo = 1 - FOG_DRIFT_AMP / 2;
    const hi = 1 + FOG_DRIFT_AMP / 2;
    // Subtle by contract: at most ±20% around the base fog.
    expect(lo).toBeGreaterThanOrEqual(0.8);
    expect(hi).toBeLessThanOrEqual(1.2);
    for (let s = 0; s < 60; s++) {
      const f = fogDriftFactor(s * 61.7 - 1500, s * 37.3 + 400, t + s * 1.1);
      expect(f).toBeGreaterThanOrEqual(lo - 1e-12);
      expect(f).toBeLessThanOrEqual(hi + 1e-12);
    }
    const f = fogDriftFactor(300, -150, t);
    expect(fogDriftFactor(1400, -150, t)).not.toBe(f);
    expect(fogDriftFactor(300, 950, t)).not.toBe(f);
    expect(fogDriftFactor(300, -150, t + 40)).not.toBe(f);
  });

  it("drifts slowly: a second barely shifts it, a minute visibly does", () => {
    let oneSecond = 0;
    let oneMinute = 0;
    for (let s = 0; s < 40; s++) {
      const x = s * 83.1 - 1200;
      const z = s * 51.7 + 300;
      const base = fogDriftFactor(x, z, 20);
      oneSecond = Math.max(oneSecond, Math.abs(fogDriftFactor(x, z, 21) - base));
      oneMinute = Math.max(oneMinute, Math.abs(fogDriftFactor(x, z, 80) - base));
    }
    expect(oneSecond).toBeLessThan(0.02);
    expect(oneMinute).toBeGreaterThan(0.01);
  });

  it("keeps near-ground fog-free and clamps far fog into range", () => {
    for (let s = 0; s < 30; s++) {
      const x = s * 97.3 - 800;
      const z = s * 43.9 - 500;
      const t = s * 2.7;
      expect(applyFogDrift(0, x, z, t)).toBe(0);
      const full = applyFogDrift(1, x, z, t);
      expect(full).toBeGreaterThanOrEqual(0);
      expect(full).toBeLessThanOrEqual(1);
      const half = applyFogDrift(0.5, x, z, t);
      expect(half).toBeCloseTo(0.5 * fogDriftFactor(x, z, t), 12);
    }
  });

  it("terrain and water GLSL carry the same wind-blown haze field", () => {
    for (const src of [terrainFragment, waterFragment]) {
      expect(src).toContain(`vWorld.xz * ${FOG_DRIFT_SCALE}`);
      expect(src).toContain(`vec2(time * ${FOG_DRIFT_WIND_X}, time * ${FOG_DRIFT_WIND_Z})`);
      expect(src).toContain(`fogWobble * ${FOG_DRIFT_AMP}`);
      expect(src).toContain("fog = clamp(fog * (1.0 + fogWobble");
    }
    // Wind blows diagonally so banks crawl across the view, not along an axis.
    expect(FOG_DRIFT_WIND_X).not.toBe(0);
    expect(FOG_DRIFT_WIND_Z).not.toBe(0);
    // No new uniforms: the drift reuses the existing time uniform.
    expect(terrainFragment).toContain("uniform float time;");
    expect(waterFragment).toContain("uniform float time;");
  });
});

describe("daytime valley fog", () => {
  const waterY = 200;
  const ex = 2;

  it("pools at/below the waterline and clears above the band", () => {
    expect(valleyFogFactor(waterY, waterY, ex)).toBe(1);
    expect(valleyFogFactor(waterY - 50, waterY, ex)).toBe(1);
    expect(valleyFogFactor(waterY - 500, waterY, ex)).toBe(1);
    const top = waterY + VALLEY_FOG_SPAN * ex;
    expect(valleyFogFactor(top, waterY, ex)).toBe(0);
    expect(valleyFogFactor(top + 100, waterY, ex)).toBe(0);
    // Mid-band holds partial haze, fading monotonically with height.
    expect(valleyFogFactor((waterY + top) / 2, waterY, ex)).toBeCloseTo(0.5, 10);
    let prev = 1;
    for (let s = 0; s <= 20; s++) {
      const f = valleyFogFactor(waterY + ((top - waterY) * s) / 20, waterY, ex);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it("covers the same terrain at any height scale", () => {
    // The band top scales with exaggeration: doubling the height scale
    // doubles the world-unit reach, so the same raw heights stay fogged.
    for (const exaggeration of [1, 2, 4, 6]) {
      const top = waterY + VALLEY_FOG_SPAN * exaggeration;
      expect(valleyFogFactor(top - 1e-6, waterY, exaggeration)).toBeGreaterThan(0);
      expect(valleyFogFactor(top, waterY, exaggeration)).toBe(0);
      expect(valleyFogFactor(waterY + (VALLEY_FOG_SPAN * exaggeration) / 2, waterY, exaggeration)).toBeCloseTo(
        0.5,
        10,
      );
    }
  });

  it("layers onto distance fog without touching far fog or strength 0", () => {
    const low = waterY - 10;
    const high = waterY + VALLEY_FOG_SPAN * ex + 50;
    // Strength 0 is the identity everywhere (the night look is untouched).
    for (const [fog, y] of [[0, low], [0.5, low], [1, low], [0.3, high]] as const) {
      expect(applyValleyFog(fog, y, waterY, ex, 0)).toBe(fog);
    }
    // Far fog stays fully fogged; high ground keeps its distance fog.
    expect(applyValleyFog(1, low, waterY, ex, 0.35)).toBe(1);
    expect(applyValleyFog(0.4, high, waterY, ex, 0.35)).toBe(0.4);
    // Low ground gains haze even where distance fog is 0 (the task).
    expect(applyValleyFog(0, low, waterY, ex, 0.35)).toBeCloseTo(0.35, 12);
    // Partial terms combine onto the remaining clarity, clamped to [0, 1].
    expect(applyValleyFog(0.5, low, waterY, ex, 0.35)).toBeCloseTo(0.5 + 0.5 * 0.35, 12);
    for (let s = 0; s < 30; s++) {
      const out = applyValleyFog((s % 11) / 10, waterY + s * 7 - 60, waterY, ex, 0.35);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
    }
  });

  it("terrain GLSL mirrors the JS factor literal for literal", () => {
    expect(terrainFragment).toContain("uniform float valleyFog;");
    expect(terrainFragment).toContain(`waterY + ${VALLEY_FOG_SPAN}.0 * exaggeration`);
    expect(terrainFragment).toContain("1.0 - smoothstep(waterY, valleyTop, vWorld.y)");
    expect(terrainFragment).toContain("fog + (1.0 - fog) * valley * valleyFog");
    // Terrain-only by design: the water sheet sits at one constant height,
    // so a height term there would be a flat constant, not pooled fog.
    expect(waterFragment).not.toContain("valleyFog");
    expect(waterFragment).not.toContain("valleyTop");
  });

  it("canvas seeds the terrain valley-fog uniform from the day/night preset", () => {
    expect(canvasSource).toContain("valleyFog: { value: fogPreset.valleyFog }");
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

  it("caustic light fades in below the waterline (no shoreline seam)", () => {
    // Regression: the underwater caustics used to switch on at full
    // strength exactly at the waterline — (1 - wet) is 1.0 at depth 0 —
    // drawing a hard bright line along the shore with the last underwater
    // tile reading lighter than the rest. The mask must be 0 at the
    // waterline and ramp up over the first few depth units instead.
    expect(waterCausticMask(0)).toBe(0);
    // Continuous across the line: no step between the surface and just
    // below it (the old mask jumped 0 -> ~1.0 over the same span).
    expect(waterCausticMask(0.05)).toBeLessThan(0.01);
    expect(waterCausticMask(1)).toBeLessThan(0.1);
    // Full strength a few units down, then decaying with the wet tint.
    expect(waterCausticMask(6)).toBeCloseTo(0.85, 10);
    expect(waterCausticMask(6)).toBeGreaterThan(waterCausticMask(3));
    expect(waterCausticMask(20)).toBeCloseTo(0.5, 10);
    expect(waterCausticMask(6)).toBeGreaterThan(waterCausticMask(20));
    expect(waterCausticMask(200)).toBeCloseTo(0.18, 10);
    expect(waterCausticMask(20)).toBeGreaterThan(waterCausticMask(200));
    // Bounded and non-negative everywhere, including above the surface.
    for (const d of [-4, 0, 0.5, 3, 6, 12, 33, 90, 400]) {
      const m = waterCausticMask(d);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });

  it("terrain GLSL gates the caustic add with the depth ramp", () => {
    // The wet tint factor the mask mirrors.
    expect(terrainFragment).toContain("float wet = clamp(depth * 0.025, 0.0, 0.82);");
    // The caustic add must carry the waterline ramp with the mirrored width.
    const addLine =
      terrainFragment.split("\n").find((l) => l.includes("color += caustic")) ?? "";
    expect(addLine).toContain("(1.0 - wet)");
    expect(addLine).toContain("smoothstep(0.0, 6.0, depth)");
    // The old un-ramped add is gone.
    expect(terrainFragment).not.toContain("caustic * (1.0 - wet) * vec3(");
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
