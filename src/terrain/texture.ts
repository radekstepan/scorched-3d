import { TILE_PIXELS, type TNTMap } from "./types";
import { palRGB } from "./palette";

export function composeAlbedo(map: TNTMap): ImageData {
  const tileW = map.width / 2;
  const tileH = map.height / 2;
  const width = tileW * TILE_PIXELS;
  const height = tileH * TILE_PIXELS;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let tz = 0; tz < tileH; tz++) {
    for (let tx = 0; tx < tileW; tx++) {
      const tile = map.tiles[map.tileMap[tz * tileW + tx]];
      const ox = tx * TILE_PIXELS;
      const oy = tz * TILE_PIXELS;
      for (let py = 0; py < TILE_PIXELS; py++) {
        for (let px = 0; px < TILE_PIXELS; px++) {
          const [r, g, b] = palRGB(map.palette, tile[py * TILE_PIXELS + px]);
          const o = ((oy + py) * width + (ox + px)) * 4;
          data[o] = r;
          data[o + 1] = g;
          data[o + 2] = b;
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
    const h = map.heights[i];
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
    const [r, g, b] = palRGB(map.palette, pixels[i]);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, width, height);
}
