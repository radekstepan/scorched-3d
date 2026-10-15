import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  holdMover,
  initMover,
  orderMover,
  type Mover,
  type RoutePoint,
} from "@scorched-3d/core";
import {
  activeTrailMode,
  isHoldingRoute,
  pointAlongPath,
  remainingOrderPoints,
  remainingPatrolPoints,
  WaypointFx,
} from "./waypoints";

function routes(): RoutePoint[][] {
  return [
    [
      { x: 0, z: 0 },
      { x: 0, z: 400 },
      { x: 400, z: 400 },
      { x: 400, z: 0 },
    ],
    [
      { x: 600, z: 600 },
      { x: 600, z: 200 },
    ],
  ];
}

function moverAt(x: number, z: number): Mover {
  const m = initMover(routes()[0]!, 0);
  return { ...m, x, z };
}

function fakeMovement(movers: Mover[], destroyed: boolean[] = []) {
  return {
    moverState: (i: number) => (movers[i] ? { ...movers[i]!, order: movers[i]!.order ? { ...movers[i]!.order!, points: movers[i]!.order!.points.map((p) => ({ ...p })) } : undefined } : null),
    isDestroyed: (i: number) => destroyed[i] ?? false,
  };
}

function makeFx(routeSet: RoutePoint[][] = routes(), lift = () => 100) {
  const scene = new THREE.Scene();
  const fx = new WaypointFx(scene, routeSet, { groundY: lift });
  return { scene, fx };
}

/** Shortest distance from a point to a polyline (for corner-cut asserts). */
function distToPoly(p: RoutePoint, poly: readonly RoutePoint[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t)));
  }
  return best;
}

describe("waypoint route helpers", () => {
  it("flags coincident hold routes and healthy loops", () => {
    expect(isHoldingRoute([])).toBe(true);
    expect(isHoldingRoute([{ x: 0, z: 0 }])).toBe(true);
    const hold: RoutePoint[] = [
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      { x: 0, z: 0 },
    ];
    expect(isHoldingRoute(hold)).toBe(true);
    expect(isHoldingRoute(routes()[0]!)).toBe(false);
  });

  it("returns the live position plus unvisited order points", () => {
    const ordered = orderMover(moverAt(10, 20), [
      { x: 100, z: 100 },
      { x: 200, z: 200 },
    ]);
    expect(remainingOrderPoints(ordered)).toEqual([
      { x: 10, z: 20 },
      { x: 100, z: 100 },
      { x: 200, z: 200 },
    ]);
    expect(remainingOrderPoints(moverAt(10, 20))).toEqual([]);
  });

  it("returns the live position plus upcoming patrol waypoints in visit order", () => {
    const route = routes()[0]!;
    const mover = { ...moverAt(10, 20), leg: 2 };
    expect(remainingPatrolPoints(mover, route)).toEqual([
      { x: 10, z: 20 },
      route[2],
      route[3],
      route[0],
      route[1],
    ]);
  });

  it("returns no patrol trail for holders, ordered units, and hold-routes", () => {
    const route = routes()[0]!;
    expect(remainingPatrolPoints(holdMover(moverAt(10, 20)), route)).toEqual([]);
    const ordered = orderMover(moverAt(10, 20), [{ x: 100, z: 100 }]);
    expect(remainingPatrolPoints(ordered, route)).toEqual([]);
    const hold: RoutePoint[] = [
      { x: 5, z: 5 },
      { x: 5, z: 5 },
    ];
    expect(remainingPatrolPoints(moverAt(5, 5), hold)).toEqual([]);
  });

  it("resolves which live path a unit is trying to take", () => {
    const route = routes()[0]!;
    expect(activeTrailMode(moverAt(0, 0), route)).toBe("patrol");
    const ordered = orderMover(moverAt(0, 0), [{ x: 100, z: 100 }]);
    expect(activeTrailMode(ordered, route)).toBe("order");
    expect(activeTrailMode(holdMover(moverAt(0, 0)), route)).toBe(null);
    expect(activeTrailMode(moverAt(0, 0), [{ x: 5, z: 5 }])).toBe(null);
    expect(activeTrailMode(moverAt(0, 0), undefined)).toBe(null);
  });

  it("walks a distance along a polyline for the tracer", () => {
    const pts: RoutePoint[] = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 100 },
    ];
    const mid = pointAlongPath(pts, 50);
    expect(mid.x).toBeCloseTo(50, 9);
    expect(mid.z).toBeCloseTo(0, 9);
    expect(mid.dx).toBeCloseTo(1, 9);
    const corner = pointAlongPath(pts, 150);
    expect(corner.x).toBeCloseTo(100, 9);
    expect(corner.z).toBeCloseTo(50, 9);
    // Past the end clamps to the destination.
    const past = pointAlongPath(pts, 10_000);
    expect(past.x).toBeCloseTo(100, 9);
    expect(past.z).toBeCloseTo(100, 9);
    expect(pointAlongPath([], 10)).toEqual({ x: 0, z: 0, dx: 0, dz: 0 });
  });
});

