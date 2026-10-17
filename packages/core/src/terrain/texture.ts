import { TILE_PIXELS, type TNTMap } from "./types";
import { palRGB } from "./palette";

export function composeAlbedo(map: TNTMap): ImageData {
  return composeAlbedoWindow(map, 0, 0, map.width / 2, map.height / 2);
}

/**
 * Compose only a tile window of the albedo (origin clamped into the map,
 * size clamped to fit, at least one tile). Same texels as `composeAlbedo`
 * at the same tile coordinates, without the full-map cost — the Unit Folio
 * preview plane samples a small patch of Greenreach, so composing the whole
 * 5120x4096 image (plus its GPU upload) on every folio visit is pure waste.
 * The inner loop reads palette bytes directly instead of allocating a
 * per-pixel RGB tuple.
 */
export function composeAlbedoWindow(
  map: TNTMap,
  tileX: number,
  tileZ: number,
  tilesW: number,
  tilesH: number,
): ImageData {
  const tileW = Math.max(Math.floor(map.width / 2), 1);
  const tileH = Math.max(Math.floor(map.height / 2), 1);
  const x0 = Math.max(0, Math.min(Math.floor(tileX), tileW - 1));
  const z0 = Math.max(0, Math.min(Math.floor(tileZ), tileH - 1));
  const w = Math.max(1, Math.min(Math.floor(tilesW), tileW - x0));
  const h = Math.max(1, Math.min(Math.floor(tilesH), tileH - z0));
  const width = w * TILE_PIXELS;
  const height = h * TILE_PIXELS;
  const data = new Uint8ClampedArray(width * height * 4);
  const pal = map.palette;

  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      const tile = map.tiles[map.tileMap[(z0 + tz) * tileW + (x0 + tx)] ?? 0] ?? map.tiles[0] ?? new Uint8Array(TILE_PIXELS * TILE_PIXELS);
      const ox = tx * TILE_PIXELS;
      const oy = tz * TILE_PIXELS;
      for (let py = 0; py < TILE_PIXELS; py++) {
        for (let px = 0; px < TILE_PIXELS; px++) {
          const pi = (tile[py * TILE_PIXELS + px] ?? 0) * 3;
          const o = ((oy + py) * width + (ox + px)) * 4;
          data[o] = pal[pi] ?? 0;
          data[o + 1] = pal[pi + 1] ?? 0;
          data[o + 2] = pal[pi + 2] ?? 0;
          data[o + 3] = 255;
        }
      }
    }
  }
  return new ImageData(data, width, height);
}

export function composeHeight(map: TNTMap): ImageData {
  const data = new Uint8ClampedArray(map.width * map.height * 4);
  for (let i = 0; i < map.heights.length; i++) {
    const h = map.heights[i] ?? 0;
    data[i * 4] = h;
    data[i * 4 + 1] = h;
    data[i * 4 + 2] = h;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, map.width, map.height);
}

export function composeMinimap(map: TNTMap): ImageData {
  const { width, height, pixels } = map.minimap;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b] = palRGB(map.palette, pixels[i] ?? 0);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, width, height);
}
