import { buildPalette, TILE_RAMPS } from "./palette";
import { clamp, fbm, hash2, lerp, mulberry32, ridged, smoothstep, warpFbm } from "./noise";
import { placeUnits, startingUnitCount } from "../units/place.js";
import { clearHqLanes, gradeHqExits, hqPadCells, levelHqPads, placeHqs } from "../units/hq.js";
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

/** Attribute-grid width in 16-pixel cells (world extent 319 × 16 = 5104 units). */
export const MAP_WIDTH = 320;
/** Attribute-grid height in 16-pixel cells (world extent 255 × 16 = 4080 units). */
export const MAP_HEIGHT = 256;

/**
 * Raw pre-construction heightfield for a preset + seed: the ground exactly
 * as the height sampler leaves it, before HQ pads, driveways, features, or
 * tiles. `generateMap` builds on this; tests site forts against it so
 * siting invariants (low valley-floor anchors under the high-ground cap)
 * are measured on the ground the siter saw, not the raised pads.
 */
export function sampleHeightField(preset: MapPreset, seed: number): {
  heights: Uint8Array;
  width: number;
  height: number;
  seaLevel: number;
} {
  const width = MAP_WIDTH;
  const height = MAP_HEIGHT;
  const seaLevel = preset === "highpass" ? 0 : 75;
  const heights = new Uint8Array(width * height);
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      heights[z * width + x] = sampleHeight(preset, x, z, width, height, seed, seaLevel);
    }
  }
  return { heights, width, height, seaLevel };
}

export function generateMap(preset: MapPreset, seed: number): TNTMap {
  const { heights, width, height, seaLevel } = sampleHeightField(preset, seed);
  const features = new Uint16Array(width * height);
  features.fill(FEATURE_EMPTY);

  stampFeatures(preset, heights, features, width, height, seaLevel, seed);

  // HQ ground works: site the forts, level their construction pads UP to
  // the highest ground they cover (cut-and-fill, so the slab and hall floor
  // sit on the ground instead of buried in it), grade each exit driveway
  // out to the road end (capped steps, so reinforcements can always climb
  // out of the mouth), and clear the pads + exit roads of features (trees,
  // rocks, metal) so reinforcements drive out onto an open lane. Runs
  // before tile classification so the pad reads flat and the road graded.
  const hqs = placeHqs({ heights, width, height, seaLevel }, seed);
  levelHqPads({ heights, width, height, seaLevel }, hqs);
  gradeHqExits({ heights, width, height, seaLevel }, hqs);
  clearHqLanes({ heights, width, height, seaLevel, features }, hqs);

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

  // Seated works, unpainted exit: paint every tile touched by an HQ
  // construction pad with a dirt variant (deterministic per tile, like the
  // base classification), so the fort reads seated on the terrain and the
  // minimap. The exit lane past the pad keeps its natural classification —
  // it is only cleared of features, never repainted. Runs after
  // classification, before the minimap + units, so both see the finished
  // ground.
  paintHqPads(tileMap, kinds, hqs, width, height, seed);

  const minimap = buildMinimap(heights, tileMap, tiles, width, height, seaLevel);
  const units = placeUnits({ heights, features, width, height, seaLevel }, seed, startingUnitCount(preset));

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
    hqs,
  };
}

