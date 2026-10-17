import { describe, expect, it } from "vitest";
import { advanceMover, ARRIVE_RADIUS, holdMover, orderMover, type Mover } from "./movement.js";
import { stepBlocked, type SeatField } from "./terrain.js";
import { terrainDetour } from "./detour.js";
import { UNIT_KINDS } from "./types.js";

function outcrop(): SeatField {
  const width = 41;
  const heights = new Uint8Array(width * width).fill(60);
  for (let z = 19; z <= 21; z++) {
    for (let x = 19; x <= 21; x++) heights[z * width + x] = 130;
  }
  return { width, height: width, heights, seaLevel: 0 };
}

describe("persistent terrain detours", () => {
  it("publishes deterministic routes without changing the terrain", () => {
    const field = outcrop();
    const before = field.heights.slice();
    const from = { x: -48, z: 0 };
    const target = { x: 128, z: 0 };
    expect(terrainDetour(field, from, target)).toEqual(terrainDetour(field, from, target));
    expect(field.heights).toEqual(before);
  });

  it("drops recovery when a new order or hold replaces intent", () => {
    const mover: Mover = { x: -48, z: 0, hull: 0, leg: 1,
      detour: { target: { x: 128, z: 0 }, points: [{ x: -48, z: -64 }], at: 0 } };
    expect(holdMover(mover).detour).toBeUndefined();
    expect(orderMover(mover, [{ x: -128, z: 0 }]).detour).toBeUndefined();
    const redirected = advanceMover("flash", mover, [{ x: -128, z: 0 }, { x: -112, z: 0 }], 1 / 60, 1, outcrop());
    expect(redirected.detour).toBeUndefined();
  });

  it("keeps its recovery route while a pursued target moves slightly", () => {
    const field = outcrop();
    const start = { x: -112, z: 0 };
    let mover: Mover = { ...start, hull: Math.PI / 2, leg: 1,
      threat: { attacker: 0, x: 400, z: 0, ttl: 60, leash: 1000 } };
    let publications = 0;
    let previousPoints: unknown;
    for (let n = 0; n < 1800; n++) {
      mover = advanceMover("peewee", mover, [start, { x: -112, z: 100 }], 1 / 60, 1, field, null,
        [{ x: 400, z: Math.sin(n / 60) * 8 }]);
      if (mover.detour && mover.detour.points !== previousPoints) publications++;
      previousPoints = mover.detour?.points;
      if (mover.x > 100) break;
    }
    expect(mover.x).toBeGreaterThan(100);
    expect(publications).toBe(1);
  });

  for (const hz of [30, 60, 120]) {
    for (const kind of UNIT_KINDS) {
      for (const ordered of [false, true]) {
        it(`${kind} rounds an isolated outcrop during ${ordered ? "orders" : "patrol"} at ${hz} Hz`, () => {
          const field = outcrop();
          const start = { x: -112, z: 0 };
          const goal = { x: 128, z: 0 };
          let mover: Mover = { ...start, hull: Math.PI / 2, leg: 1 };
          if (ordered) mover = orderMover(mover, [goal]);
          let arrived = false;
          let maxSide = 0;
          let side = 0;
          for (let n = 0; n < 30 * hz; n++) {
            const previous = mover;
            mover = advanceMover(kind, mover, [start, goal], 1 / hz, 1, field);
            expect(stepBlocked(field, previous.x, previous.z, mover.x, mover.z, kind)).toBe(false);
            maxSide = Math.max(maxSide, Math.abs(mover.z));
            // Once committed, never alternate sides of the obstacle.
            if (mover.x < 32 && Math.abs(mover.z) > 8) {
              if (side) expect(Math.sign(mover.z)).toBe(side);
              side = Math.sign(mover.z);
            }
            if (Math.hypot(mover.x - goal.x, mover.z - goal.z) <= ARRIVE_RADIUS) {
              arrived = true;
              break;
            }
            if (!ordered) expect(mover.leg).toBe(1);
          }
          expect(arrived).toBe(true);
          expect(maxSide).toBeGreaterThan(32);
        });
      }
    }
  }
});
