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
  HUNT_ENGAGE_RADIUS,
  HUNT_LEASH_RADIUS,
  HQ_DEFENSE_HITS,
  SHELL_ENGAGE_RADIUS,
  THREAT_DISENGAGE_RADIUS,
  THREAT_ENGAGE_RADIUS,
  THREAT_LEASH_RADIUS,
  THREAT_MEMORY_DURATION,
  acquireHunt,
  advanceMemory,
  clearThreat,
  hasThreat,
  notifyThreat,
  pursueStandOff,
  seekEngage,
  seekStructure,
  tickThreat,
} from "./retaliation.js";
import { wrapAngle, yawToTarget } from "./facing.js";

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

describe("seekEngage", () => {
  it("closes on a target past the retaliation engage radius (no notice gate)", () => {
    const mover = initMover(flatRoute(), 0);
    // A gun in admitted range (hammer reaches 1000) but behind a ridge must
    // still reposition: the seek has no engage-radius gate (the anchor sits
    // near the target, so the local leash still passes).
    const next = seekEngage(mover, mover, 1, THREAT_ENGAGE_RADIUS + 100, 0, { x: 700, z: 0 });
    expect(hasThreat(next)).toBe(true);
    expect(next.threat).toMatchObject({
      attacker: 1,
      x: THREAT_ENGAGE_RADIUS + 100,
      z: 0,
      ttl: THREAT_MEMORY_DURATION,
    });
    expect(mover.threat).toBeUndefined();
  });

  it("seeks structures with no roster row (attacker -1 reads last-known)", () => {
    const mover = initMover(flatRoute(), 0);
    const next = seekEngage(mover, mover, -1, 400, 100, { x: 0, z: 0 });
    expect(hasThreat(next)).toBe(true);
    expect(next.threat?.attacker).toBe(-1);
  });

  it("lets player orders win: ordered and holding hulls stay put", () => {
    const route = flatRoute();
    const ordered = orderMover(initMover(route, 0), [{ x: 500, z: 500 }]);
    expect(seekEngage(ordered, ordered, 1, 100, 0, route[0]).threat).toBeUndefined();
    const holding: Mover = { ...initMover(route, 0), hold: true };
    expect(seekEngage(holding, holding, 1, 100, 0, route[0]).threat).toBeUndefined();
  });

  it("keeps the local leash: cross-map targets never pull a patrol off its loop", () => {
    const mover = initMover(flatRoute(), 0);
    const next = seekEngage(mover, mover, 1, THREAT_LEASH_RADIUS + 50, 0, { x: 0, z: 0 });
    expect(hasThreat(next)).toBe(false);
    expect(next.threat).toBeUndefined();
  });

  it("refreshes a live memory in place, preserving a hunt leash", () => {
    const route = flatRoute();
    const hunting: Mover = {
      ...initMover(route, 0),
      threat: { attacker: 2, x: 500, z: 0, ttl: 6, leash: HUNT_LEASH_RADIUS },
    };
    const next = seekEngage(hunting, hunting, 2, 520, 20, route[0]);
    expect(next.threat).toMatchObject({ attacker: 2, x: 520, z: 20, ttl: THREAT_MEMORY_DURATION });
    // The wide hunt leash survives the refresh (no mid-chase collapse).
    expect(next.threat?.leash).toBe(HUNT_LEASH_RADIUS);
  });

  it("rejects invalid attackers and positions", () => {
    const mover = initMover(flatRoute(), 0);
    expect(seekEngage(mover, mover, -2, 100, 0, null).threat).toBeUndefined();
    expect(seekEngage(mover, mover, 1.5, 100, 0, null).threat).toBeUndefined();
    expect(seekEngage(mover, mover, 1, Number.NaN, 0, null).threat).toBeUndefined();
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

  it("honors the leash carried on the memory (hunt ranges wider)", () => {
    const route = flatRoute();
    const victim = { ...initMover(route, 0), hull: 0 };
    // Threat past the retaliation leash but inside the hunt leash: a hunt
    // memory keeps steering where a retaliation memory gives up.
    const hunted: Mover = {
      ...victim,
      threat: { attacker: 1, x: THREAT_LEASH_RADIUS + 200, z: 0, ttl: THREAT_MEMORY_DURATION, leash: HUNT_LEASH_RADIUS },
    };
    const foes = [
      { x: victim.x, z: victim.z },
      { x: THREAT_LEASH_RADIUS + 200, z: 0 },
    ];
    const chasing = advanceMover("stump", hunted, route, 1, 1, null, null, foes);
    expect(hasThreat(chasing)).toBe(true);
    const retaliated: Mover = {
      ...victim,
      threat: { attacker: 1, x: THREAT_LEASH_RADIUS + 200, z: 0, ttl: THREAT_MEMORY_DURATION },
    };
    const dropped = advanceMover("stump", retaliated, route, 1, 1, null, null, foes);
    expect(hasThreat(dropped)).toBe(false);
  });
});

describe("advanceMemory", () => {
  it("points at a position with no roster grudge on the hunt leash", () => {
    const memory = advanceMemory(1300, -50);
    expect(memory).toMatchObject({
      attacker: -1,
      x: 1300,
      z: -50,
      ttl: THREAT_MEMORY_DURATION,
      leash: HUNT_LEASH_RADIUS,
    });
  });

  it("refuses non-finite positions", () => {
    expect(advanceMemory(Number.NaN, 0)).toBeNull();
    expect(advanceMemory(0, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("keeps driving toward the spot past the disengage bound (it cannot flee)", () => {
    const route = flatRoute();
    // 1300 sits past the 1250 disengage bound but inside the hunt leash of
    // the anchor, so a live grudge would give up here while the position
    // memory keeps steering.
    const memory = advanceMemory(THREAT_DISENGAGE_RADIUS + 50, 0)!;
    const advancing: Mover = { ...initMover(route, 0), hull: 0, threat: memory };
    const start = Math.hypot(advancing.x - memory.x, advancing.z - memory.z);
    const next = advanceMover("stump", advancing, route, 1);
    expect(hasThreat(next)).toBe(true);
    expect(next.threat?.attacker).toBe(-1);
    expect(Math.hypot(next.x - memory.x, next.z - memory.z)).toBeLessThan(start);
  });

  it("still gives up past the anchor leash and on expiry", () => {
    const route = flatRoute();
    const far: Mover = {
      ...initMover(route, 0),
      hull: 0,
      threat: { attacker: -1, x: HUNT_LEASH_RADIUS + 200, z: 0, ttl: THREAT_MEMORY_DURATION, leash: HUNT_LEASH_RADIUS },
    };
    expect(hasThreat(advanceMover("stump", far, route, 1))).toBe(false);
    const stale: Mover = { ...initMover(route, 0), hull: 0, threat: advanceMemory(500, 0)! };
    const expired = advanceMover("stump", stale, route, THREAT_MEMORY_DURATION + 1);
    expect(hasThreat(expired)).toBe(false);
    expect("threat" in expired).toBe(false);
  });

  it("keeps the carried leash across drive ticks (wide chases stay wide)", () => {
    const route = flatRoute();
    const hunted: Mover = {
      ...initMover(route, 0),
      hull: 0,
      threat: { attacker: 1, x: THREAT_LEASH_RADIUS + 150, z: 0, ttl: THREAT_MEMORY_DURATION, leash: HUNT_LEASH_RADIUS },
    };
    const foes = [
      { x: 0, z: 0 },
      { x: THREAT_LEASH_RADIUS + 150, z: 0 },
    ];
    // Past the retaliation leash: the first step already steers (covered
    // above), and the refreshed memory keeps the wide leash so the second
    // step still pursues instead of collapsing to the tight anchor guard.
    const first = advanceMover("stump", hunted, route, 1, 1, null, null, foes);
    expect(hasThreat(first)).toBe(true);
    expect(first.threat?.leash).toBe(HUNT_LEASH_RADIUS);
    const second = advanceMover("stump", { ...first, hull: first.hull }, route, 1, 1, null, null, foes);
    expect(hasThreat(second)).toBe(true);
  });
});

describe("acquireHunt", () => {
  // Two live enemies east of a west-side hull; one same-team mate nearby.
  const teams = [0, 0, 1, 1];
  const anchor = { x: 0, z: 0 };
  const foesNear = [
    { x: 0, z: 0 }, // self (team 0)
    { x: 100, z: 0 }, // mate (team 0): never hunted
    { x: 500, z: 0 }, // enemy (team 1): nearest
    { x: 900, z: 0 }, // enemy (team 1): farther
  ];
  const alive = [true, true, true, true];

  function idle(): Mover {
    return initMover(flatRoute(), 0);
  }

  it("points an idle hull at the nearest live enemy on the hunt leash", () => {
    const next = acquireHunt(idle(), 0, teams, foesNear, alive, anchor);
    expect(hasThreat(next)).toBe(true);
    expect(next.threat).toMatchObject({ attacker: 2, x: 500, z: 0, ttl: THREAT_MEMORY_DURATION });
    // Hunt memories range wider than retaliation ones.
    expect(next.threat?.leash).toBe(HUNT_LEASH_RADIUS);
    // Pure: the input mover is untouched.
    expect(idle().threat).toBeUndefined();
  });

  it("notices enemies past the retaliation engage gate (wider hunt eyes)", () => {
    const far = [
      { x: 0, z: 0 },
      { x: -5000, z: 0 }, // mate far away
      { x: THREAT_ENGAGE_RADIUS + 100, z: 0 }, // enemy past retaliation notice…
      { x: 5000, z: 0 },
    ];
    const next = acquireHunt(idle(), 0, teams, far, alive, anchor);
    // …but inside the hunt engage gate and the hunt leash of the anchor.
    expect(next.threat?.attacker).toBe(2);
  });

  it("ignores enemies past the hunt engage gate or the hunt leash", () => {
    const distant = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: HUNT_ENGAGE_RADIUS + 100, z: 0 },
      { x: 5000, z: 0 },
    ];
    expect(hasThreat(acquireHunt(idle(), 0, teams, distant, alive, anchor))).toBe(false);
    // Inside engage but past the anchor leash: beneath notice.
    const unleashed = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 500, z: 0 },
      { x: 5000, z: 0 },
    ];
    const farAnchor = { x: -5000, z: 0 };
    expect(hasThreat(acquireHunt(idle(), 0, teams, unleashed, alive, farAnchor))).toBe(false);
  });

  it("never hunts its own side, wrecks, itself, or unknown hulls", () => {
    // Only the mate is close: no acquisition (same team).
    const mateOnly = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 5000, z: 0 },
      { x: -5000, z: 0 },
    ];
    expect(hasThreat(acquireHunt(idle(), 0, teams, mateOnly, alive, anchor))).toBe(false);
    // Nearest enemy is a wreck: the farther live enemy takes the memory.
    const wrecked = [true, true, false, true];
    const next = acquireHunt(idle(), 0, teams, foesNear, wrecked, anchor);
    expect(next.threat?.attacker).toBe(3);
    // The hunter itself is wrecked (belt-and-braces): nothing acquired.
    expect(hasThreat(acquireHunt(idle(), 0, teams, foesNear, [false, true, true, true], anchor))).toBe(false);
    // Unknown sides on both ends: nothing acquired.
    expect(
      hasThreat(acquireHunt(idle(), 0, [undefined, undefined, undefined, undefined], foesNear, alive, anchor)),
    ).toBe(false);
  });

  it("lets player orders win and never stacks on a live memory", () => {
    const route = flatRoute();
    const ordered = orderMover(idle(), [{ x: 500, z: 500 }]);
    expect(acquireHunt(ordered, 0, teams, foesNear, alive, route[0]).threat).toBeUndefined();
    const holding: Mover = { ...idle(), hold: true };
    expect(acquireHunt(holding, 0, teams, foesNear, alive, route[0]).threat).toBeUndefined();
    const busy = acquireHunt(idle(), 0, teams, foesNear, alive, anchor);
    expect(hasThreat(busy)).toBe(true);
    // A live memory is never overwritten by the sweep.
    const again = acquireHunt(busy, 0, teams, foesNear, alive, anchor);
    expect(again.threat).toEqual(busy.threat);
  });

  it("rejects invalid callers and positions", () => {
    const mover = idle();
    expect(acquireHunt(mover, -1, teams, foesNear, alive, anchor).threat).toBeUndefined();
    expect(acquireHunt(mover, 9, teams, foesNear, alive, anchor).threat).toBeUndefined();
    const nanFoes = [{ x: Number.NaN, z: 0 }, ...foesNear.slice(1)];
    expect(acquireHunt(mover, 0, teams, nanFoes, alive, anchor).threat).toBeUndefined();
  });
});

