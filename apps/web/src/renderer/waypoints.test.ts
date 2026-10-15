import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { initMover, orderMover, type Mover, type RoutePoint } from "@scorched-3d/core";
import { isHoldingRoute, remainingOrderPoints, WaypointFx } from "./waypoints";

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

  it("tracks the remaining order path and hides it on arrival", () => {
    const { fx } = makeFx();
    const ordered = orderMover(moverAt(0, 0), [
      { x: 100, z: 0 },
      { x: 200, z: 0 },
    ]);
    fx.update(fakeMovement([ordered, moverAt(600, 600)]), 2);
    const pts = fx.orderPoints(0);
    expect(pts).toHaveLength(3);
    expect(pts[0]!.x).toBeCloseTo(0, 9);
    expect(pts[2]!.x).toBeCloseTo(200, 9);
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
});
