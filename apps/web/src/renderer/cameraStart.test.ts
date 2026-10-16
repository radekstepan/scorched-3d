import { describe, expect, it } from "vitest";
import { worldHeight } from "@scorched-3d/core";
import {
  START_BEYOND_EDGE,
  commanderCameraPose,
  pickStartUnit,
  resnapHeightDelta,
  startGroundY,
  type StartField,
} from "./cameraStart";

function field(over: Partial<StartField> = {}): StartField {
  const width = 160;
  const height = 128;
  const heights = new Uint8Array(width * height).fill(100);
  return {
    width,
    height,
    heights,
    seaLevel: 75,
    units: [],
    ...over,
  };
}

const CELL = 16;
const HD = ((128 - 1) / 2) * CELL;

describe("pickStartUnit", () => {
  it("prefers the first commander over earlier other kinds", () => {
    const units = [
      { kind: "flash", cellX: 10, cellZ: 10 },
      { kind: "commander", cellX: 20, cellZ: 20 },
      { kind: "commander", cellX: 30, cellZ: 30 },
    ];
    expect(pickStartUnit(units)).toEqual(units[1]);
  });

  it("falls back to the first unit when no commander exists", () => {
    const units = [
      { kind: "stump", cellX: 10, cellZ: 10 },
      { kind: "hammer", cellX: 20, cellZ: 20 },
    ];
    expect(pickStartUnit(units)).toEqual(units[0]);
  });

  it("returns null for an empty roster", () => {
    expect(pickStartUnit([])).toBeNull();
  });
});

describe("commanderCameraPose", () => {
  const commander = { kind: "commander", cellX: 120, cellZ: 90 };

  it("targets the commander ground anchor", () => {
    const f = field({ units: [commander] });
    const pose = commanderCameraPose(f, 1);
    expect(pose.target.x).toBeCloseTo((120 - (160 - 1) / 2) * CELL, 10);
    expect(pose.target.z).toBeCloseTo((90 - (128 - 1) / 2) * CELL, 10);
    expect(pose.target.y).toBeCloseTo(worldHeight(100, 1), 10);
  });

  it("places the camera outside the map, due south of the commander", () => {
    const f = field({ units: [commander] });
    const pose = commanderCameraPose(f, 1);
    // Outside the rectangle: past the south edge (task 139 replaced the
    // center-through-commander ray — whose yaw varied with the spawn side
    // and misaligned the view with the minimap — with a fixed south yaw).
    expect(pose.position.x).toBeCloseTo(pose.target.x, 10);
    expect(pose.position.z).toBeCloseTo(HD + START_BEYOND_EDGE, 10);
    // South of the commander, which sits inside the map.
    expect(pose.position.z).toBeGreaterThan(pose.target.z);
    expect(Math.abs(pose.target.z)).toBeLessThanOrEqual(HD);
  });

  it("looks inward: due-north view from outside the south edge", () => {
    const f = field({ units: [commander] });
    const pose = commanderCameraPose(f, 1);
    // View direction has no east/west component and points north (−Z).
    expect(pose.target.x - pose.position.x).toBeCloseTo(0, 10);
    expect(pose.target.z - pose.position.z).toBeLessThan(0);
    // The whole map interior lies ahead of the camera.
    expect(pose.position.z).toBeGreaterThan(HD);
  });

  it("lifts the camera above the anchor", () => {
    const f = field({ units: [commander] });
    const pose = commanderCameraPose(f, 1);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
  });

  it("falls back to any unit when no commander is placed", () => {
    const stump = { kind: "stump", cellX: 40, cellZ: 30 };
    const f = field({ units: [stump] });
    const pose = commanderCameraPose(f, 1);
    expect(pose.target.x).toBeCloseTo((40 - (160 - 1) / 2) * CELL, 10);
    expect(pose.target.z).toBeCloseTo((30 - (128 - 1) / 2) * CELL, 10);
  });

  it("falls back to the map center viewed from the south with no units", () => {
    const f = field({ units: [] });
    const pose = commanderCameraPose(f, 2);
    expect(pose.target).toEqual({ x: 0, y: worldHeight(75, 2), z: 0 });
    expect(pose.position.x).toBeCloseTo(0, 10);
    expect(pose.position.z).toBeCloseTo(HD + START_BEYOND_EDGE, 10);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
  });

  it("handles a commander dead center via the south default", () => {
    // Even cell-symmetric grids rarely hit exact center; force it.
    const tiny: StartField = {
      width: 5,
      height: 5,
      heights: new Uint8Array(25).fill(100),
      seaLevel: 0,
      units: [{ kind: "commander", cellX: 2, cellZ: 2 }],
    };
    const pose = commanderCameraPose(tiny, 1);
    expect(pose.target.x).toBeCloseTo(0, 10);
    expect(pose.target.z).toBeCloseTo(0, 10);
    expect(pose.position.x).toBeCloseTo(0, 10);
    expect(pose.position.z).toBeGreaterThan((5 - 1) / 2 * CELL);
  });

  it("scales anchor height with exaggeration", () => {
    const f = field({ units: [commander] });
    const lo = commanderCameraPose(f, 1);
    const hi = commanderCameraPose(f, 2);
    expect(hi.target.y).toBeCloseTo(lo.target.y * 2, 10);
    expect(hi.target.x).toEqual(lo.target.x);
    expect(hi.target.z).toEqual(lo.target.z);
    expect(hi.position.x).toEqual(lo.position.x);
    expect(hi.position.z).toEqual(lo.position.z);
  });

  it("is deterministic per field", () => {
    const f = field({ units: [commander] });
    expect(commanderCameraPose(f, 1)).toEqual(commanderCameraPose(f, 1));
  });
});

