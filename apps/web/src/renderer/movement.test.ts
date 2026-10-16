import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  FORMATION_MIN_SEPARATION,
  createDamageField,
  isWalkable,
  pathWorldToCell,
  sampleHeightBilinear,
  seatHull,
  worldHeight,
  yawToTarget,
  type RoutePoint,
  type TNTMap,
  type UnitKind,
} from "@scorched-3d/core";
import { UnitMovement } from "./movement";
import { buildUnits, getLegs, getWheels, IDLE_TILT } from "./units";

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

  it("hesitates a stunned hull's drive, then resumes — wrecks refuse", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    // A hammer point-blank splash hesitates the drive for the max beat.
    movement.stunUnit(0, 0.16);
    expect(movement.moverState(0)!.stun).toBeCloseTo(0.8, 9);
    const held = movement.moverState(0)!;
    // One tick: the mover holds X/Z (the countdown, not the hull, moves).
    movement.update(1 / 60);
    const ticked = movement.moverState(0)!;
    expect(ticked.x).toBe(held.x);
    expect(ticked.z).toBe(held.z);
    expect(ticked.stun).toBeLessThan(held.stun!);
    // Non-positive damage is a no-op (no key appears on a fresh hull).
    movement.stunUnit(1, 0);
    expect(movement.moverState(1)!.stun).toBeUndefined();
    // Wrecks refuse the stun and stay frozen.
    movement.markDestroyed(0);
    movement.stunUnit(0, 0.16);
    expect(movement.moverState(0)!.stun).toBeUndefined();
    movement.dispose();
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
    // Arrival holds: the mover never moves again (simulation exact)…
    const parkedMover = movement.moverState(0)!;
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    const heldMover = movement.moverState(0)!;
    expect(heldMover.x).toBe(parkedMover.x);
    expect(heldMover.z).toBe(parkedMover.z);
    // …while the body breathes faintly on its seat (engine idle, visual
    // only: exact X/Z on the frozen mover, bounded tilt sway).
    expect(body.position.x).toBe(heldMover.x);
    expect(body.position.z).toBe(heldMover.z);
    // Flat ground seats zero tilt, so the hull judder reads directly.
    expect(Math.abs(body.rotation.x)).toBeLessThanOrEqual(IDLE_TILT + 1e-9);
    expect(Math.abs(body.rotation.z)).toBeLessThanOrEqual(IDLE_TILT + 1e-9);
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

  it("stamps group orders with the slowest member's pace, singles stay uncapped", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    // flash (72) + hammer (34): the group cap is the hammer's pace.
    expect(movement.orderGroup([0, 1], { x: 300, z: 300 })).toBe(2);
    expect(movement.moverState(0)!.order?.groupSpeed).toBe(34);
    expect(movement.moverState(1)!.order?.groupSpeed).toBe(34);
    movement.dispose();
    const solo = makeGroup();
    const single = new UnitMovement(solo, routes(), { groundY: () => 100 });
    expect(single.orderUnit(0, { x: 300, z: 300 })).toBe(true);
    expect(single.moverState(0)!.order?.groupSpeed).toBeUndefined();
    single.dispose();
  });

  it("snaps group goals onto walkable, separated ground so arrivals never stack", () => {
    // Shore field: land west, water east — the click sits over water, so raw
    // per-unit snaps could collapse onto one shore cell and park the pair
    // inside the mutual spacing stop. The snapped fan must keep them apart.
    const w = 64;
    const h = 64;
    const heights = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) heights[z * w + x] = x < 40 ? 100 : 0;
    }
    const field = { width: w, height: h, heights, seaLevel: 50 };
    const units = makeGroup();
    (units.children[0] as THREE.Group).position.set(-400, 100, 0);
    (units.children[1] as THREE.Group).position.set(-400, 100, 40);
    const landRoutes: RoutePoint[][] = [
      [
        { x: -400, z: 0 },
        { x: -400, z: 400 },
      ],
      [
        { x: -400, z: 40 },
        { x: -400, z: 440 },
      ],
    ];
    const movement = new UnitMovement(units, landRoutes, { groundY: () => 100 }, field);
    const target = { x: (48 - (w - 1) / 2) * 16, z: 0 };
    expect(movement.orderGroup([0, 1], target)).toBe(2);
    const a = movement.moverState(0)!;
    const b = movement.moverState(1)!;
    const endA = a.order!.points[a.order!.points.length - 1]!;
    const endB = b.order!.points[b.order!.points.length - 1]!;
    for (const end of [endA, endB]) {
      const cell = pathWorldToCell(field, end.x, end.z);
      expect(isWalkable(field, cell.cellX, cell.cellZ)).toBe(true);
    }
    expect(Math.hypot(endA.x - endB.x, endA.z - endB.z)).toBeGreaterThanOrEqual(
      FORMATION_MIN_SEPARATION,
    );
    // Both hulls still drive to their separated goals and arrive.
    for (let n = 0; n < 3600; n++) movement.update(1 / 60);
    expect(movement.hasOrder(0)).toBe(false);
    expect(movement.hasOrder(1)).toBe(false);
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
      groundY: (x: number, z: number) => worldHeight(sampleHeightBilinear(field, x, z), ex.v),
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

  it("slews tilt toward the seat instead of snapping, and snaps on resnap", () => {
    const field = rampField();
    const ex = { v: 1 };
    const units = rampGroup();
    const routes: RoutePoint[][] = [[{ x: 0, z: -200 }, { x: 0, z: 200 }]];
    const movement = new UnitMovement(units, routes, rampEnv(field, ex), field);
    const body = units.children[0] as THREE.Group;
    const state = movement.moverState(0)!;
    const want = seatHull(field, "stump", state.x, state.z, state.hull, 1);
    expect(Math.abs(want.pitch)).toBeGreaterThan(0.01);
    // Knock the tilt far off the seat: one small tick only closes part of
    // the gap (suspension settling, not a teleport)…
    body.rotation.x = want.pitch > 0 ? -0.4 : 0.4;
    const before = Math.abs(body.rotation.x - want.pitch);
    movement.update(1 / 60);
    const after = Math.abs(body.rotation.x - want.pitch);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
    // …while a re-snap (exaggeration change) lands exactly.
    movement.resnap();
    expect(body.rotation.x).toBeCloseTo(
      seatHull(field, "stump", movement.moverState(0)!.x, movement.moverState(0)!.z, movement.moverState(0)!.hull, 1).pitch,
      9,
    );
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

  it("crushes patrol lanes through tree belts instead of pinning on trunks", () => {
    // Patrol legs cut straight across whatever the waypoints straddle: with
    // a crush context the hull ploughs a lane through the belt at a crawl,
    // felling the trees it touches (reported via onCrush for re-posing) and
    // crossing instead of holding at the tree line — and an exaggeration
    // re-snap keeps its X/Z (re-seats sit the body, never teleport it).
    const w = 40;
    const h = 24;
    const heights = new Uint8Array(w * h).fill(100);
    const features = new Uint16Array(w * h).fill(0xffff);
    for (let z = 8; z <= 15; z++) {
      for (let x = 5; x < w - 5; x++) features[z * w + x] = 0;
    }
    const field = { width: w, height: h, heights, seaLevel: 0, features };
    const ex = { v: 1 };
    const units = rampGroup();
    (units.children[0] as THREE.Group).position.set(-280, 100, -8);
    const routes: RoutePoint[][] = [[{ x: -280, z: -8 }, { x: 280, z: -8 }]];
    // Crush points: the lane row (world z=-8 is row 11) in fid order.
    const lane: { x: number; z: number }[] = [];
    for (let cx = 5; cx < w - 5; cx++) lane.push({ x: (cx - (w - 1) / 2) * 16, z: -8 });
    const damage = createDamageField(lane.length, 0);
    const felled: number[] = [];
    const movement = new UnitMovement(units, routes, rampEnv(field, ex), field, {
      field: damage,
      points: lane,
      onCrush: (f) => felled.push(...f),
    });
    let maxX = -Infinity;
    for (let n = 0; n < 7200; n++) {
      movement.update(1 / 60);
      maxX = Math.max(maxX, movement.positions()[0]!.x);
    }
    // Crossed the belt lane (east edge is world x=232) instead of pinning
    // at the tree line, felling wood behind it.
    expect(maxX).toBeGreaterThan(232);
    expect(felled.length).toBeGreaterThan(0);
    for (const fid of felled) expect(damage.trees[fid]).toBe("toppled");
    const parked = (units.children[0] as THREE.Group).position.clone();
    movement.resnap();
    expect((units.children[0] as THREE.Group).position.x).toBeCloseTo(parked.x, 9);
    expect((units.children[0] as THREE.Group).position.z).toBeCloseTo(parked.z, 9);
    movement.dispose();
  });

  it("still routes ordered hulls around tree belts to arrive", () => {
    // Pathfinding still prefers open ground (endpoint snap + smoothed
    // keepout legs): an ordered stump detours around the belt and arrives.
    // Corner arcs may graze a trunk on the way — wood never pins, so the
    // order completes either way.
    const w = 40;
    const h = 24;
    const heights = new Uint8Array(w * h).fill(100);
    const features = new Uint16Array(w * h).fill(0xffff);
    for (let z = 8; z <= 15; z++) {
      for (let x = 5; x < w - 5; x++) features[z * w + x] = 0;
    }
    const field = { width: w, height: h, heights, seaLevel: 0, features };
    const ex = { v: 1 };
    const units = rampGroup();
    (units.children[0] as THREE.Group).position.set(-280, 100, -8);
    const routes: RoutePoint[][] = [[{ x: -280, z: -8 }, { x: -280, z: -8 }]];
    const movement = new UnitMovement(units, routes, rampEnv(field, ex), field);
    movement.orderUnit(0, { x: 280, z: -8 });
    for (let n = 0; n < 7200; n++) movement.update(1 / 60);
    expect(movement.hasOrder(0)).toBe(false);
    // Re-seats sit the body exactly on the mover (no tremble on re-seat).
    const parked = movement.moverState(0)!;
    movement.resnap();
    expect((units.children[0] as THREE.Group).position.x).toBe(parked.x);
    expect((units.children[0] as THREE.Group).position.z).toBe(parked.z);
    movement.dispose();
  });
});

