import { describe, expect, it } from "vitest";
import { CELL_PIXELS } from "../terrain/types.js";
import { generateMap } from "../terrain/generate.js";
import { HULL_PIVOT_FLOOR, HULL_TURN_RATE, turnAuthority, yawToTarget } from "./facing.js";
import { THREAT_MEMORY_DURATION } from "./retaliation.js";
import {
  advanceMover,
  advanceMovers,
  ARRIVE_RADIUS,
  BLOCKED_SKIP_AFTER,
  cellFromWorld,
  groupSpeedCap,
  GRIP_FLOOR,
  hasOrder,
  holdMover,
  initMover,
  isMoverMoving,
  MOVE_SPEED,
  orderMover,
  ORDER_SPACING_FLOOR,
  planRoutes,
  predictDrivenPath,
  ROUTE_WAYPOINTS,
  sampleGround,
  separationVector,
  SEPARATION_COAST_DISTANCE,
  SEPARATION_RADIUS,
  SEPARATION_SIDESTEP,
  SEPARATION_SPEED,
  SLOW_SCALE,
  spacingScale,
  STOP_RADIUS,
  stunMover,
  worldFromCell,
  type CrushContext,
  type Mover,
  type RoutePoint,
} from "./movement.js";
import { addScorchMark, BLAST_RADIUS, createDamageField, type DamageField } from "./destruction.js";
import {
  IMPACT_MAX_SHOVE,
  impactKick,
  STUN_MAX_DURATION,
  STUN_PER_DAMAGE,
} from "./impact.js";
import { findWorldPath, isWalkable } from "./pathfinding.js";
import type { SeatField } from "./terrain.js";
import { CRUSH_DRAG, TREE_DRAG, featureDrag, trunkBlockedAt } from "./terrain.js";
import { UNIT_KINDS } from "./types.js";

const PRESETS = ["greenreach", "archipelago", "highpass", "caldera", "rivercross", "dustplains"] as const;
const SEEDS = [1, 7, 0xa11ce, 123456];

function flatRoute(len = 400): RoutePoint[] {
  return [
    { x: 0, z: 0 },
    { x: 0, z: len },
    { x: len, z: len },
    { x: len, z: 0 },
  ];
}

describe("planRoutes", () => {
  it("plans one looping route per unit, deterministically per seed", () => {
    for (const preset of PRESETS) {
      const map = generateMap(preset, 42);
      const a = planRoutes(map, map.units, 42);
      const b = planRoutes(map, map.units, 42);
      expect(a).toEqual(b);
      expect(a).toHaveLength(map.units.length);
      for (const route of a) expect(route).toHaveLength(ROUTE_WAYPOINTS);
    }
  });

  it("anchors waypoint 0 at the unit spawn", () => {
    const map = generateMap("greenreach", 9);
    const routes = planRoutes(map, map.units, 9);
    map.units.forEach((u, i) => {
      const spawn = worldFromCell(map, u.cellX, u.cellZ);
      expect(routes[i]![0]!.x).toBeCloseTo(spawn.x);
      expect(routes[i]![0]!.z).toBeCloseTo(spawn.z);
    });
  });

  it("keeps every waypoint on dry, gentle, in-bounds ground", () => {
    for (const preset of PRESETS) {
      for (const seed of SEEDS) {
        const map = generateMap(preset, seed);
        const routes = planRoutes(map, map.units, seed);
        for (const route of routes) {
          for (const wp of route) {
            const { cellX, cellZ } = cellFromWorld(map, wp.x, wp.z);
            expect(cellX).toBeGreaterThanOrEqual(0);
            expect(cellX).toBeLessThan(map.width);
            expect(map.heights[cellZ * map.width + cellX]).toBeGreaterThan(map.seaLevel + 4);
            const h00 = map.heights[cellZ * map.width + cellX] ?? 0;
            const h10 = map.heights[cellZ * map.width + Math.min(map.width - 1, cellX + 1)] ?? 0;
            const h01 = map.heights[Math.min(map.height - 1, cellZ + 1) * map.width + cellX] ?? 0;
            expect(Math.max(h00, h10, h01) - Math.min(h00, h10, h01)).toBeLessThanOrEqual(15);
          }
        }
      }
    }
  });

  it("spreads waypoints so patrols actually travel", () => {
    const map = generateMap("greenreach", 7);
    const routes = planRoutes(map, map.units, 7);
    for (const route of routes) {
      const span = Math.max(
        ...route.map((wp) => Math.hypot(wp.x - route[0]!.x, wp.z - route[0]!.z)),
      );
      // Waypoints sit ≥12 cells apart, so non-degenerate loops span cells.
      expect(span).toBeGreaterThan(12 * 16 - ARRIVE_RADIUS);
    }
  });

  it("varies routes per seed without touching unit placement", () => {
    const map = generateMap("greenreach", 1);
    const a = JSON.stringify(planRoutes(map, map.units, 11));
    const b = JSON.stringify(planRoutes(map, map.units, 22));
    expect(a).not.toBe(b);
    // Same unit roster either way: routes read the field, never reseed it.
    expect(map.units).toEqual(generateMap("greenreach", 1).units);
  });
});

describe("advanceMover", () => {
  it("drives forward along the hull at per-kind speed when lined up", () => {
    // Hull 0 faces +Z; target straight ahead at +Z.
    for (const kind of UNIT_KINDS) {
      const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
      const next = advanceMover(kind, mover, flatRoute(), 1);
      expect(next.x).toBeCloseTo(0, 6);
      expect(next.z).toBeCloseTo(MOVE_SPEED[kind], 6);
      expect(next.hull).toBeCloseTo(0, 10);
    }
    // Fast scouts outrun slow guns.
    expect(MOVE_SPEED.flash).toBeGreaterThan(MOVE_SPEED.stump);
    expect(MOVE_SPEED.stump).toBeGreaterThan(MOVE_SPEED.commander);
    expect(MOVE_SPEED.commander).toBeGreaterThan(MOVE_SPEED.hammer);
  });

  it("never snaps the hull: one step respects the turn-rate cap", () => {
    // Dead-astern target: desired yaw PI away from hull 0.
    for (const kind of UNIT_KINDS) {
      const mover: Mover = { x: 0, z: 400, hull: 0, leg: 0 };
      const route: RoutePoint[] = [
        { x: 0, z: 400 },
        { x: 0, z: -400 },
      ];
      const dt = 0.05;
      const next = advanceMover(kind, mover, route, dt);
      expect(Math.abs(next.hull - mover.hull)).toBeLessThanOrEqual(
        (HULL_TURN_RATE[kind] ?? 2) * dt + 1e-9,
      );
      // Velocity stays along the hull (forward), never sideways to the goal.
      const stepX = next.x - mover.x;
      const stepZ = next.z - mover.z;
      const travel = Math.atan2(stepX, stepZ);
      expect(Math.abs(travel - next.hull)).toBeLessThan(1e-6);
    }
  });

  it("slows in turns (alignment grip) instead of cornering at full speed", () => {
    const straight: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    const turning: Mover = { x: 0, z: 400, hull: 0, leg: 0 };
    const route: RoutePoint[] = [
      { x: 0, z: 400 },
      { x: 0, z: -400 },
    ];
    const dt = 0.05;
    const fast = advanceMover("flash", straight, flatRoute(), dt);
    const slow = advanceMover("flash", turning, route, dt);
    const fastStep = Math.hypot(fast.x - straight.x, fast.z - straight.z);
    const slowStep = Math.hypot(slow.x - turning.x, slow.z - turning.z);
    expect(slowStep).toBeLessThan(fastStep * 0.6);
  });

  it("rotates to the next patrol waypoint on arrival, looping forever", () => {
    const route = flatRoute();
    let mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    const seen = new Set<number>();
    // Walk the whole loop twice: every leg index must be steered toward.
    for (let n = 0; n < 4000; n++) {
      seen.add(mover.leg);
      mover = advanceMover("flash", mover, route, 0.05);
      if (seen.size === route.length) break;
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("holds degenerate routes and non-positive dt without moving", () => {
    const mover: Mover = { x: 5, z: 5, hull: 1, leg: 0 };
    expect(advanceMover("stump", mover, [{ x: 5, z: 5 }], 0.05)).toEqual(mover);
    expect(advanceMover("stump", mover, flatRoute(), 0)).toEqual(mover);
    expect(advanceMover("stump", mover, flatRoute(), -1)).toEqual(mover);
  });

  it("rests on coincident-loop routes instead of dithering", () => {
    // Degenerate loops pad with spawn copies (see planRoutes): every leg is
    // already arrived, so the hull must rest — driving onto its own
    // position re-aims every tick and wanders (measured: 157u over 600
    // ticks). Real loops never trigger this (waypoints sit ≥12 cells
    // apart), so only coincident loops change.
    const route: RoutePoint[] = [
      { x: 100, z: 100 },
      { x: 100, z: 100 },
      { x: 100, z: 100 },
      { x: 100, z: 100 },
    ];
    let mover: Mover = { x: 100, z: 100, hull: 0, leg: 1 };
    for (let n = 0; n < 600; n++) {
      mover = advanceMover("stump", mover, route, 1 / 60);
    }
    expect(mover.x).toBe(100);
    expect(mover.z).toBe(100);
  });
});

describe("departure lead-in", () => {
  // HQ releases carry a one-shot departure point ahead of their patrol loop
  // (the straight walk out of the hall mouth) that joins the loop on
  // arrival instead of cycling back — a cyclic patrol alone cannot express
  // "lead in, then loop", and any on-lane loop waypoint gets revisited
  // every cycle, keeping staged hulls on the road forever.
  const LEAD = { x: 100, z: 0 };
  const LOOP: RoutePoint[] = [
    { x: 160, z: 96 },
    { x: 320, z: 96 },
  ];

  it("walks the via straight, then the join leg, clearing only at the loop", () => {
    let mover: Mover = { x: 0, z: 0, hull: Math.PI / 2, leg: 0, leadIn: { ...LEAD } };
    // Phase 1: the hull holds the straight exit line toward the via — it
    // never bends toward the off-lane loop point early (that veer would
    // grind through the hall curb wall).
    for (let n = 0; n < 30; n++) {
      mover = advanceMover("flash", mover, LOOP, 1 / 60);
      expect(Math.abs(mover.z)).toBeLessThan(5);
      expect(mover.leg).toBe(0);
      expect(mover.leadIn).toEqual(LEAD);
    }
    expect(mover.x).toBeGreaterThan(20);
    // Past the via the departure continues onto the join leg — it does NOT
    // clear at the mouth (a mouth join would hand pursuit a hull sitting on
    // the road, which parks there when the odds look bad).
    for (let n = 0; n < 300 && mover.x <= LEAD.x + 30; n++) {
      mover = advanceMover("flash", mover, LOOP, 1 / 60);
    }
    expect(mover.x).toBeGreaterThan(LEAD.x + 30);
    // The departure latches onto the join leg past the via (rewriting its
    // target to the loop point, so the phase can't flap back at the rim).
    expect(mover.leadIn).toEqual(LOOP[0]);
    // The hull veers onto the loop from the via, then clears AT staging.
    for (let n = 0; n < 600 && mover.leadIn; n++) {
      mover = advanceMover("flash", mover, LOOP, 1 / 60);
    }
    expect(mover.leadIn).toBeUndefined();
    expect(Math.hypot(mover.x - LOOP[0]!.x, mover.z - LOOP[0]!.z)).toBeLessThan(40);
    // And the loop itself cycles from there (the departure never repeats).
    let sawLeg1 = false;
    for (let n = 0; n < 2000; n++) {
      mover = advanceMover("flash", mover, LOOP, 1 / 60);
      if (mover.leg === 1) sawLeg1 = true;
      expect(mover.leadIn).toBeUndefined();
    }
    expect(sawLeg1).toBe(true);
  });

  it("drives the departure before pursuit steers, ticking the threat underneath", () => {
    // Splashed mid-exit: the hull keeps walking out of the hall (the exit
    // never waits for a chase), while the live threat ticks underneath so
    // the guns keep answering it — and pursuit steers the moment the hull
    // joins the loop.
    const threat = { attacker: 3, x: 0, z: 300, ttl: THREAT_MEMORY_DURATION };
    let mover: Mover = { x: 0, z: 0, hull: Math.PI / 2, leg: 0, leadIn: { ...LEAD }, threat };
    mover = advanceMover("flash", mover, LOOP, 1 / 60);
    // Steering holds the exit line (+X) instead of bending toward the
    // threat (+Z); the departure and the (ticked) threat both survive.
    expect(mover.x).toBeGreaterThan(0);
    expect(Math.abs(mover.z)).toBeLessThan(0.5);
    expect(mover.leadIn).toEqual(LEAD);
    expect(mover.threat?.attacker).toBe(3);
    expect(mover.threat?.ttl).toBeLessThan(THREAT_MEMORY_DURATION);
    // Past arrival the departure clears and pursuit steers the same tick:
    // the hull bends off the exit line toward the threat.
    for (let n = 0; n < 300 && mover.leadIn; n++) {
      mover = advanceMover("flash", mover, LOOP, 1 / 60);
    }
    expect(mover.leadIn).toBeUndefined();
    const joinedZ = mover.z;
    for (let n = 0; n < 60; n++) {
      mover = advanceMover("flash", mover, LOOP, 1 / 60);
    }
    expect(mover.z).toBeGreaterThan(joinedZ + 5);
    expect(mover.threat?.attacker).toBe(3);
  });

  it("walks an outnumbered departure out instead of holding for odds at the door", () => {
    // The real-game failure: a fresh release acquires a team-advance memory
    // same-tick, and alone at the base the odds at the far contact read
    // unwinnable — so the drive held it at the spawn (in the hall, on the
    // road) until the next release spawned beside it. The departure steers
    // ahead of pursuit now, so the exit completes and any odds-hold waits
    // until the hull has joined its loop.
    const foes = [
      { x: 0, z: 0 },
      { x: 0, z: 300 },
      { x: 30, z: 310 },
    ];
    const tactics = { self: 0, teams: [0, 1, 1], alive: [true, true, true] };
    const threat = { attacker: -1, x: 0, z: 300, ttl: THREAT_MEMORY_DURATION, leash: 3500 };
    // Control first: without a departure the same memory parks the hull —
    // the hold this test proves the exit escapes.
    let control: Mover = { x: 0, z: 0, hull: Math.PI / 2, leg: 0, threat: { ...threat } };
    for (let n = 0; n < 60; n++) {
      control = advanceMover("flash", control, LOOP, 1 / 60, 1, null, null, foes, tactics);
    }
    expect(Math.hypot(control.x, control.z)).toBeLessThan(1);
    expect(control.threat?.attacker).toBe(-1);
    // With the departure the hull walks all the way to staging instead —
    // veering off the exit line onto the loop, where any odds-hold waits
    // off the road instead of parking at the mouth.
    let mover: Mover = {
      x: 0,
      z: 0,
      hull: Math.PI / 2,
      leg: 0,
      leadIn: { ...LEAD },
      threat: { ...threat },
    };
    for (let n = 0; n < 600; n++) {
      mover = advanceMover("flash", mover, LOOP, 1 / 60, 1, null, null, foes, tactics);
    }
    expect(mover.leadIn).toBeUndefined();
    expect(Math.hypot(mover.x - LOOP[0]!.x, mover.z - LOOP[0]!.z)).toBeLessThan(60);
    expect(mover.z).toBeGreaterThan(40);
  });

  it("abandons a slope-pinned lead-in to patrol instead of grinding", () => {
    // The departure point sits past a wall: patrol patience applies, so the
    // hull drops the departure and joins its loop rather than pinning.
    const field = walledField();
    const z = 0;
    const route: RoutePoint[] = [
      { x: worldX(field, 14), z },
      { x: worldX(field, 10), z },
    ];
    let mover: Mover = {
      x: worldX(field, 14),
      z,
      hull: Math.PI / 2,
      leg: 0,
      leadIn: { x: worldX(field, 35), z },
    };
    const dt = 1 / 60;
    const ticks = Math.ceil(BLOCKED_SKIP_AFTER / dt) + 120;
    let maxX = mover.x;
    for (let n = 0; n < ticks; n++) {
      mover = advanceMover("stump", mover, route, dt, 1, field);
      maxX = Math.max(maxX, mover.x);
      const { cellX } = cellFromWorld(field, mover.x, mover.z);
      expect(cellX).toBeLessThan(16);
    }
    // Drove at the departure (up against the wall face) before abandoning.
    expect(maxX).toBeGreaterThan(worldX(field, 15));
    expect(mover.leadIn).toBeUndefined();
  });

  it("clears the lead-in on player orders and holds, but survives stuns", () => {
    const mover: Mover = { x: 0, z: 0, hull: Math.PI / 2, leg: 0, leadIn: { ...LEAD } };
    // A player order (or a hold) wins over the departure: no resurrection.
    const ordered = orderMover(mover, [{ x: 50, z: 50 }]);
    expect(hasOrder(ordered)).toBe(true);
    expect(ordered.leadIn).toBeUndefined();
    expect(holdMover(mover).leadIn).toBeUndefined();
    // A recoil beat only pauses the drive: the departure resumes after.
    // Start facing the loop point, so facing the departure reads as turning.
    const facingLoop: Mover = { ...mover, hull: yawToTarget(mover, LOOP[0]!) };
    const stunned = stunMover(facingLoop, 0.2);
    expect(stunned.leadIn).toEqual(LEAD);
    let faced = stunned;
    for (let n = 0; n < 10; n++) faced = advanceMover("flash", faced, LOOP, 1 / 60);
    expect(faced.leadIn).toEqual(LEAD);
    // ... and the recoiling hull turns toward the departure, not the loop.
    const wantLead = yawToTarget(stunned, LEAD);
    expect(Math.abs(faced.hull - wantLead)).toBeLessThan(Math.abs(stunned.hull - wantLead) - 0.01);
  });
});

describe("hit-stun hesitation", () => {
  it("stuns by dealt damage and leaves misses untouched", () => {
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    // A miss returns the move untouched (no stun key appears).
    expect(stunMover(mover, 0)).toEqual(mover);
    expect(stunMover(mover, -0.2)).toEqual(mover);
    // A flash point-blank chip hesitates a snappy mid-band beat; a hammer
    // point-blank hit lands the max beat.
    expect(stunMover(mover, 0.06).stun).toBeCloseTo(0.06 * STUN_PER_DAMAGE, 12);
    expect(stunMover(mover, 0.16).stun).toBe(STUN_MAX_DURATION);
  });

  it("refreshes re-hits under the cap instead of parking the hull", () => {
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1, stun: 0.2 };
    // A fading chip refreshed by a heavy lands the heavy's beat...
    expect(stunMover(mover, 0.16).stun).toBe(STUN_MAX_DURATION);
    // ...while a chip landing mid-heavy never shortens the clock.
    expect(stunMover({ ...mover, stun: STUN_MAX_DURATION }, 0.001).stun).toBe(
      STUN_MAX_DURATION,
    );
  });

  it("holds the drive while stunned, still turns, then resumes exactly", () => {
    const route = flatRoute();
    // Hull spun halfway around: it must turn back toward the leg, not drive.
    let mover: Mover = { x: 0, z: 0, hull: Math.PI, leg: 1, stun: 0.5 };
    const dt = 0.05;
    const turned = advanceMover("flash", mover, route, dt);
    expect(turned.x).toBe(0);
    expect(turned.z).toBe(0);
    expect(Math.abs(turned.hull - Math.PI)).toBeLessThan(Math.PI);
    expect(turned.hull).not.toBeCloseTo(Math.PI, 6);
    expect(turned.stun).toBeCloseTo(0.45, 12);
    expect(turned.leg).toBe(1);
    // Run out the clock: the key drops (not zero — absent, like `stuck`)
    // and the hull drives again.
    mover = turned;
    let ticks = 0;
    while (mover.stun !== undefined && ticks < 20) {
      mover = advanceMover("flash", mover, route, dt);
      ticks++;
    }
    expect(mover.stun).toBeUndefined();
    expect(ticks).toBeLessThanOrEqual(11);
    const parked = { x: mover.x, z: mover.z };
    mover = advanceMover("flash", mover, route, dt);
    expect(Math.hypot(mover.x - parked.x, mover.z - parked.z)).toBeGreaterThan(0);
  });

  it("freezes the order cursor while stunned (no waypoint skipping)", () => {
    let mover: Mover = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [
      { x: 0, z: 400 },
      { x: 400, z: 400 },
    ]);
    mover = stunMover(mover, 0.16);
    const at = mover.order!.at;
    const stepped = advanceMover("flash", mover, [], 0.05);
    expect(stepped.order!.at).toBe(at);
    expect(stepped.x).toBe(0);
    expect(stepped.z).toBe(0);
    expect(hasOrder(stepped)).toBe(true);
  });

  it("keeps a non-positive dt a pure no-op on stunned hulls", () => {
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1, stun: 0.5 };
    expect(advanceMover("flash", mover, flatRoute(), 0)).toBe(mover);
    expect(advanceMover("flash", mover, flatRoute(), -1)).toBe(mover);
  });

  it("still separates stunned hulls (the crowd jostles, drive stays held)", () => {
    const kinds = ["flash", "flash"] as const;
    const routes: RoutePoint[][] = [flatRoute(), flatRoute(600)];
    const movers: Mover[] = [
      { x: 0, z: 0, hull: 0, leg: 1, stun: 0.4 },
      { x: 0, z: 20, hull: 0, leg: 1 },
    ];
    const next = advanceMovers([...kinds], movers, routes, 0.05);
    // The pair opened past its 20-unit hold even though hull 0 never drove.
    const gap = Math.hypot(next[0]!.x - next[1]!.x, next[0]!.z - next[1]!.z);
    expect(gap).toBeGreaterThan(20);
    // And the stun clock still ticked down through the shove.
    expect(next[0]!.stun).toBeCloseTo(0.35, 12);
  });
});

