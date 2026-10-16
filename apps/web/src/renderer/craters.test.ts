import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CELL_PIXELS, worldHeight, type TNTMap } from "@scorched-3d/core";
import {
  applyCraters,
  bakeScorchBytes,
  disposeScorchTexture,
  getScorchTexture,
  scorchEdgeRadius,
  scorchTexel,
  smoothstep,
  SCORCH_TEXTURE_SIZE,
} from "./craters";

describe("scorchEdgeRadius (irregular silhouette)", () => {
  it("wobbles around 1, deterministically and periodically", () => {
    expect(scorchEdgeRadius(0.3)).toBe(scorchEdgeRadius(0.3));
    expect(scorchEdgeRadius(1.1)).toBeCloseTo(scorchEdgeRadius(1.1 + Math.PI * 2), 12);
    let min = Infinity;
    let max = -Infinity;
    for (let n = 0; n < 64; n++) {
      const r = scorchEdgeRadius((n / 64) * Math.PI * 2);
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    // Genuinely irregular (not a circle), but never wild.
    expect(min).toBeLessThan(0.95);
    expect(max).toBeGreaterThan(1.05);
    expect(min).toBeGreaterThan(0.7);
    expect(max).toBeLessThan(1.3);
  });
});

describe("scorchTexel (charred center, scorched rim)", () => {
  it("fades from an opaque char heart to a transparent fringe", () => {
    const [r0, g0, b0, a0] = scorchTexel(0);
    expect(a0).toBe(1);
    // Dark cool-grey center, never saturated brown.
    expect(r0).toBeLessThan(0.12);
    expect(Math.max(r0, g0, b0) - Math.min(r0, g0, b0)).toBeLessThan(0.02);
    const [, , , aMid] = scorchTexel(0.7);
    expect(aMid).toBeGreaterThan(0);
    expect(aMid).toBeLessThan(1);
    const [, , , aOut] = scorchTexel(1.2);
    expect(aOut).toBe(0);
  });

  it("lightens toward a desaturated grey rim before dissolving", () => {
    const [r0] = scorchTexel(0);
    const [rRim, gRim, bRim, aRim] = scorchTexel(0.8);
    expect(rRim).toBeGreaterThan(r0);
    expect(Math.max(rRim, gRim, bRim) - Math.min(rRim, gRim, bRim)).toBeLessThan(0.04);
    // Rim stays dim grey, never mud-bright.
    expect(rRim).toBeLessThan(0.24);
    // Rim reads translucent, not painted: mostly faded by t = 0.8.
    expect(aRim).toBeLessThan(0.35);
  });

  it("smoothstep clamps and eases", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 9);
  });
});

describe("bakeScorchBytes (shared texture)", () => {
  it("bakes an opaque dark center and a transparent corner", () => {
    const size = 32;
    const bytes = bakeScorchBytes(size);
    expect(bytes.length).toBe(size * size * 4);
    const center = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
    expect(bytes[center + 3]).toBe(255);
    expect(bytes[center]).toBeLessThan(40);
    // Center texel is desaturated grey, never brown: channels track closely.
    const spread = Math.max(bytes[center]!, bytes[center + 1]!, bytes[center + 2]!) -
      Math.min(bytes[center]!, bytes[center + 1]!, bytes[center + 2]!);
    expect(spread).toBeLessThan(12);
    // Far corner sits outside even the wobbled rim: fully transparent.
    expect(bytes[bytes.length - 1]).toBe(0);
  });

  it("shares one texture instance until disposed", () => {
    const a = getScorchTexture();
    expect(getScorchTexture()).toBe(a);
    expect(a.image.width).toBe(SCORCH_TEXTURE_SIZE);
    expect(a.image.height).toBe(SCORCH_TEXTURE_SIZE);
    disposeScorchTexture();
    // Re-bakes on next use (same bytes, fresh texture).
    const b = getScorchTexture();
    expect(b).not.toBe(a);
    expect(b.image.width).toBe(SCORCH_TEXTURE_SIZE);
    disposeScorchTexture();
  });
});

