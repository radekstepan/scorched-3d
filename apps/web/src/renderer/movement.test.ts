import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  sampleHeightBilinear,
  seatHull,
  yawToTarget,
  type RoutePoint,
  type UnitKind,
} from "@scorched-3d/core";
import { UnitMovement } from "./movement";

function makeGroup(): THREE.Group {
  const group = new THREE.Group();
  group.userData.units = [
    { kind: "flash", cellX: 10, cellZ: 10, rotation: 0 },
    { kind: "hammer", cellX: 40, cellZ: 40, rotation: Math.PI },
  ];
  const starts = [
    new THREE.Vector3(0, 100, 0),
    new THREE.Vector3(600, 120, 600),
  ];
  group.userData.units.forEach((u: { rotation: number }, i: number) => {
    const body = new THREE.Group();
    body.rotation.y = u.rotation;
    body.position.copy(starts[i]!);
    const turret = new THREE.Group();
    turret.name = "turret";
    turret.rotation.y = 0.3;
    body.add(turret);
    body.userData.turret = turret;
    group.add(body);
  });
  return group;
}

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
      { x: 200, z: 200 },
      { x: 200, z: 600 },
    ],
  ];
}

describe("UnitMovement", () => {
  it("advances bodies along their routes with hulls facing travel", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    const before = units.children.map((c) => (c as THREE.Group).position.clone());
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    units.children.forEach((child, i) => {
      const body = child as THREE.Group;
      const travelled = body.position.distanceTo(before[i]!);
      expect(travelled).toBeGreaterThan(0);
      // Hull faces the current leg: yaw matches the bearing to the target.
      const state = movement.moverState(i)!;
      const target = routes()[i]![state.leg]!;
      const want = yawToTarget({ x: body.position.x, z: body.position.z }, target);
      const aligned = Math.abs(body.rotation.y - want) < Math.PI / 2 || travelled < 60;
      expect(aligned).toBe(true);
    });
    movement.dispose();
  });

  it("never touches the turret subgroup while driving the hull", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    units.children.forEach((child) => {
      const turret = (child as THREE.Group).userData.turret as THREE.Group;
      expect(turret.rotation.y).toBeCloseTo(0.3, 10);
    });
    movement.dispose();
  });

  it("seats bodies on the terrain surface and re-seats on resnap", () => {
    const units = makeGroup();
    let height = 100;
    const movement = new UnitMovement(units, routes(), { groundY: () => height });
    movement.update(0.05);
    units.children.forEach((child) => {
      expect((child as THREE.Group).position.y).toBeCloseTo(100.5, 9);
    });
    height = 200;
    movement.resnap();
    units.children.forEach((child) => {
      expect((child as THREE.Group).position.y).toBeCloseTo(200.5, 9);
    });
    movement.dispose();
  });

  it("reports per-unit shifts so recoil anchors can follow", () => {
    const units = makeGroup();
    const shifts: { index: number; dx: number; dz: number }[] = [];
    const movement = new UnitMovement(units, routes(), {
      groundY: () => 100,
      onShift: (index, dx, dz) => shifts.push({ index, dx, dz }),
    });
    const first = units.children[0] as THREE.Group;
    const px = first.position.x;
    const pz = first.position.z;
    movement.update(0.05);
    const shift = shifts.find((s) => s.index === 0)!;
    expect(shift).toBeDefined();
    expect(first.position.x - px).toBeCloseTo(shift.dx, 9);
    expect(first.position.z - pz).toBeCloseTo(shift.dz, 9);
    movement.dispose();
  });

  it("stops updates after dispose", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    movement.dispose();
    const before = (units.children[0] as THREE.Group).position.clone();
    movement.update(1);
    expect((units.children[0] as THREE.Group).position.equals(before)).toBe(true);
  });

  it("drives ordered units to their target and holds on arrival", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    expect(movement.orderUnit(0, { x: 600, z: 0 })).toBe(true);
    expect(movement.orderUnit(99, { x: 0, z: 0 })).toBe(false);
    expect(movement.hasOrder(0)).toBe(true);
    expect(movement.hasOrder(1)).toBe(false);
    for (let n = 0; n < 1500; n++) movement.update(1 / 60);
    expect(movement.hasOrder(0)).toBe(false);
    const body = units.children[0] as THREE.Group;
    expect(body.position.x).toBeGreaterThan(300);
    // Arrival holds: further ticks keep the unit parked.
    const parked = body.position.clone();
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    expect(body.position.distanceTo(parked)).toBeCloseTo(0, 6);
    // The unordered unit kept patrolling meanwhile.
    expect(movement.hasOrder(1)).toBe(false);
    movement.dispose();
  });

  it("fans group orders out over formation slots with live positions", () => {
    const field = {
      width: 64,
      height: 64,
      heights: new Uint8Array(64 * 64).fill(100),
      features: new Uint16Array(64 * 64),
      seaLevel: 0,
    };
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 }, field);
    expect(movement.orderGroup([0, 1], { x: 300, z: 300 })).toBe(2);
    expect(movement.hasOrder(0)).toBe(true);
    expect(movement.hasOrder(1)).toBe(true);
    const a = movement.moverState(0)!;
    const b = movement.moverState(1)!;
    const endA = a.order!.points[a.order!.points.length - 1]!;
    const endB = b.order!.points[b.order!.points.length - 1]!;
    // Distinct destinations: first slot takes the click, the rest fan out.
    expect(Math.hypot(endA.x - endB.x, endA.z - endB.z)).toBeGreaterThan(10);
    expect(movement.positions()).toHaveLength(2);
    expect(movement.positions()[0]!.x).toBeCloseTo(a.x, 9);
    movement.dispose();
  });
});