describe("hit recoil", () => {
  it("recoils away from the blast over the beat, then resumes driving", () => {
    const route = flatRoute();
    // Blast 30 ahead (+Z) of a yaw-0 hull: the frontal shove pushes back (−Z).
    let mover = stunMover({ x: 0, z: 0, hull: 0, leg: 1 }, 0.16, { x: 0, z: 30 });
    expect(mover.stun).toBe(STUN_MAX_DURATION);
    const want = impactKick(0, 30, 0, 0, 0, 0.16);
    expect(mover.recoil!.x).toBeCloseTo(want.shoveX, 12);
    expect(mover.recoil!.z).toBeCloseTo(want.shoveZ, 12);
    expect(mover.recoil!.z).toBeLessThan(0);
    // Drain the whole beat: the hull ends displaced away from the blast by
    // the full shove, both keys drop, and the drive resumes from the new spot.
    const dt = 0.05;
    let ticks = 0;
    while (mover.stun !== undefined && ticks < 30) {
      mover = advanceMover("flash", mover, route, dt);
      ticks++;
    }
    expect(mover.stun).toBeUndefined();
    expect(mover.recoil).toBeUndefined();
    expect(mover.x).toBeCloseTo(want.shoveX, 9);
    expect(mover.z).toBeCloseTo(want.shoveZ, 9);
    const parked = { x: mover.x, z: mover.z };
    mover = advanceMover("flash", mover, route, dt);
    expect(Math.hypot(mover.x - parked.x, mover.z - parked.z)).toBeGreaterThan(0);
  });

  it("slides at constant velocity (half the beat, half the shove)", () => {
    const route = flatRoute();
    let mover = stunMover({ x: 0, z: 0, hull: 0, leg: 1 }, 0.16, { x: 0, z: 30 });
    const total = mover.recoil!.z;
    const half = STUN_MAX_DURATION / 2;
    mover = advanceMover("flash", mover, route, half);
    expect(mover.stun).toBeCloseTo(half, 12);
    expect(mover.x).toBeCloseTo(0, 12);
    expect(mover.z).toBeCloseTo(total / 2, 12);
    expect(mover.recoil!.z).toBeCloseTo(total / 2, 12);
    mover = advanceMover("flash", mover, route, half);
    expect(mover.stun).toBeUndefined();
    expect(mover.recoil).toBeUndefined();
    expect(mover.z).toBeCloseTo(total, 12);
  });

  it("leaves misses untouched and holds directionless hits in place", () => {
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    // Misses still return the mover untouched, even with a blast pin.
    expect(stunMover(mover, 0, { x: 0, z: 30 })).toEqual(mover);
    expect(stunMover(mover, -0.2, { x: 0, z: 30 })).toEqual(mover);
    // No blast, a non-finite blast, or a coincident overhead blast (no flank
    // to push along): the clock ticks but no slide is set, so X/Z hold.
    for (const blast of [undefined, null, { x: Number.NaN, z: 0 }, { x: 0, z: 0 }]) {
      const held = stunMover(mover, 0.16, blast);
      expect(held.stun).toBe(STUN_MAX_DURATION);
      expect(held.recoil).toBeUndefined();
      const stepped = advanceMover("flash", held, flatRoute(), 0.05);
      expect(stepped.x).toBe(0);
      expect(stepped.z).toBe(0);
      expect(stepped.stun).toBeCloseTo(STUN_MAX_DURATION - 0.05, 12);
    }
  });

  it("stacks re-hits under the shove cap and cancels opposing ones", () => {
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    // Two flank heavies stack but pin at the shared cap, never past it.
    let run = stunMover(mover, 0.16, { x: 30, z: 0 });
    run = stunMover(run, 0.16, { x: 30, z: 0 });
    expect(Math.hypot(run.recoil!.x, run.recoil!.z)).toBeLessThanOrEqual(
      IMPACT_MAX_SHOVE + 1e-9,
    );
    expect(run.recoil!.x).toBeCloseTo(-IMPACT_MAX_SHOVE, 9);
    expect(run.recoil!.z).toBeCloseTo(0, 9);
    // A matching hit from the far flank cancels the standing slide.
    const cancelled = stunMover(stunMover(mover, 0.16, { x: 30, z: 0 }), 0.16, { x: -30, z: 0 });
    expect(Math.abs(cancelled.recoil?.x ?? 0)).toBeLessThan(1e-9);
    expect(Math.abs(cancelled.recoil?.z ?? 0)).toBeLessThan(1e-9);
  });

  it("freezes the order cursor while recoiling (slide, don't drive)", () => {
    let mover: Mover = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [
      { x: 0, z: 400 },
      { x: 400, z: 400 },
    ]);
    mover = stunMover(mover, 0.16, { x: 0, z: 30 });
    const at = mover.order!.at;
    const stepped = advanceMover("flash", mover, [], 0.05);
    expect(stepped.order!.at).toBe(at);
    expect(hasOrder(stepped)).toBe(true);
    // ...but the hull still slid away from the blast (−Z).
    expect(stepped.z).toBeLessThan(0);
    expect(stepped.x).toBeCloseTo(0, 12);
  });

  it("absorbs the slide against a wall while the clock still ticks", () => {
    const field = walledField();
    // Hull near the ramp foot, blast due west: the full recoil points east
    // into the wall grade, so every slide step refuses and X/Z pin.
    const hx = worldX(field, 16) + 7;
    let mover = stunMover({ x: hx, z: 0, hull: 0, leg: 1 }, 0.16, { x: hx - 30, z: 0 });
    expect(mover.recoil!.x).toBeGreaterThan(0);
    const dt = 0.05;
    let ticks = 0;
    while (mover.stun !== undefined && ticks < 30) {
      mover = advanceMover("flash", mover, flatRoute(), dt, 1, field);
      expect(mover.x).toBe(hx);
      expect(mover.z).toBe(0);
      ticks++;
    }
    // The beat ran out (keys dropped) without ever entering the wall.
    expect(mover.stun).toBeUndefined();
    expect(mover.recoil).toBeUndefined();
  });

  it("degrades a diagonal slide to the open axis at a wall", () => {
    // Dry plateau with open water east of column 8; the hull sits 0.1 short
    // of the column-7 line, so east steps land unwalkable while north steps
    // stay on dry cells. (A walledField won't do: the column hugging the
    // ramp is itself unwalkable, refusing every axis at once.)
    const w = 12;
    const h = 12;
    const heights = new Uint8Array(w * h).fill(100);
    for (let z = 0; z < h; z++) {
      for (let x = 8; x < w; x++) heights[z * w + x] = 0;
    }
    const field: SeatField = { width: w, height: h, heights, seaLevel: 0 };
    // Blast to the southwest: the recoil points east-north, the east half
    // refuses at the water line, and the hull slides north only.
    const hx = worldX(field, 6) + 7.9;
    let mover = stunMover({ x: hx, z: 0, hull: 0, leg: 1 }, 0.16, { x: hx - 30, z: 30 });
    expect(mover.recoil!.x).toBeGreaterThan(0);
    expect(mover.recoil!.z).toBeLessThan(0);
    const north = mover.recoil!.z;
    mover = advanceMover("flash", mover, flatRoute(), 0.05, 1, field);
    expect(mover.x).toBe(hx);
    expect(mover.z).toBeLessThan(0);
    expect(mover.stun).toBeCloseTo(STUN_MAX_DURATION - 0.05, 12);
    // Drain the beat: the full north component lands, the east half absorbs.
    let ticks = 1;
    while (mover.stun !== undefined && ticks < 30) {
      mover = advanceMover("flash", mover, flatRoute(), 0.05, 1, field);
      expect(mover.x).toBe(hx);
      ticks++;
    }
    expect(mover.stun).toBeUndefined();
    expect(mover.recoil).toBeUndefined();
    expect(mover.z).toBeCloseTo(north, 9);
  });
});