describe("shell investigate", () => {
  it("records a distant shell hit as a hunt-leash investigate memory", () => {
    const route = flatRoute();
    const mover = initMover(route, 0);
    // A hammer shelling from 1000: past the bolt envelope, inside the shell
    // engage gate and the hunt leash of the anchor.
    const next = notifyThreat(mover, mover, 1, 1000, 0, route[0], true);
    expect(hasThreat(next)).toBe(true);
    expect(next.threat).toMatchObject({
      attacker: 1,
      x: 1000,
      z: 0,
      ttl: THREAT_MEMORY_DURATION,
      leash: HUNT_LEASH_RADIUS,
    });
    expect(mover.threat).toBeUndefined();
  });

  it("still ignores shells past shell engage or the hunt leash", () => {
    const route = flatRoute();
    const mover = initMover(route, 0);
    // Past the shell engage gate: cross-map artillery never pulls a patrol.
    expect(hasThreat(notifyThreat(mover, mover, 1, SHELL_ENGAGE_RADIUS + 1, 0, route[0], true))).toBe(false);
    // Inside shell engage but past the hunt leash of the anchor: likewise.
    expect(hasThreat(notifyThreat(mover, mover, 1, 1000, 0, { x: -5000, z: 0 }, true))).toBe(false);
  });

  it("records close shell hits as plain retaliation (bolt-identical)", () => {
    const route = flatRoute();
    const next = notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 1, 300, 0, route[0], true);
    expect(next.threat).toMatchObject({ attacker: 1, x: 300, z: 0, ttl: THREAT_MEMORY_DURATION });
    expect(next.threat?.leash).toBeUndefined();
  });

  it("investigates past the bolt leash where a bolt hit stays silent", () => {
    const route = flatRoute();
    const mover = initMover(route, 0);
    // Attacker 800 away: inside bolt engage, past the 650 retaliation leash
    // of the anchor — a bolt hit is ignored, a shell investigates.
    expect(hasThreat(notifyThreat(mover, mover, 1, 800, 0, route[0]))).toBe(false);
    const next = notifyThreat(mover, mover, 1, 800, 0, route[0], true);
    expect(hasThreat(next)).toBe(true);
    expect(next.threat?.leash).toBe(HUNT_LEASH_RADIUS);
  });

  it("refreshes an investigate on shell re-hits, keeping the wide leash", () => {
    const route = flatRoute();
    const live = notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 1, 1000, 0, route[0], true);
    const refreshed = notifyThreat(live, live, 1, 1020, 10, route[0], true);
    expect(hasThreat(refreshed)).toBe(true);
    expect(refreshed.threat).toMatchObject({
      attacker: 1,
      x: 1020,
      z: 10,
      ttl: THREAT_MEMORY_DURATION,
      leash: HUNT_LEASH_RADIUS,
    });
  });

  it("refreshes an investigate on a close hit, keeping the ranging leash", () => {
    const route = flatRoute();
    const live = notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 1, 1000, 0, route[0], true);
    // The gun closed in: position and clock refresh, but the ranging leash
    // survives the re-hit (like seeks and drive ticks) instead of
    // collapsing to the tight anchor guard mid-chase.
    const refreshed = notifyThreat(live, live, 1, 300, 0, route[0]);
    expect(refreshed.threat).toMatchObject({
      attacker: 1, x: 300, z: 0, ttl: THREAT_MEMORY_DURATION, leash: HUNT_LEASH_RADIUS,
    });
  });

  it("lets player orders and holds refuse shells too", () => {
    const route = flatRoute();
    const ordered = orderMover(initMover(route, 0), [{ x: 500, z: 500 }]);
    expect(notifyThreat(ordered, ordered, 1, 1000, 0, route[0], true).threat).toBeUndefined();
    const holding: Mover = { ...initMover(route, 0), hold: true };
    expect(notifyThreat(holding, holding, 1, 1000, 0, route[0], true).threat).toBeUndefined();
  });

  it("drives an investigate toward the firing position, facing it", () => {
    const route = flatRoute();
    // Hull starts facing away from the firing position (east); the drive
    // must turn toward it and close the distance.
    const victim = { ...notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 1, 1000, 0, route[0], true), hull: Math.PI };
    const foes = [
      { x: 0, z: 0 },
      { x: 1000, z: 0 },
    ];
    const start = Math.hypot(victim.x - 1000, victim.z - 0);
    const want = yawToTarget(victim, { x: 1000, z: 0 });
    const turnBefore = Math.abs(wrapAngle(victim.hull - want));
    const next = advanceMover("stump", victim, route, 1, 1, null, null, foes);
    expect(hasThreat(next)).toBe(true);
    expect(Math.hypot(next.x - 1000, next.z - 0)).toBeLessThan(start);
    expect(Math.abs(wrapAngle(next.hull - want))).toBeLessThan(turnBefore);
  });

  it("gives up the investigate on expiry and past the hunt leash", () => {
    const route = flatRoute();
    const victim = { ...notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 1, 1000, 0, route[0], true), hull: 0 };
    const expired = advanceMover("stump", victim, route, THREAT_MEMORY_DURATION + 1);
    expect(hasThreat(expired)).toBe(false);
    expect("threat" in expired).toBe(false);
    // Past the hunt leash of the anchor: the drive lets go like any pursuit.
    const far: Mover = {
      ...initMover(route, 0),
      hull: 0,
      threat: {
        attacker: 1, x: HUNT_LEASH_RADIUS + 200, z: 0, ttl: THREAT_MEMORY_DURATION, leash: HUNT_LEASH_RADIUS,
      },
    };
    const foes = [{ x: 0, z: 0 }, { x: HUNT_LEASH_RADIUS + 200, z: 0 }];
    expect(hasThreat(advanceMover("stump", far, route, 1, 1, null, null, foes))).toBe(false);
  });
});

