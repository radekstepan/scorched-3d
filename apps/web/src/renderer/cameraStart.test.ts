import { describe, expect, it } from "vitest";
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
const HW = ((160 - 1) / 2) * CELL;
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
    expect(pose.target.y).toBeCloseTo(100, 10);
  });

  it("places the camera outside the map, behind the commander", () => {
    const f = field({ units: [commander] });
    const pose = commanderCameraPose(f, 1);
    // Outside the rectangle: past at least one edge.
    const outside = Math.abs(pose.position.x) > HW || Math.abs(pose.position.z) > HD;
    expect(outside).toBe(true);
    // Collinear with the center-through-commander ray (cross product ~0).
    const cross =
      pose.position.x * pose.target.z - pose.position.z * pose.target.x;
    expect(Math.abs(cross)).toBeLessThan(1e-6 * Math.max(HW, HD) ** 2 + 1e-3);
    // Camera is farther from the center than the commander (behind it).
    const camDist = Math.hypot(pose.position.x, pose.position.z);
    const cmdDist = Math.hypot(pose.target.x, pose.target.z);
    expect(camDist).toBeGreaterThan(cmdDist + START_BEYOND_EDGE - 1);
  });

  it("looks inward: the commander sits between camera and map center", () => {
    const f = field({ units: [commander] });
    const pose = commanderCameraPose(f, 1);
    // Project the commander onto the camera->center segment: t in (0,1).
    const cx = 0 - pose.position.x;
    const cz = 0 - pose.position.z;
    const ux = pose.target.x - pose.position.x;
    const uz = pose.target.z - pose.position.z;
    const t = (ux * cx + uz * cz) / (cx * cx + cz * cz);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
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
    expect(pose.target).toEqual({ x: 0, y: 75 * 2, z: 0 });
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

describe("startGroundY / resnapHeightDelta", () => {
  it("tracks the anchor height across exaggeration", () => {
    const f = field({ units: [{ kind: "commander", cellX: 120, cellZ: 90 }] });
    expect(startGroundY(f, f.units[0]!, 1)).toBeCloseTo(100, 10);
    expect(startGroundY(f, f.units[0]!, 2)).toBeCloseTo(200, 10);
    expect(resnapHeightDelta(f, f.units[0]!, 1, 2)).toBeCloseTo(100, 10);
  });

  it("falls back to sea level without a unit", () => {
    const f = field({ units: [] });
    expect(startGroundY(f, null, 2)).toBeCloseTo(150, 10);
    expect(resnapHeightDelta(f, null, 1, 2)).toBeCloseTo(75, 10);
  });
});
