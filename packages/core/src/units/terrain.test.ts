import { describe, expect, it } from "vitest";
import { CELL_PIXELS } from "../terrain/types.js";
import { generateMap } from "../terrain/generate.js";
import { isWalkable } from "./pathfinding.js";
import {
  HULL_CLEARANCE,
  HULL_FOOTPRINT,
  HULL_TILT_SLEW,
  MAX_DRIVE_GRADE,
  MAX_HULL_TILT,
  CRUSH_DRAG,
  ROCK_DRAG,
  ROUGH_SLOPE_FLOOR,
  TREE_DRAG,
  TRUNK_PUSH_SPEED,
  blastSlopeAt,
  downslopeAt,
  featureDrag,
  groundHeight,
  hullBodyRadius,
  hullPitchRoll,
  pushOutOfTrunks,
  sampleHeightBilinear,
  seatHull,
  segmentClipsTrunk,
  slewTilt,
  stepBlocked,
  terrainSpeedScale,
  treesCrushedByStep,
  trunkBlockedAt,
  trunkKeepoutFor,
  type SeatField,
} from "./terrain.js";
import { MAX_BLAST_SKEW } from "./destruction.js";
import { TRUNK_KEEPOUT, TRUNK_RADIUS } from "./pathfinding.js";

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
    // 40 raw per cell = grade 2.5 > MAX_DRIVE_GRADE (15/16 ≈ 0.94).
    const steep = rampField(40);
    const a = worldOf(steep, 10, 10);
    const b = worldOf(steep, 11, 10);
    expect(stepBlocked(steep, a.x, a.z, b.x, b.z)).toBe(true);
    // 8 raw per cell = grade 0.5: free to climb.
    const gentle = rampField(8);
    const c = worldOf(gentle, 10, 10);
    const d = worldOf(gentle, 11, 10);
    expect(stepBlocked(gentle, c.x, c.z, d.x, d.z)).toBe(false);
    expect(MAX_DRIVE_GRADE).toBeCloseTo(15 / 16, 12);
  });

  it("refuses the old climb band: grades the retired 24-gate allowed", () => {
    // Retail tank profiles stop at MaxSlope 15; the old gate (24) let hulls
    // scale volcanic-cone grades like these. 20 raw per cell used to drive
    // and now holds position instead of clipping into the hillside.
    // (base 0 keeps tall ramps inside the 0–255 byte without wrapping.)
    const cone = rampField(20, 32, 32, 0);
    const a = worldOf(cone, 10, 10);
    const b = worldOf(cone, 11, 10);
    expect(stepBlocked(cone, a.x, a.z, b.x, b.z)).toBe(true);
    // The boundary still passes: 15 raw per cell is the steepest legal climb.
    const edge = rampField(15, 32, 32, 0);
    const c = worldOf(edge, 10, 10);
    const d = worldOf(edge, 11, 10);
    expect(stepBlocked(edge, c.x, c.z, d.x, d.z)).toBe(false);
  });
});

