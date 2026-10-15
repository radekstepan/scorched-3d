import { describe, expect, it } from "vitest";
import {
  advanceMover,
  advanceMovers,
  initMover,
  orderMover,
  type Mover,
  type RoutePoint,
} from "./movement.js";
import {
  THREAT_DISENGAGE_RADIUS,
  THREAT_ENGAGE_RADIUS,
  THREAT_LEASH_RADIUS,
  THREAT_MEMORY_DURATION,
  clearThreat,
  hasThreat,
  notifyThreat,
  pursueStandOff,
  tickThreat,
} from "./retaliation.js";

function flatRoute(len = 400): RoutePoint[] {
  return [
    { x: 0, z: 0 },
    { x: 0, z: len },
    { x: len, z: len },
    { x: len, z: 0 },
  ];
}

function threatened(attacker = 1, ax = 300, az = 0): Mover {
  const route = flatRoute();
  const mover = initMover(route, 0);
  return notifyThreat(mover, mover, attacker, ax, az, route[0]);
}

describe("notifyThreat", () => {
  it("records a close hit as a live threat memory", () => {
    const mover = initMover(flatRoute(), 0);
    const next = notifyThreat(mover, mover, 1, 300, 0, { x: 0, z: 0 });
    expect(hasThreat(next)).toBe(true);
    expect(next.threat).toMatchObject({ attacker: 1, x: 300, z: 0, ttl: THREAT_MEMORY_DURATION });
    // Pure: the input mover is untouched.
    expect(mover.threat).toBeUndefined();
  });

  it("ignores hits from beyond the engage radius", () => {
    const mover = initMover(flatRoute(), 0);
    const next = notifyThreat(mover, mover, 1, THREAT_ENGAGE_RADIUS + 1, 0, { x: 0, z: 0 });
    expect(hasThreat(next)).toBe(false);
    expect(next.threat).toBeUndefined();
  });

  it("ignores cross-map snipers past the leash even inside engage range", () => {
    const mover = initMover(flatRoute(), 0);
    // Attacker 800 away (inside engage) but far from the anchor (past leash).
    const next = notifyThreat(mover, mover, 1, 800, 0, { x: 0, z: 0 });
    expect(hasThreat(next)).toBe(false);
  });

  it("lets player orders win: ordered and holding hulls record nothing", () => {
    const route = flatRoute();
    const ordered = orderMover(initMover(route, 0), [{ x: 500, z: 500 }]);
    expect(notifyThreat(ordered, ordered, 1, 100, 0, route[0]).threat).toBeUndefined();
    const holding: Mover = { ...initMover(route, 0), hold: true };
    expect(notifyThreat(holding, holding, 1, 100, 0, route[0]).threat).toBeUndefined();
  });

  it("refreshes the same attacker inside disengage, drops past it", () => {
    const route = flatRoute();
    const live = threatened();
    const refreshed = notifyThreat(live, live, 1, THREAT_ENGAGE_RADIUS + 100, 0, route[0]);
    // Same attacker re-hitting past engage but inside disengage refreshes.
    expect(hasThreat(refreshed)).toBe(true);
    expect(refreshed.threat?.x).toBe(THREAT_ENGAGE_RADIUS + 100);
    const gone = notifyThreat(live, live, 1, THREAT_DISENGAGE_RADIUS + 1, 0, route[0]);
    expect(hasThreat(gone)).toBe(false);
    expect(gone.threat).toBeUndefined();
  });

  it("lets a new close attacker steal the memory, keeps it against distant ones", () => {
    const route = flatRoute();
    const live = threatened();
    const stolen = notifyThreat(live, live, 2, 120, 40, route[0]);
    expect(stolen.threat?.attacker).toBe(2);
    const kept = notifyThreat(live, live, 2, THREAT_ENGAGE_RADIUS + 50, 0, route[0]);
    expect(kept.threat?.attacker).toBe(1);
  });

  it("rejects invalid attackers and positions", () => {
    const mover = initMover(flatRoute(), 0);
    expect(notifyThreat(mover, mover, -1, 100, 0, null).threat).toBeUndefined();
    expect(notifyThreat(mover, mover, 1.5, 100, 0, null).threat).toBeUndefined();
    expect(notifyThreat(mover, mover, 1, Number.NaN, 0, null).threat).toBeUndefined();
  });
});

describe("tickThreat / clearThreat / hasThreat", () => {
  it("counts the memory down and drops the key at expiry", () => {
    const live = threatened();
    const ticked = tickThreat(live, 4);
    expect(ticked.threat?.ttl).toBeCloseTo(THREAT_MEMORY_DURATION - 4);
    const expired = tickThreat(live, THREAT_MEMORY_DURATION);
    expect(hasThreat(expired)).toBe(false);
    expect("threat" in expired).toBe(false);
  });

  it("leaves threat-free movers and non-positive steps untouched", () => {
    const mover = initMover(flatRoute(), 0);
    expect(tickThreat(mover, 1)).toBe(mover);
    const live = threatened();
    expect(tickThreat(live, 0)).toBe(live);
    expect(tickThreat(live, -2)).toBe(live);
    expect(clearThreat(mover)).toBe(mover);
  });

  it("sizes stand-off inside the clamp, artillery holding farther out", () => {
    for (const kind of ["flash", "stump", "commander", "hammer"] as const) {
      const standOff = pursueStandOff(kind);
      expect(standOff).toBeGreaterThanOrEqual(150);
      expect(standOff).toBeLessThanOrEqual(800);
      // Every stand-off sits far inside the engage gate, so most pursuits
      // visibly drive before holding.
      expect(standOff).toBeLessThan(THREAT_ENGAGE_RADIUS);
    }
    // Artillery holds farther out than scouts close in.
    expect(pursueStandOff("hammer")).toBeGreaterThan(pursueStandOff("flash"));
  });
});

