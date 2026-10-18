import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  FORMATION_MIN_SEPARATION,
  HULL_TURN_RATE,
  createDamageField,
  isWalkable,
  pathWorldToCell,
  sampleHeightBilinear,
  seatHull,
  STUN_MAX_DURATION,
  THREAT_MEMORY_DURATION,
  worldHeight,
  yawToTarget,
  type RoutePoint,
  type TNTMap,
  type UnitKind,
} from "@scorched-3d/core";
import { UnitMovement } from "./movement";
import { hqExitWorld, hqFacingFor, hqSpawnWorld, hqStagingRoute } from "./hq";
import { buildUnits, getLegs, getWheels } from "./units";

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
    expect(movement.moverState(0)!.stun).toBeCloseTo(STUN_MAX_DURATION, 9);
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

  it("recoils a hit hull away from the blast — wrecks refuse", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    // Hull 0 sits at (0, 0) yawed 0; a blast 30 ahead (+Z) recoils it back (−Z).
    movement.stunUnit(0, 0.16, 0, 30);
    const struck = movement.moverState(0)!;
    expect(struck.stun).toBeCloseTo(STUN_MAX_DURATION, 9);
    expect(struck.recoil).toBeDefined();
    expect(struck.recoil!.z).toBeLessThan(0);
    // Mid-beat ticks slide the mover and the posed body away from the blast
    // while the clock drains (half the snappy beat, still recoiling).
    for (let n = 0; n < 13; n++) movement.update(1 / 60);
    const sliding = movement.moverState(0)!;
    expect(sliding.stun).toBeGreaterThan(0);
    expect(sliding.stun).toBeLessThan(struck.stun!);
    expect(sliding.z).toBeLessThan(0);
    expect(sliding.x).toBeCloseTo(0, 9);
    expect((units.children[0] as THREE.Group).position.z).toBeLessThan(0);
    // Past the beat both keys drop and the drive resumes from the new spot.
    for (let n = 0; n < 30; n++) movement.update(1 / 60);
    const free = movement.moverState(0)!;
    expect(free.stun).toBeUndefined();
    expect(free.recoil).toBeUndefined();
    // A miss with a blast pin is still a no-op (no keys appear).
    movement.stunUnit(1, 0, 600, 630);
    expect(movement.moverState(1)!.stun).toBeUndefined();
    expect(movement.moverState(1)!.recoil).toBeUndefined();
    // Wrecks refuse the recoil and stay frozen.
    movement.markDestroyed(0);
    const seat = { x: free.x, z: free.z };
    movement.stunUnit(0, 0.16, seat.x, seat.z + 30);
    expect(movement.moverState(0)!.stun).toBeUndefined();
    expect(movement.moverState(0)!.recoil).toBeUndefined();
    movement.update(1 / 60);
    expect(movement.moverState(0)!.x).toBe(seat.x);
    expect(movement.moverState(0)!.z).toBe(seat.z);
    movement.dispose();
  });

  it("drives ordered units to their target and resumes patrol on arrival", () => {
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
    // Arrival rejoins the patrol loop instead of parking: the mover drives
    // its frozen leg again (leg 1 heads +Z from the route start).
    const arrived = movement.moverState(0)!;
    expect(arrived.hold).not.toBe(true);
    for (let n = 0; n < 120; n++) movement.update(1 / 60);
    const resumed = movement.moverState(0)!;
    expect(Math.hypot(resumed.x - arrived.x, resumed.z - arrived.z)).toBeGreaterThan(0);
    expect(body.position.x).toBe(resumed.x);
    expect(body.position.z).toBe(resumed.z);
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
    // Freeze both hulls where they stand (wrecks hold forever — arrival
    // resumes patrol now, so self-orders no longer park a hull).
    group.children.forEach((_, i) => movement.markDestroyed(i));
    for (let n = 0; n < 10; n++) movement.update(1 / 60);
    expect(movement.isDestroyed(0)).toBe(true);
    expect(movement.isDestroyed(1)).toBe(true);
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

  it("walks HQ releases straight out of the hall, then off the lane for good", () => {
    const units = makeGroup();
    const rs = routes();
    const movement = new UnitMovement(units, rs, { groundY: () => 100 });
    const anchor = { x: -1000, z: 0 };
    const spawn = hqSpawnWorld(anchor, hqFacingFor(0));
    const exit = hqExitWorld(anchor, hqFacingFor(0));
    const staging = hqStagingRoute(exit, hqFacingFor(0), 1);
    const idx = movement.addUnit(spawn.x, spawn.z, Math.PI / 2, staging.loop, "stump", staging.leadIn);
    const body = new THREE.Group();
    body.position.set(spawn.x, 100, spawn.z);
    units.add(body);
    // The release seeds at the door on a one-shot departure, joining the
    // nearest loop point after — never a loop leg back into the hall.
    expect(movement.moverState(idx)!.leg).toBe(0);
    expect(movement.moverState(idx)!.leadIn).toEqual(staging.leadIn);
    let joined = false;
    let staged = false;
    let closestToFar = Infinity;
    let minOffLaneAfterJoin = Infinity;
    for (let n = 0; n < 2400; n++) {
      movement.update(1 / 60);
      const m = movement.moverState(idx)!;
      if (!m.leadIn) joined = true;
      if (joined && Math.abs(m.z - exit.z) > 80) staged = true;
      if (!joined) {
        // Still on the departure: inside the hall the drive holds the
        // centerline instead of bending off-lane through the curb wall.
        if (m.x < exit.x) expect(Math.abs(m.z - exit.z)).toBeLessThan(5);
      } else {
        // Joined the loop: past the mouth for good, and the departure
        // never repeats or returns to the door.
        expect(m.x, `tick ${n} stays past the mouth`).toBeGreaterThan(exit.x);
        expect(m.leadIn, `tick ${n} stays joined`).toBeUndefined();
        // Once veered off, the loop never comes back within the road edge
        // plus a full spacing stop.
        if (staged) minOffLaneAfterJoin = Math.min(minOffLaneAfterJoin, Math.abs(m.z - exit.z));
      }
      closestToFar = Math.min(
        closestToFar,
        Math.hypot(m.x - staging.loop[1]!.x, m.z - staging.loop[1]!.z),
      );
    }
    expect(joined).toBe(true);
    expect(staged).toBe(true);
    expect(closestToFar).toBeLessThan(40);
    expect(minOffLaneAfterJoin).toBeGreaterThan(52);
    expect(minOffLaneAfterJoin).toBeLessThan(160);
    movement.dispose();
  });

  it("keeps the exit road clear with a full cap of staged releases", () => {
    // Four releases at realistic cadence, alternating sides like the canvas:
    // with the old on-lane far point every hull re-entered the road twice
    // per cycle and the road sat occupied ~95% of the time. Staged loops
    // live off the lane now, so once every release has exited, the road
    // stays empty and the entrance approach stays passable.
    const units = new THREE.Group();
    units.userData.units = [];
    const movement = new UnitMovement(units, [], { groundY: () => 100 });
    const anchor = { x: -1000, z: 0 };
    const facing = hqFacingFor(0);
    const spawn = hqSpawnWorld(anchor, facing);
    const exit = hqExitWorld(anchor, facing);
    const kinds = ["flash", "stump", "hammer", "peewee"] as const;
    const releaseAt = [0, 20, 45, 70];
    const dt = 1 / 60;
    let released = 0;
    let roadTicks = 0;
    let windowTicks = 0;
    const indices: number[] = [];
    for (let t = 0; t < 170; t += dt) {
      if (released < kinds.length && t >= releaseAt[released]!) {
        const staging = hqStagingRoute(exit, facing, released % 2 === 0 ? 1 : -1);
        const idx = movement.addUnit(spawn.x, spawn.z, Math.PI / 2, staging.loop, kinds[released]!, staging.leadIn);
        const body = new THREE.Group();
        body.position.set(spawn.x, 100, spawn.z);
        units.add(body);
        (units.userData.units as unknown[]).push({ kind: kinds[released], team: 0 });
        indices.push(idx);
        released++;
      }
      movement.update(dt);
      // Past the exit window every release has joined its loop: the road
      // (hall + graded lane, hull half-width included) must sit empty.
      if (t > 100) {
        windowTicks++;
        const pos = movement.positions();
        const onRoad = pos.some(
          (p) => Math.abs(p.z - exit.z) < 52 && p.x > exit.x - 130 && p.x < exit.x + 340,
        );
        if (onRoad) roadTicks++;
      }
    }
    expect(released).toBe(4);
    for (const idx of indices) expect(movement.moverState(idx)!.leadIn).toBeUndefined();
    expect(roadTicks / windowTicks).toBeLessThan(0.05);
    movement.dispose();
  });

  it("walks a release under fire all the way to staging instead of parking at the door", () => {
    // The real-game failure behind two "fixed" road tasks: a fresh release
    // acquires a team-advance memory same-tick (its side already knows the
    // enemy), and alone at the base the odds at the far contact read
    // unwinnable — so the outnumbered hold parked it at the spawn, then
    // (once the exit drove first) at the mouth join, blocking the entrance
    // until the next release spawned beside it. The departure completes AT
    // the loop now, so the exit always reaches staging before any hold.
    const units = new THREE.Group();
    units.userData.units = [];
    const anchor = { x: -1000, z: 0 };
    const facing = hqFacingFor(0);
    const spawn = hqSpawnWorld(anchor, facing);
    const exit = hqExitWorld(anchor, facing);
    // Two enemies clustered past the release's own notice (it never sees
    // them itself — the side's shared intel is what reaches it), frozen on
    // empty routes so the odds never shift under the test.
    const placed = units.userData.units as { kind: UnitKind; team: 0 | 1 }[];
    const bodies: [number, number, UnitKind, 0 | 1][] = [
      [spawn.x + 700, spawn.z, "flash", 0], // spotter: shares the sighting
      [spawn.x + 1250, spawn.z, "flash", 1], // enemy pair at the contact
      [spawn.x + 1280, spawn.z + 30, "stump", 1],
    ];
    for (const [x, z, kind, team] of bodies) {
      const body = new THREE.Group();
      body.position.set(x, 100, z);
      units.add(body);
      placed.push({ kind, team });
    }
    const movement = new UnitMovement(units, [[], [], []], { groundY: () => 100 });
    const staging = hqStagingRoute(exit, facing, 1);
    const idx = movement.addUnit(spawn.x, spawn.z, Math.PI / 2, staging.loop, "stump", staging.leadIn);
    const releaseBody = new THREE.Group();
    releaseBody.position.set(spawn.x, 100, spawn.z);
    units.add(releaseBody);
    placed.push({ kind: "stump", team: 0 });
    // The frozen cast never moves: the spotter keeps its 700-unit gap (the
    // release reads alone) and the enemy pair keeps the contact hot.
    const near = staging.loop[0]!;
    let sawAdvanceDuringExit = false;
    let minDistToStaging = Infinity;
    for (let n = 0; n < 1800; n++) {
      movement.update(1 / 60);
      const m = movement.moverState(idx)!;
      if (m.leadIn && m.threat?.attacker === -1) sawAdvanceDuringExit = true;
      const p = movement.positions()[idx]!;
      minDistToStaging = Math.min(minDistToStaging, Math.hypot(p.x - near.x, p.z - near.z));
    }
    // The test armed the real-game override (an advance memory live during
    // the exit) — without it the assertions below would pass vacuously.
    expect(sawAdvanceDuringExit).toBe(true);
    // And the exit still reached staging instead of parking at the door.
    expect(movement.moverState(idx)!.leadIn).toBeUndefined();
    expect(minDistToStaging).toBeLessThan(60);
    movement.dispose();
  });
});