describe("applyCraters (tiny visual dents)", () => {
  function makeGrid(w: number, h: number, height: number): { map: TNTMap; geo: THREE.BufferGeometry } {
    const map = { width: w, height: h, heights: new Uint8Array(w * h).fill(height) } as TNTMap;
    const positions = new Float32Array(w * h * 3);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        positions[i * 3] = (x - (w - 1) / 2) * CELL_PIXELS;
        positions[i * 3 + 1] = height;
        positions[i * 3 + 2] = (z - (h - 1) / 2) * CELL_PIXELS;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return { map, geo };
  }

  function yAt(geo: THREE.BufferGeometry, i: number): number {
    return (geo.getAttribute("position") as THREE.BufferAttribute).getY(i);
  }

  it("leaves flat ground untouched with no craters", () => {
    const { map, geo } = makeGrid(5, 5, 100);
    applyCraters(geo, map, [], 3.6);
    for (let i = 0; i < 25; i++) expect(yAt(geo, i)).toBeCloseTo(worldHeight(100, 3.6), 9);
  });

  it("dents the bowl center and spares distant vertices", () => {
    const { map, geo } = makeGrid(9, 9, 100);
    // Center vertex sits at world (0, 0); radius covers ~2 cells.
    applyCraters(geo, map, [{ x: 0, z: 0, radius: 2 * CELL_PIXELS, depth: 1 }], 2);
    expect(yAt(geo, 40)).toBeCloseTo(worldHeight(100 - 1, 2), 9);
    // Corner vertex (~5.6 cells out) is past the rim: untouched.
    expect(yAt(geo, 0)).toBeCloseTo(worldHeight(100, 2), 9);
    // Midway vertex is partially dented.
    const mid = yAt(geo, 39);
    expect(mid).toBeLessThan(worldHeight(100, 2));
    expect(mid).toBeGreaterThan(worldHeight(99, 2));
  });

  it("scales dents with exaggeration and re-runs deterministically", () => {
    const crater = { x: 0, z: 0, radius: 3 * CELL_PIXELS, depth: 0.5 };
    const a = makeGrid(7, 7, 80);
    applyCraters(a.geo, a.map, [crater], 1);
    const b = makeGrid(7, 7, 80);
    applyCraters(b.geo, b.map, [crater], 3);
    // Same dent, triple the exaggeration: triple the world depth.
    const dropA = worldHeight(80, 1) - yAt(a.geo, 24);
    const dropB = worldHeight(80, 3) - yAt(b.geo, 24);
    expect(dropB).toBeCloseTo(dropA * 3, 9);
    // Re-running over the same inputs reproduces the exact mesh (re-snaps
    // never accumulate: the dent is recomputed from the map, not the mesh).
    applyCraters(a.geo, a.map, [crater], 1);
    expect(yAt(a.geo, 24)).toBeCloseTo(worldHeight(80, 1) - dropA, 12);
  });
});

describe("applyCraters (washed bowls on gradients)", () => {
  function makeGrid(w: number, h: number, height: number): { map: TNTMap; geo: THREE.BufferGeometry } {
    const map = { width: w, height: h, heights: new Uint8Array(w * h).fill(height) } as TNTMap;
    const positions = new Float32Array(w * h * 3);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        positions[i * 3] = (x - (w - 1) / 2) * CELL_PIXELS;
        positions[i * 3 + 1] = height;
        positions[i * 3 + 2] = (z - (h - 1) / 2) * CELL_PIXELS;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return { map, geo };
  }

  function yAt(geo: THREE.BufferGeometry, i: number): number {
    return (geo.getAttribute("position") as THREE.BufferAttribute).getY(i);
  }

  it("digs deeper downhill and shallower uphill under a wash", () => {
    // 9×9 grid: row 4 holds world z = 0; x = 3/4/5 sit at −16/0/+16.
    const { map, geo } = makeGrid(9, 9, 100);
    applyCraters(
      geo,
      map,
      [{ x: 0, z: 0, radius: 2 * CELL_PIXELS, depth: 1, sx: 1, sz: 0, skew: 0.45 }],
      2,
    );
    const down = yAt(geo, 41); // +16 world x, downhill
    const up = yAt(geo, 39); // −16 world x, uphill
    expect(down).toBeLessThan(worldHeight(100, 2));
    expect(up).toBeLessThan(worldHeight(100, 2));
    // Same plan distance, but the downhill flank digs visibly deeper.
    expect(down).toBeLessThan(up - 0.5);
  });

  it("keeps unwashed bowls symmetric (legacy)", () => {
    const { map, geo } = makeGrid(9, 9, 100);
    applyCraters(geo, map, [{ x: 0, z: 0, radius: 2 * CELL_PIXELS, depth: 1 }], 2);
    expect(yAt(geo, 41)).toBeCloseTo(yAt(geo, 39), 12);
  });
});
