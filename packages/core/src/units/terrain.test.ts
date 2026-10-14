import { describe, expect, it } from "vitest";
import { CELL_PIXELS } from "../terrain/types.js";
import { generateMap } from "../terrain/generate.js";
import { isWalkable } from "./pathfinding.js";
import {
  HULL_CLEARANCE,
  HULL_FOOTPRINT,
  MAX_DRIVE_GRADE,
  MAX_HULL_TILT,
  groundHeight,
  hullPitchRoll,
  sampleHeightBilinear,
  seatHull,
  stepBlocked,
  type SeatField,
} from "./terrain.js";

function flatField(w = 32, h = 32, height = 100, sea = 0): SeatField {
  return { width: w, height: h, heights: new Uint8Array(w * h).fill(height), seaLevel: sea };
}

/** Eastward ramp: height rises `per` raw units per cell toward +x. */
function rampField(per = 8, w = 32, h = 32, base = 100): SeatField {
  const heights = new Uint8Array(w * h);
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) heights[z * w + x] = base + x * per;
  }
  return { width: w, height: h, heights, seaLevel: 0 };
}

function worldOf(field: SeatField, cellX: number, cellZ: number): { x: number; z: number } {
  return {
    x: (cellX - (field.width - 1) / 2) * CELL_PIXELS,
    z: (cellZ - (field.height - 1) / 2) * CELL_PIXELS,
  };
}

describe("sampleHeightBilinear", () => {
  it("is constant on flat ground, even mid-cell", () => {
    const field = flatField();
    expect(sampleHeightBilinear(field, 0, 0)).toBe(100);
    expect(sampleHeightBilinear(field, 3.7, -11.2)).toBe(100);
    expect(sampleHeightBilinear(field, 10000, 10000)).toBe(100);
  });

  it("hits corners exactly and blends edges linearly", () => {
    const field = rampField(10);
    const a = worldOf(field, 10, 10);
    const b = worldOf(field, 11, 10);
    // Cell centers read their own corner.
    expect(sampleHeightBilinear(field, a.x, a.z)).toBeCloseTo(100 + 10 * 10, 9);
    expect(sampleHeightBilinear(field, b.x, b.z)).toBeCloseTo(100 + 11 * 10, 9);
    // Midway reads the average: no whole-step pops mid-leg.
    expect(sampleHeightBilinear(field, (a.x + b.x) / 2, a.z)).toBeCloseTo(100 + 10.5 * 10, 9);
  });
});

describe("hullPitchRoll", () => {
  it("poses flat on flat ground", () => {
    for (const hull of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
      const { pitch, roll } = hullPitchRoll(flatField(), "stump", 0, 0, hull, 3.6);
      expect(pitch).toBeCloseTo(0, 12);
      expect(roll).toBeCloseTo(0, 12);
    }
  });

  it("points the nose uphill when climbing, downhill when descending", () => {
    // Eastward ramp: facing +x (hull π/2) climbs, facing −x descends.
    const field = rampField(8);
    const { x, z } = worldOf(field, 16, 16);
    const up = hullPitchRoll(field, "stump", x, z, Math.PI / 2, 1);
    const down = hullPitchRoll(field, "stump", x, z, -Math.PI / 2, 1);
    expect(up.pitch).toBeLessThan(0);
    expect(down.pitch).toBeGreaterThan(0);
    expect(Math.abs(up.pitch)).toBeCloseTo(Math.abs(down.pitch), 9);
    expect(up.roll).toBeCloseTo(0, 9);
  });

  it("rolls across the fall line instead of pitching", () => {
    // Facing +z on an eastward ramp: the grade runs across the hull.
    const field = rampField(8);
    const { x, z } = worldOf(field, 16, 16);
    const { pitch, roll } = hullPitchRoll(field, "stump", x, z, 0, 1);
    expect(pitch).toBeCloseTo(0, 9);
    // Right flank (+x) sits uphill, so the right side rides up.
    expect(roll).toBeGreaterThan(0);
  });

  it("scales with exaggeration and clamps on cliffs", () => {
    const field = rampField(8);
    const { x, z } = worldOf(field, 16, 16);
    const gentle = hullPitchRoll(field, "stump", x, z, Math.PI / 2, 1);
    const steep = hullPitchRoll(field, "stump", x, z, Math.PI / 2, 3.6);
    expect(Math.abs(steep.pitch)).toBeGreaterThan(Math.abs(gentle.pitch));
    // Step cliff: 0 west, 200 east — unclamped atan would read ~85°.
    const w = 16;
    const h = 8;
    const heights = new Uint8Array(w * h).fill(0);
    for (let zz = 0; zz < h; zz++) {
      for (let xx = 8; xx < w; xx++) heights[zz * w + xx] = 200;
    }
    const cliff: SeatField = { width: w, height: h, heights, seaLevel: 0 };
    const c = worldOf(cliff, 7, 4);
    const pose = hullPitchRoll(cliff, "stump", c.x, c.z, Math.PI / 2, 3.6);
    expect(Math.abs(pose.pitch)).toBeLessThanOrEqual(MAX_HULL_TILT + 1e-9);
    expect(Math.abs(pose.roll)).toBeLessThanOrEqual(MAX_HULL_TILT + 1e-9);
  });
});