describe("seekStructure", () => {
  it("marks an HQ assault distinct from a team-advance waypoint", () => {
    const mover = initMover(flatRoute(), 0);
    const next = seekStructure(mover, mover, 400, 100, { x: 0, z: 0 });
    expect(hasThreat(next)).toBe(true);
    expect(next.threat).toMatchObject({
      attacker: -1,
      x: 400,
      z: 100,
      ttl: THREAT_MEMORY_DURATION,
      structure: true,
    });
    // Pure: the input mover is untouched.
    expect(mover.threat).toBeUndefined();
  });

  it("lets player orders win and keeps the local leash", () => {
    const route = flatRoute();
    const ordered = orderMover(initMover(route, 0), [{ x: 500, z: 500 }]);
    expect(seekStructure(ordered, ordered, 100, 0, route[0]).threat).toBeUndefined();
    const holding: Mover = { ...initMover(route, 0), hold: true };
    expect(seekStructure(holding, holding, 100, 0, route[0]).threat).toBeUndefined();
    // Past the patrol-anchor leash: no cross-map fort pushes.
    const mover = initMover(route, 0);
    expect(seekStructure(mover, mover, THREAT_LEASH_RADIUS + 50, 0, route[0]).threat).toBeUndefined();
  });

  it("never overwrites a live grudge (finish the enemy first)", () => {
    const route = flatRoute();
    const fighting = notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 1, 300, 0, route[0]);
    expect(fighting.threat?.attacker).toBe(1);
    // An obstructed fort shot while brawling leaves the grudge alone.
    const next = seekStructure(fighting, fighting, 400, 100, route[0]);
    expect(next.threat?.attacker).toBe(1);
    expect(next.threat?.structure).toBeUndefined();
  });

  it("takes over a team-advance waypoint, keeping the carried leash", () => {
    const route = flatRoute();
    const advancing: Mover = { ...initMover(route, 0), threat: advanceMemory(500, 0)! };
    const next = seekStructure(advancing, advancing, 400, 100, route[0]);
    expect(next.threat).toMatchObject({ attacker: -1, structure: true, x: 400, z: 100 });
    // The wide advance leash survives the takeover (no mid-push collapse).
    expect(next.threat?.leash).toBe(HUNT_LEASH_RADIUS);
  });

  it("refreshes a live assault in place, preserving its challenger", () => {
    const route = flatRoute();
    const assaulting: Mover = {
      ...initMover(route, 0),
      threat: {
        attacker: -1, x: 400, z: 100, ttl: 6, structure: true,
        challenger: { attacker: 1, hits: 2, x: 300, z: 0 },
      },
    };
    const next = seekStructure(assaulting, assaulting, 410, 110, route[0]);
    expect(next.threat).toMatchObject({ attacker: -1, structure: true, x: 410, z: 110 });
    expect(next.threat?.challenger).toEqual({ attacker: 1, hits: 2, x: 300, z: 0 });
  });

  it("rejects non-finite targets", () => {
    const mover = initMover(flatRoute(), 0);
    expect(seekStructure(mover, mover, Number.NaN, 0, null).threat).toBeUndefined();
  });
});