describe("drive locomotion", () => {
  function flatMap(): TNTMap {
    const width = 32;
    const height = 32;
    return {
      width,
      height,
      heights: new Uint8Array(width * height).fill(100),
      units: [
        { kind: "commander", cellX: 8, cellZ: 8, rotation: 0 },
        { kind: "stump", cellX: 20, cellZ: 20, rotation: 0 },
      ],
    } as unknown as TNTMap;
  }

  it("spins wheels and strides legs while driving, settling at rest", () => {
    const map = flatMap();
    const group = buildUnits(map, 1);
    // Straight +Z legs from the live anchors so both hulls drive at speed.
    const routes: RoutePoint[][] = group.children.map((child) => {
      const p = (child as THREE.Group).position;
      return [
        { x: p.x, z: p.z },
        { x: p.x, z: p.z + 400 },
        { x: p.x + 400, z: p.z + 400 },
        { x: p.x + 400, z: p.z },
      ];
    });
    const movement = new UnitMovement(group, routes, { groundY: () => 100 });
    const walker = group.children[0] as THREE.Group;
    const tank = group.children[1] as THREE.Group;
    for (let n = 0; n < 120; n++) movement.update(1 / 60);
    // Tracked hulls roll: ~80u at radius 4 reads ~20 rad of spin.
    for (const wheel of getWheels(tank)) expect(wheel.rotation.x).toBeGreaterThan(10);
    // The walker strides at full amplitude with phase advanced by the road.
    expect((walker.userData as { amp?: number }).amp).toBe(1);
    expect((walker.userData as { gait?: number }).gait).toBeGreaterThan(0);
    // Park both hulls where they stand: orders complete, patrol holds.
    group.children.forEach((_, i) => {
      const m = movement.moverState(i)!;
      movement.orderUnit(i, { x: m.x, z: m.z });
    });
    for (let n = 0; n < 10; n++) movement.update(1 / 60);
    expect(movement.hasOrder(0)).toBe(false);
    expect(movement.hasOrder(1)).toBe(false);
    const parkedSpin = getWheels(tank)[0]!.rotation.x;
    for (let n = 0; n < 120; n++) movement.update(1 / 60);
    // Held hulls never roll: wheels frozen, legs back to neutral.
    expect(getWheels(tank)[0]!.rotation.x).toBeCloseTo(parkedSpin, 10);
    expect((walker.userData as { amp?: number }).amp).toBe(0);
    for (const leg of getLegs(walker)) {
      expect(leg.rotation.x).toBeCloseTo(0, 10);
      expect(leg.position.y).toBeCloseTo(14, 10);
    }
    movement.dispose();
  });
});