describe("terrainSpeedScale", () => {
  /** Flat field with a tree cell at (16,16) and a rock cell at (20,20). */
  function woodedFlat(): SeatField {
    const w = 32;
    const h = 32;
    const features = new Uint16Array(w * h).fill(0xffff);
    features[16 * w + 16] = 1;
    features[20 * w + 20] = 3;
    return { width: w, height: h, heights: new Uint8Array(w * h).fill(100), seaLevel: 0, features };
  }

  it("runs at exactly 1 on flat open ground", () => {
    const field = flatField();
    expect(terrainSpeedScale(field, 0, 0, 10, 5)).toBe(1);
    expect(terrainSpeedScale(field, 0, 0, 0, 0)).toBe(1);
    expect(featureDrag(field, 0, 0)).toBe(1);
    // Feature-less fields never drag, whatever the query point.
    const bare = flatField();
    expect(featureDrag(bare, 3.7, -11.2)).toBe(1);
  });

  it("bleeds speed on grades, steeper dragging harder down to the floor", () => {
    // 8 raw per cell = grade 0.5 (about half the gate): partial drag.
    const gentle = rampField(8);
    const a = worldOf(gentle, 10, 10);
    const b = worldOf(gentle, 11, 10);
    const soft = terrainSpeedScale(gentle, a.x, a.z, b.x, b.z);
    expect(soft).toBeLessThan(1);
    expect(soft).toBeGreaterThan(ROUGH_SLOPE_FLOOR);
    // 12 raw per cell = grade 0.75 (near the gate): harder drag.
    const rough = rampField(12);
    const c = worldOf(rough, 10, 10);
    const d = worldOf(rough, 11, 10);
    const hard = terrainSpeedScale(rough, c.x, c.z, d.x, d.z);
    expect(hard).toBeLessThan(soft);
    expect(hard).toBeGreaterThanOrEqual(ROUGH_SLOPE_FLOOR);
    // The steepest legal climb rides exactly on the floor; beyond the gate
    // the ratio clamps, so forbidden grades never read faster than the floor.
    const edge = rampField(15, 32, 32, 0);
    const e = worldOf(edge, 10, 10);
    const f = worldOf(edge, 11, 10);
    expect(terrainSpeedScale(edge, e.x, e.z, f.x, f.z)).toBeCloseTo(ROUGH_SLOPE_FLOOR, 12);
    // Uphill and downhill drag equally: the hull labours over the grade.
    expect(terrainSpeedScale(rough, d.x, d.z, c.x, c.z)).toBeCloseTo(hard, 12);
  });

  it("drags through trees and harder through rocks, neighbours included", () => {
    const field = woodedFlat();
    const tree = worldOf(field, 16, 16);
    const rock = worldOf(field, 20, 20);
    const open = worldOf(field, 5, 5);
    expect(featureDrag(field, tree.x, tree.z)).toBe(TREE_DRAG);
    expect(featureDrag(field, rock.x, rock.z)).toBe(ROCK_DRAG);
    expect(featureDrag(field, open.x, open.z)).toBe(1);
    // Canopy overhang: the cell next to a tree still drags.
    const nextToTree = worldOf(field, 17, 16);
    expect(featureDrag(field, nextToTree.x, nextToTree.z)).toBe(TREE_DRAG);
    // Rock outranks neighbouring trees.
    expect(ROCK_DRAG).toBeLessThan(TREE_DRAG);
    // The full step scale carries the feature drag on flat ground.
    expect(terrainSpeedScale(field, open.x, open.z, tree.x, tree.z)).toBe(TREE_DRAG);
    expect(terrainSpeedScale(field, open.x, open.z, rock.x, rock.z)).toBe(ROCK_DRAG);
  });
});

