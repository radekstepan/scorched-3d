import { buildPalette, TILE_RAMPS } from "./palette";
import { clamp, fbm, hash2, lerp, mulberry32, ridged, smoothstep, warpFbm } from "./noise";
import { placeUnits } from "../units/place.js";
import {
  CELL_PIXELS,
  FEATURE_EMPTY,
  FEATURE_FRINGE,
  PRESET_META,
  TILE_PIXELS,
  TNT_VERSION,
  type FeatureRecord,
  type MapPreset,
  type TileKind,
  type TNTMap,
} from "./types";

const FEATURE_TABLE: FeatureRecord[] = [
  { name: "Tree1", kind: "tree" },
  { name: "Tree2", kind: "tree" },
  { name: "Tree3", kind: "tree" },
  { name: "Rock1", kind: "rock" },
  { name: "Rock2", kind: "rock" },
  { name: "RockMetal3", kind: "metal" },
];

const VARIANTS_PER_KIND = 6;

export function generateMap(preset: MapPreset, seed: number): TNTMap {
  const width = 160;
  const height = 128;
  const seaLevel = preset === "highpass" ? 0 : 75;
  const heights = new Uint8Array(width * height);
  const features = new Uint16Array(width * height);
  features.fill(FEATURE_EMPTY);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      heights[z * width + x] = sampleHeight(preset, x, z, width, height, seed, seaLevel);
    }
  }

  stampFeatures(preset, heights, features, width, height, seaLevel, seed);

  const kinds: TileKind[] = [];
  const tiles: Uint8Array[] = [];
  const palette = buildPalette();
  (Object.keys(TILE_RAMPS) as TileKind[]).forEach((kind) => {
    for (let v = 0; v < VARIANTS_PER_KIND; v++) {
      kinds.push(kind);
      tiles.push(paintTile(kind, v, seed));
    }
  });

  const tileW = width / 2;
  const tileH = height / 2;
  const tileMap = new Uint16Array(tileW * tileH);
  for (let tz = 0; tz < tileH; tz++) {
    for (let tx = 0; tx < tileW; tx++) {
      const kind = classifyTile(heights, width, height, seaLevel, tx * 2, tz * 2, seed);
      const variant = Math.floor(hash2(tx, tz, seed + 90) * VARIANTS_PER_KIND);
      const index = kinds.findIndex((k, i) => k === kind && i % VARIANTS_PER_KIND === variant);
      tileMap[tz * tileW + tx] = index >= 0 ? index : 0;
    }
  }

  const minimap = buildMinimap(heights, tileMap, tiles, width, height, seaLevel);
  const units = placeUnits({ heights, features, width, height, seaLevel }, seed);

  return {
    name: PRESET_META[preset].name,
    world: PRESET_META[preset].world,
    preset,
    seed,
    version: TNT_VERSION,
    width,
    height,
    seaLevel,
    heights,
    features,
    tileMap,
    tiles,
    tileKinds: kinds,
    featureTable: FEATURE_TABLE,
    palette,
    minimap,
    units,
  };
}