describe("terrain seating", () => {
  const W = 40;
  const H = 24;
  /** Southward ramp: height rises 2 raw units per cell toward +z. */
  function rampField(): { width: number; height: number; heights: Uint8Array; seaLevel: number } {
    const heights = new Uint8Array(W * H);
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) heights[z * W + x] = 100 + z * 2;
    }
    return { width: W, height: H, heights, seaLevel: 0 };
  }

  function rampGroup(): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = [{ kind: "stump", cellX: 10, cellZ: 10, rotation: 0 }];
    const body = new THREE.Group();
    body.rotation.y = 0;
    body.position.set(0, 0, 0);
    const turret = new THREE.Group();
    turret.name = "turret";
    body.add(turret);
    body.userData.turret = turret;
    group.add(body);
    return group;
  }

  function rampEnv(field: ReturnType<typeof rampField>, ex: { v: number }) {
    return {
      groundY: (x: number, z: number) => sampleHeightBilinear(field, x, z) * ex.v,
      seat: (x: number, z: number, hull: number, kind: UnitKind) => seatHull(field, kind, x, z, hull, ex.v),
    };
  }

  it("pitches the hull nose-up on an upgrade and matches the core seat", () => {
    const field = rampField();
    const ex = { v: 1 };
    const units = rampGroup();
    const routes: RoutePoint[][] = [[{ x: 0, z: -200 }, { x: 0, z: 200 }]];
    const movement = new UnitMovement(units, routes, rampEnv(field, ex), field);
    for (let n = 0; n < 30; n++) movement.update(1 / 60);
    const body = units.children[0] as THREE.Group;
    const state = movement.moverState(0)!;
    // Facing +z (uphill on the southward ramp): nose up = negative X.
    expect(body.rotation.x).toBeLessThan(-0.01);
    expect(body.rotation.order).toBe("YXZ");
    const want = seatHull(field, "stump", state.x, state.z, state.hull, 1);
    expect(body.position.y).toBeCloseTo(want.y, 9);
    expect(body.rotation.x).toBeCloseTo(want.pitch, 9);
    expect(body.rotation.z).toBeCloseTo(want.roll, 9);
    // The turret subgroup is still untouched by the driver.
    expect((body.userData.turret as THREE.Group).rotation.y).toBeCloseTo(0, 10);
    movement.dispose();
  });

  it("re-seats height and tilt when the exaggeration changes", () => {
    const field = rampField();
    const ex = { v: 1 };
    const units = rampGroup();
    const routes: RoutePoint[][] = [[{ x: 0, z: -200 }, { x: 0, z: 200 }]];
    const movement = new UnitMovement(units, routes, rampEnv(field, ex), field);
    movement.update(0.05);
    const body = units.children[0] as THREE.Group;
    const lowY = body.position.y;
    const lowPitch = body.rotation.x;
    ex.v = 3;
    movement.resnap();
    const state = movement.moverState(0)!;
    const want = seatHull(field, "stump", state.x, state.z, state.hull, 3);
    expect(body.position.y).toBeCloseTo(want.y, 9);
    expect(body.position.y).toBeGreaterThan(lowY);
    // Steeper rendered grade reads as a harder pitch.
    expect(Math.abs(body.rotation.x)).toBeGreaterThan(Math.abs(lowPitch));
    movement.dispose();
  });

  it("pins hulls against too-steep ground instead of clipping through", () => {
    // Cliff field: flat 100 west of x=20, plateau 200 east — the step reads
    // steep through the slope probe, so the drive clamp must pin the hull.
    const w = 40;
    const h = 24;
    const heights = new Uint8Array(w * h).fill(100);
    for (let z = 0; z < h; z++) {
      for (let x = 20; x < w; x++) heights[z * w + x] = 200;
    }
    const field = { width: w, height: h, heights, seaLevel: 0 };
    const ex = { v: 1 };
    const units = rampGroup();
    // Route straight at the cliff from walkable ground.
    const routes: RoutePoint[][] = [[{ x: -200, z: 0 }, { x: 400, z: 0 }]];
    (units.children[0] as THREE.Group).position.set(-200, 0, 0);
    const movement = new UnitMovement(units, routes, rampEnv(field, ex), field);
    const cliffX = (20 - (w - 1) / 2) * 16;
    for (let n = 0; n < 1200; n++) {
      movement.update(1 / 60);
      const body = units.children[0] as THREE.Group;
      expect(body.position.x).toBeLessThan(cliffX);
    }
    movement.dispose();
  });
});