describe("tree-trunk collision", () => {
  /** Flat field with one standing tree at (treeX, treeZ). */
  function trunkField(treeX = 16, treeZ = 16, w = 32, h = 32): SeatField {
    const features = new Uint16Array(w * h).fill(0xffff);
    features[treeZ * w + treeX] = 0;
    return { width: w, height: h, heights: new Uint8Array(w * h).fill(100), seaLevel: 0, features };
  }

  function trunkWorld(field: SeatField, cellX: number, cellZ: number): { x: number; z: number } {
    return {
      x: (cellX - (field.width - 1) / 2) * CELL_PIXELS,
      z: (cellZ - (field.height - 1) / 2) * CELL_PIXELS,
    };
  }

  it("sizes keepout per kind: flank half-width plus the trunk radius", () => {
    expect(TRUNK_RADIUS).toBe(4);
    expect(TRUNK_KEEPOUT).toBe(14);
    expect(hullBodyRadius("flash")).toBe(HULL_FOOTPRINT.flash.halfWid);
    expect(hullBodyRadius("stump")).toBe(HULL_FOOTPRINT.stump.halfWid);
    expect(trunkKeepoutFor("flash")).toBe(HULL_FOOTPRINT.flash.halfWid + TRUNK_RADIUS);
    expect(trunkKeepoutFor("stump")).toBe(HULL_FOOTPRINT.stump.halfWid + TRUNK_RADIUS);
    expect(trunkKeepoutFor("hammer")).toBe(HULL_FOOTPRINT.hammer.halfWid + TRUNK_RADIUS);
    expect(trunkKeepoutFor("commander")).toBe(HULL_FOOTPRINT.commander.halfWid + TRUNK_RADIUS);
    // Kind-less queries steer with the widest hull's margin, matching smoothing.
    expect(trunkKeepoutFor()).toBe(TRUNK_KEEPOUT);
  });

  it("flags positions inside the keepout, clears the flank outside it", () => {
    const field = trunkField();
    const trunk = trunkWorld(field, 16, 16);
    for (const kind of Object.keys(HULL_FOOTPRINT) as (keyof typeof HULL_FOOTPRINT)[]) {
      expect(trunkBlockedAt(field, trunk.x, trunk.z, kind)).toBe(true);
      const keepout = trunkKeepoutFor(kind);
      expect(trunkBlockedAt(field, trunk.x + keepout - 1, trunk.z, kind)).toBe(true);
      expect(trunkBlockedAt(field, trunk.x + keepout + 1, trunk.z, kind)).toBe(false);
    }
    // Open ground far from any trunk reads clear, as do feature-less fields.
    const open = trunkWorld(field, 5, 5);
    expect(trunkBlockedAt(field, open.x, open.z, "stump")).toBe(false);
    expect(trunkBlockedAt(flatField(), trunk.x, trunk.z, "stump")).toBe(false);
  });

  it("drives through trunks instead of refusing (crush, not block)", () => {
    const field = trunkField();
    const trunk = trunkWorld(field, 16, 16);
    const west = { x: trunk.x - 40, z: trunk.z };
    const east = { x: trunk.x + 40, z: trunk.z };
    // Straight through the trunk: free — the hull crushes it (see the crush
    // tests below and movement.test.ts), whatever the kind.
    expect(segmentClipsTrunk(field, west.x, west.z, east.x, east.z, "flash")).toBe(true);
    expect(stepBlocked(field, west.x, west.z, east.x, east.z, "flash")).toBe(false);
    // Landing inside the keepout: free too.
    expect(segmentClipsTrunk(field, west.x, west.z, trunk.x, trunk.z, "flash")).toBe(true);
    expect(stepBlocked(field, west.x, west.z, trunk.x, trunk.z, "flash")).toBe(false);
    // Skirting outside the keepout: free, as before.
    const keepout = trunkKeepoutFor("flash");
    expect(
      segmentClipsTrunk(field, west.x, west.z - keepout - 2, east.x, east.z - keepout - 2, "flash"),
    ).toBe(false);
    expect(stepBlocked(field, west.x, west.z - keepout - 2, east.x, east.z - keepout - 2, "flash")).toBe(
      false,
    );
    // Escape: starting inside and moving away is allowed (still inside, but
    // farther out) — this is how spawns on trunks drive free.
    expect(segmentClipsTrunk(field, trunk.x, trunk.z, trunk.x + 5, trunk.z, "flash")).toBe(false);
    expect(stepBlocked(field, trunk.x, trunk.z, trunk.x + 5, trunk.z, "flash")).toBe(false);
    // Milling around inside (ending nearer) still clips the trunk circle —
    // the drive no longer consults it, but the lean/avoid helpers do.
    expect(segmentClipsTrunk(field, trunk.x + 5, trunk.z, trunk.x + 2, trunk.z, "flash")).toBe(true);
    expect(stepBlocked(field, trunk.x + 5, trunk.z, trunk.x + 2, trunk.z, "flash")).toBe(false);
    // Feature-less fields never clip, keeping terrain-less parity.
    expect(segmentClipsTrunk(flatField(), west.x, west.z, east.x, east.z, "flash")).toBe(false);
  });

  it("pushes spawns out of trunks to clear ground, deterministically", () => {
    const field = trunkField();
    const trunk = trunkWorld(field, 16, 16);
    const exit = pushOutOfTrunks(field, trunk.x, trunk.z, "stump");
    expect(trunkBlockedAt(field, exit.x, exit.z, "stump")).toBe(false);
    // Coincident escape runs +X, and replays exactly.
    expect(exit.x).toBeGreaterThan(trunk.x);
    expect(exit.z).toBeCloseTo(trunk.z, 9);
    expect(pushOutOfTrunks(field, trunk.x, trunk.z, "stump")).toEqual(exit);
    // Clear ground is untouched, as are feature-less fields.
    const open = trunkWorld(field, 5, 5);
    expect(pushOutOfTrunks(field, open.x, open.z, "stump")).toEqual(open);
    expect(pushOutOfTrunks(flatField(), trunk.x, trunk.z, "stump")).toEqual({
      x: trunk.x,
      z: trunk.z,
    });
    expect(TRUNK_PUSH_SPEED).toBeGreaterThan(0);
  });

  it("exits overlapping keepouts in dense stands instead of ping-ponging", () => {
    // Two adjacent trees: keepouts overlap, so the midpoint sits inside both.
    const w = 32;
    const h = 32;
    const features = new Uint16Array(w * h).fill(0xffff);
    features[16 * w + 15] = 0;
    features[16 * w + 16] = 1;
    const field: SeatField = { width: w, height: h, heights: new Uint8Array(w * h).fill(100), seaLevel: 0, features };
    const a = trunkWorld(field, 15, 16);
    const b = trunkWorld(field, 16, 16);
    const mid = { x: (a.x + b.x) / 2, z: a.z };
    expect(trunkBlockedAt(field, mid.x, mid.z, "stump")).toBe(true);
    const exit = pushOutOfTrunks(field, mid.x, mid.z, "stump");
    expect(pushOutOfTrunks(field, mid.x, mid.z, "stump")).toEqual(exit);
    // Marches along one escape heading: the exit sits on the mid line, clear
    // of both trunks (the stand is sparse enough to have an edge nearby).
    expect(exit.z).toBeCloseTo(mid.z, 9);
  });
});