describe("UnitMovement sweep efficiency", () => {
  function makeTeamed(): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 10, cellZ: 10, rotation: 0, team: 0 },
      { kind: "stump", cellX: 40, cellZ: 40, rotation: Math.PI, team: 1 },
    ];
    const starts = [new THREE.Vector3(0, 100, 0), new THREE.Vector3(500, 120, 300)];
    group.userData.units.forEach((u: { rotation: number }, i: number) => {
      const body = new THREE.Group();
      body.rotation.y = u.rotation;
      body.position.copy(starts[i]!);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    });
    return group;
  }

  it("queries live HQ positions once per sweep, not once per hull", () => {
    // Hot-loop sweep: the assault pass used to call the HQ provider per
    // hull; the sweep now resolves forts once and shares them.
    const units = makeTeamed();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    let calls = 0;
    movement.setHqProvider(() => {
      calls++;
      return [
        { x: -1500, z: 0, team: 0 },
        { x: 1500, z: 0, team: 1 },
      ];
    });
    movement.sweepHunt();
    expect(calls).toBe(1);
    movement.sweepHunt();
    expect(calls).toBe(2);
    movement.dispose();
  });

  it("hands its pre-tick snapshot (sides, live flags, health) to the drive", () => {
    const units = makeTeamed();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    movement.setDamage([0.25, 0.5]);
    movement.markDestroyed(1);
    const snapshot = movement.sweepHunt();
    expect(snapshot.teams).toEqual([0, 1]);
    expect(snapshot.alive).toEqual([true, false]);
    // Remaining health: the living hull at 1 - damage, the wreck at zero.
    expect(snapshot.hp).toEqual([0.75, 0]);
    movement.dispose();
  });

  it("reads no damage as unknown health and empty rosters as empty", () => {
    const units = makeTeamed();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    expect(movement.sweepHunt().hp).toBeNull();
    movement.dispose();
    const empty = new UnitMovement(new THREE.Group(), [], { groundY: () => 100 });
    expect(empty.sweepHunt()).toEqual({ teams: [], alive: [], hp: null });
    empty.dispose();
  });
});