function sampleHeight(
  preset: MapPreset,
  x: number,
  z: number,
  w: number,
  h: number,
  seed: number,
  sea: number,
): number {
  const nx = (x / (w - 1)) * 2 - 1;
  const nz = (z / (h - 1)) * 2 - 1;
  let v = 0;

  if (preset === "greenreach") {
    const warped = warpFbm(x * 0.018, z * 0.018, seed, 0.55);
    const d = Math.hypot(nx * 0.92 + (warped - 0.5) * 0.35, nz * 1.08);
    const island = smoothstep(1.05, 0.32, d);
    const bay = 1 - smoothstep(0.12, 0.5, Math.hypot(nx - 0.42, nz - 0.38));
    const mask = clamp(island - bay * 0.62, 0, 1);
    const hills = fbm(x * 0.032, z * 0.032, seed + 3, 5);
    const ridge = Math.exp(-((nz + 0.42) * (nz + 0.42)) / 0.085) * ridged(x * 0.045, z * 0.04, seed + 4);
    const detail = (fbm(x * 0.11, z * 0.11, seed + 5, 3) - 0.5) * 12;
    const canyon = Math.exp(-(nx * nx) / 0.012) * smoothstep(-0.15, 0.55, nz) * (0.55 + fbm(x * 0.08, z * 0.08, seed + 12, 3));
    v = 38 + mask * (58 + hills * 48 + ridge * 58) + detail - canyon * 26 * mask;
    if (mask > 0.08 && mask < 0.42) v = lerp(v, sea + 4, 0.35);
  } else if (preset === "archipelago") {
    let mask = 0;
    const islands = [
      [ -0.25, -0.1, 0.42 ],
      [ 0.38, 0.18, 0.3 ],
      [ -0.55, 0.4, 0.22 ],
      [ 0.15, -0.48, 0.26 ],
      [ 0.62, -0.28, 0.18 ],
      [ -0.05, 0.52, 0.2 ],
    ];
    for (let i = 0; i < islands.length; i++) {
      const [cx = 0, cz = 0, r = 0] = islands[i] ?? [];
      const warp = (fbm(x * 0.04 + i * 3, z * 0.04, seed + i, 3) - 0.5) * 0.28;
      const d = Math.hypot(nx - cx + warp, nz - cz);
      mask = Math.max(mask, smoothstep(r, r * 0.25, d));
    }
    const volc = ridged(x * 0.05, z * 0.05, seed + 11);
    v = 28 + mask * (58 + volc * 70) + (fbm(x * 0.1, z * 0.1, seed + 8, 3) - 0.5) * 10;
  } else if (preset === "highpass") {
    const plateauL = smoothstep(0.15, -0.05, nx + (fbm(x * 0.02, z * 0.02, seed) - 0.5) * 0.2);
    const plateauR = smoothstep(-0.15, 0.08, nx - (fbm(x * 0.02, z * 0.02, seed + 2) - 0.5) * 0.2);
    const pass = Math.exp(-(nx * nx) / 0.08) * (0.35 + fbm(x * 0.03, z * 0.05, seed + 6) * 0.4);
    const hills = fbm(x * 0.04, z * 0.04, seed + 3, 5);
    v = 88 + plateauL * 62 + plateauR * 70 - pass * 55 + (hills - 0.5) * 22;
    v += ridged(x * 0.06, z * 0.03, seed + 9) * 18 * (1 - pass);
  } else {
    const d = Math.hypot(nx * 0.95, nz * 1.05);
    const rim = Math.exp(-((d - 0.55) * (d - 0.55)) / 0.018);
    const bowl = 1 - smoothstep(0.18, 0.5, d);
    const outer = smoothstep(1.15, 0.72, d);
    const crack = ridged(x * 0.07, z * 0.07, seed + 4);
    v = 46 + outer * 28 + rim * (78 + crack * 22) - bowl * 36;
    v += (fbm(x * 0.09, z * 0.09, seed + 5, 3) - 0.5) * 10;
  }

  const edge = Math.max(Math.abs(nx), Math.abs(nz));
  if (preset !== "highpass") {
    v = lerp(v, sea - 28, smoothstep(0.82, 1.0, edge));
  }

  return clamp(Math.round(v), 0, 255);
}

function cellSlope(heights: Uint8Array, w: number, h: number, x: number, z: number): number {
  const h00 = heights[z * w + x] ?? 0;
  const h10 = heights[z * w + Math.min(w - 1, x + 1)] ?? 0;
  const h01 = heights[Math.min(h - 1, z + 1) * w + x] ?? 0;
  const h11 = heights[Math.min(h - 1, z + 1) * w + Math.min(w - 1, x + 1)] ?? 0;
  return Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
}

function classifyTile(
  heights: Uint8Array,
  w: number,
  h: number,
  sea: number,
  x: number,
  z: number,
  seed: number,
): TileKind {
  const hgt = heights[z * w + x] ?? 0;
  const slope = cellSlope(heights, w, h, x, z);
  const metal = fbm(x * 0.07, z * 0.07, seed + 40, 3);

  if (hgt < sea - 14) return "deep";
  if (hgt < sea - 2) return "shallow";
  if (hgt < sea + 3) return "wetSand";
  if (hgt < sea + 8) return "sand";
  if (slope > 22) return "cliff";
  if (slope > 14) return "rock";
  if (metal > 0.72 && hgt > sea + 10) return "metal";
  if (hgt < sea + 14) return "dirt";
  const lush = fbm(x * 0.05, z * 0.05, seed + 21, 4);
  if (lush > 0.62) return "lush";
  if (lush < 0.38) return "darkGrass";
  return "grass";
}