describe("slewTilt", () => {
  it("steps toward the seat by at most the allowance, both directions", () => {
    expect(slewTilt(0, 0.3, 0.1)).toBeCloseTo(0.1, 12);
    expect(slewTilt(0, -0.3, 0.1)).toBeCloseTo(-0.1, 12);
    // Within reach lands exactly — no asymptotic crawl toward the seat.
    expect(slewTilt(0.1, 0.15, 0.1)).toBeCloseTo(0.15, 12);
    expect(slewTilt(0, 0, 0.1)).toBe(0);
  });

  it("holds on non-positive steps and snaps on infinite ones", () => {
    expect(slewTilt(0.1, 0.4, 0)).toBe(0.1);
    expect(slewTilt(0.1, 0.4, -1)).toBe(0.1);
    expect(slewTilt(0.1, 0.4, Number.POSITIVE_INFINITY)).toBe(0.4);
  });

  it("settles a full-tilt swing inside half a second", () => {
    // The renderer slews at HULL_TILT_SLEW per second: worst case
    // (−max to +max tilt) must converge fast enough to read as suspension,
    // not a stuck lean.
    expect(HULL_TILT_SLEW).toBeGreaterThan(0);
    let tilt = -MAX_HULL_TILT;
    for (let n = 0; n < 30; n++) tilt = slewTilt(tilt, MAX_HULL_TILT, HULL_TILT_SLEW / 60);
    expect(tilt).toBeCloseTo(MAX_HULL_TILT, 9);
  });
});

