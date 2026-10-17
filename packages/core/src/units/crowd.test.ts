import { describe, expect, it } from "vitest";
import { advanceMovers, CROWD_ACCELERATION, holdMover, orderMover, SLOW_RADIUS, type Mover, type RoutePoint } from "./movement.js";
import type { SeatField } from "./terrain.js";

const dt = 1 / 60;

function pack(count: number): { movers: Mover[]; routes: RoutePoint[][] } {
  const movers = Array.from({ length: count }, (_, i) => {
    const angle = i * Math.PI * 2 / count;
    return { x: Math.sin(angle) * 80, z: Math.cos(angle) * 80, hull: angle + Math.PI, leg: 1 };
  });
  return {
    movers,
    // The far exit keeps arrivals out of this crossing for the whole run.
    routes: movers.map((m) => [{ x: m.x, z: m.z }, { x: 0, z: 0 }, { x: -100 * m.x, z: -100 * m.z }]),
  };
}

describe("continuous crowd motion", () => {
  it("drains a sixteen-way crossing without frame-to-frame reversals", () => {
    const scene = pack(16);
    let movers = scene.movers;
    const previousSteps = movers.map(() => ({ x: 0, z: 0 }));
    const lastFlip = movers.map(() => -Infinity);
    const arrivals = new Set<number>();
    let rapidReversals = 0;
    let constrainedSteps = 0;
    let travel = 0;
    for (let tick = 0; tick < 5400; tick++) {
      const next = advanceMovers(movers.map(() => "stump"), movers, scene.routes, dt);
      next.forEach((m, i) => {
        const old = movers[i]!;
        const step = { x: m.x - old.x, z: m.z - old.z };
        const before = previousSteps[i]!;
        const speed = Math.hypot(step.x, step.z);
        const previousSpeed = Math.hypot(before.x, before.z);
        if (speed > 0.02 && previousSpeed > 0.02 && step.x * before.x + step.z * before.z < 0) {
          if (tick - lastFlip[i]! <= 4) rapidReversals++;
          lastFlip[i] = tick;
        }
        const contacts = movers.filter((other, j) => j !== i && Math.hypot(other.x - old.x, other.z - old.z) < SLOW_RADIUS).length;
        if (old.motion && (contacts >= 2 || old.motion.crowd)) {
          // Check actual positions, not just a filtered presentation value.
          expect(Math.hypot(step.x / dt - old.motion.x, step.z / dt - old.motion.z)).toBeLessThanOrEqual(CROWD_ACCELERATION * dt + 1e-7);
          constrainedSteps++;
        }
        if (m.leg !== 1) arrivals.add(i);
        travel += speed;
        previousSteps[i] = step;
      });
      movers = next;
    }
    // Before: 942 rapid flips. A few tiny turns around zero are allowed;
    // the visible every-other-frame dance is gone, and every hull passes.
    expect(rapidReversals).toBeLessThan(20);
    expect(constrainedSteps).toBeGreaterThan(1000);
    expect(arrivals.size).toBe(16);
    expect(travel).toBeGreaterThan(25000);
  });

  it("settles a moving sixteen-unit column without hiding a stalled pack", () => {
    let movers: Mover[] = Array.from({ length: 16 }, (_, i) => ({ x: (i % 4) * 30, z: Math.floor(i / 4) * 30, hull: 0, leg: 1 }));
    const routes = movers.map((m) => [{ x: m.x, z: m.z }, { x: 0, z: 500 }]);
    let previousSteps = movers.map(() => ({ x: 0, z: 0 }));
    let visibleReversals = 0;
    let travel = 0;
    const arrivals = new Set<number>();
    for (let tick = 0; tick < 1800; tick++) {
      const next = advanceMovers(movers.map(() => "peewee"), movers, routes, dt);
      const steps = next.map((m, i) => ({ x: m.x - movers[i]!.x, z: m.z - movers[i]!.z }));
      steps.forEach((step, i) => {
        const previous = previousSteps[i]!;
        if (Math.hypot(step.x, step.z) > 0.02 && Math.hypot(previous.x, previous.z) > 0.02 && step.x * previous.x + step.z * previous.z < 0) visibleReversals++;
        travel += Math.hypot(step.x, step.z);
        if (next[i]!.leg !== 1) arrivals.add(i);
      });
      previousSteps = steps;
      movers = next;
    }
    // Before: 1520 reversals. Progress and route transitions prohibit
    // passing this by damping the column to a standstill.
    expect(visibleReversals).toBeLessThan(100);
    expect(travel).toBeGreaterThan(8000);
    expect(arrivals.size).toBeGreaterThanOrEqual(5);
  });

  it("absorbs carried velocity at terrain instead of drifting into a wall", () => {
    const field: SeatField = { width: 40, height: 24, heights: new Uint8Array(40 * 24).fill(100), seaLevel: 0 };
    // Border is steep at the first attempted coast step.
    for (let z = 0; z < 24; z++) for (let x = 20; x < 40; x++) field.heights[z * 40 + x] = 250;
    const mover: Mover = { x: -8.1, z: 0, hull: 0, leg: 0, motion: { x: 30, z: 0, crowd: true } };
    const next = advanceMovers(["stump"], [mover], [[]], dt, field)[0]!;
    expect(next.x).toBe(mover.x);
    expect(next.motion?.x).toBe(0);
  });

  it("clears crowd momentum when an order or hold takes control", () => {
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1, motion: { x: -30, z: 0, crowd: true } };
    const ordered = orderMover(mover, [{ x: 0, z: 400 }]);
    expect(ordered.motion).toBeUndefined();
    expect(holdMover(mover).motion).toBeUndefined();
    const next = advanceMovers(["stump"], [ordered], [[]], dt)[0]!;
    expect(next.x).toBe(0);
    expect(next.z).toBeGreaterThan(0);
  });

  it("rejects corrupt velocity and replays identical traffic deterministically", () => {
    const run = () => {
      const scene = pack(8);
      let movers: Mover[] = scene.movers.map((m) => ({ ...m, motion: { x: NaN, z: Infinity, crowd: true } }));
      for (let tick = 0; tick < 300; tick++) movers = advanceMovers(movers.map(() => "stump"), movers, scene.routes, dt);
      return movers;
    };
    const first = run();
    expect(first).toEqual(run());
    expect(first.every((m) => Number.isFinite(m.x) && Number.isFinite(m.z))).toBe(true);
  });
});
