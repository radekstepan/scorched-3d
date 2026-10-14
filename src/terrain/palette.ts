/** Original 256-color table inspired by TA's packed ramps, not the retail PAL. */

import type { TileKind } from "./types";

export function buildPalette(): Uint8Array {
  const pal = new Uint8Array(256 * 3);
  const set = (i: number, r: number, g: number, b: number) => {
    pal[i * 3] = r;
    pal[i * 3 + 1] = g;
    pal[i * 3 + 2] = b;
  };

  set(0, 0, 0, 0);

  ramp(pal, 1, 16, [8, 16, 8], [36, 64, 24]); // deep greens
  ramp(pal, 16, 32, [28, 52, 16], [92, 132, 40]); // grass
  ramp(pal, 48, 16, [70, 108, 32], [168, 196, 72]); // lush / highlight
  ramp(pal, 64, 16, [48, 36, 20], [128, 92, 48]); // dirt
  ramp(pal, 80, 16, [96, 72, 40], [196, 164, 96]); // dry earth
  ramp(pal, 96, 16, [140, 116, 64], [228, 208, 148]); // sand
  ramp(pal, 112, 12, [92, 84, 52], [168, 148, 92]); // wet sand
  ramp(pal, 124, 20, [36, 32, 28], [140, 132, 120]); // rock
  ramp(pal, 144, 12, [72, 48, 36], [168, 112, 72]); // cliff
  ramp(pal, 156, 20, [4, 20, 36], [48, 92, 120]); // deep water
  ramp(pal, 176, 16, [20, 64, 72], [96, 168, 164]); // shallow water
  ramp(pal, 192, 16, [40, 44, 48], [156, 164, 172]); // metal
  ramp(pal, 208, 16, [16, 40, 16], [64, 96, 40]); // dark grass
  ramp(pal, 224, 16, [24, 28, 20], [80, 88, 52]); // seabed
  ramp(pal, 240, 15, [180, 188, 160], [255, 255, 255]); // highlights
  set(255, 255, 255, 255);
  return pal;
}

function ramp(
  pal: Uint8Array,
  start: number,
  count: number,
  a: [number, number, number],
  b: [number, number, number],
) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const idx = start + i;
    pal[idx * 3] = Math.round(a[0] + (b[0] - a[0]) * t);
    pal[idx * 3 + 1] = Math.round(a[1] + (b[1] - a[1]) * t);
    pal[idx * 3 + 2] = Math.round(a[2] + (b[2] - a[2]) * t);
  }
}

export const TILE_RAMPS: Record<TileKind, { start: number; count: number; specks: number[] }> = {
  deep: { start: 156, count: 20, specks: [224, 225, 160] },
  shallow: { start: 176, count: 16, specks: [180, 112, 96] },
  wetSand: { start: 112, count: 12, specks: [80, 96, 176] },
  sand: { start: 96, count: 16, specks: [80, 64, 240] },
  dirt: { start: 64, count: 16, specks: [80, 16, 124] },
  grass: { start: 16, count: 32, specks: [48, 208, 64] },
  lush: { start: 48, count: 16, specks: [16, 32, 240] },
  darkGrass: { start: 208, count: 16, specks: [16, 1, 64] },
  rock: { start: 124, count: 20, specks: [144, 80, 192] },
  cliff: { start: 144, count: 12, specks: [124, 64, 80] },
  metal: { start: 192, count: 16, specks: [124, 240, 80] },
};

export function palRGB(pal: Uint8Array, index: number): [number, number, number] {
  const i = index * 3;
  return [pal[i], pal[i + 1], pal[i + 2]];
}