describe("spacingScale", () => {
  const line = [
    { x: 0, z: 0 },
    { x: 500, z: 0 },
  ];

  it("stops inside stop radius so units never stack", () => {
    expect(spacingScale(0, [{ x: 0, z: 0 }, { x: 10, z: 0 }])).toBe(0);
  });

  it("crawls inside slow radius and runs free beyond it", () => {
    expect(spacingScale(0, line)).toBe(1);
    expect(spacingScale(0, [{ x: 0, z: 0 }, { x: 50, z: 0 }])).toBe(SLOW_SCALE);
  });

  it("holds the splash-aware gap: stops inside 48, crawls on the boundary", () => {
    // 40 sits inside every tank blast but outside the old 30 hold — the new
    // stop must refuse to close it, while exactly-on-48 still crawls (the
    // stop gate is strict, matching the blast boundary scoring zero).
    expect(spacingScale(0, [{ x: 0, z: 0 }, { x: 40, z: 0 }])).toBe(0);
    expect(spacingScale(0, [{ x: 0, z: 0 }, { x: STOP_RADIUS, z: 0 }])).toBe(SLOW_SCALE);
  });

  it("parks neighbours outside the heaviest bolt splash", () => {
    // Doctrine pin: the mutual stop clears every bolt blast (commander 48),
    // so a brawl shares hammer fringe at most — see STOP_RADIUS.
    expect(STOP_RADIUS).toBeGreaterThanOrEqual(BLAST_RADIUS.commander);
    expect(STOP_RADIUS).toBeGreaterThan(BLAST_RADIUS.stump);
    expect(STOP_RADIUS).toBeGreaterThan(BLAST_RADIUS.flash);
  });

  it("ignores the unit itself", () => {
    expect(spacingScale(0, [{ x: 0, z: 0 }])).toBe(1);
    expect(spacingScale(5, [{ x: 0, z: 0 }])).toBe(1);
  });
});

describe("advanceMovers", () => {
  it("separates stopped pairs instead of pinning them forever", () => {
    const kinds = ["flash", "stump", "hammer"] as const;
    const routes: RoutePoint[][] = [flatRoute(), flatRoute(600), flatRoute(900)];
    const movers: Mover[] = [
      { x: 0, z: 0, hull: 0, leg: 1 },
      // Second unit parked right ahead, inside the mutual spacing stop: the
      // old drive-only rule held both at scale 0 forever. Separation must
      // open the gap even though forward drive still refuses to close it.
      { x: 0, z: 20, hull: 0, leg: 1 },
      // Third unit far from the pair: free to patrol.
      { x: 900, z: 900, hull: Math.PI, leg: 3 },
    ];
    const before = Math.hypot(movers[0]!.x - movers[1]!.x, movers[0]!.z - movers[1]!.z);
    const next = advanceMovers([...kinds], movers, routes, 0.05);
    expect(next).toHaveLength(3);
    const after = Math.hypot(next[0]!.x - next[1]!.x, next[0]!.z - next[1]!.z);
    expect(after).toBeGreaterThan(before);
    // The pair opens radially (head-on on the Z line) while counter-stepping
    // sideways to open a passing lane — never mirrored, never purely axial.
    expect(next[0]!.z).toBeLessThan(0);
    expect(next[1]!.z).toBeGreaterThan(20);
    expect(next[0]!.x).toBeGreaterThan(0);
    expect(next[1]!.x).toBeLessThan(0);
    const travelled = Math.hypot(next[2]!.x - 900, next[2]!.z - 900);
    expect(travelled).toBeGreaterThan(0);
  });

  it("keeps degenerate dt a pure no-op (no separation shove)", () => {
    const kinds = ["flash", "stump"] as const;
    const movers: Mover[] = [
      { x: 0, z: 0, hull: 0, leg: 1 },
      { x: 0, z: 5, hull: 0, leg: 1 },
    ];
    const routes: RoutePoint[][] = [flatRoute(), flatRoute()];
    expect(advanceMovers([...kinds], movers, routes, 0)).toEqual(movers);
    expect(advanceMovers([...kinds], movers, routes, -1)).toEqual(movers);
  });
});

describe("world/cell helpers", () => {
  it("round-trips world and cell coordinates", () => {
    const map = generateMap("greenreach", 3);
    for (const u of map.units) {
      const w = worldFromCell(map, u.cellX, u.cellZ);
      expect(cellFromWorld(map, w.x, w.z)).toEqual({ cellX: u.cellX, cellZ: u.cellZ });
      expect(sampleGround(map, w.x, w.z)).toBe(map.heights[u.cellZ * map.width + u.cellX]);
    }
  });

  it("seeds movers at the spawn waypoint steering at leg 1", () => {
    const route = flatRoute();
    const m = initMover(route, 1.2);
    expect(m.x).toBe(route[0]!.x);
    expect(m.z).toBe(route[0]!.z);
    expect(m.hull).toBe(1.2);
    expect(m.leg).toBe(1);
  });
});

describe("separationVector", () => {
  it("pushes nothing when alone or beyond the radius", () => {
    expect(separationVector(0, [{ x: 0, z: 0 }])).toEqual({ x: 0, z: 0 });
    expect(separationVector(0, [{ x: 0, z: 0 }, { x: 500, z: 0 }])).toEqual({ x: 0, z: 0 });
    expect(separationVector(0, [{ x: 0, z: 0 }, { x: SEPARATION_RADIUS, z: 0 }])).toEqual({
      x: 0,
      z: 0,
    });
  });

  it("pushes along the pair axis with a sidestep, mirrored pair-wise", () => {
    // Neighbour 10 west of self: unit radial shove +x plus the sidestep
    // (perp of the away axis), at SEPARATION_SIDESTEP weight.
    const push = separationVector(0, [
      { x: 0, z: 0 },
      { x: -10, z: 0 },
    ]);
    expect(push.x).toBeCloseTo(1, 9);
    expect(push.z).toBeCloseTo(SEPARATION_SIDESTEP, 9);
    // The neighbour sees the exact negation: symmetric, deterministic, so
    // the pair counter-steps instead of mirroring into a backup loop.
    const mirror = separationVector(1, [
      { x: 0, z: 0 },
      { x: -10, z: 0 },
    ]);
    expect(mirror.x).toBeCloseTo(-push.x, 9);
    expect(mirror.z).toBeCloseTo(-push.z, 9);
  });

  it("splits coincident hulls along deterministic headings", () => {
    const pair = [
      { x: 7, z: -3 },
      { x: 7, z: -3 },
    ];
    const a = separationVector(0, pair);
    const b = separationVector(1, pair);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(1, 9);
    expect(Math.hypot(b.x, b.z)).toBeCloseTo(1, 9);
    // Repeatable: same indices, same headings.
    expect(separationVector(0, pair)).toEqual(a);
    expect(separationVector(1, pair)).toEqual(b);
  });
});

/** Flat, dry, gentle field: every cell walkable, so only spacing matters. */
function openField(): SeatField {
  const w = 64;
  const h = 64;
  return { width: w, height: h, heights: new Uint8Array(w * h).fill(100), seaLevel: 0 };
}

