import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  factionColorBytes,
  INFLUENCE_STALE_SECONDS,
  TERRITORY_MAX_ALPHA,
  type InfluenceUnit,
} from "@scorched-3d/core";
import { TERRITORY_PAINT_INTERVAL, TerritoryFx } from "./territory";

const WORLD_W = 5088;
const WORLD_D = 4064;

function unit(x: number, z: number, team: 0 | 1, alive = true): InfluenceUnit {
  return { x, z, team, alive };
}

function texelOf(fx: TerritoryFx, x: number, z: number): [number, number, number, number] {
  const { cols, rows, worldW, worldD } = fx.field;
  const col = Math.floor(((x + worldW / 2) / worldW) * cols);
  const row = Math.floor(((z + worldD / 2) / worldD) * rows);
  const data = fx.texture.image.data as Uint8ClampedArray;
  const o = (row * cols + col) * 4;
  return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!];
}

describe("TerritoryFx", () => {
  it("builds a coarse RGBA texture matching the field (flipY so row 0 lands north)", () => {
    const fx = new TerritoryFx(WORLD_W, WORLD_D);
    expect(fx.texture.image.width).toBe(fx.field.cols);
    expect(fx.texture.image.height).toBe(fx.field.rows);
    expect(fx.texture.flipY).toBe(true);
    expect(fx.texture.minFilter).toBe(THREE.LinearFilter);
    expect(fx.texture.magFilter).toBe(THREE.LinearFilter);
    // Bytes hit the screen as authored so the 3D tint matches the minimap hex.
    expect(fx.texture.colorSpace).toBe(THREE.NoColorSpace);
    fx.dispose();
  });

  it("stamps presence every tick even while hidden, so toggle-on shows live ground", () => {
    const fx = new TerritoryFx(WORLD_W, WORLD_D);
    fx.update([unit(0, 0, 0)], 10, false);
    const { cols, rows } = fx.field;
    const col = Math.floor(0.5 * cols);
    const row = Math.floor(0.5 * rows);
    expect(fx.field.seen[0]![row * cols + col]).toBe(10);
    // …but paints nothing until visible (no 4 Hz upload cost while hidden).
    expect(texelOf(fx, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(fx.minimap()).toBeNull();
    fx.dispose();
  });

  it("paints faction colors at the 4 Hz cadence while visible", () => {
    const fx = new TerritoryFx(WORLD_W, WORLD_D);
    fx.update([unit(0, 0, 0)], 10, true);
    const blue = factionColorBytes(0);
    expect(texelOf(fx, 0, 0).slice(0, 3)).toEqual([blue.r, blue.g, blue.b]);
    expect(texelOf(fx, 0, 0)[3]).toBe(Math.round(255 * TERRITORY_MAX_ALPHA));
    const first = fx.minimap();
    expect(first).not.toBeNull();
    expect(first!.cols).toBe(fx.field.cols);
    // A second tick inside the interval re-stamps but does not repaint.
    fx.update([unit(0, 0, 0)], 10 + TERRITORY_PAINT_INTERVAL / 2, true);
    expect(fx.minimap()!.seq).toBe(first!.seq);
    // Past the interval it repaints.
    fx.update([unit(0, 0, 0)], 10 + TERRITORY_PAINT_INTERVAL, true);
    expect(fx.minimap()!.seq).toBe(first!.seq + 1);
    fx.dispose();
  });

  it("repaints immediately when toggled on instead of waiting for the cadence", () => {
    const fx = new TerritoryFx(WORLD_W, WORLD_D);
    fx.update([unit(0, 0, 0)], 10, true);
    const seq = fx.minimap()!.seq;
    fx.setVisible(false, 11);
    fx.update([unit(500, 500, 1)], 11, false);
    fx.setVisible(true, 11);
    // The orange stamp (same tick, no interval elapsed) is already painted.
    expect(fx.minimap()!.seq).toBe(seq + 1);
    const orange = factionColorBytes(1);
    expect(texelOf(fx, 500, 500).slice(0, 3)).toEqual([orange.r, orange.g, orange.b]);
    fx.dispose();
  });

  it("blends contested ground and fades stale ground in the texture", () => {
    const fx = new TerritoryFx(WORLD_W, WORLD_D);
    fx.update([unit(0, 0, 0), unit(0, 0, 1)], 10, true);
    const blue = factionColorBytes(0);
    const orange = factionColorBytes(1);
    const [r, g, b] = texelOf(fx, 0, 0);
    expect(r).toBe(Math.round((blue.r + orange.r) / 2));
    expect(g).toBe(Math.round((blue.g + orange.g) / 2));
    expect(b).toBe(Math.round((blue.b + orange.b) / 2));
    // Both sides leave: the blend stays but the alpha fades to zero.
    const stale = 10 + INFLUENCE_STALE_SECONDS + 1;
    fx.setVisible(true, stale);
    expect(texelOf(fx, 0, 0)[3]).toBe(0);
    fx.dispose();
  });

  it("hands the minimap a copy, so React state never aliases the live buffer", () => {
    const fx = new TerritoryFx(WORLD_W, WORLD_D);
    fx.update([unit(0, 0, 0)], 10, true);
    const shot = fx.minimap()!;
    shot.data.fill(0);
    expect(texelOf(fx, 0, 0)[3]).toBe(Math.round(255 * TERRITORY_MAX_ALPHA));
    fx.dispose();
  });
});