describe("start view matches the minimap (task 139)", () => {
  // Minimap mapping: u left→right is world −X→+X, v top→bottom is world
  // −Z→+Z (minimap.ts). The opening frame must share that orientation:
  // screen-right is world +X and away-from-viewer is world −Z, so moving
  // right on the minimap pans the main view right. That means the camera
  // always starts due south of its target, wherever the commander spawned.
  /** Screen-right unit vector of a lookAt-style pose (camera up is +Y). */
  function screenRightOf(pose: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }) {
    const fx = pose.target.x - pose.position.x;
    const fz = pose.target.z - pose.position.z;
    // right = normalize(forward × up) with up = (0,1,0): (-fz, 0, fx).
    const cx = -fz;
    const cz = fx;
    const len = Math.hypot(cx, cz);
    return { x: cx / len, y: 0, z: cz / len };
  }

  const spots = {
    north: { kind: "commander", cellX: 80, cellZ: 10 },
    south: { kind: "commander", cellX: 80, cellZ: 117 },
    east: { kind: "commander", cellX: 150, cellZ: 64 },
    west: { kind: "commander", cellX: 9, cellZ: 64 },
    corner: { kind: "commander", cellX: 150, cellZ: 10 },
  } as const;

  for (const [name, commander] of Object.entries(spots)) {
    it(`starts due south of a ${name}-spawned commander, outside the map`, () => {
      const f = field({ units: [{ ...commander }] });
      const pose = commanderCameraPose(f, 1);
      // Target stays on the commander ground anchor.
      expect(pose.target.x).toBeCloseTo((commander.cellX - (160 - 1) / 2) * CELL, 10);
      expect(pose.target.z).toBeCloseTo((commander.cellZ - (128 - 1) / 2) * CELL, 10);
      // Camera due south of the target: same X, past the south map edge.
      expect(pose.position.x).toBeCloseTo(pose.target.x, 10);
      expect(pose.position.z).toBeCloseTo(HD + START_BEYOND_EDGE, 10);
      expect(pose.position.y).toBeGreaterThan(pose.target.y);
    });

    it(`screen-right is world +X (minimap right) for a ${name} spawn`, () => {
      const f = field({ units: [{ ...commander }] });
      const pose = commanderCameraPose(f, 1);
      const right = screenRightOf(pose);
      expect(right.x).toBeCloseTo(1, 9);
      expect(right.y).toBeCloseTo(0, 9);
      expect(right.z).toBeCloseTo(0, 9);
    });
  }
});

describe("startGroundY / resnapHeightDelta", () => {
  it("tracks the anchor height across exaggeration", () => {
    const f = field({ units: [{ kind: "commander", cellX: 120, cellZ: 90 }] });
    expect(startGroundY(f, f.units[0]!, 1)).toBeCloseTo(worldHeight(100, 1), 10);
    expect(startGroundY(f, f.units[0]!, 2)).toBeCloseTo(worldHeight(100, 2), 10);
    expect(resnapHeightDelta(f, f.units[0]!, 1, 2)).toBeCloseTo(worldHeight(100, 1), 10);
  });

  it("falls back to sea level without a unit", () => {
    const f = field({ units: [] });
    expect(startGroundY(f, null, 2)).toBeCloseTo(worldHeight(75, 2), 10);
    expect(resnapHeightDelta(f, null, 1, 2)).toBeCloseTo(worldHeight(75, 1), 10);
  });
});