describe("adjacent-unit deadlock", () => {
  it("drives two adjacent ordered units to their goals (no permanent hold)", () => {
    const field = openField();
    const kinds = ["flash", "flash"] as const;
    let movers: Mover[] = [
      { x: -10, z: 0, hull: 0, leg: 0 },
      { x: 10, z: 0, hull: 0, leg: 0 },
    ];
    // Side-by-side pair ordered due north on parallel lanes: the old
    // drive-only rule read spacing 0 both ways and parked them forever.
    movers = [
      orderMover(movers[0]!, [{ x: -10, z: 400 }]),
      orderMover(movers[1]!, [{ x: 10, z: 400 }]),
    ];
    const routes: RoutePoint[][] = [[], []];
    const dt = 1 / 60;
    // Lanes 20 apart keep the pair inside each other's slow zone most of
    // the trip, so this needs a long horizon: what matters is continuous
    // progress to arrival, never a permanent hold.
    for (let n = 0; n < 2400; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    // Both arrived instead of grinding inside the stop radius.
    expect(hasOrder(movers[0]!)).toBe(false);
    expect(hasOrder(movers[1]!)).toBe(false);
    // Post-arrival the pair still un-stacks (empty routes, so nothing drives
    // on): the arrival slop (14) plus one separation-coast glide (8) past
    // the goal is the honest bound — the old arrival-slop-only bound held
    // with 0.48u of margin and pinned post-arrival stillness that separation
    // was never contracted to keep (the sibling already rests 33+ past).
    expect(movers[0]!.z).toBeGreaterThan(400 - ARRIVE_RADIUS - SEPARATION_COAST_DISTANCE);
    expect(movers[1]!.z).toBeGreaterThan(400 - ARRIVE_RADIUS - SEPARATION_COAST_DISTANCE);
  });

  it("opens coincident patrol hulls past the stop radius", () => {
    const field = openField();
    const kinds = ["stump", "stump"] as const;
    const routes: RoutePoint[][] = [flatRoute(), flatRoute(600)];
    let movers: Mover[] = [
      { x: 50, z: 50, hull: 0, leg: 1 },
      { x: 50, z: 50, hull: Math.PI, leg: 1 },
    ];
    const dt = 1 / 60;
    for (let n = 0; n < 300; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    const gap = Math.hypot(movers[0]!.x - movers[1]!.x, movers[0]!.z - movers[1]!.z);
    expect(gap).toBeGreaterThan(STOP_RADIUS * 0.8);
  });

  it("settles holders outside bolt splash instead of stacking", () => {
    // Two holders parked 20 apart (a stand-off pair in a brawl): no drive,
    // so separation alone must open them past every bolt blast — a shell
    // landing on one should not splash the other at full share.
    const field = openField();
    const kinds = ["stump", "stump"] as const;
    const routes: RoutePoint[][] = [[], []];
    let movers: Mover[] = [
      { x: -10, z: 0, hull: 0, leg: 0, hold: true },
      { x: 10, z: 0, hull: 0, leg: 0, hold: true },
    ];
    const dt = 1 / 60;
    for (let n = 0; n < 600; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    const gap = Math.hypot(movers[0]!.x - movers[1]!.x, movers[0]!.z - movers[1]!.z);
    expect(gap).toBeGreaterThanOrEqual(STOP_RADIUS);
    expect(gap).toBeGreaterThan(BLAST_RADIUS.stump);
  });

  it("lets units parked inside scorch (brown-hole) cells drive out", () => {
    // Scorch marks are renderer decals: recording one must not mutate the
    // heightfield or walkability, so "stuck in a brown hole" can only ever
    // be the spacing deadlock above, never the scorch itself.
    const field = openField();
    const before = field.heights.slice();
    const marks = addScorchMark([], { x: 0, z: 0, radius: 46, intensity: 0.8 });
    expect(marks).toHaveLength(1);
    expect(field.heights).toEqual(before);
    const mark = marks[0]!;
    for (const [x, z] of [[-10, 0], [10, 0], [0, 0]] as const) {
      const { cellX, cellZ } = cellFromWorld(field, x, z);
      expect(Math.hypot(x - mark.x, z - mark.z)).toBeLessThan(mark.radius);
      expect(isWalkable(field, cellX, cellZ)).toBe(true);
    }
    const kinds = ["commander", "hammer"] as const;
    let movers: Mover[] = [
      orderMover({ x: -10, z: 0, hull: 0, leg: 0 }, [{ x: -30, z: 400 }]),
      orderMover({ x: 10, z: 0, hull: 0, leg: 0 }, [{ x: 30, z: 400 }]),
    ];
    const routes: RoutePoint[][] = [[], []];
    const dt = 1 / 60;
    for (let n = 0; n < 3600; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    for (const m of movers) {
      expect(hasOrder(m)).toBe(false);
      expect(Math.hypot(m.x - mark.x, m.z - mark.z)).toBeGreaterThan(mark.radius);
    }
  });
});

describe("crowd separation", () => {
  it("never shoves an ordered mover backwards off its goal", () => {
    // Single file into the same destination with the drive held by stun, so
    // only separation moves the trailer: the radial push away from the
    // leader points opposite the goal and must be stripped, leaving just
    // the sideways lane-opening. Without the strip the trailer would lose
    // ground on this tick.
    const kinds = ["flash", "flash"] as const;
    const routes: RoutePoint[][] = [[], []];
    const movers: Mover[] = [
      orderMover({ x: 0, z: 20, hull: 0, leg: 0 }, [{ x: 0, z: 400 }]),
      stunMover(orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [{ x: 0, z: 400 }]), 0.16),
    ];
    const next = advanceMovers([...kinds], movers, routes, 1 / 60);
    // No backward shove (z untouched), only the sidestep off the lane.
    expect(next[1]!.z).toBe(0);
    expect(Math.abs(next[1]!.x)).toBeGreaterThan(0);
    // The leader's forward-aiding push is kept, never stripped.
    expect(next[0]!.z).toBeGreaterThan(20);
  });

  it("moves single-file columns forward instead of grinding", () => {
    // Trailer 20 behind the leader, same lane, same goal: the old full push
    // shoved the trailer backwards at separation speed against its floor drive, so
    // the column ground through the stop. Stripping the opposed radial half
    // keeps every tick's progress while the kept sidestep still opens the
    // lane (measured: trailer z at tick 60 goes 14.9 -> 20.6, lane offset
    // 3.5 -> 7.5, arrival 1204 -> 1123 ticks).
    const field = openField();
    const kinds = ["flash", "flash"] as const;
    let movers: Mover[] = [
      orderMover({ x: 0, z: 20, hull: 0, leg: 0 }, [{ x: 0, z: 400 }]),
      orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [{ x: 0, z: 400 }]),
    ];
    const routes: RoutePoint[][] = [[], []];
    const dt = 1 / 60;
    for (let n = 0; n < 60; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    expect(movers[1]!.z).toBeGreaterThan(18);
    expect(Math.abs(movers[1]!.x)).toBeGreaterThan(5);
    let arrivedAt = -1;
    for (let n = 60; n < 3600; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
      if (!hasOrder(movers[0]!) && !hasOrder(movers[1]!)) {
        arrivedAt = n;
        break;
      }
    }
    expect(arrivedAt).toBeGreaterThanOrEqual(0);
    expect(arrivedAt).toBeLessThan(1180);
  });

  it("passes head-on crossings through instead of backing both up", () => {
    // Same lane, opposite goals: each radial shove opposes its owner's
    // goal, so both strip to the counter-stepping sidestep and the pair
    // drives through at floor speed (measured arrival 559 -> 521 ticks)
    // instead of retreating from each other.
    const field = openField();
    const kinds = ["flash", "flash"] as const;
    let movers: Mover[] = [
      orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [{ x: 0, z: 400 }]),
      orderMover({ x: 0, z: 200, hull: Math.PI, leg: 0 }, [{ x: 0, z: -200 }]),
    ];
    const routes: RoutePoint[][] = [[], []];
    const dt = 1 / 60;
    let arrivedAt = -1;
    for (let n = 0; n < 3600; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
      if (!hasOrder(movers[0]!) && !hasOrder(movers[1]!)) {
        arrivedAt = n;
        break;
      }
    }
    expect(arrivedAt).toBeGreaterThanOrEqual(0);
    expect(arrivedAt).toBeLessThan(545);
  });

  it("un-stacks coincident orders without parking either hull", () => {
    // Same point, same goal: the deterministic split opens the pair (kept
    // whole - with no pair axis "away from the goal" is meaningless) and
    // both still arrive (measured 1277 -> 1199 ticks).
    const field = openField();
    const kinds = ["flash", "flash"] as const;
    let movers: Mover[] = [
      orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [{ x: 0, z: 400 }]),
      orderMover({ x: 0, z: 0, hull: Math.PI, leg: 0 }, [{ x: 0, z: 400 }]),
    ];
    const routes: RoutePoint[][] = [[], []];
    const dt = 1 / 60;
    let arrivedAt = -1;
    for (let n = 0; n < 3600; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
      if (!hasOrder(movers[0]!) && !hasOrder(movers[1]!)) {
        arrivedAt = n;
        break;
      }
    }
    expect(arrivedAt).toBeGreaterThanOrEqual(0);
    expect(arrivedAt).toBeLessThan(1250);
  });

  it("slides separation along walls instead of clipping into them", () => {
    // A held pair with one hull between its neighbour and a steep wall: the
    // eastward shove is unwalkable, so it must degrade to sliding along the
    // wall (or holding) — never entering it — while the pair still opens.
    const field = walledField();
    const kinds = ["flash", "flash"] as const;
    let movers: Mover[] = [
      { x: worldX(field, 14), z: 0, hull: 0, leg: 0, hold: true },
      { x: worldX(field, 15), z: 0, hull: 0, leg: 0, hold: true },
    ];
    const routes: RoutePoint[][] = [[], []];
    const dt = 1 / 60;
    const wallX = worldX(field, 16);
    for (let n = 0; n < 300; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
      for (const m of movers) {
        const { cellX, cellZ } = cellFromWorld(field, m.x, m.z);
        expect(isWalkable(field, cellX, cellZ)).toBe(true);
        expect(m.x).toBeLessThan(wallX);
      }
    }
    const gap = Math.hypot(movers[0]!.x - movers[1]!.x, movers[0]!.z - movers[1]!.z);
    expect(gap).toBeGreaterThan(16);
  });
});

describe("separation coast", () => {
  /**
   * Count gap-direction reversals landing within 4 ticks of the previous one:
   * the ~30 Hz boundary sawtooth, where the homing drive pulls the pair back
   * inside the stop radius every other tick. Legitimate passes and slow
   * jostling space their reversals tens of ticks apart; chatter alternates
   * every 1-2 ticks. Base rates on these fixtures: 23-95 per 900 ticks.
   */
  function chatterFlips(gaps: readonly number[]): number {
    let chatter = 0;
    let prev = 0;
    let lastFlip = -Infinity;
    for (let n = 1; n < gaps.length; n++) {
      const radial = gaps[n]! - gaps[n - 1]!;
      if (n > 1 && radial !== 0 && prev !== 0 && Math.sign(radial) !== Math.sign(prev)) {
        if (n - lastFlip <= 4) chatter++;
        lastFlip = n;
      }
      if (radial !== 0) prev = radial;
    }
    return chatter;
  }

  function pairGap(a: Mover, b: Mover): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  it("crossing patrol pair exits the radius without chattering", () => {
    // Head-on patrol crossing through each other: the exit must glide, not
    // sawtooth ~1u at ~30 Hz against the homing drive (base: 66 chatter
    // flips here). The final gap proves the pair actually passes instead of
    // freezing apart.
    const field = openField();
    const kinds = ["hammer", "hammer"] as const;
    const routes: RoutePoint[][] = [
      [
        { x: -30, z: 0 },
        { x: 400, z: 0 },
      ],
      [
        { x: 30, z: 0 },
        { x: -400, z: 0 },
      ],
    ];
    let movers: Mover[] = [
      { x: -15, z: 0, hull: Math.PI / 2, leg: 1 },
      { x: 15, z: 0, hull: -Math.PI / 2, leg: 1 },
    ];
    const dt = 1 / 60;
    const gaps: number[] = [pairGap(movers[0]!, movers[1]!)];
    for (let n = 0; n < 900; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
      gaps.push(pairGap(movers[0]!, movers[1]!));
    }
    expect(chatterFlips(gaps)).toBe(0);
    expect(gaps[gaps.length - 1]).toBeGreaterThan(300);
  });

  it("fast pack-advance pair rides clear without chattering", () => {
    // Two peewees converging on one point (the pack-advance shape, with the
    // fastest crawl on the field): base pins the gap at the boundary
    // [48.0, 49.0] with 89 chatter flips; the pair must ride outside and
    // advance instead. Total travel guards against freezing trivially green.
    const field = openField();
    const kinds = ["peewee", "peewee"] as const;
    const routes: RoutePoint[][] = [
      [
        { x: -10, z: 0 },
        { x: 0, z: 400 },
      ],
      [
        { x: 10, z: 0 },
        { x: 0, z: 400 },
      ],
    ];
    let movers: Mover[] = [
      { x: -10, z: 0, hull: 0, leg: 1 },
      { x: 10, z: 0, hull: 0, leg: 1 },
    ];
    const dt = 1 / 60;
    const gaps: number[] = [pairGap(movers[0]!, movers[1]!)];
    let travel = 0;
    for (let n = 0; n < 900; n++) {
      const next = advanceMovers([...kinds], movers, routes, dt, field);
      travel += Math.hypot(next[0]!.x - movers[0]!.x, next[0]!.z - movers[0]!.z);
      movers = next;
      gaps.push(pairGap(movers[0]!, movers[1]!));
    }
    expect(chatterFlips(gaps)).toBe(0);
    expect(Math.min(...gaps.slice(-120))).toBeGreaterThan(STOP_RADIUS);
    expect(travel).toBeGreaterThan(500);
  });

  it("grazing fast cross resolves without chattering", () => {
    // Fast tanks brushing past on crossing courses: the pair axis rotates
    // under the coast heading here, which re-entered mid-glide until the
    // drive paused for the glide (base: 51 chatter flips). Max gap proves
    // the encounter resolves into open water instead of sticking.
    const field = openField();
    const kinds = ["flash", "flash"] as const;
    const routes: RoutePoint[][] = [
      [
        { x: -30, z: 0 },
        { x: 400, z: 0 },
      ],
      [
        { x: 30, z: 0 },
        { x: -400, z: 0 },
      ],
    ];
    let movers: Mover[] = [
      { x: -15, z: 0, hull: Math.PI / 2, leg: 1 },
      { x: 15, z: 0, hull: -Math.PI / 2, leg: 1 },
    ];
    const dt = 1 / 60;
    const gaps: number[] = [pairGap(movers[0]!, movers[1]!)];
    for (let n = 0; n < 900; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
      gaps.push(pairGap(movers[0]!, movers[1]!));
    }
    expect(chatterFlips(gaps)).toBe(0);
    expect(Math.max(...gaps)).toBeGreaterThan(100);
  });

  it("parked holders settle exactly on the radius", () => {
    // Two holders parked 20 apart: no drive, so separation alone opens them
    // and motion must end exactly — per-tick displacement to zero, no
    // limit cycle, no leftover coast budget. Holds never arm the coast, so
    // they stop on the radius instead of gliding past their parking spot.
    const field = openField();
    const kinds = ["stump", "stump"] as const;
    const routes: RoutePoint[][] = [[], []];
    let movers: Mover[] = [
      { x: -10, z: 0, hull: 0, leg: 0, hold: true },
      { x: 10, z: 0, hull: 0, leg: 0, hold: true },
    ];
    const dt = 1 / 60;
    const tailSteps: number[] = [];
    for (let n = 0; n < 600; n++) {
      const next = advanceMovers([...kinds], movers, routes, dt, field);
      if (n >= 540) {
        tailSteps.push(Math.hypot(next[0]!.x - movers[0]!.x, next[0]!.z - movers[0]!.z));
        tailSteps.push(Math.hypot(next[1]!.x - movers[1]!.x, next[1]!.z - movers[1]!.z));
      }
      movers = next;
    }
    expect(pairGap(movers[0]!, movers[1]!)).toBeGreaterThanOrEqual(STOP_RADIUS);
    expect(Math.max(...tailSteps)).toBe(0);
    expect(movers[0]!.sep).toBeUndefined();
    expect(movers[1]!.sep).toBeUndefined();
  });

  it("drains the coast budget exactly, then ends", () => {
    // A lone hull with a hand-armed 8u budget and nowhere to drive (empty
    // route): the glide covers exactly the budget at separation speed — 16
    // ticks at 0.5u — and the key drops, so no residue can revive later.
    const field = openField();
    const kinds = ["flash"] as const;
    const routes: RoutePoint[][] = [[]];
    let movers: Mover[] = [{ x: 0, z: 0, hull: 0, leg: 0, sep: { x: 8, z: 0 } }];
    const dt = 1 / 60;
    for (let n = 0; n < 16; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    expect(movers[0]!.x).toBe(8);
    expect(movers[0]!.z).toBe(0);
    expect(movers[0]!.sep).toBeUndefined();
    for (let n = 0; n < 60; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    expect(movers[0]!.x).toBe(8);
    expect(movers[0]!.z).toBe(0);
  });

  it("absorbs the coast against a wall instead of banking it", () => {
    // A hull gliding into a steep wall holds and drops the budget: a pinned
    // hull rests like before instead of owing motion it can never spend.
    const field = walledField();
    const wallEdge = worldX(field, 16) - CELL_PIXELS / 2;
    const kinds = ["flash"] as const;
    const routes: RoutePoint[][] = [[]];
    let movers: Mover[] = [{ x: wallEdge - 0.25, z: 0, hull: 0, leg: 0, sep: { x: 8, z: 0 } }];
    const dt = 1 / 60;
    for (let n = 0; n < 60; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    expect(movers[0]!.x).toBe(wallEdge - 0.25);
    expect(movers[0]!.z).toBe(0);
    expect(movers[0]!.sep).toBeUndefined();
    const { cellX, cellZ } = cellFromWorld(field, movers[0]!.x, movers[0]!.z);
    expect(isWalkable(field, cellX, cellZ)).toBe(true);
  });

  it("pauses unordered drive for the glide but never the ordered floor", () => {
    // A coasting patrol hull turns in place while the glide carries it (no
    // drive-back into the crowd it just left); an ordered twin keeps its
    // floor drive under the same glide, so explicit orders stay alive.
    const field = openField();
    const dt = 1 / 60;
    const route: RoutePoint[][] = [[{ x: 0, z: 0 }, { x: 0, z: 400 }]];
    const patrol = advanceMovers(
      ["stump"],
      [{ x: 0, z: 0, hull: Math.PI, leg: 1, sep: { x: 8, z: 0 } }],
      route,
      dt,
      field,
    )[0]!;
    expect(patrol.x).toBeCloseTo(0.5, 9);
    expect(patrol.z).toBe(0);
    expect(patrol.hull).not.toBe(Math.PI);
    // An ordered twin carrying a live coast (armed mid-order by a shove, as
    // `orderMover` itself strips stale ones): the glide AND the drive both
    // advance, so explicit orders stay alive through crowds.
    const orderedMover: Mover = {
      x: 0,
      z: 0,
      hull: 0,
      leg: 0,
      sep: { x: 8, z: 0 },
      order: { points: [{ x: 0, z: 400 }], at: 0 },
    };
    const ordered = advanceMovers(["stump"], [orderedMover], [[]], dt, field)[0]!;
    expect(ordered.x).toBeCloseTo(0.5, 9);
    expect(ordered.z).toBeGreaterThan(0.5);
  });

  it("clears the coast on new orders and holds", () => {
    // Explicit new intent supersedes the glide like the departure lead-in:
    // a repathed hull never resumes a stale coast heading.
    const coasting: Mover = { x: 0, z: 0, hull: 0, leg: 0, sep: { x: 8, z: 0 } };
    const ordered = orderMover(coasting, [{ x: 0, z: 400 }]);
    expect(ordered.sep).toBeUndefined();
    expect(hasOrder(ordered)).toBe(true);
    const held = holdMover(coasting);
    expect(held.sep).toBeUndefined();
    expect(held.hold).toBe(true);
  });
});

describe("crowd circulation", () => {
  it("passes a four-way converge through instead of pinwheeling forever", () => {
    // Four hulls converging on one point from four sides: with mirror
    // sidesteps every pair counter-steps the same rotational way, so the
    // sidesteps sum to a coherent circulation and the pack orbits the
    // waypoint forever (measured: nobody arrives in 3600 ticks, net mean
    // rotation -5 rad over 1800 ticks). One-side-yields breaks the
    // symmetry, so the pack must serially pass and every leg advance.
    const field = openField();
    const kinds = ["stump", "stump", "stump", "stump"] as const;
    const routes: RoutePoint[][] = [
      [{ x: -200, z: 0 }, { x: 0, z: 0 }, { x: 200, z: 0 }],
      [{ x: 200, z: 0 }, { x: 0, z: 0 }, { x: -200, z: 0 }],
      [{ x: 0, z: -200 }, { x: 0, z: 0 }, { x: 0, z: 200 }],
      [{ x: 0, z: 200 }, { x: 0, z: 0 }, { x: 0, z: -200 }],
    ];
    let movers: Mover[] = [
      { x: -200, z: 0, hull: Math.PI / 2, leg: 1 },
      { x: 200, z: 0, hull: -Math.PI / 2, leg: 1 },
      { x: 0, z: -200, hull: 0, leg: 1 },
      { x: 0, z: 200, hull: Math.PI, leg: 1 },
    ];
    const dt = 1 / 60;
    const arrivedAt = [-1, -1, -1, -1];
    for (let n = 0; n < 3600; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
      for (let i = 0; i < 4; i++) {
        if (arrivedAt[i]! < 0 && movers[i]!.leg !== 1) arrivedAt[i] = n;
      }
    }
    expect(arrivedAt.every((t) => t >= 0)).toBe(true);
  });

  it("drains a converge around a held hull instead of pinwheeling", () => {
    // A holder cannot lead (no drive to creep with) but must not suppress
    // the drain either: it keeps a full loop route, so hold status is its
    // only ineligibility, and leadership elects the lowest *eligible*
    // index around it. Yielding to any lower index instead — holder
    // included — pins the whole pack into the mutual pinwheel (measured:
    // nobody arrives in 5400 ticks, ~12 rad swept each).
    const field = openField();
    const kinds = ["stump", "stump", "stump", "stump", "stump"] as const;
    const routes: RoutePoint[][] = [
      [
        { x: 0, z: 0 },
        { x: 0, z: 400 },
        { x: 400, z: 400 },
        { x: 400, z: 0 },
      ],
      [{ x: -200, z: 0 }, { x: 0, z: 0 }, { x: 200, z: 0 }],
      [{ x: 200, z: 0 }, { x: 0, z: 0 }, { x: -200, z: 0 }],
      [{ x: 0, z: -200 }, { x: 0, z: 0 }, { x: 0, z: 200 }],
      [{ x: 0, z: 200 }, { x: 0, z: 0 }, { x: 0, z: -200 }],
    ];
    let movers: Mover[] = [
      holdMover({ x: 0, z: 0, hull: 0, leg: 0 }),
      { x: -200, z: 0, hull: Math.PI / 2, leg: 1 },
      { x: 200, z: 0, hull: -Math.PI / 2, leg: 1 },
      { x: 0, z: -200, hull: 0, leg: 1 },
      { x: 0, z: 200, hull: Math.PI, leg: 1 },
    ];
    const dt = 1 / 60;
    const arrivedAt = [-1, -1, -1, -1];
    for (let n = 0; n < 3600; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
      for (let i = 0; i < 4; i++) {
        if (arrivedAt[i]! < 0 && movers[i + 1]!.leg !== 1) arrivedAt[i] = n;
      }
    }
    expect(arrivedAt.every((t) => t >= 0)).toBe(true);
  });
});

/** Synthetic field: flat 100 plateau, steep 40/cell ramp wall east of x=16. */
function walledField(): SeatField {
  const w = 40;
  const h = 24;
  const heights = new Uint8Array(w * h).fill(100);
  for (let z = 0; z < h; z++) {
    for (let x = 17; x < w; x++) heights[z * w + x] = 100 + (x - 16) * 40;
  }
  return { width: w, height: h, heights, seaLevel: 0 };
}

/** Flat dry field with a tree belt across the middle rows. */
function woodedField(): SeatField {
  const w = 40;
  const h = 24;
  const heights = new Uint8Array(w * h).fill(100);
  const features = new Uint16Array(w * h).fill(0xffff);
  for (let z = 8; z <= 15; z++) {
    for (let x = 5; x < w - 5; x++) features[z * w + x] = 0;
  }
  return { width: w, height: h, heights, seaLevel: 0, features };
}

/** Gentle eastward ramp (4 raw per cell): walkable, but dragging. */
function rampField(): SeatField {
  const w = 40;
  const h = 24;
  const heights = new Uint8Array(w * h);
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) heights[z * w + x] = 60 + x * 4;
  }
  return { width: w, height: h, heights, seaLevel: 0 };
}

function worldX(field: SeatField, cellX: number): number {
  return (cellX - (field.width - 1) / 2) * CELL_PIXELS;
}

function worldZ(field: SeatField, cellZ: number): number {
  return (cellZ - (field.height - 1) / 2) * CELL_PIXELS;
}

/** Flat dry plain (land at sea+10) with a graduated 2×3 pond mid-map. */
function pondField(): SeatField {
  const w = 40;
  const h = 24;
  const heights = new Uint8Array(w * h).fill(60);
  for (let z = 10; z <= 12; z++) {
    for (let x = 16; x <= 17; x++) heights[z * w + x] = 52;
  }
  return { width: w, height: h, heights, seaLevel: 50 };
}

/** Flat dry plain split by a full-height graduated water column. */
function seaWallField(): SeatField {
  const w = 40;
  const h = 24;
  const heights = new Uint8Array(w * h).fill(60);
  for (let z = 0; z < h; z++) heights[z * w + 16] = 52;
  return { width: w, height: h, heights, seaLevel: 50 };
}

describe("steep-slope clamp", () => {
  it("holds position (turning in place) instead of climbing a wall", () => {
    const field = walledField();
    const z = 0;
    // Ordered due east into the wall: hull faces the target, X/Z pin.
    let mover: Mover = { x: worldX(field, 10), z, hull: Math.PI / 2, leg: 0 };
    mover = orderMover(mover, [{ x: worldX(field, 35), z }]);
    const pinned = { x: mover.x, z: mover.z };
    for (let n = 0; n < 300; n++) {
      mover = advanceMover("flash", mover, [], 1 / 60, 1, field);
    }
    // Never entered the wall: still west of it, order still live.
    expect(mover.x).toBeLessThan(worldX(field, 16));
    expect(mover.z).toBeCloseTo(pinned.z, 9);
    expect(hasOrder(mover)).toBe(true);
    // Hull kept turning toward the target instead of freezing.
    expect(mover.hull).toBeCloseTo(Math.PI / 2, 6);
    // Same order without terrain knowledge drives straight through.
    let free: Mover = { x: worldX(field, 10), z, hull: Math.PI / 2, leg: 0 };
    free = orderMover(free, [{ x: worldX(field, 35), z }]);
    for (let n = 0; n < 300; n++) {
      free = advanceMover("flash", free, [], 1 / 60);
    }
    expect(free.x).toBeGreaterThan(worldX(field, 16));
  });

  it("lets patrol skip a leg pinned against steep ground", () => {
    const field = walledField();
    const z = 0;
    // Patrol leg straight into the wall from nearby walkable ground.
    const route: RoutePoint[] = [
      { x: worldX(field, 14), z },
      { x: worldX(field, 35), z },
    ];
    let mover: Mover = { x: worldX(field, 14), z, hull: Math.PI / 2, leg: 1 };
    const dt = 1 / 60;
    const ticks = Math.ceil(BLOCKED_SKIP_AFTER / dt) + 300;
    let skipped = false;
    for (let n = 0; n < ticks; n++) {
      mover = advanceMover("stump", mover, route, dt, 1, field);
      // The hull never clips into the wall while pinned or skipping.
      const { cellX } = cellFromWorld(field, mover.x, mover.z);
      expect(cellX).toBeLessThan(16);
      if (mover.leg === 0) skipped = true;
    }
    expect(skipped).toBe(true);
  });

  it("keeps patrols on walkable ground on a real map", () => {
    // Real-map case (not synthetic flat): patrol legs cut straight across
    // whatever the waypoints straddle, so the clamp + skip must hold on
    // generated terrain with real slopes and shorelines.
    const map = generateMap("greenreach", 7);
    const routes = planRoutes(map, map.units, 7);
    const kinds = map.units.map((u) => u.kind);
    // Seed on filtered (walkable) waypoints, steering at the next leg.
    let movers: Mover[] = routes.map((route) => {
      const wp = route[1] ?? route[0]!;
      expect(
        isWalkable(map, cellFromWorld(map, wp.x, wp.z).cellX, cellFromWorld(map, wp.x, wp.z).cellZ),
      ).toBe(true);
      return { x: wp.x, z: wp.z, hull: 0, leg: 2 % route.length };
    });
    const start = movers.map((m) => ({ ...m }));
    const dt = 1 / 60;
    for (let n = 0; n < 3600; n++) {
      movers = advanceMovers(kinds, movers, routes, dt, map);
      for (const m of movers) {
        const { cellX, cellZ } = cellFromWorld(map, m.x, m.z);
        expect(isWalkable(map, cellX, cellZ)).toBe(true);
      }
    }
    // The column actually travelled instead of grinding in place.
    const travel = movers.reduce(
      (sum, m, i) => sum + Math.hypot(m.x - start[i]!.x, m.z - start[i]!.z),
      0,
    );
    expect(travel).toBeGreaterThan(0);
  });
});

describe("shore slide", () => {
  it("edges an ordered hull around a pond instead of beaching nose-on", () => {
    // Straight order due east through the pond: waypoint homing would beach
    // the hull on the water corner with the goal across it (the old grind
    // held there forever). The shore fan rounds the corner and arrives.
    const field = pondField();
    const z = worldZ(field, 11);
    const drive = (): { mover: Mover; excursion: number } => {
      let mover: Mover = { x: worldX(field, 13), z, hull: Math.PI / 2, leg: 0 };
      mover = orderMover(mover, [{ x: worldX(field, 21), z }]);
      let excursion = 0;
      for (let n = 0; n < 3600; n++) {
        mover = advanceMover("stump", mover, [], 1 / 60, 1, field);
        const { cellX, cellZ } = cellFromWorld(field, mover.x, mover.z);
        expect(isWalkable(field, cellX, cellZ)).toBe(true);
        excursion = Math.max(excursion, Math.abs(mover.z - z));
        if (!hasOrder(mover)) break;
      }
      return { mover, excursion };
    };
    const { mover, excursion } = drive();
    expect(hasOrder(mover)).toBe(false);
    // Arrival rejoins patrol instead of holding (no legs here, so it rests
    // unheld where the slide rounded the pond).
    expect(mover.hold).not.toBe(true);
    // It rounded the pond (more than a cell off the lane), not through it.
    expect(excursion).toBeGreaterThan(CELL_PIXELS);
    // Deterministic: the same slide replays exactly.
    const again = drive();
    expect(again.mover.x).toBe(mover.x);
    expect(again.mover.z).toBe(mover.z);
  });

  it("gives up an unreachable slide and holds beached past patience", () => {
    // Straight order across a full water column: the hull tries the shore,
    // then holds instead of pacing the coast forever. The order stays live.
    const field = seaWallField();
    const z = worldZ(field, 11);
    let mover: Mover = { x: worldX(field, 13), z, hull: Math.PI / 2, leg: 0 };
    mover = orderMover(mover, [{ x: worldX(field, 25), z }]);
    const dt = 1 / 60;
    let early: Mover | null = null;
    let mid: Mover | null = null;
    for (let n = 0; n < 720; n++) {
      mover = advanceMover("stump", mover, [], dt, 1, field);
      const { cellX, cellZ } = cellFromWorld(field, mover.x, mover.z);
      expect(isWalkable(field, cellX, cellZ)).toBe(true);
      expect(cellX).toBeLessThan(16);
      if (n === 180) early = { ...mover };
      if (n === 360) mid = { ...mover };
    }
    // It slid along the shore first (never pinned in place from the start).
    expect(Math.abs(early!.z - z)).toBeGreaterThan(4);
    // ...then gave up: frozen from 6 s to 12 s, order still live.
    expect(mover.x).toBe(mid!.x);
    expect(mover.z).toBe(mid!.z);
    expect(hasOrder(mover)).toBe(true);
  });

  it("lets patrol skip a leg pinned at the water like at a wall", () => {
    // Patrol never fans: a leg across the water holds at the shore, then
    // skips — sliding would walk the whole coastline instead of skipping.
    const field = seaWallField();
    const z = worldZ(field, 11);
    const route: RoutePoint[] = [
      { x: worldX(field, 13), z },
      { x: worldX(field, 25), z },
    ];
    let mover: Mover = { x: worldX(field, 13), z, hull: Math.PI / 2, leg: 1 };
    const dt = 1 / 60;
    let skipped = false;
    for (let n = 0; n < Math.ceil(BLOCKED_SKIP_AFTER / dt) + 300; n++) {
      mover = advanceMover("stump", mover, route, dt, 1, field);
      const { cellX, cellZ } = cellFromWorld(field, mover.x, mover.z);
      expect(cellX).toBeLessThan(16);
      expect(isWalkable(field, cellX, cellZ)).toBe(true);
      if (mover.leg === 0) skipped = true;
    }
    expect(skipped).toBe(true);
  });
});

describe("rough-terrain drag", () => {
  it("matches terrain-less speed on flat open ground, bit for bit", () => {
    const field = openField();
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    const route = flatRoute();
    const dt = 0.05;
    const free = advanceMover("flash", mover, route, dt);
    const seated = advanceMover("flash", mover, route, dt, 1, field);
    expect(seated.x).toBe(free.x);
    expect(seated.z).toBe(free.z);
    expect(seated.hull).toBe(free.hull);
  });

  it("climbs grades slower than the flat, steeper slower still", () => {
    const z = 0;
    const drive = (field: SeatField, ticks: number): number => {
      const startX = worldX(field, 5);
      let mover: Mover = { x: startX, z, hull: Math.PI / 2, leg: 0 };
      mover = orderMover(mover, [{ x: worldX(field, 30), z }]);
      for (let n = 0; n < ticks; n++) {
        mover = advanceMover("flash", mover, [], 1 / 60, 1, field);
      }
      return mover.x - startX;
    };
    const ticks = 200;
    const flat = drive(openField(), ticks);
    const gentle = drive(rampField(), ticks);
    expect(gentle).toBeLessThan(flat);
    // Deterministic: the same drag replays exactly.
    expect(drive(rampField(), ticks)).toBe(gentle);
  });

  it("pushes around single trees slower, but still arrives", () => {
    // One isolated trunk on the lane: the order routes around it instead of
    // through it, arriving without ever entering the keepout.
    const w = 40;
    const h = 24;
    const heights = new Uint8Array(w * h).fill(100);
    const features = new Uint16Array(w * h).fill(0xffff);
    features[11 * w + 18] = 0;
    const field: SeatField = { width: w, height: h, heights, seaLevel: 0, features };
    const z = (11 - (field.height - 1) / 2) * CELL_PIXELS;
    const from = { x: worldX(field, 10), z };
    const to = { x: worldX(field, 26), z };
    const path = findWorldPath(field, from, to);
    let mover: Mover = { x: from.x, z: from.z, hull: Math.PI / 2, leg: 0 };
    mover = orderMover(mover, path);
    for (let n = 0; n < 3600; n++) {
      mover = advanceMover("flash", mover, [], 1 / 60, 1, field);
      expect(trunkBlockedAt(field, mover.x, mover.z, "flash")).toBe(false);
    }
    expect(hasOrder(mover)).toBe(false);
  });

  it("crushes through the tree belt slowly, felling trees, and arrives", () => {
    // A solid tree belt is no longer a wall of keepouts: a straight order
    // into it crushes a lane through the wood at a crawl instead of holding
    // at the first trunk line. Pathfound orders still route around when they
    // can (see below); the crush is for lanes that must go through.
    const field = woodedField();
    const z = (11 - (field.height - 1) / 2) * CELL_PIXELS;
    // Crush points: the lane row (z=11) in fid order. Adjacent rows still
    // slow the hull through canopy proximity, but only lane trees fall.
    const rowTrees: { x: number; z: number }[] = [];
    for (let x = 5; x < field.width - 5; x++) rowTrees.push({ x: worldX(field, x), z });
    const run = (damage: DamageField, ticks: number): { mover: Mover; felled: number[] } => {
      const felled: number[] = [];
      const crush: CrushContext = {
        field: damage,
        points: rowTrees,
        onCrush: (f) => felled.push(...f),
      };
      let mover: Mover = { x: worldX(field, 2), z, hull: Math.PI / 2, leg: 0 };
      mover = orderMover(mover, [{ x: worldX(field, 37), z }]);
      for (let n = 0; n < ticks; n++) {
        mover = advanceMover("flash", mover, [], 1 / 60, 1, field, crush);
      }
      return { mover, felled };
    };
    // Full drive: arrives through the belt, felling the lane behind it.
    const damage = createDamageField(rowTrees.length, 0);
    const full = run(damage, 7200);
    expect(hasOrder(full.mover)).toBe(false);
    expect(full.mover.x).toBeGreaterThan(worldX(field, 37) - ARRIVE_RADIUS - 1);
    expect(full.felled.length).toBeGreaterThan(0);
    for (const fid of full.felled) expect(damage.trees[fid]).toBe("toppled");
    // Fresh lanes labour: over fixed ticks the first pass (crushing at
    // CRUSH_DRAG under canopy drag) covers less ground than a second pass
    // over its own fallen trunks — which still trails open ground, where
    // even the canopy proximity drag is absent.
    const fresh = createDamageField(rowTrees.length, 0);
    const first = run(fresh, 600);
    const second = run(fresh, 600);
    // `run` always starts at the same X: compare covered distance instead.
    const startX = worldX(field, 2);
    expect(first.mover.x - startX).toBeGreaterThan(0);
    expect(second.mover.x - startX).toBeGreaterThan(first.mover.x - startX);
    // And both trail the same order on open ground (same-size field, so
    // world coordinates match exactly).
    let openMover: Mover = { x: startX, z, hull: Math.PI / 2, leg: 0 };
    openMover = orderMover(openMover, [{ x: worldX(field, 37), z }]);
    const open: SeatField = {
      width: field.width,
      height: field.height,
      heights: new Uint8Array(field.width * field.height).fill(100),
      seaLevel: 0,
    };
    for (let n = 0; n < 600; n++) {
      openMover = advanceMover("flash", openMover, [], 1 / 60, 1, open);
    }
    expect(openMover.x - startX).toBeGreaterThan(second.mover.x - startX);
    // Crushing reads much slower than brushing canopy: the fresh pass crawls
    // at CRUSH_DRAG under the TREE_DRAG proximity it also pays.
    expect(CRUSH_DRAG * TREE_DRAG).toBeLessThan(TREE_DRAG);
  });

  it("routes pathfound orders around tree belts, crushing only grazes", () => {
    // Smoothing still steers legs around standing trunks when it can — but
    // the hulls no longer slide around wood they graze while cornering, so
    // a detour may fell a tree or two on its arcs where the old clamp would
    // have slid. A detour stays a detour (not a plough): far fewer falls
    // than driving the lane straight through.
    const field = woodedField();
    const z = (11 - (field.height - 1) / 2) * CELL_PIXELS;
    const from = { x: worldX(field, 2), z };
    const to = { x: worldX(field, 37), z };
    const path = findWorldPath(field, from, to);
    // A real detour, not a straight drive through the belt.
    expect(path.length).toBeGreaterThan(1);
    const points: { x: number; z: number }[] = [];
    for (let cz = 8; cz <= 15; cz++) {
      for (let cx = 5; cx < field.width - 5; cx++) {
        points.push({
          x: (cx - (field.width - 1) / 2) * CELL_PIXELS,
          z: (cz - (field.height - 1) / 2) * CELL_PIXELS,
        });
      }
    }
    const damage = createDamageField(points.length, 0);
    const felled: number[] = [];
    const crush: CrushContext = { field: damage, points, onCrush: (f) => felled.push(...f) };
    let mover: Mover = { x: from.x, z: from.z, hull: Math.PI / 2, leg: 0 };
    mover = orderMover(mover, path);
    for (let n = 0; n < 7200; n++) {
      mover = advanceMover("flash", mover, [], 1 / 60, 1, field, crush);
    }
    expect(hasOrder(mover)).toBe(false);
    // Grazes only: a straight lane plough fells the whole row (~30), the
    // detour only clips corner arcs.
    expect(felled.length).toBeLessThan(10);
  });

  it("drives a pathfound order through a spanning forest, felling its lane", () => {
    // No flank anywhere: the search can only route through the wood, and the
    // hull crushes the lane it takes — arriving late (canopy drag plus the
    // fell-on-contact crawl), but arriving, with the lane felled behind it.
    const w = 40;
    const h = 24;
    const heights = new Uint8Array(w * h).fill(100);
    const features = new Uint16Array(w * h).fill(0xffff);
    const points: { x: number; z: number }[] = [];
    for (let cz = 0; cz < h; cz++) {
      for (let cx = 5; cx < w - 5; cx++) {
        features[cz * w + cx] = 0;
        points.push({
          x: (cx - (w - 1) / 2) * CELL_PIXELS,
          z: (cz - (h - 1) / 2) * CELL_PIXELS,
        });
      }
    }
    const field: SeatField = { width: w, height: h, heights, seaLevel: 0, features };
    const z = (11 - (h - 1) / 2) * CELL_PIXELS;
    const from = { x: worldX(field, 2), z };
    const to = { x: worldX(field, 37), z };
    const path = findWorldPath(field, from, to);
    expect(path.length).toBeGreaterThan(0);
    expect(findWorldPath(field, from, to)).toEqual(path);
    const damage = createDamageField(points.length, 0);
    const felled: number[] = [];
    const crush: CrushContext = { field: damage, points, onCrush: (f) => felled.push(...f) };
    let mover: Mover = { x: from.x, z: from.z, hull: Math.PI / 2, leg: 0 };
    mover = orderMover(mover, path);
    let ticks = 0;
    while (hasOrder(mover) && ticks < 12000) {
      mover = advanceMover("flash", mover, [], 1 / 60, 1, field, crush);
      ticks++;
    }
    expect(hasOrder(mover)).toBe(false);
    expect(felled.length).toBeGreaterThan(0);
  });

  it("crushes out a spawn parked on a trunk instead of grinding", () => {
    // An isolated trunk under the spawn (relaxed placement permits it):
    // the hull simply drives out, felling the trunk beneath it — no
    // push-out ease needed, since wood never pins.
    const w = 32;
    const h = 32;
    const features = new Uint16Array(w * h).fill(0xffff);
    features[16 * w + 16] = 0;
    const field: SeatField = { width: w, height: h, heights: new Uint8Array(w * h).fill(100), seaLevel: 0, features };
    const x = (16 - (w - 1) / 2) * CELL_PIXELS;
    const z = (16 - (h - 1) / 2) * CELL_PIXELS;
    expect(trunkBlockedAt(field, x, z, "stump")).toBe(true);
    const kinds = ["stump"] as const;
    const routes: RoutePoint[][] = [[{ x, z }, { x, z: z + 400 }]];
    const drive = (damage: DamageField, felled: number[]): Mover[] => {
      const crush: CrushContext = { field: damage, points: [{ x, z }], onCrush: (f) => felled.push(...f) };
      let movers: Mover[] = [{ x, z, hull: 0, leg: 1 }];
      for (let n = 0; n < 600; n++) {
        movers = advanceMovers([...kinds], movers, routes, 1 / 60, field, crush);
      }
      return movers;
    };
    const damage = createDamageField(1, 0);
    const felled: number[] = [];
    const movers = drive(damage, felled);
    // Felled the spawn tree on the way out and drove south down the route.
    expect(felled).toEqual([0]);
    expect(damage.trees[0]).toBe("toppled");
    expect(movers[0]!.z).toBeGreaterThan(z);
    // Deterministic: the same crush replays exactly.
    const replayDamage = createDamageField(1, 0);
    const replay = drive(replayDamage, []);
    expect(replay[0]).toEqual(movers[0]);
  });

  it("keeps patrol waypoints off standing trunks on real maps", () => {
    for (const preset of PRESETS) {
      for (const seed of SEEDS) {
        const map = generateMap(preset, seed);
        const routes = planRoutes(map, map.units, seed);
        for (const route of routes) {
          route.forEach((wp, i) => {
            if (i === 0) return; // waypoint 0 is the spawn, exempt by design
            const { cellX, cellZ } = cellFromWorld(map, wp.x, wp.z);
            expect(map.features[cellZ * map.width + cellX]).toBeGreaterThan(2);
          });
        }
      }
    }
  });
});

describe("predictDrivenPath", () => {
  it("stays silent for holders, hold-routes, and empty orders", () => {
    const route = flatRoute();
    const held: Mover = { x: 0, z: 0, hull: 0, leg: 1, hold: true };
    expect(predictDrivenPath("flash", held, route)).toEqual([]);
    const holdRoute: RoutePoint[] = [
      { x: 5, z: 5 },
      { x: 5, z: 5 },
    ];
    expect(predictDrivenPath("flash", { x: 5, z: 5, hull: 0, leg: 1 }, holdRoute)).toEqual([]);
    expect(predictDrivenPath("flash", { x: 0, z: 0, hull: 0, leg: 0 }, [])).toEqual([]);
    const emptied = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, []);
    expect(predictDrivenPath("flash", emptied, route)).toEqual([]);
    expect(predictDrivenPath("flash", { x: 0, z: 0, hull: 0, leg: 1 }, route, null, 0)).toEqual([]);
  });

  it("runs an order from the live position to the destination", () => {
    const mover = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [
      { x: 0, z: 200 },
      { x: 200, z: 200 },
    ]);
    const path = predictDrivenPath("flash", mover, []);
    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual({ x: 0, z: 0 });
    const last = path[path.length - 1]!;
    expect(Math.hypot(last.x - 200, last.z - 200)).toBeLessThanOrEqual(ARRIVE_RADIUS);
  });

  it("walks a full patrol loop, passing near every waypoint", () => {
    const route = flatRoute();
    const mover: Mover = { x: 0, z: 50, hull: 0, leg: 1 };
    const path = predictDrivenPath("stump", mover, route);
    expect(path.length).toBeGreaterThan(10);
    expect(path[0]).toEqual({ x: 0, z: 50 });
    // The driven line cuts corners but still visits each waypoint's
    // neighbourhood (arrival radius plus one sim stride of slack).
    for (const wp of route) {
      const near = path.some((p) => Math.hypot(p.x - wp.x, p.z - wp.z) < ARRIVE_RADIUS + 30);
      expect(near).toBe(true);
    }
  });

  it("curves off the waypoint chord when the hull starts crosswise", () => {
    const route = flatRoute();
    // Hull faces +X while the leg runs +Z: the grip drives it forward along
    // the hull as it turns, so the driven line must bulge off the chord.
    const mover: Mover = { x: 0, z: 0, hull: Math.PI / 2, leg: 1 };
    const path = predictDrivenPath("flash", mover, route);
    expect(path.length).toBeGreaterThan(5);
    const bulge = Math.max(...path.slice(0, 12).map((p) => Math.abs(p.x)));
    expect(bulge).toBeGreaterThan(5);
  });

  it("refuses the wall and ends the trail there instead of crossing it", () => {
    const field = walledField();
    const z = 0;
    const mover = orderMover({ x: worldX(field, 10), z, hull: Math.PI / 2, leg: 0 }, [
      { x: worldX(field, 35), z },
    ]);
    const before = JSON.parse(JSON.stringify(mover)) as Mover;
    const path = predictDrivenPath("flash", mover, [], field);
    // Never entered the wall, never arrived — the stall rule ends the trail
    // where the hull pins, well short of the destination.
    for (const p of path) expect(p.x).toBeLessThan(worldX(field, 16));
    const last = path[path.length - 1]!;
    expect(Math.hypot(last.x - worldX(field, 35), last.z - z)).toBeGreaterThan(ARRIVE_RADIUS);
    // Pure: neither the mover nor the field moved.
    expect(mover).toEqual(before);
  });

  it("is deterministic for the same live state", () => {
    const route = flatRoute();
    const mover = orderMover({ x: 10, z: 20, hull: 1.2, leg: 0 }, [{ x: 300, z: 300 }]);
    expect(predictDrivenPath("hammer", mover, route)).toEqual(predictDrivenPath("hammer", mover, route));
  });
});