describe("HQ defense (assault under fire)", () => {
  function assaulting(): Mover {
    const route = flatRoute();
    return seekStructure(initMover(route, 0), { x: 0, z: 0 }, 400, 100, route[0]);
  }

  it("holds the fort through stray splashes, counting the challenger", () => {
    const route = flatRoute();
    const first = notifyThreat(assaulting(), { x: 0, z: 0 }, 1, 300, 0, route[0]);
    expect(first.threat?.attacker).toBe(-1);
    expect(first.threat?.structure).toBe(true);
    expect(first.threat?.challenger).toEqual({ attacker: 1, hits: 1, x: 300, z: 0 });
    const second = notifyThreat(first, { x: 0, z: 0 }, 1, 320, 20, route[0]);
    expect(second.threat?.attacker).toBe(-1);
    expect(second.threat?.challenger).toMatchObject({ attacker: 1, hits: 2, x: 320, z: 20 });
  });

  it("retargets onto a consistent attacker at the threshold, then fights normally", () => {
    const route = flatRoute();
    let mover = assaulting();
    mover = notifyThreat(mover, { x: 0, z: 0 }, 1, 300, 0, route[0]);
    mover = notifyThreat(mover, { x: 0, z: 0 }, 1, 310, 10, route[0]);
    const turned = notifyThreat(mover, { x: 0, z: 0 }, 1, 320, 20, route[0]);
    expect(turned.threat).toMatchObject({ attacker: 1, x: 320, z: 20, ttl: THREAT_MEMORY_DURATION });
    // A live grudge now: no fort flag, no challenger count, squad-focusable.
    expect(turned.threat?.structure).toBeUndefined();
    expect(turned.threat?.challenger).toBeUndefined();
    expect(HQ_DEFENSE_HITS).toBe(3);
  });

  it("restarts the count when a different gun chips in", () => {
    const route = flatRoute();
    let mover = notifyThreat(assaulting(), { x: 0, z: 0 }, 1, 300, 0, route[0]);
    mover = notifyThreat(mover, { x: 0, z: 0 }, 1, 310, 0, route[0]);
    const switched = notifyThreat(mover, { x: 0, z: 0 }, 2, 200, 50, route[0]);
    expect(switched.threat?.attacker).toBe(-1);
    expect(switched.threat?.challenger).toMatchObject({ attacker: 2, hits: 1 });
  });

  it("ignores distant chips without touching the count", () => {
    const route = flatRoute();
    const chipped = notifyThreat(assaulting(), { x: 0, z: 0 }, 1, 300, 0, route[0]);
    // Past the engage gate: not worth turning for, count untouched.
    const far = notifyThreat(chipped, { x: 0, z: 0 }, 1, THREAT_ENGAGE_RADIUS + 100, 0, route[0]);
    expect(far.threat?.challenger).toMatchObject({ attacker: 1, hits: 1 });
    // Past the anchor leash: likewise ignored.
    const unleashed = notifyThreat(chipped, { x: 0, z: 0 }, 1, 300, 0, { x: -5000, z: 0 });
    expect(unleashed.threat?.challenger).toMatchObject({ attacker: 1, hits: 1 });
  });

  it("keeps position waypoints stealing immediately (no assault, no count)", () => {
    const route = flatRoute();
    const advancing: Mover = { ...initMover(route, 0), threat: advanceMemory(500, 0)! };
    const stolen = notifyThreat(advancing, advancing, 1, 300, 0, route[0]);
    expect(stolen.threat).toMatchObject({ attacker: 1, x: 300, z: 0, ttl: THREAT_MEMORY_DURATION });
    expect(stolen.threat?.structure).toBeUndefined();
    expect(stolen.threat?.challenger).toBeUndefined();
  });

  it("carries the assault and its challenger through the drive, tracking live positions", () => {
    const route = flatRoute();
    const pushing: Mover = {
      ...initMover(route, 0),
      hull: 0,
      threat: {
        attacker: -1, x: 400, z: 100, ttl: THREAT_MEMORY_DURATION,
        structure: true, challenger: { attacker: 1, hits: 2, x: 500, z: 0 },
      },
    };
    // The challenger sidesteps east; the stored position follows.
    const foes = [
      { x: 0, z: 0 },
      { x: 520, z: 40 },
    ];
    const next = advanceMover("stump", pushing, route, 1, 1, null, null, foes);
    expect(hasThreat(next)).toBe(true);
    expect(next.threat?.attacker).toBe(-1);
    expect(next.threat?.structure).toBe(true);
    expect(next.threat?.challenger).toEqual({ attacker: 1, hits: 2, x: 520, z: 40 });
    // Still marching on the fort (not the challenger).
    const before = Math.hypot(pushing.x - 400, pushing.z - 100);
    expect(Math.hypot(next.x - 400, next.z - 100)).toBeLessThan(before);
  });
});
