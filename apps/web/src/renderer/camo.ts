import * as THREE from "three";
import type { UnitKind } from "@scorched-3d/core";

/**
 * Subtle procedural camo on unit hulls: one small shared grayscale texture
 * per unit kind (near-white blotches + grain) bound as `map` on the hull
 * Lambert materials. The map multiplies the hull paint, so:
 *
 * - hue is preserved exactly (grayscale carries luminance only — no team
 *   color is ever painted on the hull; side identity stays on the ground
 *   rings / HUD chips / minimap per the no-tint policy),
 * - damage charring (`applyUnitDamageTint`) and wreck char
 *   (`applyWreckChar`) keep working untouched — they rewrite `color` from
 *   the stashed base hex while the map rides along,
 * - selection stays ring/beacon-only (no material/emissive tricks here),
 * - the occlusion ghost is unaffected (it mirrors geometries under its own
 *   cyan x-ray materials, never hull materials).
 *
 * Cheap by construction: 4 shared 64×64 `DataTexture`s (one per kind, built
 * once, no DOM/canvas so node tests cover the bake), zero new materials,
 * zero new draw calls. The bake is seeded per kind (mulberry32, no
 * `Math.random`), so replays match frame for frame.
 */

/** Camo texture edge length, texels (one shared texture per kind). */
export const CAMO_TEXTURE_SIZE = 64;
/** Flat field the blotches darken from (near-white, so paint stays exact). */
export const CAMO_BASE = 250;
/** Deepest blotch-center darkening, fraction of the base (subtle: ~12%). */
export const CAMO_MAX_DEPTH = 0.13;
/** Per-texel grain amplitude, ± (paint-grain read, not noise). */
export const CAMO_GRAIN = 3.5;

/** Deterministic bake seed per kind (fixed table, not a hash — stable). */
const CAMO_SEEDS: Record<UnitKind, number> = {
  flash: 1234567,
  stump: 2345671,
  hammer: 3456712,
  commander: 4567123,
};

/** Disruptive-blotch count per kind (silhouette variety, same budget). */
const CAMO_BLOTCHES: Record<UnitKind, number> = {
  flash: 7,
  stump: 9,
  hammer: 8,
  commander: 6,
};

/** Deterministic PRNG (mulberry32): same seed, same stream, no Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Blotch {
  cx: number;
  cy: number;
  r: number;
  depth: number;
}

/**
 * Raw baked bytes for one kind's camo texture (pure: no DOM, no three.js —
 * unit-testable in node). Row-major RGBA, `size`×`size`, opaque grayscale:
 * a near-white field with smooth disruptive blotches plus a whisper of
 * grain. Luminance-only, so hull hue (and the no-hull-tint policy) survives
 * the multiply exactly.
 */
export function bakeCamoBytes(kind: UnitKind, size: number): Uint8Array {
  const bytes = new Uint8Array(size * size * 4);
  const rng = mulberry32(CAMO_SEEDS[kind] ?? 1);
  const blotches: Blotch[] = [];
  const count = CAMO_BLOTCHES[kind] ?? 7;
  for (let b = 0; b < count; b++) {
    blotches.push({
      cx: rng() * size,
      cy: rng() * size,
      r: 5 + rng() * 6,
      depth: 0.07 + rng() * (CAMO_MAX_DEPTH - 0.07),
    });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = CAMO_BASE;
      for (const blotch of blotches) {
        // Toroidal distance so edge texels join seamlessly under UV wrap.
        let dx = Math.abs(x + 0.5 - blotch.cx);
        let dy = Math.abs(y + 0.5 - blotch.cy);
        if (dx > size / 2) dx = size - dx;
        if (dy > size / 2) dy = size - dy;
        const d = Math.sqrt(dx * dx + dy * dy) / blotch.r;
        if (d < 1) v -= blotch.depth * 255 * (0.5 + 0.5 * Math.cos(Math.PI * d));
      }
      v += (rng() - 0.5) * 2 * CAMO_GRAIN;
      const q = Math.max(0, Math.min(255, Math.round(v)));
      const i = (y * size + x) * 4;
      bytes[i] = q;
      bytes[i + 1] = q;
      bytes[i + 2] = q;
      bytes[i + 3] = 255;
    }
  }
  return bytes;
}

const cachedCamo = new Map<UnitKind, THREE.DataTexture>();

/**
 * Shared camo texture for a kind (built once from `bakeCamoBytes`, like the
 * scorch texture). Same object every call — hull materials share it, so the
 * whole roster adds 4 texture binds and no new materials or draws.
 */
export function getCamoTexture(kind: UnitKind): THREE.DataTexture {
  const cached = cachedCamo.get(kind);
  if (cached) return cached;
  const size = CAMO_TEXTURE_SIZE;
  const tex = new THREE.DataTexture(bakeCamoBytes(kind, size), size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cachedCamo.set(kind, tex);
  return tex;
}

/** Drop the shared camo textures (canvas unmount / regen). */
export function disposeCamoTextures(): void {
  for (const tex of cachedCamo.values()) tex.dispose();
  cachedCamo.clear();
}

/**
 * Dress one unit body in its kind's camo: bind the shared texture as `map`
 * on every hull-paint Lambert mesh. Skips road wheels (rubber stays flat),
 * selection/team markers (`noHighlight` — damage charring skips them too),
 * and non-Lambert marker materials. Idempotent; hull `color` hexes are never
 * touched, so the stashed-base damage/wreck char math is byte-identical.
 * Headless-test groups without meshes are a no-op.
 */
export function applyCamo(body: THREE.Object3D, kind: UnitKind): void {
  const tex = getCamoTexture(kind);
  body.traverse((child) => {
    if (child.userData.noHighlight) return;
    if (child.name === "wheel") return;
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
    if (!mat || !("emissive" in mat) || !("color" in mat)) return;
    if (mat.map === tex) return;
    mat.map = tex;
    mat.needsUpdate = true;
  });
}