describe("group cohesion", () => {
  it("caps at the slowest member's base speed", () => {
    expect(groupSpeedCap(["peewee", "flash", "hammer"])).toBe(MOVE_SPEED.hammer);
    expect(groupSpeedCap(["flash", "flash"])).toBe(MOVE_SPEED.flash);
    expect(groupSpeedCap(["peewee"])).toBe(MOVE_SPEED.peewee);
    expect(groupSpeedCap([])).toBeUndefined();
  });

  it("leaves single orders uncapped and byte-identical", () => {
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 0 };
    const single = orderMover(mover, [{ x: 0, z: 400 }]);
    expect(single.order?.groupSpeed).toBeUndefined();
    expect("groupSpeed" in (single.order ?? {})).toBe(false);
    const next = advanceMover("peewee", single, [], 1);
    expect(next.z).toBeCloseTo(MOVE_SPEED.peewee, 6);
  });

  it("slows a capped fast hull to the group's pace", () => {
    const cap = groupSpeedCap(["peewee", "hammer"])!;
    const fast = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [{ x: 0, z: 400 }], cap);
    const slow = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [{ x: 0, z: 400 }], cap);
    expect(fast.order?.groupSpeed).toBe(MOVE_SPEED.hammer);
    const fastNext = advanceMover("peewee", fast, [], 1);
    const slowNext = advanceMover("hammer", slow, [], 1);
    // Both drive at the hammer's pace now.
    expect(fastNext.z).toBeCloseTo(MOVE_SPEED.hammer, 6);
    expect(slowNext.z).toBeCloseTo(MOVE_SPEED.hammer, 6);
    // The cap never speeds a slow hull past its own base.
    const over = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [{ x: 0, z: 400 }], 999);
    expect(advanceMover("hammer", over, [], 1).z).toBeCloseTo(MOVE_SPEED.hammer, 6);
  });

  it("keeps a mixed group together instead of letting the fast hull cut ahead", () => {
    const field = openField();
    const kinds = ["peewee", "hammer"] as const;
    const cap = groupSpeedCap([...kinds])!;
    const drive = (grouped: boolean): number => {
      let movers: Mover[] = [
        orderMover({ x: -100, z: 0, hull: 0, leg: 0 }, [{ x: -100, z: 400 }], grouped ? cap : undefined),
        orderMover({ x: 100, z: 0, hull: 0, leg: 0 }, [{ x: 100, z: 400 }], grouped ? cap : undefined),
      ];
      const routes: RoutePoint[][] = [[], []];
      for (let n = 0; n < 120; n++) {
        movers = advanceMovers([...kinds], movers, routes, 1 / 60, field);
      }
      return Math.abs(movers[0]!.z - movers[1]!.z);
    };
    // Lanes 200 apart: no spacing/separation contact, pure drive speeds.
    expect(drive(false)).toBeGreaterThan(80);
    expect(drive(true)).toBeLessThan(5);
  });

  it("predicts the capped path slower for a fast hull", () => {
    const cap = groupSpeedCap(["peewee", "hammer"])!;
    const free = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [{ x: 0, z: 400 }]);
    const capped = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [{ x: 0, z: 400 }], cap);
    const freePath = predictDrivenPath("peewee", free, []);
    const cappedPath = predictDrivenPath("peewee", capped, [], null);
    expect(cappedPath.length).toBeGreaterThan(freePath.length);
  });
});

