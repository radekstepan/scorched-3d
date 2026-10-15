import { describe, expect, it } from "vitest";
import {
  jumpCameraTo,
  minimapPointToWorld,
  minimapUvToWorld,
  worldToMinimapUv,
} from "./minimap";

const W = 5104;
const D = 4080;

describe("minimapUvToWorld", () => {
  it("maps the center to the world origin", () => {
    expect(minimapUvToWorld(0.5, 0.5, W, D)).toEqual({ x: 0, z: 0 });
  });

  it("maps corners to half-extents", () => {
    expect(minimapUvToWorld(0, 0, W, D)).toEqual({ x: -W / 2, z: -D / 2 });
    expect(minimapUvToWorld(1, 1, W, D)).toEqual({ x: W / 2, z: D / 2 });
  });

  it("clamps out-of-range and non-finite input to the edges", () => {
    expect(minimapUvToWorld(-0.5, 2, W, D)).toEqual({ x: -W / 2, z: D / 2 });
    expect(minimapUvToWorld(NaN, Infinity, W, D)).toEqual({ x: -W / 2, z: -D / 2 });
  });

  it("round-trips with worldToMinimapUv (the overlay dot math)", () => {
    for (const [x, z] of [
      [0, 0],
      [-W / 2, -D / 2],
      [W / 2, D / 2],
      [1234, -987],
    ] as const) {
      const uv = worldToMinimapUv(x, z, W, D);
      expect(minimapUvToWorld(uv.u, uv.v, W, D).x).toBeCloseTo(x, 9);
      expect(minimapUvToWorld(uv.u, uv.v, W, D).z).toBeCloseTo(z, 9);
    }
  });
});

describe("minimapPointToWorld", () => {
  const rect = { left: 10, top: 20, width: 250, height: 250 };

  it("maps a client point through the box rect", () => {
    // Center of the box → world origin.
    expect(minimapPointToWorld(135, 145, rect, W, D)).toEqual({ x: 0, z: 0 });
    // Top-left corner → north-west corner of the world.
    expect(minimapPointToWorld(10, 20, rect, W, D)).toEqual({ x: -W / 2, z: -D / 2 });
  });

  it("falls back to the center on a zero-size rect", () => {
    expect(minimapPointToWorld(10, 20, { left: 0, top: 0, width: 0, height: 0 }, W, D)).toEqual({
      x: 0,
      z: 0,
    });
  });
});

describe("jumpCameraTo preserves angle of view and zoom", () => {
  it("translates target and camera by the same ground offset", () => {
    const position = { x: 0, y: 1200, z: 3000 };
    const target = { x: 0, y: 50, z: 0 };
    const before = {
      dx: position.x - target.x,
      dy: position.y - target.y,
      dz: position.z - target.z,
      dist: Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z),
    };
    jumpCameraTo(position, target, { x: 1000, z: -500 }, W, D);
    expect(target.x).toBeCloseTo(1000, 9);
    expect(target.z).toBeCloseTo(-500, 9);
    // Same offset vector → same yaw/pitch/zoom; target height untouched.
    expect(position.x - target.x).toBeCloseTo(before.dx, 9);
    expect(position.y - target.y).toBeCloseTo(before.dy, 9);
    expect(position.z - target.z).toBeCloseTo(before.dz, 9);
    expect(Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z)).toBeCloseTo(
      before.dist,
      9,
    );
    expect(target.y).toBe(50);
  });

  it("clamps past the edge but still preserves the offset", () => {
    const position = { x: 0, y: 1200, z: 3000 };
    const target = { x: 0, y: 50, z: 0 };
    const dx = position.x - target.x;
    const dz = position.z - target.z;
    jumpCameraTo(position, target, { x: 99999, z: -99999 }, W, D);
    const boundX = (W / 2) * 1.25;
    const boundZ = (D / 2) * 1.25;
    expect(target.x).toBeCloseTo(boundX, 9);
    expect(target.z).toBeCloseTo(-boundZ, 9);
    expect(position.x - target.x).toBeCloseTo(dx, 9);
    expect(position.z - target.z).toBeCloseTo(dz, 9);
  });
});