describe("isMoving", () => {
  it("reads patrol-driving hulls as moving once they displace", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    // Before the first tick nothing has displaced yet.
    expect(movement.isMoving(0)).toBe(false);
    expect(movement.isMoving(1)).toBe(false);
    expect(movement.isMoving(99)).toBe(false);
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    expect(movement.isMoving(0)).toBe(true);
    expect(movement.isMoving(1)).toBe(true);
    expect(movement.isMoving(99)).toBe(false);
    movement.dispose();
  });

  it("reads ordered hulls as moving while they drive", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    // Hull 0 sits at the origin: order it 400 east (no field, direct leg).
    expect(movement.orderUnit(0, { x: 400, z: 0 })).toBe(true);
    movement.update(1 / 60);
    expect(movement.hasOrder(0)).toBe(true);
    expect(movement.isMoving(0)).toBe(true);
    movement.dispose();
  });

  it("reads stunned hulls as stationary even mid-recoil-slide", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    // Hull 0 sits at (0, 0); a blast 30 ahead recoils it back mid-beat.
    movement.stunUnit(0, 0.16, 0, 30);
    for (let n = 0; n < 13; n++) movement.update(1 / 60);
    const sliding = movement.moverState(0)!;
    expect(sliding.stun).toBeGreaterThan(0);
    // The hull genuinely displaced — and still reads stationary: recoil
    // is involuntary, never driving.
    expect(sliding.z).toBeLessThan(0);
    expect(movement.isMoving(0)).toBe(false);
    // The unstunned patrol mate reads moving as the control.
    expect(movement.isMoving(1)).toBe(true);
    movement.dispose();
  });

  it("reads wrecks as stationary", () => {
    const units = makeGroup();
    const movement = new UnitMovement(units, routes(), { groundY: () => 100 });
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    expect(movement.isMoving(0)).toBe(true);
    movement.markDestroyed(0);
    movement.update(1 / 60);
    expect(movement.isMoving(0)).toBe(false);
    expect(movement.isMoving(1)).toBe(true);
    movement.dispose();
  });

  it("reads slope-pinned hulls as stationary", () => {
    // Cliff field: flat 100 west of x=20, plateau 200 east — the drive
    // clamp pins the hull at the wall while it keeps turning.
    const w = 40;
    const h = 24;
    const heights = new Uint8Array(w * h).fill(100);
    for (let z = 0; z < h; z++) {
      for (let x = 20; x < w; x++) heights[z * w + x] = 200;
    }
    const field = { width: w, height: h, heights, seaLevel: 0 };
    const env = {
      groundY: (x: number, z: number) => worldHeight(sampleHeightBilinear(field, x, z), 1),
      seat: (x: number, z: number, hull: number, kind: UnitKind) => seatHull(field, kind, x, z, hull, 1),
    };
    const group = new THREE.Group();
    group.userData.units = [{ kind: "stump", cellX: 10, cellZ: 10, rotation: 0 }];
    const body = new THREE.Group();
    body.rotation.y = 0;
    body.position.set(-200, 0, 0);
    group.add(body);
    const movement = new UnitMovement(group, [[{ x: -200, z: 0 }, { x: 400, z: 0 }]], env, field);
    // An order into the wall: patrol would skip the leg past patience, but
    // orders hold their ground, so the hull pins at the cliff forever.
    expect(movement.orderUnit(0, { x: 400, z: 0 })).toBe(true);
    // Still approaching the wall: genuinely displacing.
    for (let n = 0; n < 30; n++) movement.update(1 / 60);
    expect(movement.isMoving(0)).toBe(true);
    // Pinned at the wall: ticks pass, X/Z never move again.
    for (let n = 0; n < 1200; n++) movement.update(1 / 60);
    const cliffX = (20 - (w - 1) / 2) * 16;
    const pinned = movement.moverState(0)!;
    expect(pinned.x).toBeLessThan(cliffX);
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    expect(movement.moverState(0)!.x).toBe(pinned.x);
    expect(movement.moverState(0)!.z).toBe(pinned.z);
    expect(movement.isMoving(0)).toBe(false);
    movement.dispose();
  });
});