describe("faster movement tune", () => {
  it("keeps kind ordering with lifted base speeds", () => {
    expect(MOVE_SPEED.peewee).toBeGreaterThan(MOVE_SPEED.flash);
    expect(MOVE_SPEED.flash).toBeGreaterThan(MOVE_SPEED.stump);
    expect(MOVE_SPEED.stump).toBeGreaterThan(MOVE_SPEED.commander);
    expect(MOVE_SPEED.commander).toBeGreaterThan(MOVE_SPEED.hammer);
    expect(MOVE_SPEED.hammer).toBeGreaterThanOrEqual(30);
    expect(MOVE_SPEED.flash).toBeGreaterThanOrEqual(70);
  });

  it("keeps crowd drags ordered but lighter than before", () => {
    // SLOW_SCALE 0.5 crawls faster than the old 0.35 without removing the
    // convoy signal; separation still outruns the ordered floor drive so
    // head-on pairs open instead of stacking through each other.
    expect(SLOW_SCALE).toBe(0.5);
    expect(ORDER_SPACING_FLOOR).toBe(0.3);
    const floorMax = Math.max(...Object.values(MOVE_SPEED)) * ORDER_SPACING_FLOOR;
    expect(SEPARATION_SPEED).toBeGreaterThan(floorMax);
  });

  it("covers open ground quickly and rough/woods proportionally faster", () => {
    const field = openField();
    const ramp = rampField();
    const drive = (terrain: SeatField, ticks: number): number => {
      const startX = worldX(terrain, 5);
      let mover: Mover = { x: startX, z: 0, hull: Math.PI / 2, leg: 0 };
      mover = orderMover(mover, [{ x: worldX(terrain, 30), z: 0 }]);
      for (let n = 0; n < ticks; n++) {
        mover = advanceMover("flash", mover, [], 1 / 60, 1, terrain);
      }
      return mover.x - startX;
    };
    // 400 world units in well under 10 s on the flat at 72 u/s.
    const flat200 = drive(field, 360);
    expect(flat200).toBeGreaterThan(380);
    // Rough grade still drags, but keeps most of the pace (>=55% of flat
    // with the 0.6 slope floor, vs ~40% on the old 0.45 tune).
    const rough200 = drive(ramp, 360);
    expect(rough200).toBeLessThan(flat200);
    expect(rough200 / flat200).toBeGreaterThan(0.55);
  });

  it("brushes canopy near full pace on a felled lane", () => {
    expect(TREE_DRAG).toBe(0.75);
    expect(CRUSH_DRAG).toBe(0.4);
    expect(CRUSH_DRAG).toBeLessThan(TREE_DRAG);
    const w = 40;
    const h = 24;
    const heights = new Uint8Array(w * h).fill(100);
    const features = new Uint16Array(w * h).fill(0xffff);
    features[11 * w + 18] = 0;
    const wooded: SeatField = { width: w, height: h, heights, seaLevel: 0, features };
    const z = (11 - (h - 1) / 2) * CELL_PIXELS;
    const near = { x: worldX(wooded, 17), z };
    expect(featureDrag(wooded, near.x, near.z)).toBe(0.75);
  });
});

