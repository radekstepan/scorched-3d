import * as THREE from "three";
import {
  craterDepthAt,
  SCORCH_CORE_RGB,
  SCORCH_RIM_RGB,
  type Crater,
  type TNTMap,
} from "@scorched-3d/core";

/**
 * Believable blast scorch + tiny terrain dents.
 *
 * The old scorch was a flat brown circle (one solid tone, hard silhouette) —
 * it read as mud. The shared texture baked here gives every mark a charred
 * cool-grey center fading to a desaturated grey rim with an irregular,
 * wobbling feathered edge; per-mark instance colors only scale brightness by
 * blast intensity, and each mark is squashed elliptically + rotated so no two
 * blotches share a silhouette. One 128² byte-bake shared by every mark, one
 * instanced draw — the scene budget is untouched.
 *
 * Craters dent the visual terrain mesh only (a shallow dimple ≤0.6 height units
 * per blast). Pathing and unit
 * seating read the static core heightfield, so dents can never trap a unit;
 * only the mesh, scorch seating, and the hover probe dip into the bowl.
 */

/** Texture resolution (px, square). */
export const SCORCH_TEXTURE_SIZE = 128;
/** Edge wobble of the baked silhouette (fraction of radius). */
export const SCORCH_EDGE_WOBBLE = 0.22;

/**
 * Angular edge radius multiplier at angle `theta` (the irregular silhouette).
 * Sum of sines with irrational-ish phases — deterministic, baked once into
 * the shared texture; per-mark rotation + squash supply the variety.
 */
export function scorchEdgeRadius(theta: number): number {
  return (
    1 +
    SCORCH_EDGE_WOBBLE * 0.55 * Math.sin(3 * theta + 1.7) +
    SCORCH_EDGE_WOBBLE * 0.3 * Math.sin(5 * theta + 0.6) +
    SCORCH_EDGE_WOBBLE * 0.15 * Math.sin(8 * theta + 3.1)
  );
}

/** Smoothstep helper (pure, for the baked alpha falloff). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Baked scorch color at normalized radius `t` (0 = ground zero, 1 = rim):
 * charred core → scorched rim → transparent feather. Returns sRGB 0..1 + alpha.
 */
export function scorchTexel(t: number): [number, number, number, number] {
  const core = SCORCH_CORE_RGB;
  const rim = SCORCH_RIM_RGB;
  const mix = smoothstep(0.25, 0.85, t);
  const r = core[0]! + (rim[0]! - core[0]!) * mix;
  const g = core[1]! + (rim[1]! - core[1]!) * mix;
  const b = core[2]! + (rim[2]! - core[2]!) * mix;
  // Opaque char heart, feathered scorched fringe dissolving past the rim.
  // The fringe starts fading early so the rim reads translucent, not painted.
  const alpha = 1 - smoothstep(0.42, 0.9, t);
  return [r, g, b, alpha];
}

let cachedTexture: THREE.DataTexture | null = null;

/**
 * Raw baked bytes for the shared scorch texture (pure: no DOM, no three.js
 * — unit-testable in node). Row-major RGBA, `size`×`size`.
 */
export function bakeScorchBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const r = Math.sqrt(dx * dx + dy * dy);
      const theta = Math.atan2(dy, dx);
      const t = r / scorchEdgeRadius(theta);
      const [cr, cg, cb, a] = scorchTexel(t);
      const i = (y * size + x) * 4;
      bytes[i] = Math.round(cr * 255);
      bytes[i + 1] = Math.round(cg * 255);
      bytes[i + 2] = Math.round(cb * 255);
      bytes[i + 3] = Math.round(a * 255);
    }
  }
  return bytes;
}

/**
 * Shared baked scorch texture (built once from `bakeScorchBytes`).
 * Instance colors multiply over it for per-kind darkness.
 */
export function getScorchTexture(): THREE.DataTexture {
  if (cachedTexture) return cachedTexture;
  const size = SCORCH_TEXTURE_SIZE;
  const tex = new THREE.DataTexture(bakeScorchBytes(size), size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cachedTexture = tex;
  return tex;
}

/** Drop the shared baked texture (canvas unmount / regen). */
export function disposeScorchTexture(): void {
  if (!cachedTexture) return;
  cachedTexture.dispose();
  cachedTexture = null;
}

/**
 * Recompute terrain vertex heights from the static map minus the visual
 * crater bowls: `y = h * exaggeration - dent * exaggeration`. Deterministic
 * (pure function of map + craters + exaggeration), so exaggeration re-snaps
 * just re-run it. Normals are left alone per blast — the bowl is ≤0.6 height
 * unit deep and the dark char decal on top carries the shading; the canvas
 * recomputes normals on re-snap anyway.
 */
export function applyCraters(
  geometry: THREE.BufferGeometry,
  map: TNTMap,
  craters: readonly Crater[],
  exaggeration: number,
): void {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const w = map.width;
  const h = map.height;
  for (let i = 0; i < w * h; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const base = map.heights[i] ?? 0;
    const dent = craters.length > 0 ? craterDepthAt(craters, x, z) : 0;
    pos.setY(i, (base - dent) * exaggeration);
  }
  pos.needsUpdate = true;
}