describe("seatHull", () => {
  it("collapses to groundY + clearance on flat ground", () => {
    const field = flatField();
    for (const kind of Object.keys(HULL_FOOTPRINT) as (keyof typeof HULL_FOOTPRINT)[]) {
      const seat = seatHull(field, kind, 5, -7, 1.1, 3.6);
      expect(seat.y).toBeCloseTo(100 * 3.6 + HULL_CLEARANCE, 9);
      expect(seat.pitch).toBeCloseTo(0, 12);
      expect(seat.roll).toBeCloseTo(0, 12);
    }
  });

  it("rides on the highest footprint tap so tracks never bury", () => {
    // Eastward ramp, hull facing east: nose tap is highest, tail lowest.
    const field = rampField(8);
    const { x, z } = worldOf(field, 16, 16);
    const seat = seatHull(field, "stump", x, z, Math.PI / 2, 1);
    const fp = HULL_FOOTPRINT.stump;
    const nose = groundHeight(field, x + fp.halfLen, z, 1);
    expect(seat.y).toBeCloseTo(nose + HULL_CLEARANCE, 9);
    expect(seat.pitch).toBeLessThan(0);
  });

  it("never seats a hull below the terrain on a real map", () => {
    // Real-map case (not synthetic flat): rough ground taps disagree, and
    // the seat must still clear every one of them, whatever the yaw.
    const map = generateMap("greenreach", 7);
    const yaws = [0, Math.PI / 3, Math.PI / 2, Math.PI];
    let checked = 0;
    for (let cz = 20; cz < map.height - 20; cz += 7) {
      for (let cx = 20; cx < map.width - 20; cx += 7) {
        if (!isWalkable(map, cx, cz)) continue;
        const { x, z } = worldOf(map, cx, cz);
        for (const hull of yaws) {
          const seat = seatHull(map, "stump", x, z, hull, 3.6);
          const fp = HULL_FOOTPRINT.stump;
          const fx = Math.sin(hull);
          const fz = Math.cos(hull);
          const taps = [
            groundHeight(map, x, z, 3.6),
            groundHeight(map, x + fx * fp.halfLen, z + fz * fp.halfLen, 3.6),
            groundHeight(map, x - fx * fp.halfLen, z - fz * fp.halfLen, 3.6),
            groundHeight(map, x + Math.cos(hull) * fp.halfWid, z - Math.sin(hull) * fp.halfWid, 3.6),
            groundHeight(map, x - Math.cos(hull) * fp.halfWid, z + Math.sin(hull) * fp.halfWid, 3.6),
          ];
          for (const tap of taps) expect(seat.y).toBeGreaterThanOrEqual(tap);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("HULL_FOOTPRINT", () => {
  it("runs long along travel for tanks, so grade seating leans nose/tail", () => {
    // The seating taps ±halfLen along the hull yaw (nose/tail) and ±halfWid
    // across it. Tanks drive nose-first (+Z), so halfLen must exceed halfWid
    // — a wider-than-long footprint pitches across the hull and reads as
    // driving sideways on grades.
    for (const kind of ["flash", "stump", "hammer"] as const) {
      const fp = HULL_FOOTPRINT[kind];
      expect(fp.halfLen).toBeGreaterThan(fp.halfWid);
    }
  });
});

describe("stepBlocked", () => {
  it("lets flat steps through and ignores zero-length checks", () => {
    const field = flatField();
    expect(stepBlocked(field, 0, 0, 0, 0)).toBe(false);
    expect(stepBlocked(field, 0, 0, 10, 5)).toBe(false);
  });

  it("refuses steps into water cells", () => {
    const w = 24;
    const h = 24;
    const heights = new Uint8Array(w * h).fill(100);
    for (let z = 0; z < h; z++) heights[z * w + 12] = 0;
    const field: SeatField = { width: w, height: h, heights, seaLevel: 50 };
    const from = worldOf(field, 10, 12);
    const into = worldOf(field, 12, 12);
    expect(stepBlocked(field, from.x, from.z, into.x, into.z)).toBe(true);
  });

  it("refuses grades steeper than the walkability gate, allows gentle ones", () => {
    // 40 raw per cell = grade 2.5 > MAX_DRIVE_GRADE (1.5).
    const steep = rampField(40);
    const a = worldOf(steep, 10, 10);
    const b = worldOf(steep, 11, 10);
    expect(stepBlocked(steep, a.x, a.z, b.x, b.z)).toBe(true);
    // 8 raw per cell = grade 0.5: free to climb.
    const gentle = rampField(8);
    const c = worldOf(gentle, 10, 10);
    const d = worldOf(gentle, 11, 10);
    expect(stepBlocked(gentle, c.x, c.z, d.x, d.z)).toBe(false);
    expect(MAX_DRIVE_GRADE).toBeCloseTo(24 / 16, 12);
  });
});