describe("pursuit sidestep", () => {
  // Flash holder at (0,0) with a live grudge on a foe at (200,0): inside
  // the 220 stand-off, inside the 650 anchor leash, inside disengage.
  const route: RoutePoint[] = [
    { x: 0, z: 0 },
    { x: 0, z: 400 },
  ];
  const foes = [
    { x: 0, z: 0 },
    { x: 200, z: 0 },
  ];
  function holder(sidestep?: { x: number; z: number }): Mover {
    const goal = sidestep ?? foes[1]!;
    return {
      ...initMover(route, yawToTarget({ x: 0, z: 0 }, goal)),
      x: 0,
      z: 0,
      threat: {
        attacker: 1,
        x: 200,
        z: 0,
        ttl: THREAT_MEMORY_DURATION,
        ...(sidestep ? { sidestep } : {}),
      },
    };
  }
  const step = (mover: Mover, live = foes): Mover =>
    advanceMover("flash", mover, route, 1 / 60, 1, null, null, live, null);

  it("walks a carried sidestep while holding at stand-off", () => {
    const next = step(holder({ x: 0, z: 48 }));
    // Full-stride step along the pre-aligned hull (72 u/s): purely lateral.
    expect(next.z).toBeCloseTo(72 / 60, 9);
    expect(next.x).toBeCloseTo(0, 9);
    expect(next.threat?.sidestep).toEqual({ x: 0, z: 48 });
    expect(next.threat?.ttl).toBeLessThan(THREAT_MEMORY_DURATION);
  });

  it("stands still without a sidestep (legacy hold)", () => {
    const next = step(holder());
    expect(next.x).toBe(0);
    expect(next.z).toBe(0);
    expect(next.threat?.sidestep).toBeUndefined();
  });

  it("clears the sidestep on arrival and turns back to the threat", () => {
    const next = step(holder({ x: 0, z: 8 }));
    expect(next.x).toBe(0);
    expect(next.z).toBe(0);
    expect(next.threat).toBeDefined();
    expect(next.threat).not.toHaveProperty("sidestep");
    // Turning from the step bearing (+z) back toward the foe (+x).
    expect(next.hull).toBeGreaterThan(0);
  });

  it("keeps walking a sidestep across the stand-off boundary (no self-cancel)", () => {
    // Flash holder exactly at its 220 stand-off with a live grudge: the
    // first lateral strides push it just past stand-off — the step must
    // still be walked to arrival, not dropped for a drive back at the foe.
    // Dropping here self-cancels the forest-futility cure: every sidestep
    // died at the boundary and the hull kept firing into the wood.
    const edge = [
      { x: 0, z: 0 },
      { x: 220, z: 0 },
    ];
    const mover: Mover = {
      ...initMover(route, yawToTarget({ x: 0, z: 0 }, { x: 0, z: 48 })),
      x: 0,
      z: 0,
      threat: {
        attacker: 1,
        x: 220,
        z: 0,
        ttl: THREAT_MEMORY_DURATION,
        sidestep: { x: 0, z: 48 },
      },
    };
    let next = mover;
    for (let n = 0; n < 20; n++) next = step(next, edge);
    // Walked laterally off the firing line instead of closing on the foe.
    expect(next.z).toBeGreaterThan(10);
    expect(next.x).toBeCloseTo(0, 6);
    expect(next.threat?.attacker).toBe(1);
    expect(next.threat?.sidestep).toEqual({ x: 0, z: 48 });
  });

  it("walks a carried sidestep while closing (fresh steps finish)", () => {
    // Contract change (was: "drops while closing as stale"): a carried step
    // is scored fresh at attach and walks in ~1 s, so the geometry cannot
    // go stale mid-stride — and dropping it on the close self-cancelled the
    // forest-futility cure the stride the hull crossed stand-off. Closers
    // therefore walk the step first, then resume the close on arrival.
    const far = [
      { x: 0, z: 0 },
      { x: 500, z: 0 },
    ];
    const mover: Mover = {
      ...initMover(route, yawToTarget({ x: 0, z: 0 }, { x: 0, z: 48 })),
      x: 0,
      z: 0,
      threat: {
        attacker: 1,
        x: 500,
        z: 0,
        ttl: THREAT_MEMORY_DURATION,
        sidestep: { x: 0, z: 48 },
      },
    };
    const next = step(mover, far);
    // Full-stride step along the pre-aligned hull (72 u/s): purely lateral,
    // the point surviving the close for the walk.
    expect(next.z).toBeCloseTo(72 / 60, 9);
    expect(next.x).toBeCloseTo(0, 9);
    expect(next.threat?.attacker).toBe(1);
    expect(next.threat?.sidestep).toEqual({ x: 0, z: 48 });
  });
});