function paintHqPads(
  tileMap: Uint16Array,
  kinds: TileKind[],
  hqs: { team: 0 | 1; cellX: number; cellZ: number }[],
  width: number,
  height: number,
  seed: number,
): void {
  const dirt: number[] = [];
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === "dirt") dirt.push(i);
  }
  if (dirt.length === 0) return;
  const tileW = width / 2;
  const paint = (cellX: number, cellZ: number): void => {
    const tx = cellX >> 1;
    const tz = cellZ >> 1;
    const variant = Math.floor(hash2(tx, tz, seed + 90) * dirt.length);
    tileMap[tz * tileW + tx] = dirt[variant] ?? dirt[0]!;
  };
  for (const site of hqs) {
    for (const cell of hqPadCells(site, width, height)) paint(cell.cellX, cell.cellZ);
  }
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
  } else if (preset === "rivercross") {
    // Battle map: flat plains split by a meandering north–south river with
    // two seeded ford causeways. Base sits just above the waterline so both
    // banks stay open maneuver ground; the channel carves below sea level
    // except at the fords, where the bed lifts back to dry land.
    const phase = hash2(seed, 5, 17) * Math.PI * 2;
    const meander =
      Math.sin(nz * 2.4 + phase) * 0.1 + (fbm(x * 0.02, z * 0.02, seed + 31, 3) - 0.5) * 0.14;
    const adx = Math.abs(nx - meander);
    const base =
      sea +
      15 +
      (fbm(x * 0.03, z * 0.03, seed + 33, 4) - 0.5) * 14 +
      (fbm(x * 0.11, z * 0.11, seed + 34, 2) - 0.5) * 5;
    const river = smoothstep(0.085, 0.02, adx);
    const fz1 = -0.42 + hash2(seed, 11, 101) * 0.3;
    const fz2 = 0.12 + hash2(seed, 23, 102) * 0.3;
    const ford1 = Math.exp(-((nz - fz1) * (nz - fz1)) / 0.004);
    const ford2 = Math.exp(-((nz - fz2) * (nz - fz2)) / 0.004);
    const ford = Math.max(ford1, ford2);
    const carved = base - river * 36;
    // Causeway sill: deliberately WIDER than the channel carve (the lerp
    // target sits just above the waterline, so a sill as narrow as the
    // carve would leave a water moat on each side and the ford would read
    // as an island). Full lift across the channel, feathered into the banks.
    const sill = ford * smoothstep(0.15, 0.03, adx);
    const causeway = lerp(
      carved,
      sea + 6 + (fbm(x * 0.09, z * 0.09, seed + 35, 2) - 0.5) * 2,
      clamp(sill * 1.3, 0, 1),
    );
    const levee = Math.exp(-((adx - 0.11) * (adx - 0.11)) / 0.0012) * 4;
    v = causeway + levee;
  } else if (preset === "dustplains") {
    // Battle map: vast flat steppe. A broad island mask keeps the interior
    // dry, low swells give gentle cover, rim hills enclose the field, and a
    // single pond breaks the west side without splitting the map.
    const d = Math.hypot(nx * 0.95, nz * 1.05);
    const island = smoothstep(1.1, 0.55, d);
    const swells = (fbm(x * 0.025, z * 0.025, seed + 41, 4) - 0.5) * 16;
    const detail = (fbm(x * 0.1, z * 0.1, seed + 42, 2) - 0.5) * 6;
    const rim = smoothstep(0.62, 0.95, d) * (18 + ridged(x * 0.05, z * 0.05, seed + 43) * 22);
    const pond = 1 - smoothstep(0.02, 0.12, Math.hypot(nx + 0.3, nz - 0.25));
    v = sea + 13 + island * (6 + swells) + rim * island - pond * 30 + detail;
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

/**
 * Natural ground kind for the tile whose top-left attribute cell is
 * (`x`, `z`). Exported for tests — the HQ exit lanes must keep exactly
 * this classification (cleared, never repainted).
 */
export function classifyTile(
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
      if (preset === "rivercross" && hgt < sea + 8) continue;
      const slope = cellSlope(heights, w, h, x, z);
      const forest = fbm(x * 0.055, z * 0.055, seed + 70, 4);
      const dens =
        preset === "archipelago"
          ? 0.6
          : preset === "highpass"
            ? 0.52
            : preset === "rivercross"
              ? 0.5
              : preset === "dustplains"
                ? 0.63
                : 0.56;
      // Rivercross keeps banks and ford causeways (low ground) treeless so
      // crossings stay open maneuver ground; forest clusters on higher soil.
      if (slope < 9 && forest > dens && hash2(x, z, seed + 71) > 0.55) {
        const which = Math.floor(hash2(x, z, seed + 72) * 3);
        features[i] = which;
      } else if (slope > 16 && hash2(x, z, seed + 73) > 0.82) {
        features[i] = 3 + (hash2(x, z, seed + 74) > 0.5 ? 1 : 0);
      } else if (
        slope < 9 &&
        hash2(x, z, seed + 75) > 0.94 &&
        fbm(x * 0.03, z * 0.03, seed + 78, 3) > 0.58
      ) {
        // Scattered boulder fields on open, dry, gentle ground: the cheap
        // hash gates first so the rockiness fbm only runs on candidates.
        // Rocks never block hulls (walkability ignores features; they only
        // add traverse cost), so open-ground scatter is gameplay-safe; HQ
        // pads/roads are cleared after stamping and spawns avoid features.
        features[i] = 3 + (hash2(x, z, seed + 76) > 0.5 ? 1 : 0);
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