describe("WaypointFx", () => {
  it("draws one patrol loop per live unit on non-holding routes", () => {
    const { fx, scene } = makeFx();
    const movers = [moverAt(0, 0), moverAt(600, 600)];
    fx.update(fakeMovement(movers), 2);
    expect(fx.hasPatrol(0)).toBe(true);
    expect(fx.hasPatrol(1)).toBe(true);
    expect(scene.getObjectByName("waypoints")).toBe(fx.group);
    fx.dispose();
  });

  it("hides patrol loops for holding routes and wrecks", () => {
    const hold: RoutePoint[][] = [
      [
        { x: 5, z: 5 },
        { x: 5, z: 5 },
      ],
    ];
    const { fx } = makeFx(hold);
    fx.update(fakeMovement([moverAt(5, 5)]), 1);
    expect(fx.hasPatrol(0)).toBe(false);
    const { fx: fx2 } = makeFx();
    fx2.update(fakeMovement([moverAt(0, 0), moverAt(600, 600)], [true, false]), 2);
    expect(fx2.hasPatrol(0)).toBe(false);
    expect(fx2.hasPatrol(1)).toBe(true);
    fx.dispose();
    fx2.dispose();
  });

  it("tracks the driven order path and hides it on arrival", () => {
    const { fx } = makeFx();
    const ordered = orderMover(moverAt(0, 0), [
      { x: 100, z: 0 },
      { x: 200, z: 0 },
    ]);
    fx.update(fakeMovement([ordered, moverAt(600, 600)]), 2);
    const pts = fx.orderPoints(0);
    // The driven line samples the steering (many points), starting at the
    // hull and ending inside the arrival radius of the destination.
    expect(pts.length).toBeGreaterThan(3);
    expect(pts[0]!.x).toBeCloseTo(0, 9);
    expect(pts[0]!.z).toBeCloseTo(0, 9);
    const last = pts[pts.length - 1]!;
    expect(Math.hypot(last.x - 200, last.z - 0)).toBeLessThanOrEqual(14);
    // The destination diamond still pins the true ordered point.
    const marker = (fx as unknown as { orders: { marker: THREE.Mesh }[] }).orders[0]!.marker;
    expect(marker.position.x).toBeCloseTo(200, 9);
    expect(marker.position.z).toBeCloseTo(0, 9);
    expect(fx.orderPoints(1)).toEqual([]);
    // Arrival clears the order: the line hides.
    fx.update(fakeMovement([moverAt(200, 0), moverAt(600, 600)]), 2);
    expect(fx.orderPoints(0)).toEqual([]);
    fx.dispose();
  });

  it("toggles the whole overlay and re-seats heights on resnap", () => {
    let height = 100;
    const { fx } = makeFx(routes(), () => height);
    fx.update(fakeMovement([moverAt(0, 0), moverAt(600, 600)]), 2);
    fx.setVisible(false);
    expect(fx.group.visible).toBe(false);
    fx.setVisible(true);
    expect(fx.group.visible).toBe(true);
    height = 250;
    fx.resnap();
    const loop = (fx as unknown as { patrol: { loop: THREE.LineLoop }[] }).patrol[0]!.loop;
    const pos = loop.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(pos.getY(0)).toBeCloseTo(250 + 3, 9);
    fx.dispose();
  });

  it("draws the driven patrol path from the hull, not the waypoint chords", () => {
    const { fx } = makeFx();
    // Crosswise hull: facing +X while the leg runs to (400, 400), so the
    // grip steers a visible arc off the straight chord.
    const mover = { ...moverAt(50, 60), hull: Math.PI / 2, leg: 2 };
    fx.update(fakeMovement([mover, moverAt(600, 600)]), 2, 1.5);
    expect(fx.trailMode(0)).toBe("patrol");
    const trail = fx.trailPoints(0);
    expect(trail.length).toBeGreaterThan(4);
    expect(trail[0]).toEqual({ x: 50, z: 60 });
    const route = routes()[0]!;
    // The driven loop still visits every upcoming waypoint's neighbourhood.
    for (const wp of route) {
      expect(trail.some((p) => Math.hypot(p.x - wp.x, p.z - wp.z) < 14 + 30)).toBe(true);
    }
    // ...but it cuts corners instead of tracing the waypoint chords.
    const straight = remainingPatrolPoints(mover, route);
    const cut = Math.max(...trail.map((p) => distToPoly(p, straight)));
    expect(cut).toBeGreaterThan(5);
    // The tracer rides the trail and the next waypoint reads larger.
    expect(fx.flowPosition(0)).not.toBe(null);
    const dots = (fx as unknown as { patrol: { dots: THREE.Mesh[] }[] }).patrol[0]!.dots;
    expect(dots[2]!.scale.x).toBeGreaterThan(dots[0]!.scale.x);
    fx.dispose();
  });

  it("shapes the driven arc by unit kind", () => {
    const mover = { ...moverAt(0, 0), hull: Math.PI / 2, leg: 1 };
    const drive = (kind: "flash" | "hammer") => {
      const { fx } = makeFx();
      fx.update({ ...fakeMovement([mover]), kindAt: () => kind }, 1, 0);
      const pts = fx.trailPoints(0);
      fx.dispose();
      return pts;
    };
    const flash = drive("flash");
    const hammer = drive("hammer");
    expect(flash.length).toBeGreaterThan(4);
    expect(hammer.length).toBeGreaterThan(4);
    // Same live state, different speed/turn profiles: different arcs.
    expect(flash).not.toEqual(hammer);
  });

  it("freezes live lines while hidden and repaints on toggle", () => {
    const { fx } = makeFx();
    fx.update(fakeMovement([moverAt(0, 0), moverAt(600, 600)]), 2, 1.5);
    const before = fx.trailPoints(0);
    expect(before.length).toBeGreaterThan(0);
    fx.setVisible(false);
    fx.update(fakeMovement([moverAt(300, 300), moverAt(600, 600)]), 2, 2.5);
    expect(fx.trailPoints(0)).toEqual(before);
    fx.setVisible(true);
    expect(fx.trailPoints(0)[0]).toEqual({ x: 300, z: 300 });
    fx.dispose();
  });

  it("hides the patrol loop while ordered and tints the tracer amber", () => {
    const { fx } = makeFx();
    const ordered = orderMover(moverAt(0, 0), [
      { x: 100, z: 0 },
      { x: 200, z: 0 },
    ]);
    fx.update(fakeMovement([ordered, moverAt(600, 600)]), 2, 1.5);
    expect(fx.hasPatrol(0)).toBe(false);
    expect(fx.trailMode(0)).toBe("order");
    expect(fx.trailPoints(0)).toEqual([]);
    const driven = fx.orderPoints(0);
    expect(driven.length).toBeGreaterThan(3);
    expect(driven[0]!.x).toBeCloseTo(0, 9);
    const end = driven[driven.length - 1]!;
    expect(Math.hypot(end.x - 200, end.z - 0)).toBeLessThanOrEqual(14);
    expect(fx.flowPosition(0)).not.toBe(null);
    const flow = (fx as unknown as { flows: THREE.Mesh[] }).flows[0]!;
    expect((flow.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xfbbf24);
    // The undisturbed unit keeps its slate patrol context.
    expect(fx.hasPatrol(1)).toBe(true);
    expect(fx.trailMode(1)).toBe("patrol");
    fx.dispose();
  });

  it("shows no path at all for holders and wrecks", () => {
    const { fx } = makeFx();
    const held = holdMover(moverAt(0, 0));
    fx.update(fakeMovement([held, moverAt(600, 600)], [false, true]), 2, 1.5);
    expect(fx.hasPatrol(0)).toBe(false);
    expect(fx.trailMode(0)).toBe(null);
    expect(fx.flowPosition(0)).toBe(null);
    expect(fx.hasPatrol(1)).toBe(false);
    expect(fx.trailMode(1)).toBe(null);
    expect(fx.flowPosition(1)).toBe(null);
    fx.dispose();
  });

  it("advances the tracer with time and loops it around the path", () => {
    const { fx } = makeFx();
    const movers = [moverAt(0, 0), moverAt(600, 600)];
    fx.update(fakeMovement(movers), 2, 0);
    const start = fx.flowPosition(0)!;
    fx.update(fakeMovement(movers), 2, 2);
    const later = fx.flowPosition(0)!;
    // 2 s at 70 u/s = 140 u along the first leg (400 u long).
    expect(Math.hypot(later.x - start.x, later.z - start.z)).toBeGreaterThan(100);
    // Far-future time wraps modulo the loop instead of running away.
    fx.update(fakeMovement(movers), 2, 10_000);
    const wrapped = fx.flowPosition(0)!;
    const trail = fx.trailPoints(0);
    const xs = trail.map((p) => p.x);
    const zs = trail.map((p) => p.z);
    expect(wrapped.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1);
    expect(wrapped.x).toBeLessThanOrEqual(Math.max(...xs) + 1);
    expect(wrapped.z).toBeGreaterThanOrEqual(Math.min(...zs) - 1);
    expect(wrapped.z).toBeLessThanOrEqual(Math.max(...zs) + 1);
    fx.dispose();
  });

  it("re-seats the live trail and tracer on resnap", () => {
    let height = 100;
    const { fx } = makeFx(routes(), () => height);
    fx.update(fakeMovement([moverAt(0, 0), moverAt(600, 600)]), 2, 1.5);
    height = 250;
    fx.resnap();
    const trail = (fx as unknown as { trails: THREE.Line[] }).trails[0]!;
    const pos = trail.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(pos.getY(0)).toBeCloseTo(250 + 4, 9);
    const flow = (fx as unknown as { flows: THREE.Mesh[] }).flows[0]!;
    expect(flow.position.y).toBeCloseTo(250 + 5, 9);
    fx.dispose();
  });

  it("reuses live-line geometry across ticks instead of reallocating", () => {
    // Hot-loop sweep: repainting the driven lines every tick used to dispose
    // + rebuild a BufferGeometry per unit per frame. Steady-state ticks now
    // rewrite the same buffer in place (draw-range prefix for shorter paths).
    const { fx } = makeFx();
    const view = fx as unknown as { orders: { line: THREE.Line }[]; trails: THREE.Line[] };
    const ordered = orderMover(moverAt(0, 0), [
      { x: 100, z: 0 },
      { x: 200, z: 0 },
    ]);
    fx.update(fakeMovement([ordered, moverAt(600, 600)]), 2, 1.5);
    expect(fx.orderPoints(0).length).toBeGreaterThan(3);
    expect(fx.trailPoints(1).length).toBeGreaterThan(3);
    const orderGeo = view.orders[0]!.line.geometry;
    const trailGeo = view.trails[1]!.geometry;
    const ordered2 = orderMover(moverAt(30, 0), [
      { x: 100, z: 0 },
      { x: 200, z: 0 },
    ]);
    fx.update(fakeMovement([ordered2, moverAt(600, 600)]), 2, 2.5);
    expect(view.orders[0]!.line.geometry).toBe(orderGeo);
    expect(view.trails[1]!.geometry).toBe(trailGeo);
    // Same buffers, fresh content: the repainted order starts at the new hull.
    const after = fx.orderPoints(0);
    expect(after.length).toBeGreaterThan(3);
    expect(after[0]!.x).toBeCloseTo(30, 9);
    expect(after[0]!.z).toBeCloseTo(0, 9);
    fx.dispose();
  });
});