describe("isMoverMoving", () => {
  const parked: Mover = { x: 0, z: 0, hull: 0, leg: 1 };

  it("reads displacement as moving, stillness as stationary", () => {
    expect(isMoverMoving(parked, true)).toBe(true);
    expect(isMoverMoving(parked, false)).toBe(false);
  });

  it("reads holds as stationary even when jostled", () => {
    const held = holdMover(parked);
    // Separation can shove a held hull — displacement without driving.
    expect(isMoverMoving(held, true)).toBe(false);
    expect(isMoverMoving(held, false)).toBe(false);
  });

  it("reads stun beats as stationary even mid-recoil-slide", () => {
    const stunned = stunMover(parked, 0.16);
    expect(stunned.stun).toBeGreaterThan(0);
    // The recoil slide displaces the hull, but recoil is involuntary —
    // never driving — so the beat reads stationary throughout.
    expect(isMoverMoving(stunned, true)).toBe(false);
    expect(isMoverMoving(stunned, false)).toBe(false);
  });

  it("treats an expired stun like no stun", () => {
    expect(isMoverMoving({ ...parked, stun: 0 }, true)).toBe(true);
    expect(isMoverMoving({ ...parked, stun: 0 }, false)).toBe(false);
  });

  it("reads every drive mode off the same displacement leg", () => {
    // Orders, patrol legs, threat pursuits, departures, and separation
    // coasts all displace through the drive — what matters is whether the
    // hull moved, not which intent moved it.
    const ordered = orderMover(parked, [{ x: 100, z: 0 }]);
    expect(isMoverMoving(ordered, true)).toBe(true);
    expect(isMoverMoving(ordered, false)).toBe(false);
    const coasting: Mover = { ...parked, sep: { x: 2, z: 0 } };
    expect(isMoverMoving(coasting, true)).toBe(true);
    expect(isMoverMoving(coasting, false)).toBe(false);
  });
});

describe("proper turns (pivot discipline)", () => {
  const DT = 1 / 60;
  const yawDelta = (a: number, b: number): number =>
    Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

  it("pivots deliberately when held instead of whipping at full traverse", () => {
    // Dead-astern target with spacing 0 (crowd-held, no translation): the
    // hull neutral-steers at the pivot floor, not the traverse cap — a
    // held flash turns 45° in ~1s, not ~0.35s.
    for (const kind of UNIT_KINDS) {
      const mover: Mover = { x: 0, z: 400, hull: 0, leg: 0 };
      const route: RoutePoint[] = [
        { x: 0, z: 400 },
        { x: 0, z: -400 },
      ];
      const next = advanceMover(kind, mover, route, DT, 0);
      const cap = HULL_TURN_RATE[kind] ?? 1.5;
      expect(Math.abs(next.hull - mover.hull)).toBeCloseTo(
        (HULL_PIVOT_FLOOR[kind] ?? 0.35) * cap * DT,
        9,
      );
      // Strictly below the old full-traverse whip.
      expect(Math.abs(next.hull - mover.hull)).toBeLessThan(cap * DT);
      // Still facing travel (holding still, so the hull only yaws).
      expect(next.x).toBe(mover.x);
      expect(next.z).toBe(mover.z);
    }
  });

  it("keeps full traverse carving arcs at speed", () => {
    // Small heading correction at full speed: past the blend band authority
    // is exactly 1, so aligned flight settles bit-identically to before
    // (no circling regression possible — rolling turns are untouched).
    for (const kind of UNIT_KINDS) {
      const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
      const route: RoutePoint[] = [
        { x: 0, z: 0 },
        { x: 40, z: 400 },
      ];
      const next = advanceMover(kind, mover, route, DT, 1);
      const cap = HULL_TURN_RATE[kind] ?? 1.5;
      expect(Math.abs(next.hull - mover.hull)).toBeCloseTo(cap * DT, 12);
    }
  });

  it("never exceeds the traverse cap on any tick, in any drive regime", () => {
    // The continuity pin: ordered diagonals, patrol-leg switches, pursuit
    // flips, separation jostles, stuns, and departures all evolve hull yaw
    // through the capped turn rate — no tick may snap.
    const map = generateMap("greenreach", 42);
    const routes = planRoutes(map, map.units, 42);
    const kinds = map.units.map((u) => u.kind);
    const field = map as unknown as SeatField;
    const worst: number[] = kinds.map(() => 0);
    const note = (before: Mover, after: Mover, i: number): void => {
      const d = yawDelta(before.hull, after.hull);
      if (d > worst[i]!) worst[i] = d;
    };

    // Ordered diagonal completion across the whole roster.
    let sim: Mover[] = map.units.map((u, i) => {
      const m = { x: 0, z: 0, hull: u.rotation, leg: 1 } as Mover;
      const spawn = routes[i]![0]!;
      m.x = spawn.x;
      m.z = spawn.z;
      const gx = spawn.x > 0 ? -1200 : 1200;
      const gz = spawn.z > 0 ? -1200 : 1200;
      return orderMover(m, findWorldPath(field, { x: m.x, z: m.z }, { x: gx, z: gz }));
    });
    for (let t = 0; t < 2400 && sim.some((m) => m.order); t++) {
      const prev = sim;
      sim = advanceMovers(kinds, sim, routes, DT, field);
      sim.forEach((m, i) => note(prev[i]!, m, i));
    }

    // Patrol-leg switches on a second map.
    {
      const dusty = generateMap("dustplains", 7);
      const dustyRoutes = planRoutes(dusty, dusty.units, 7);
      const dustyKinds = dusty.units.map((u) => u.kind);
      const dustyField = dusty as unknown as SeatField;
      const dustyWorst: number[] = dustyKinds.map(() => 0);
      let patrol: Mover[] = dusty.units.map((u, i) => {
        const spawn = dustyRoutes[i]![0]!;
        return { x: spawn.x, z: spawn.z, hull: u.rotation, leg: 1 } as Mover;
      });
      for (let t = 0; t < 1200; t++) {
        const prev = patrol;
        patrol = advanceMovers(dustyKinds, patrol, dustyRoutes, DT, dustyField);
        patrol.forEach((m, i) => {
          const d = yawDelta(prev[i]!.hull, m.hull);
          if (d > dustyWorst[i]!) dustyWorst[i] = d;
        });
      }
      dustyKinds.forEach((kind, i) => {
        const cap = (HULL_TURN_RATE[kind] ?? 1.5) * DT;
        expect(dustyWorst[i]).toBeLessThanOrEqual(cap + 1e-9);
      });
    }

    // Pursuit flips: a live foe teleports across the victim twice a second,
    // whipping the desired bearing 180° — the hull must still slew capped.
    {
      let victim: Mover = {
        x: 0, z: 0, hull: 0, leg: 1,
        threat: { attacker: 1, x: 300, z: 0, ttl: THREAT_MEMORY_DURATION },
      };
      const lane = [
        { x: 0, z: 0 },
        { x: 0, z: 400 },
      ];
      let flipWorst = 0;
      for (let t = 0; t < 600; t++) {
        const side = Math.floor(t / 30) % 2 === 0 ? 1 : -1;
        const foes = [{ x: victim.x, z: victim.z }, { x: side * 300, z: 0 }];
        const prev = victim;
        victim = advanceMover("flash", victim, lane, DT, 1, null, null, foes);
        // Re-hit every flip so the memory never expires mid-probe.
        if (t % 30 === 0 && victim.threat) victim = { ...victim, threat: { ...victim.threat, ttl: THREAT_MEMORY_DURATION } };
        flipWorst = Math.max(flipWorst, yawDelta(prev.hull, victim.hull));
      }
      expect(flipWorst).toBeLessThanOrEqual((HULL_TURN_RATE.flash ?? 1.5) * DT + 1e-9);
    }

    // Separation jostle: a head-on ordered pair through each other.
    {
      const pairKinds = ["flash", "flash"] as const;
      let pair: Mover[] = [
        orderMover({ x: -100, z: 0, hull: Math.PI / 2, leg: 0 }, [{ x: 100, z: 0 }]),
        orderMover({ x: 100, z: 0, hull: -Math.PI / 2, leg: 0 }, [{ x: -100, z: 0 }]),
      ];
      const pairWorst = [0, 0];
      for (let t = 0; t < 600; t++) {
        const prev = pair;
        pair = advanceMovers([...pairKinds], pair, [[], []], DT, null);
        pair.forEach((m, i) => {
          pairWorst[i] = Math.max(pairWorst[i]!, yawDelta(prev[i]!.hull, m.hull));
        });
      }
      for (const w of pairWorst) expect(w).toBeLessThanOrEqual((HULL_TURN_RATE.flash ?? 1.5) * DT + 1e-9);
    }

    // Stun beat + departure lead-in: turn-while-recoiling and the HQ exit.
    {
      let stunned = stunMover(
        { x: 0, z: 0, hull: 0, leg: 1 },
        0.5,
        { x: 50, z: 0 },
      );
      const lane = [
        { x: 0, z: 0 },
        { x: -400, z: 0 },
      ];
      let stunWorst = 0;
      for (let t = 0; t < 120 && stunned.stun !== undefined; t++) {
        const prev = stunned;
        stunned = advanceMover("stump", stunned, lane, DT, 1, null);
        stunWorst = Math.max(stunWorst, yawDelta(prev.hull, stunned.hull));
      }
      expect(stunWorst).toBeLessThanOrEqual((HULL_TURN_RATE.stump ?? 1.5) * DT + 1e-9);
      let exit: Mover = {
        x: 0, z: 0, hull: Math.PI / 2, leg: 0, leadIn: { x: 0, z: 320 },
      };
      const loop = [
        { x: 160, z: 320 },
        { x: 160, z: -320 },
      ];
      let exitWorst = 0;
      for (let t = 0; t < 1200; t++) {
        const prev = exit;
        exit = advanceMover("hammer", exit, loop, DT, 1, null);
        exitWorst = Math.max(exitWorst, yawDelta(prev.hull, exit.hull));
        if (!exit.leadIn) break;
      }
      expect(exitWorst).toBeLessThanOrEqual((HULL_TURN_RATE.hammer ?? 1.5) * DT + 1e-9);
    }

    kinds.forEach((kind, i) => {
      const cap = (HULL_TURN_RATE[kind] ?? 1.5) * DT;
      expect(worst[i]).toBeLessThanOrEqual(cap + 1e-9);
    });
  });

  it("turns every rolling recovery at full traverse (capture intact)", () => {
    // The grip/blend coupling, pinned at the contract level: the grip floor
    // sits above the authority blend, so even a fully-spun recovery crawl
    // carries full authority — recovery arcs keep their tuned radii inside
    // ARRIVE_RADIUS for every kind. A future grip/rate edit that breaks
    // this fails here first, before staging loops start circling.
    expect(GRIP_FLOOR).toBe(0.3);
    for (const kind of UNIT_KINDS) {
      const top = MOVE_SPEED[kind] ?? 32;
      const v = GRIP_FLOOR * top;
      expect(turnAuthority(kind, v, top)).toBe(1);
      const omega = (HULL_TURN_RATE[kind] ?? 1.5) * turnAuthority(kind, v, top);
      expect(v / omega).toBeLessThan(ARRIVE_RADIUS - 2);
    }
  });

  it("keeps rolling corners at full traverse and completes (no orbiting)", () => {
    // Rolling-full contract, end to end: a 90° ordered corner turns at the
    // traverse cap exactly as before pivot discipline (held-only by design
    // — slowing rolling turns circled staging loops and bullied slow hulls
    // off their lanes), and the order completes instead of orbiting.
    const dt = 1 / 60;
    let m = orderMover({ x: 0, z: -400, hull: 0, leg: 0 }, [
      { x: 0, z: 400 },
      { x: 400, z: 400 },
    ]);
    const route = [{ x: 0, z: 0 }];
    let cornerStart = -1;
    let cornerEnd = -1;
    let ticks = 0;
    for (; ticks < 2000; ticks++) {
      m = advanceMover("flash", m, route, dt, 1, null);
      if (!m.order) break;
      if (m.order.at === 1 && cornerStart < 0) cornerStart = ticks;
      if (cornerStart >= 0 && cornerEnd < 0 && Math.abs(m.hull - Math.PI / 2) < (5 * Math.PI) / 180) {
        cornerEnd = ticks;
      }
    }
    expect(m.order).toBeUndefined();
    expect(cornerStart).toBeGreaterThanOrEqual(0);
    expect(cornerEnd).toBeGreaterThan(cornerStart);
    // Full-traverse pace for 90° at 2.2 rad/s is ~40 ticks; the corner must
    // hold that pace (a slower corner means rolling authority regressed).
    const cornerTicks = cornerEnd - cornerStart;
    expect(cornerTicks).toBeGreaterThan(35);
    expect(cornerTicks).toBeLessThan(46);
  });
});