describe("hull crush contact (which standing trees a step touches)", () => {
  /** Two standing trees 64 world units apart on the mid row. */
  function twoTrees(): { points: { x: number; z: number }[]; states: ("intact")[] } {
    const w = 32;
    const h = 32;
    const at = (cellX: number, cellZ: number): { x: number; z: number } => ({
      x: (cellX - (w - 1) / 2) * CELL_PIXELS,
      z: (cellZ - (h - 1) / 2) * CELL_PIXELS,
    });
    return { points: [at(14, 16), at(18, 16)], states: ["intact", "intact"] };
  }

  it("crawls much slower than canopy brush while crushing", () => {
    // Ordering pin: crushing a fresh lane (0.25) labours far below the
    // canopy-brush proximity drag (0.6) — and both below open ground.
    expect(CRUSH_DRAG).toBe(0.25);
    expect(CRUSH_DRAG).toBeLessThan(TREE_DRAG);
    expect(TREE_DRAG).toBeLessThan(1);
  });

  it("flags the tree a step drives over, in ascending fid order", () => {
    const { points, states } = twoTrees();
    const a = points[0]!;
    // Straight over the first tree only (64u lane, keepout ~12): one hit.
    expect(treesCrushedByStep(points, states, a.x - 40, a.z, a.x + 20, a.z, "flash")).toEqual([0]);
    // A lane through both trunks clips both keepouts.
    const b = points[1]!;
    expect(treesCrushedByStep(points, states, a.x - 40, a.z, b.x + 40, b.z, "flash")).toEqual([0, 1]);
    // A parallel lane two keepouts north touches nothing.
    const keepout = trunkKeepoutFor("flash");
    expect(
      treesCrushedByStep(points, states, a.x - 40, a.z - keepout - 4, a.x + 40, a.z - keepout - 4, "flash"),
    ).toEqual([]);
    // Degenerate (zero-length) steps still crush the tree under the hull —
    // this is how a spawn parked on a trunk fells it getting out.
    expect(treesCrushedByStep(points, states, a.x, a.z, a.x, a.z, "flash")).toEqual([0]);
  });

  it("sizes contact per kind and skips felled or gone trees", () => {
    const { points } = twoTrees();
    const a = points[0]!;
    // Commander (flank 7 + trunk 4 = 11) vs stump (10 + 4 = 14): a lane at
    // 12.5u clips for the wide hull only.
    const lane = 12.5;
    expect(treesCrushedByStep(points, ["intact"], a.x - 40, a.z + lane, a.x + 40, a.z + lane, "stump")).toEqual([
      0,
    ]);
    expect(
      treesCrushedByStep(points, ["intact"], a.x - 40, a.z + lane, a.x + 40, a.z + lane, "commander"),
    ).toEqual([]);
    // Felled and gone trees are already flat: never re-counted, so crushed
    // lanes stay crushed and later passes ride free of crush drag.
    for (const state of ["toppled", "stump", "snag", "gone"] as const) {
      expect(treesCrushedByStep(points, [state], a.x - 40, a.z, a.x + 40, a.z, "flash")).toEqual([]);
    }
    // Burning trees still stand: crushing one puts its fire out (crushTree).
    expect(treesCrushedByStep(points, ["burning"], a.x - 40, a.z, a.x + 40, a.z, "flash")).toEqual([
      0,
    ]);
    // Deterministic: replays agree exactly.
    const lane2 = treesCrushedByStep(points, ["intact", "intact"], a.x - 40, a.z, a.x + 200, a.z, "flash");
    expect(lane2).toEqual([0, 1]);
    expect(treesCrushedByStep(points, ["intact", "intact"], a.x - 40, a.z, a.x + 200, a.z, "flash")).toEqual(
      lane2,
    );
  });

  it("counts every point as standing without states (drag estimate)", () => {
    const { points } = twoTrees();
    const a = points[0]!;
    expect(treesCrushedByStep(points, undefined, a.x - 40, a.z, a.x + 40, a.z, "flash")).toEqual([0]);
    expect(treesCrushedByStep([], [], a.x - 40, a.z, a.x + 40, a.z, "flash")).toEqual([]);
  });
});

describe("downslopeAt/blastSlopeAt (fall line for blast wash)", () => {
  it("reads flat ground as zero grade with no direction", () => {
    expect(downslopeAt(flatField(), 0, 0)).toEqual({ dx: 0, dz: 0, grade: 0 });
    expect(downslopeAt(flatField(), 37.5, -112)).toEqual({ dx: 0, dz: 0, grade: 0 });
    const s = blastSlopeAt(flatField(), 0, 0);
    expect(s).toEqual({ sx: 0, sz: 0, skew: 0 });
  });

  it("points down the fall line with the ramp grade", () => {
    // Eastward ramp rising toward +x: downhill is −x at per/CELL_PIXELS.
    const field = rampField(4, 9, 9);
    const d = downslopeAt(field, 0, 0);
    expect(d.dx).toBeCloseTo(-1, 9);
    expect(d.dz).toBeCloseTo(0, 6);
    expect(d.grade).toBeCloseTo(4 / CELL_PIXELS, 9);
    const s = blastSlopeAt(field, 0, 0);
    expect(s.sx).toBeCloseTo(-1, 9);
    expect(s.sz).toBeCloseTo(0, 6);
    expect(s.skew).toBeGreaterThan(0);
    expect(s.skew).toBeLessThanOrEqual(MAX_BLAST_SKEW);
  });

  it("saturates the wash on cliffs instead of skewing past the max", () => {
    const field = rampField(30, 9, 9);
    const s = blastSlopeAt(field, 0, 0);
    expect(s.skew).toBeCloseTo(MAX_BLAST_SKEW, 9);
  });
});