describe("UnitMovement hull yaw continuity", () => {
  it("never snaps body yaw through patrol corners, orders, pursuit, and stuns", () => {
    // End-to-end pin: whatever the sweep and the drive decide — leg
    // switches, cross-map orders, hunt acquisitions, separation jostles,
    // recoil beats — the posed body yaw must evolve through the traverse
    // cap every tick, never snap.
    const specs: { kind: UnitKind; team: 0 | 1; x: number; z: number; rot: number }[] = [
      { kind: "flash", team: 0, x: 0, z: 0, rot: 0 },
      { kind: "stump", team: 0, x: 60, z: 0, rot: 0 },
      { kind: "flash", team: 1, x: 400, z: 200, rot: Math.PI },
      { kind: "hammer", team: 1, x: 460, z: 200, rot: Math.PI },
    ];
    const group = new THREE.Group();
    group.userData.units = specs.map((s, n) => ({
      kind: s.kind,
      cellX: n + 1,
      cellZ: n + 1,
      rotation: s.rot,
      team: s.team,
    }));
    for (const s of specs) {
      const body = new THREE.Group();
      body.rotation.y = s.rot;
      body.position.set(s.x, 100, s.z);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    const loops: RoutePoint[][] = specs.map((s) => [
      { x: s.x, z: s.z },
      { x: s.x, z: s.z + 400 },
      { x: s.x + 400, z: s.z + 400 },
      { x: s.x + 400, z: s.z },
    ]);
    const movement = new UnitMovement(group, loops, { groundY: () => 100 });
    // Cross orders through each other (separation jostles guaranteed).
    movement.orderUnit(0, { x: 800, z: 400 });
    movement.orderUnit(2, { x: -400, z: -200 });
    const dt = 1 / 60;
    const prev = specs.map((s) => s.rot);
    const worst = specs.map(() => 0);
    for (let n = 0; n < 900; n++) {
      if (n === 300) movement.stunUnit(1, 0.5, 60, 50);
      movement.update(dt);
      group.children.forEach((child, i) => {
        const yaw = (child as THREE.Group).rotation.y;
        const d = Math.abs(Math.atan2(Math.sin(yaw - prev[i]!), Math.cos(yaw - prev[i]!)));
        if (d > worst[i]!) worst[i] = d;
        prev[i] = yaw;
      });
    }
    specs.forEach((s, i) => {
      const cap = (HULL_TURN_RATE[s.kind] ?? 1.5) * dt;
      expect(worst[i]).toBeLessThanOrEqual(cap + 1e-9);
    });
    // Vacuity guard: the run actually turned hulls (corners + pursuit).
    expect(Math.max(...worst)).toBeGreaterThan(0);
    movement.dispose();
  });
});

describe("attackGroup", () => {
  function makeDuel(): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 10, cellZ: 10, rotation: 0, team: 0 },
      { kind: "stump", cellX: 12, cellZ: 10, rotation: 0, team: 0 },
      { kind: "flash", cellX: 40, cellZ: 40, rotation: Math.PI, team: 1 },
    ];
    const starts = [
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(60, 100, 0),
      new THREE.Vector3(500, 100, 300),
    ];
    group.userData.units.forEach((u: { rotation: number }, i: number) => {
      const body = new THREE.Group();
      body.rotation.y = u.rotation;
      body.position.copy(starts[i]!);
      group.add(body);
    });
    return group;
  }

  function duelRoutes(): RoutePoint[][] {
    return [
      [
        { x: 0, z: 0 },
        { x: 0, z: 400 },
        { x: 400, z: 400 },
        { x: 400, z: 0 },
      ],
      [
        { x: 60, z: 0 },
        { x: 60, z: 400 },
        { x: 460, z: 400 },
        { x: 460, z: 0 },
      ],
      [
        { x: 500, z: 300 },
        { x: 500, z: 700 },
        { x: 900, z: 700 },
        { x: 900, z: 300 },
      ],
    ];
  }

  it("points hostile members at the enemy with ordered memories", () => {
    const units = makeDuel();
    const movement = new UnitMovement(units, duelRoutes(), { groundY: () => 100 });
    expect(movement.attackGroup([0, 1], 2)).toBe(2);
    for (const i of [0, 1]) {
      const state = movement.moverState(i)!;
      expect(state.threat).toMatchObject({ attacker: 2, ordered: true });
      expect(state.threat?.ttl).toBe(THREAT_MEMORY_DURATION);
      expect(movement.hasOrder(i)).toBe(false);
      expect(movement.isFighting(i)).toBe(true);
    }
    // The quarry keeps its own counsel — no memory lands on the target.
    expect(movement.moverState(2)!.threat).toBeUndefined();
    movement.dispose();
  });

  it("orders only hostile live members and refuses bad targets", () => {
    const units = makeDuel();
    const movement = new UnitMovement(units, duelRoutes(), { groundY: () => 100 });
    // Same-team members and the target itself sit out.
    expect(movement.attackGroup([0, 1, 2], 2)).toBe(2);
    expect(movement.attackGroup([0, 1], 1)).toBe(0);
    expect(movement.attackUnit(0, 0)).toBe(false);
    expect(movement.attackUnit(0, 9)).toBe(false);
    expect(movement.attackUnit(9, 2)).toBe(false);
    movement.markDestroyed(2);
    expect(movement.attackUnit(0, 2)).toBe(false);
    movement.dispose();
    // Unknown sides (unteamed headless groups) refuse: no team lines, no attack.
    const plain = makeGroup();
    const headless = new UnitMovement(plain, routes(), { groundY: () => 100 });
    expect(headless.attackGroup([0], 1)).toBe(0);
    headless.dispose();
  });

  it("clears any move order and is superseded by the next move order", () => {
    const units = makeDuel();
    const movement = new UnitMovement(units, duelRoutes(), { groundY: () => 100 });
    movement.orderUnit(0, { x: -300, z: -300 });
    expect(movement.hasOrder(0)).toBe(true);
    movement.attackGroup([0], 2);
    expect(movement.hasOrder(0)).toBe(false);
    expect(movement.moverState(0)!.threat?.ordered).toBe(true);
    movement.orderUnit(0, { x: -300, z: -300 });
    expect(movement.hasOrder(0)).toBe(true);
    expect(movement.moverState(0)!.threat).toBeUndefined();
    movement.dispose();
  });

  it("refreshes the order every sweep so it never expires mid-chase", () => {
    const units = makeDuel();
    // The quarry holds its ground (a single-point route never steps), so the
    // closing distance reads the pursuit instead of a same-speed footrace.
    const held = duelRoutes();
    held[2] = [{ x: 500, z: 300 }];
    const movement = new UnitMovement(units, held, { groundY: () => 100 });
    movement.attackGroup([0], 2);
    // Thirteen sim-seconds: a plain 12 s grudge would have expired.
    for (let n = 0; n < 13; n++) movement.update(1);
    const state = movement.moverState(0)!;
    expect(state.threat?.attacker).toBe(2);
    expect(state.threat?.ordered).toBe(true);
    // Refreshed to full by the sweep, then ticked once by the drive.
    expect(state.threat?.ttl).toBeCloseTo(THREAT_MEMORY_DURATION - 1, 9);
    // And the hull actually closed on the quarry instead of patrolling.
    const at = movement.positions()[0]!;
    const foe = movement.positions()[2]!;
    expect(Math.hypot(foe.x - at.x, foe.z - at.z)).toBeLessThan(583);
    movement.dispose();
  });

  it("ends the order when the target dies and survives the quarry's own hits", () => {
    const units = makeDuel();
    const movement = new UnitMovement(units, duelRoutes(), { groundY: () => 100 });
    movement.attackGroup([0, 1], 2);
    // The quarry hits back: the drive holds its order through the fire.
    const foe = movement.positions()[2]!;
    movement.threatenUnit(0, 2, foe.x, foe.z);
    expect(movement.moverState(0)!.threat).toMatchObject({ attacker: 2, ordered: true });
    // The kill ends it: survivors stop guarding the corpse.
    movement.markDestroyed(2);
    movement.sweepHunt();
    expect(movement.moverState(0)!.threat).toBeUndefined();
    expect(movement.moverState(1)!.threat).toBeUndefined();
    movement.dispose();
  });
});