describe("pursuit driving", () => {
  it("steers a patrolling hull toward the threat, freezing the patrol leg", () => {
    const route = flatRoute();
    const mover = { ...threatened(), hull: 0 };
    const start = Math.hypot(mover.x - 300, mover.z - 0);
    const next = advanceMover("stump", mover, route, 1);
    expect(hasThreat(next)).toBe(true);
    expect(next.leg).toBe(mover.leg);
    expect(Math.hypot(next.x - 300, next.z - 0)).toBeLessThan(start);
  });

  it("tracks a moving attacker through live roster positions", () => {
    const route = flatRoute();
    const victim = { ...threatened(), hull: 0 };
    // Attacker (index 1) sidesteps east; the victim's memory follows.
    const foes = [
      { x: victim.x, z: victim.z },
      { x: 500, z: 100 },
    ];
    const next = advanceMover("stump", victim, route, 0.5, 1, null, null, foes);
    expect(next.threat?.x).toBe(500);
    expect(next.threat?.z).toBe(100);
  });

  it("holds at weapons-range stand-off instead of ramming", () => {
    const route = flatRoute();
    const victim = initMover(route, 0);
    // Attacker well inside the stump's stand-off: the hull turns, not drives.
    const close = notifyThreat(victim, victim, 1, 100, 0, route[0]);
    const next = advanceMover("stump", close, route, 1);
    expect(next.x).toBe(close.x);
    expect(next.z).toBe(close.z);
    expect(hasThreat(next)).toBe(true);
  });

  it("gives up past the disengage bound and resumes the patrol leg", () => {
    const route = flatRoute();
    const victim = { ...threatened(), hull: 0 };
    const foes = [
      { x: victim.x, z: victim.z },
      { x: THREAT_DISENGAGE_RADIUS + 500, z: 0 },
    ];
    const leg = victim.leg;
    const next = advanceMover("stump", victim, route, 1, 1, null, null, foes);
    expect(hasThreat(next)).toBe(false);
    // Patrol resumes: the hull drives toward its leg waypoint again.
    const target = route[leg]!;
    const before = Math.hypot(victim.x - target.x, victim.z - target.z);
    const after = Math.hypot(next.x - target.x, next.z - target.z);
    expect(after).toBeLessThanOrEqual(before);
  });

  it("gives up when the memory expires without a re-hit", () => {
    const route = flatRoute();
    const victim = { ...threatened(), hull: 0 };
    const next = advanceMover("stump", victim, route, THREAT_MEMORY_DURATION + 1);
    expect(hasThreat(next)).toBe(false);
    expect("threat" in next).toBe(false);
  });

  it("gives up when the threat sits past the leash from the anchor", () => {
    const route = flatRoute();
    const victim = { ...threatened(), hull: 0 };
    const foes = [
      { x: victim.x, z: victim.z },
      { x: THREAT_LEASH_RADIUS + 200, z: 0 },
    ];
    const next = advanceMover("stump", victim, route, 1, 1, null, null, foes);
    expect(hasThreat(next)).toBe(false);
  });

  it("keeps ordered hulls on their orders even with a stale memory key", () => {
    const route = flatRoute();
    // Belt-and-braces: a memory key smuggled onto an ordered hull never steers.
    const ordered = orderMover(initMover(route, 0), [{ x: 500, z: 500 }]);
    const smuggled: Mover = {
      ...ordered,
      threat: { attacker: 1, x: -400, z: -400, ttl: THREAT_MEMORY_DURATION },
    };
    const next = advanceMover("stump", smuggled, route, 1);
    const dest = { x: 500, z: 500 };
    const before = Math.hypot(smuggled.x - dest.x, smuggled.z - dest.z);
    const after = Math.hypot(next.x - dest.x, next.z - dest.z);
    expect(after).toBeLessThan(before);
  });

  it("is deterministic: the same hit sequence replays the same drive", () => {
    const route = flatRoute();
    const drive = (): Mover => {
      let mover = { ...notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 1, 300, 0, route[0]), hull: 0 };
      const foes = [
        { x: 0, z: 0 },
        { x: 300, z: 0 },
      ];
      for (let i = 0; i < 20; i++) {
        mover = advanceMover("stump", mover, route, 0.25, 1, null, null, foes);
      }
      return mover;
    };
    expect(drive()).toEqual(drive());
  });

  it("advances a roster pursuit through advanceMovers", () => {
    const route = flatRoute();
    const victim = { ...notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 1, 300, 0, route[0]), hull: 0 };
    const attacker = initMover(route, 0);
    const moved: Mover[] = [
      { ...victim, x: 0, z: 0 },
      { ...attacker, x: 300, z: 0 },
    ];
    const next = advanceMovers(["stump", "flash"], moved, [route, route], 0.5);
    // Victim closes on the attacker; the attacker's own patrol is unaffected.
    expect(Math.hypot(next[0]!.x - 300, next[0]!.z - 0)).toBeLessThan(300);
    expect(hasThreat(next[0]!)).toBe(true);
  });
});