function stampFeatures(
  preset: MapPreset,
  heights: Uint8Array,
  features: Uint16Array,
  w: number,
  h: number,
  sea: number,
  seed: number,
) {
  for (let z = 2; z < h - 2; z++) {
    for (let x = 2; x < w - 2; x++) {
      const i = z * w + x;
      const hgt = heights[i] ?? 0;
      if (hgt <= sea + 4) continue;
      const slope = cellSlope(heights, w, h, x, z);
      const forest = fbm(x * 0.055, z * 0.055, seed + 70, 4);
      const dens = preset === "archipelago" ? 0.6 : preset === "highpass" ? 0.52 : 0.56;
      if (slope < 9 && forest > dens && hash2(x, z, seed + 71) > 0.55) {
        const which = Math.floor(hash2(x, z, seed + 72) * 3);
        features[i] = which;
      } else if (slope > 16 && hash2(x, z, seed + 73) > 0.82) {
        features[i] = 3 + (hash2(x, z, seed + 74) > 0.5 ? 1 : 0);
      }
    }
  }

  const deposits = preset === "highpass" ? 7 : 5;
  const rng = mulberry32(seed ^ 0x51ed);
  for (let n = 0; n < deposits; n++) {
    const x = 8 + Math.floor(rng() * (w - 16));
    const z = 8 + Math.floor(rng() * (h - 16));
    const i = z * w + x;
    if ((heights[i] ?? 0) <= sea + 6) continue;
    features[i] = 5;
    for (let dz = 0; dz < 3; dz++) {
      for (let dx = 0; dx < 3; dx++) {
        if (dx === 0 && dz === 0) continue;
        const fi = (z + dz) * w + (x + dx);
        if (features[fi] === FEATURE_EMPTY) features[fi] = FEATURE_FRINGE;
      }
    }
  }
}

function paintTile(kind: TileKind, variant: number, seed: number): Uint8Array {
  const pix = new Uint8Array(TILE_PIXELS * TILE_PIXELS);
  const ramp = TILE_RAMPS[kind];
  const rng = mulberry32(seed ^ (kind.length * 17 + variant * 999));
  for (let y = 0; y < TILE_PIXELS; y++) {
    for (let x = 0; x < TILE_PIXELS; x++) {
      const n = fbm(x * 0.28 + variant * 3, y * 0.28 + variant * 1.7, seed + variant, 3);
      let t = clamp(n * 0.85 + rng() * 0.15, 0, 0.999);
      if (kind === "grass" || kind === "lush" || kind === "darkGrass") {
        const tuft = hash2(x >> 1, y >> 1, seed + variant + 3);
        if (tuft > 0.72) t = clamp(t + 0.2, 0, 0.999);
      }
      if (kind === "rock" || kind === "cliff") {
        const crack = Math.abs(Math.sin((x + y * 0.3) * 0.7 + variant));
        if (crack > 0.85) t *= 0.45;
      }
      let idx = ramp.start + Math.floor(t * ramp.count);
      if (rng() > 0.93) {
        idx = ramp.specks[Math.floor(rng() * ramp.specks.length)] ?? idx;
      }
      pix[y * TILE_PIXELS + x] = idx;
    }
  }
  return pix;
}

function buildMinimap(
  heights: Uint8Array,
  tileMap: Uint16Array,
  tiles: Uint8Array[],
  w: number,
  h: number,
  sea: number,
) {
  const mw = 252;
  const mh = 252;
  const pixels = new Uint8Array(mw * mh);
  const tileW = w / 2;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const tx = Math.min(w - 1, Math.floor((x / mw) * w));
      const tz = Math.min(h - 1, Math.floor((y / mh) * h));
      const hgt = heights[tz * w + tx] ?? 0;
      const tix = Math.min(tileW - 1, tx >> 1);
      const tiz = Math.min(h / 2 - 1, tz >> 1);
      const tileIndex = tileMap[tiz * tileW + tix] ?? 0;
      const tile = tiles[tileIndex] ?? tiles[0] ?? new Uint8Array(TILE_PIXELS * TILE_PIXELS);
      const px = tile[(tz & 1) * 16 * TILE_PIXELS + (tx & 1) * 16] ?? 16;
      let idx = px;
      if (hgt < sea) idx = hgt < sea - 12 ? 160 : 180;
      pixels[y * mw + x] = idx;
    }
  }
  return { width: mw, height: mh, pixels };
}

export function worldSize(map: TNTMap): { worldW: number; worldD: number } {
  return {
    worldW: (map.width - 1) * CELL_PIXELS,
    worldD: (map.height - 1) * CELL_PIXELS,
  };
}

export function heightAt(map: TNTMap, x: number, z: number): number {
  const xi = clamp(Math.floor(x), 0, map.width - 1);
  const zi = clamp(Math.floor(z), 0, map.height - 1);
  return map.heights[zi * map.width + xi] ?? 0;
}

export function featureName(map: TNTMap, x: number, z: number): string | null {
  const word = map.features[z * map.width + x] ?? FEATURE_EMPTY;
  if (word === FEATURE_EMPTY || word === FEATURE_FRINGE) return null;
  return map.featureTable[word]?.name ?? null;
}
