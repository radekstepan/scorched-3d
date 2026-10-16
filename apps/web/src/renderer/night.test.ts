import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { skyFragment } from "./shaders";
import {
  applyDayNight,
  DAY_LIGHTING,
  dayNightLighting,
  NIGHT_LIGHTING,
  NIGHT_MIN_HEMI_INTENSITY,
  NIGHT_MIN_SUN_INTENSITY,
  type DayNightTargets,
} from "./night";

const here = dirname(fileURLToPath(import.meta.url));

function luminance(hex: number): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function buildTargets(): DayNightTargets {
  const fogColor = new THREE.Color(DAY_LIGHTING.fog);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DAY_LIGHTING.background);
  scene.fog = new THREE.Fog(fogColor, 3600, 12400);
  const colorUniform = (hex: number) => ({ value: new THREE.Color(hex) });
  return {
    scene,
    fogColor,
    hemi: new THREE.HemisphereLight(DAY_LIGHTING.hemiSky, DAY_LIGHTING.hemiGround, DAY_LIGHTING.hemiIntensity),
    sun: new THREE.DirectionalLight(DAY_LIGHTING.sunColor, DAY_LIGHTING.sunIntensity),
    terrainMat: new THREE.ShaderMaterial({
      uniforms: {
        sunColor: colorUniform(0xffffff),
        skyColor: colorUniform(0xffffff),
        groundColor: colorUniform(0xffffff),
      },
    }),
    waterMat: new THREE.ShaderMaterial({ uniforms: { sunColor: colorUniform(0xffffff) } }),
    skyMat: new THREE.ShaderMaterial({ uniforms: { nightMix: { value: 0 } } }),
  };
}

describe("day/night lighting presets", () => {
  it("selects the day preset by default and night on toggle", () => {
    expect(dayNightLighting(false)).toBe(DAY_LIGHTING);
    expect(dayNightLighting(true)).toBe(NIGHT_LIGHTING);
  });

  it("pins the day preset to the pre-night canvas hardcodes (no day regression)", () => {
    expect(DAY_LIGHTING.background).toBe(0x6aa0c8);
    expect(DAY_LIGHTING.fog).toBe(0x8eb4c8);
    expect(DAY_LIGHTING.hemiSky).toBe(0xb8d4f0);
    expect(DAY_LIGHTING.hemiGround).toBe(0x3a3424);
    expect(DAY_LIGHTING.hemiIntensity).toBe(0.45);
    expect(DAY_LIGHTING.sunColor).toBe(0xfff1d0);
    expect(DAY_LIGHTING.sunIntensity).toBe(1.15);
    expect(DAY_LIGHTING.terrainSun).toEqual([1.0, 0.93, 0.78]);
    expect(DAY_LIGHTING.terrainSky).toEqual([0.55, 0.7, 0.88]);
    expect(DAY_LIGHTING.terrainGround).toEqual([0.18, 0.16, 0.1]);
    expect(DAY_LIGHTING.waterSun).toEqual([1.0, 0.95, 0.8]);
  });

  it("keeps night moonlit, not pitch black (visibility floor)", () => {
    expect(NIGHT_LIGHTING.sunIntensity).toBeGreaterThanOrEqual(NIGHT_MIN_SUN_INTENSITY);
    expect(NIGHT_LIGHTING.hemiIntensity).toBeGreaterThanOrEqual(NIGHT_MIN_HEMI_INTENSITY);
    // Terrain light still lifts the albedo: sun + sky channels well above 0.
    for (const triple of [NIGHT_LIGHTING.terrainSun, NIGHT_LIGHTING.terrainSky]) {
      expect(triple[0] + triple[1] + triple[2]).toBeGreaterThan(0.9);
    }
  });

  it("tints the night moon cool and darkens the sky below day", () => {
    const moon = new THREE.Color(NIGHT_LIGHTING.sunColor);
    expect(moon.b).toBeGreaterThanOrEqual(moon.r);
    expect(luminance(NIGHT_LIGHTING.background)).toBeLessThan(luminance(DAY_LIGHTING.background));
    expect(luminance(NIGHT_LIGHTING.fog)).toBeLessThan(luminance(DAY_LIGHTING.fog));
  });
});

describe("applyDayNight", () => {
  it("retints every target in place (fog identity preserved for the alias)", () => {
    const targets = buildTargets();
    applyDayNight(targets, true);
    expect((targets.scene.background as THREE.Color).getHex()).toBe(NIGHT_LIGHTING.background);
    expect(targets.fogColor.getHex()).toBe(NIGHT_LIGHTING.fog);
    expect((targets.scene.fog as THREE.Fog).color.getHex()).toBe(NIGHT_LIGHTING.fog);
    expect(targets.hemi.color.getHex()).toBe(NIGHT_LIGHTING.hemiSky);
    expect(targets.hemi.groundColor.getHex()).toBe(NIGHT_LIGHTING.hemiGround);
    expect(targets.hemi.intensity).toBe(NIGHT_LIGHTING.hemiIntensity);
    expect(targets.sun.color.getHex()).toBe(NIGHT_LIGHTING.sunColor);
    expect(targets.sun.intensity).toBe(NIGHT_LIGHTING.sunIntensity);
    expect(targets.skyMat.uniforms.nightMix!.value).toBe(1);
  });

  it("writes the terrain/water shader triples and toggles back to day", () => {
    const targets = buildTargets();
    applyDayNight(targets, true);
    const sun = targets.terrainMat.uniforms.sunColor!.value as THREE.Color;
    expect([sun.r, sun.g, sun.b]).toEqual(NIGHT_LIGHTING.terrainSun);
    applyDayNight(targets, false);
    expect((targets.scene.background as THREE.Color).getHex()).toBe(DAY_LIGHTING.background);
    expect(targets.sun.intensity).toBe(DAY_LIGHTING.sunIntensity);
    expect(targets.skyMat.uniforms.nightMix!.value).toBe(0);
    const back = targets.terrainMat.uniforms.sunColor!.value as THREE.Color;
    expect([back.r, back.g, back.b]).toEqual(DAY_LIGHTING.terrainSun);
  });
});

describe("night sky shader + canvas wiring", () => {
  it("declares nightMix/time uniforms, a moon disc, and stars", () => {
    expect(skyFragment).toContain("nightMix");
    expect(skyFragment).toContain("uniform float time");
    expect(skyFragment).toContain("0.92, 0.96, 1.0");
    expect(skyFragment).toContain("twinkle");
  });

  it("wires the preset + swarm through the canvas tick with cleanup", () => {
    const canvas = readFileSync(join(here, "TerrainCanvas.tsx"), "utf8");
    expect(canvas).toContain("applyDayNight(dayNightTargets");
    expect(canvas).toContain("nightMix: { value: 0 }");
    expect(canvas).toContain("skyMat.uniforms.time!.value = t");
    expect(canvas).toContain("new FireflyFx(");
    expect(canvas).toContain("fireflies.setNight(");
    expect(canvas).toContain("fireflies.update(t)");
    expect(canvas).toContain("fireflies.poolLights()");
    expect(canvas).toContain("fireflies.glowLevel");
    expect(canvas).toContain("fireflyGlow: { value: 0 }");
    expect(canvas).toContain("fireflies.resnap()");
    expect(canvas).toContain("fireflies.dispose()");
  });

  it("exposes a Night toggle in the View panel (default off)", () => {
    const app = readFileSync(join(here, "..", "App.tsx"), "utf8");
    expect(app).toContain('label="Night"');
    expect(app).toContain("options.nightMode");
    expect(app).toContain("nightMode: false");
  });
});
