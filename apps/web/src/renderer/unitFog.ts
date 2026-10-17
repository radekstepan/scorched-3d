import * as THREE from "three";
import { applyValleyFog, VALLEY_FOG_SPAN, valleyFogFactor } from "./shaders";

/**
 * Valley haze for unit hulls. The terrain shader layers three fog terms —
 * linear distance, drifting haze, and a day-only valley height term — while
 * unit hulls (plain Lambert meshes) only ever saw `scene.fog`'s distance
 * blend. Hulls parked in hollows therefore rendered crisp against hazed
 * ground. This module injects the valley term into hull materials via
 * `onBeforeCompile` (the `applyFireflyTreeGlow` precedent in fireflies.ts),
 * so hulls haze with the dirt under them.
 *
 * Deliberately matched terms:
 * - Distance: already shared — hulls keep three.js's own `fogFactor`
 *   (smoothstep-shaped, vs the terrain's linear ramp; both pin 0 at
 *   fogNear and 1 at fogFar, so the response agrees approximately).
 * - Valley: injected, combining exactly like the terrain
 *   (`fog + (1 - fog) * valley * strength`) with the band span generated
 *   from the shared `VALLEY_FOG_SPAN` constant, so the GLSL cannot drift
 *   from the JS mirror.
 *
 * Deliberately unmatched: the drift wobble (±17.5% breathing on far fog)
 * would cost a noise field in every hull program for a modulation nobody
 * can read on a 26-unit hull, and the mist-bank sprites already blend over
 * hulls behind their plane (banks pool in the same hollows the valley
 * term covers, so the two stay correlated).
 *
 * Markers (team rings, selection chevrons, health bars, occlusion ghosts)
 * are UI layers and never take the valley term: units must stay findable
 * in the haze. Thumbnail scenes carry no `scene.fog`, so the term is
 * gated on `USE_FOG` and tray icons render crisp.
 */

/** Program-cache key for valley-hazed hull materials (trees use their own). */
export const UNIT_FOG_CACHE_KEY = "unit-valley-fog";

/**
 * Shared unit-fog uniform objects, aliased (not copied) into every hull
 * program at compile time — the canvas writes these and all hulls follow
 * with zero per-frame cost. Day defaults; `applyDayNight` owns `valley`,
 * the canvas owns `color`/`waterY`/`exaggeration`.
 */
export const unitFogUniforms = {
  color: { value: new THREE.Color(0x8eb4c8) },
  valley: { value: 0.35 },
  waterY: { value: 0 },
  exaggeration: { value: 1 },
};

/**
 * Bind the shared field. `color` aliases the canvas's fog `THREE.Color`
 * (day/night retints propagate); the floats copy by value.
 */
export function setUnitFog(input: {
  color?: THREE.Color;
  valley?: number;
  waterY?: number;
  exaggeration?: number;
}): void {
  if (input.color) unitFogUniforms.color.value = input.color;
  if (input.valley !== undefined) unitFogUniforms.valley.value = input.valley;
  if (input.waterY !== undefined) unitFogUniforms.waterY.value = input.waterY;
  if (input.exaggeration !== undefined) unitFogUniforms.exaggeration.value = input.exaggeration;
}

/**
 * Splice a world-Y varying into a Lambert vertex shader (pure — tested
 * directly). Injected after `#include <project_vertex>` where `transformed`
 * is in scope (verified against the installed three.js Lambert shader);
 * no instancing branch — unit hulls are never instanced.
 */
export function spliceUnitFogVertex(src: string): string {
  const head = `varying float vUnitFogY;\n`;
  const inject =
    `#include <project_vertex>\n` + `vUnitFogY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;`;
  return head + src.replace("#include <project_vertex>", inject);
}

/**
 * Splice the valley term into a Lambert fragment shader (pure — tested
 * directly). Applied after `#include <fog_fragment>`, reusing three.js's
 * own `fogFactor` for the distance share, so the combine matches the
 * terrain: the height term layers onto the remaining clarity. The whole
 * block sits under `USE_FOG` so fog-less scenes (tray thumbnails) compile
 * it out entirely.
 */
export function spliceUnitFogFragment(src: string): string {
  const head =
    `uniform vec3 unitFogColor;\n` +
    `uniform float unitValleyFog;\n` +
    `uniform float unitWaterY;\n` +
    `uniform float unitExaggeration;\n` +
    `varying float vUnitFogY;\n`;
  const inject =
    `#include <fog_fragment>\n` +
    `#ifdef USE_FOG\n` +
    `float ufValley = 1.0 - smoothstep( unitWaterY, unitWaterY + ${VALLEY_FOG_SPAN}.0 * unitExaggeration, vUnitFogY );\n` +
    `gl_FragColor.rgb = mix( gl_FragColor.rgb, unitFogColor, clamp( ( 1.0 - fogFactor ) * ufValley * unitValleyFog, 0.0, 1.0 ) );\n` +
    `#endif`;
  return head + src.replace("#include <fog_fragment>", inject);
}

/**
 * Give a hull Lambert material the valley haze. The uniform objects are
 * aliased, so the canvas's writes update hulls and terrain together. The
 * custom program-cache key keeps hazed programs distinct from plain
 * Lambert (rocks) and firefly-glow Lambert (trees).
 */
export function applyUnitFog(material: THREE.MeshLambertMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.unitFogColor = unitFogUniforms.color;
    shader.uniforms.unitValleyFog = unitFogUniforms.valley;
    shader.uniforms.unitWaterY = unitFogUniforms.waterY;
    shader.uniforms.unitExaggeration = unitFogUniforms.exaggeration;
    shader.vertexShader = spliceUnitFogVertex(shader.vertexShader);
    shader.fragmentShader = spliceUnitFogFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => UNIT_FOG_CACHE_KEY;
}

/**
 * Hull paint: a Lambert material with the valley haze wired. Every present
 * and future hull mesh (hull boxes, barrels, wheels, legs, antennae, wreck
 * collars) builds through here, so live hulls and wrecks haze alike —
 * markers build their own materials and stay crisp.
 */
export function unitHullMaterial(color: number): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color });
  applyUnitFog(material);
  return material;
}

/**
 * JS mirror of the hull fog combine: distance share plus the valley term
 * layered onto the remaining clarity. Implemented by the shared
 * `applyValleyFog` — the equality with the terrain math is structural,
 * not coincidental.
 */
export function unitFogFactor(
  fogDist: number,
  groundY: number,
  waterY: number,
  exaggeration: number,
  strength: number,
): number {
  return applyValleyFog(fogDist, groundY, waterY, exaggeration, strength);
}

/**
 * The valley layer's own whitening share in [0, 1]: `(1 - fogDist) *
 * valley * strength`. Bounded above by `strength`, so day hulls always
 * keep >= 65% of their shaded paint from this term alone.
 */
export function unitValleyWhitening(
  fogDist: number,
  groundY: number,
  waterY: number,
  exaggeration: number,
  strength: number,
): number {
  const f = valleyFogFactor(groundY, waterY, exaggeration);
  return Math.min(1, Math.max(0, (1 - fogDist) * f * strength));
}
