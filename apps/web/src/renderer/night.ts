import * as THREE from "three";

/**
 * Day/night lighting presets. Night is moonlit, not pitch black: a cool
 * directional "moon" keeps slopes readable, the hemisphere fill stays up,
 * and the terrain shader colors shift blue instead of collapsing to black.
 * Fog/background go deep blue so the horizon still separates from the sky.
 *
 * DAY_LIGHTING pins the exact pre-night hardcodes from TerrainCanvas, so
 * day mode renders pixel-identical to before this feature existed.
 */

export interface DayNightLighting {
  background: number;
  fog: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Sun by day, cool moon by night (same direction — see SUN). */
  sunColor: number;
  sunIntensity: number;
  /** Terrain-shader light colors (linear-ish 0..1 triples). */
  terrainSun: [number, number, number];
  terrainSky: [number, number, number];
  terrainGround: [number, number, number];
  /** Water-shader specular tint. */
  waterSun: [number, number, number];
}

export const DAY_LIGHTING: DayNightLighting = {
  background: 0x6aa0c8,
  fog: 0x8eb4c8,
  hemiSky: 0xb8d4f0,
  hemiGround: 0x3a3424,
  hemiIntensity: 0.45,
  sunColor: 0xfff1d0,
  sunIntensity: 1.15,
  terrainSun: [1.0, 0.93, 0.78],
  terrainSky: [0.55, 0.7, 0.88],
  terrainGround: [0.18, 0.16, 0.1],
  waterSun: [1.0, 0.95, 0.8],
};

export const NIGHT_LIGHTING: DayNightLighting = {
  background: 0x0a1626,
  fog: 0x18293f,
  hemiSky: 0x5a7fb0,
  hemiGround: 0x141a26,
  hemiIntensity: 0.6,
  sunColor: 0xbdd2f0,
  sunIntensity: 0.7,
  terrainSun: [0.6, 0.7, 0.9],
  terrainSky: [0.26, 0.36, 0.54],
  terrainGround: [0.07, 0.08, 0.12],
  waterSun: [0.62, 0.72, 0.92],
};

/** Visibility floor: night intensities must stay at/above these. */
export const NIGHT_MIN_SUN_INTENSITY = 0.5;
export const NIGHT_MIN_HEMI_INTENSITY = 0.4;

export function dayNightLighting(night: boolean): DayNightLighting {
  return night ? NIGHT_LIGHTING : DAY_LIGHTING;
}

export interface DayNightTargets {
  scene: THREE.Scene;
  /**
   * Shared fog color object (both shader uniforms alias it — but NOT
   * scene.fog: THREE.Fog copies the color at construction, so the applier
   * retints scene.fog explicitly too).
   */
  fogColor: THREE.Color;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  terrainMat: THREE.ShaderMaterial;
  waterMat: THREE.ShaderMaterial;
  skyMat: THREE.ShaderMaterial;
}

function setTriple(uniform: { value: THREE.Color } | undefined, triple: [number, number, number]): void {
  uniform?.value.setRGB(triple[0], triple[1], triple[2]);
}

/**
 * Apply the day or night preset to the live scene objects. Colors mutate in
 * place (the fog color is aliased by the fog + shader uniforms, so one
 * `.set()` retints all three) — no object identity changes, no recompile.
 */
export function applyDayNight(targets: DayNightTargets, night: boolean): void {
  const p = dayNightLighting(night);
  (targets.scene.background as THREE.Color).set(p.background);
  targets.fogColor.set(p.fog);
  (targets.scene.fog as THREE.Fog | null)?.color.set(p.fog);
  targets.hemi.color.set(p.hemiSky);
  targets.hemi.groundColor.set(p.hemiGround);
  targets.hemi.intensity = p.hemiIntensity;
  targets.sun.color.set(p.sunColor);
  targets.sun.intensity = p.sunIntensity;
  setTriple(targets.terrainMat.uniforms.sunColor, p.terrainSun);
  setTriple(targets.terrainMat.uniforms.skyColor, p.terrainSky);
  setTriple(targets.terrainMat.uniforms.groundColor, p.terrainGround);
  setTriple(targets.waterMat.uniforms.sunColor, p.waterSun);
  targets.skyMat.uniforms.nightMix!.value = night ? 1 : 0;
}