describe("UnitMovement wrecks", () => {
  it("freezes destroyed hulls in place while the living drive on", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    expect(movement.isDestroyed(0)).toBe(false);
    movement.markDestroyed(0);
    expect(movement.isDestroyed(0)).toBe(true);
    const wreck = (units.children[0] as THREE.Group).position.clone();
    const liveBefore = (units.children[1] as THREE.Group).position.clone();
    for (let n = 0; n < 120; n++) movement.update(1 / 60);
    // The wreck never moves (X/Z frozen; Y re-seats on the flat ground).
    expect((units.children[0] as THREE.Group).position.x).toBeCloseTo(wreck.x, 9);
    expect((units.children[0] as THREE.Group).position.z).toBeCloseTo(wreck.z, 9);
    // Its neighbour still patrols away.
    const travelled = (units.children[1] as THREE.Group).position.distanceTo(liveBefore);
    expect(travelled).toBeGreaterThan(0);
    movement.dispose();
  });

  it("refuses move orders for wrecks and fans groups around them", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    movement.markDestroyed(0);
    expect(movement.orderUnit(0, { x: 500, z: 500 })).toBe(false);
    expect(movement.hasOrder(0)).toBe(false);
    // Group orders skip the wreck: one live hull, one issued order.
    expect(movement.orderGroup([0, 1], { x: 500, z: 500 })).toBe(1);
    expect(movement.hasOrder(0)).toBe(false);
    expect(movement.hasOrder(1)).toBe(true);
    // Re-marking is idempotent, unknown indices are a no-op.
    movement.markDestroyed(0);
    movement.markDestroyed(99);
    expect(movement.isDestroyed(0)).toBe(true);
    expect(movement.isDestroyed(1)).toBe(false);
    movement.dispose();
  });

  it("registers HQ reinforcements mid-battle on a hall-to-staging patrol", () => {
    const units = makeGroup();
    const rs = routes();
    const movement = new UnitMovement(units, rs, { groundY: () => 100 });
    expect(movement.unitCount).toBe(2);
    const idx = movement.addUnit(900, 100, Math.PI / 2, [{ x: 900, z: 100 }, { x: 600, z: 100 }], "stump");
    expect(idx).toBe(2);
    expect(movement.unitCount).toBe(3);
    expect(movement.kindAt(2)).toBe("stump");
    expect(movement.teamAt(2)).toBeUndefined();
    const mover = movement.moverState(2)!;
    expect(mover.x).toBe(900);
    expect(mover.z).toBe(100);
    // The release drives its patrol leg (toward staging) on the next ticks.
    const body = new THREE.Group();
    body.position.set(900, 100, 100);
    units.add(body);
    for (let n = 0; n < 600; n++) movement.update(1 / 60);
    const driven = movement.moverState(2)!;
    expect(Math.hypot(driven.x - 900, driven.z - 100)).toBeGreaterThan(50);
    expect(units.children.length).toBe(3);
    movement.dispose();
  });
});
