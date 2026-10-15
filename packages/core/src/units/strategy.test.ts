import { describe, expect, it } from "vitest";
import {
  acquireHunt,
  HUNT_LEASH_RADIUS,
  notifyThreat,
  THREAT_MEMORY_DURATION,
} from "./retaliation.js";
import {
  advanceMover,
  advanceMovers,
  initMover,
  orderMover,
  type Mover,
  type RoutePoint,
} from "./movement.js";
import {
  acquireStrategicHunt,
  battleOdds,
  chooseTarget,
  outnumbered,
  pickStrategicTarget,
  shouldHold,
  squadFocus,
  STRATEGY_HOLD_RATIO,
  targetScore,
} from "./strategy.js";

/** Two teams on a line: self 0 (team 0) at origin, mates + enemies placed per test. */
function roster(
  self: { x: number; z: number },
  mates: { x: number; z: number }[],
  enemies: { x: number; z: number }[],
): {
  positions: { x: number; z: number }[];
  teams: (number | undefined)[];
  alive: boolean[];
} {
  const positions = [self, ...mates, ...enemies];
  const teams = [0, ...mates.map(() => 0), ...enemies.map(() => 1)];
  const alive = positions.map(() => true);
  return { positions, teams, alive };
}

describe("battleOdds", () => {
  it("counts allies around me and enemies around the threat separately", () => {
    // Mate at 100 (near me), enemy scout at 300, enemy column at 2000.
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [{ x: 100, z: 0 }], [
      { x: 300, z: 0 },
      { x: 2000, z: 0 },
      { x: 2050, z: 0 },
    ]);
    // Allies center = me, enemies center = the lone scout: the far column
    // does not count against a fight with the scout.
    const odds = battleOdds(0, 0, 1, positions[0]!, positions[2]!, positions, teams, alive);
    expect(odds.allies).toBe(1);
    expect(odds.enemies).toBe(1);
    expect(odds.allyHp).toBeCloseTo(2);
    expect(odds.enemyHp).toBeCloseTo(1);
    // Same centers on the far column: now the column counts, the scout drops out.
    const far = battleOdds(0, 0, 1, positions[0]!, positions[3]!, positions, teams, alive);
    expect(far.enemies).toBe(2);
    expect(far.enemyHp).toBeCloseTo(2);
  });

  it("weights strength by remaining health, ignoring the dead", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [], [
      { x: 100, z: 0 },
      { x: 200, z: 0 },
    ]);
    const hp = [1, 0.2, 0.3];
    const odds = battleOdds(0, 0, 1, positions[0]!, positions[0]!, positions, teams, alive, hp);
    expect(odds.enemies).toBe(2);
    // Burning hulls count for little: 0.2 + 0.3 against my 1.0.
    expect(odds.enemyHp).toBeCloseTo(0.5);
    expect(odds.allyHp).toBeCloseTo(1);
    // A wreck contributes nothing (count or strength).
    const wrecked = battleOdds(0, 0, 1, positions[0]!, positions[0]!, positions, teams, [true, false, true], hp);
    expect(wrecked.enemies).toBe(1);
    expect(wrecked.enemyHp).toBeCloseTo(0.3);
  });

  it("reads missing health as pristine and counts self once", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [], [{ x: 100, z: 0 }]);
    const odds = battleOdds(0, 0, 0.4, positions[0]!, positions[0]!, positions, teams, alive);
    // Damaged self still counts once, at remaining health.
    expect(odds.allies).toBe(0);
    expect(odds.allyHp).toBeCloseTo(0.4);
  });
});

describe("outnumbered / shouldHold", () => {
  it("holds a lone hull facing a fresh group, engages even fights", () => {
    // 1v1: engage.
    const duel = roster({ x: 0, z: 0 }, [], [{ x: 300, z: 0 }]);
    expect(shouldHold(0, duel.positions, duel.teams, duel.alive)).toBe(false);
    // 1v2 fresh: 2 > 1 * 1.5 — wait for backup.
    const mobbed = roster({ x: 0, z: 0 }, [], [
      { x: 300, z: 0 },
      { x: 350, z: 0 },
    ]);
    expect(shouldHold(0, mobbed.positions, mobbed.teams, mobbed.alive)).toBe(true);
    // 2v2 with a mate nearby: 2 <= 2 * 1.5 — engage together.
    const line = roster({ x: 0, z: 0 }, [{ x: -100, z: 0 }], [
      { x: 300, z: 0 },
      { x: 350, z: 0 },
    ]);
    expect(shouldHold(0, line.positions, line.teams, line.alive)).toBe(false);
  });

  it("engages wounded groups it would refuse fresh (finish the kill)", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [], [
      { x: 300, z: 0 },
      { x: 350, z: 0 },
    ]);
    // Two burning enemies count ~0.5 against my 1.0: below the hold line.
    expect(shouldHold(0, positions, teams, alive, [1, 0.25, 0.25])).toBe(false);
    expect(shouldHold(0, positions, teams, alive)).toBe(true);
  });

  it("never holds with no live enemies, unknown sides, or dead callers", () => {
    const mates = roster({ x: 0, z: 0 }, [{ x: 50, z: 0 }], []);
    expect(shouldHold(0, mates.positions, mates.teams, mates.alive)).toBe(false);
    const unknown = {
      positions: [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
      ],
      teams: [undefined, undefined] as (number | undefined)[],
      alive: [true, true],
    };
    expect(shouldHold(0, unknown.positions, unknown.teams, unknown.alive)).toBe(false);
    const duel = roster({ x: 0, z: 0 }, [], [{ x: 100, z: 0 }]);
    expect(shouldHold(0, duel.positions, duel.teams, [false, true])).toBe(false);
    expect(shouldHold(9, duel.positions, duel.teams, duel.alive)).toBe(false);
  });

  it("judges the destination, not just home, for in-progress pursuits", () => {
    // One scout far from its column, me alone: fighting *here* is even…
    const me = { x: 0, z: 0 };
    const scout = { x: 300, z: 0 };
    const column = [
      { x: 1100, z: 0 },
      { x: 1150, z: 0 },
      { x: 1200, z: 0 },
    ];
    const { positions, teams, alive } = roster(me, [], [scout, ...column]);
    // …but driving into the column's neighbourhood is suicide: hold.
    expect(outnumbered(0, me, scout, positions, teams, alive)).toBe(false);
    expect(outnumbered(0, me, column[0]!, positions, teams, alive)).toBe(true);
  });

  it("holds exactly past the documented ratio", () => {
    // allyHp 2 (me + mate) vs enemyHp just over 3: holds; at 3.0 it engages.
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [{ x: 50, z: 0 }], [
      { x: 300, z: 0 },
      { x: 320, z: 0 },
      { x: 340, z: 0 },
    ]);
    expect(shouldHold(0, positions, teams, alive)).toBe(false); // 3 <= 2 * 1.5
    expect(shouldHold(0, positions, teams, alive, [1, 1, 1, 1, 0.6])).toBe(false);
    const extra = {
      positions: [...positions, { x: 360, z: 0 }],
      teams: [...teams, 1] as (number | undefined)[],
      alive: [...alive, true],
    };
    expect(shouldHold(0, extra.positions, extra.teams, extra.alive)).toBe(true); // 4 > 3
    expect(STRATEGY_HOLD_RATIO).toBe(1.5);
  });
});

describe("squadFocus", () => {
  it("names the enemy most teammates pursue, lowest index on ties", () => {
    const teams = [0, 0, 1, 1, 1];
    const alive = [true, true, true, true, true];
    const threats = [
      { attacker: 2, x: 0, z: 0, ttl: 5 },
      { attacker: 2, x: 0, z: 0, ttl: 5 },
      undefined,
      undefined,
      undefined,
    ];
    expect(squadFocus(0, threats, teams, alive)).toBe(2);
    expect(squadFocus(1, threats, teams, alive)).toBe(-1);
    // Tie between 3 and 4: lowest index wins, deterministically.
    const tied = [
      { attacker: 4, x: 0, z: 0, ttl: 5 },
      { attacker: 3, x: 0, z: 0, ttl: 5 },
      undefined,
      undefined,
      undefined,
    ];
    expect(squadFocus(0, tied, teams, alive)).toBe(3);
  });

  it("ignores grudges against wrecks, mates, and unknown sides", () => {
    const teams = [0, 0, 1, 1, undefined];
    const threats = [
      { attacker: 2, x: 0, z: 0, ttl: 5 },
      { attacker: 1, x: 0, z: 0, ttl: 5 },
      undefined,
      undefined,
      undefined,
    ];
    // 2 is a wreck: no focus. 1 is a mate: never focused.
    expect(squadFocus(0, threats, teams, [true, true, false, true, true])).toBe(-1);
    const unknown = [
      { attacker: 4, x: 0, z: 0, ttl: 5 },
      undefined,
      undefined,
      undefined,
      undefined,
    ];
    expect(squadFocus(0, unknown, teams, [true, true, true, true, true])).toBe(-1);
  });
});

describe("targetScore", () => {
  it("prefers closer, wounded, focused, threatening, sticky targets", () => {
    const plain = targetScore(500, 1, 0, false, false);
    expect(targetScore(400, 1, 0, false, false)).toBeLessThan(plain);
    expect(targetScore(500, 0.2, 0, false, false)).toBeLessThan(plain);
    expect(targetScore(500, 1, 2, false, false)).toBeLessThan(plain);
    expect(targetScore(500, 1, 0, true, false)).toBeLessThan(plain);
    expect(targetScore(500, 1, 0, false, true)).toBeLessThan(plain);
    // A wounded near-far tradeoff: burning at 600 beats pristine at 400.
    expect(targetScore(600, 0, 0, false, false)).toBeLessThan(targetScore(400, 1, 0, false, false));
  });
});

describe("chooseTarget", () => {
  it("picks the nearest live enemy inside both gates by default", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [{ x: 50, z: 0 }], [
      { x: 500, z: 0 },
      { x: 300, z: 0 },
    ]);
    expect(chooseTarget(0, positions, teams, alive, { anchor: { x: 0, z: 0 } })).toBe(3);
  });

  it("prefers a wounded enemy over a nearer pristine one", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [], [
      { x: 400, z: 0 },
      { x: 500, z: 0 },
    ]);
    // Burning at 500 (score ~240) beats pristine at 400.
    expect(chooseTarget(0, positions, teams, alive, { hp: [1, 1, 0] })).toBe(2);
    // Healthy pair: nearest wins.
    expect(chooseTarget(0, positions, teams, alive)).toBe(1);
  });

  it("joins the squad focus and answers its attacker", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [], [
      { x: 400, z: 0 },
      { x: 450, z: 0 },
    ]);
    expect(chooseTarget(0, positions, teams, alive, { focus: 2 })).toBe(2);
    expect(chooseTarget(0, positions, teams, alive, { threatAttacker: 2 })).toBe(2);
  });

  it("filters wrecks, mates, self, and out-of-gate contacts", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [{ x: 100, z: 0 }], [
      { x: 300, z: 0 },
      { x: 900, z: 0 },
    ]);
    // Nearest enemy wrecked: the farther live one takes it…
    expect(chooseTarget(0, positions, teams, [true, true, false, true])).toBe(3);
    // …but with every enemy wrecked there is nothing to fight.
    expect(chooseTarget(0, positions, teams, [true, true, false, false])).toBe(-1);
    // A tighter notice gate puts both contacts beneath notice.
    expect(chooseTarget(0, positions, teams, alive, { maxDist: 200 })).toBe(-1);
    // Mate-only roster: no civil war.
    const matesOnly = {
      positions: [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
      ],
      teams: [0, 0] as (number | undefined)[],
      alive: [true, true],
    };
    expect(chooseTarget(0, matesOnly.positions, matesOnly.teams, matesOnly.alive)).toBe(-1);
    // Past the anchor leash: beneath notice.
    expect(
      chooseTarget(0, positions, teams, alive, { anchor: { x: -5000, z: 0 } }),
    ).toBe(-1);
  });

  it("breaks exact ties to the lowest index", () => {
    const positions = [
      { x: 0, z: 0 },
      { x: 300, z: 0 },
      { x: -300, z: 0 },
    ];
    expect(chooseTarget(0, positions, [0, 1, 1], [true, true, true])).toBe(1);
  });
});

describe("acquireStrategicHunt", () => {
  function idle(): Mover {
    return initMover(
      [
        { x: 0, z: 0 },
        { x: 0, z: 400 },
      ],
      0,
    );
  }

  it("resolves even fights exactly like acquireHunt", () => {
    const teams = [0, 0, 1, 1];
    const alive = [true, true, true, true];
    const anchor = { x: 0, z: 0 };
    const foes = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 500, z: 0 },
      { x: 900, z: 0 },
    ];
    const legacy = acquireHunt(idle(), 0, teams, foes, alive, anchor);
    const strategic = acquireStrategicHunt(idle(), 0, teams, foes, alive, anchor);
    expect(strategic.threat).toEqual(legacy.threat);
    expect(strategic.threat?.attacker).toBe(2);
    expect(strategic.threat?.leash).toBe(HUNT_LEASH_RADIUS);
  });

  it("refuses the same callers acquireHunt refuses", () => {
    const teams = [0, 0, 1, 1];
    const alive = [true, true, true, true];
    const anchor = { x: 0, z: 0 };
    const foes = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 500, z: 0 },
      { x: 900, z: 0 },
    ];
    const ordered = orderMover(idle(), [{ x: 500, z: 500 }]);
    expect(acquireStrategicHunt(ordered, 0, teams, foes, alive, anchor).threat).toBeUndefined();
    const holding: Mover = { ...idle(), hold: true };
    expect(acquireStrategicHunt(holding, 0, teams, foes, alive, anchor).threat).toBeUndefined();
    const busy = acquireStrategicHunt(idle(), 0, teams, foes, alive, anchor);
    expect(acquireStrategicHunt(busy, 0, teams, foes, alive, anchor).threat).toEqual(busy.threat);
    expect(acquireStrategicHunt(idle(), 9, teams, foes, alive, anchor).threat).toBeUndefined();
  });

  it("waits instead of charging alone into a group", () => {
    // Self at origin, no mates; a group of three at ~400.
    const teams = [0, 1, 1, 1];
    const alive = [true, true, true, true];
    const foes = [
      { x: 0, z: 0 },
      { x: 400, z: 0 },
      { x: 430, z: 20 },
      { x: 460, z: -20 },
    ];
    // Legacy hunt charges; strategic judgment waits for backup.
    expect(acquireHunt(idle(), 0, teams, foes, alive, { x: 0, z: 0 }).threat?.attacker).toBe(1);
    expect(acquireStrategicHunt(idle(), 0, teams, foes, alive, { x: 0, z: 0 }).threat).toBeUndefined();
    // With two mates beside it the same hull commits.
    const evenTeams = [0, 0, 0, 1, 1, 1];
    const evenAlive = [true, true, true, true, true, true];
    const evenFoes = [
      { x: 0, z: 0 },
      { x: -50, z: 0 },
      { x: -100, z: 0 },
      { x: 400, z: 0 },
      { x: 430, z: 20 },
      { x: 460, z: -20 },
    ];
    const committed = acquireStrategicHunt(idle(), 0, evenTeams, evenFoes, evenAlive, { x: 0, z: 0 });
    expect(committed.threat?.attacker).toBeGreaterThanOrEqual(3);
  });

  it("joins the squad focus and finishes the wounded", () => {
    // Two enemies at similar distance with a mate nearby (even odds, so the
    // hull commits and the choice — not the courage gate — is under test).
    const teams = [0, 0, 1, 1];
    const alive = [true, true, true, true];
    const nearFoes = [
      { x: 0, z: 0 },
      { x: -100, z: 0 },
      { x: 500, z: 0 },
      { x: 560, z: 0 },
    ];
    // No focus: nearest wins.
    expect(
      acquireStrategicHunt(idle(), 0, teams, nearFoes, alive, { x: 0, z: 0 }, []).threat?.attacker,
    ).toBe(2);
    // Squad on the farther enemy: join them (focus fire).
    const threats = [undefined, { attacker: 3, x: 560, z: 0, ttl: 5 }, undefined, undefined];
    expect(
      acquireStrategicHunt(idle(), 0, teams, nearFoes, alive, { x: 0, z: 0 }, threats).threat?.attacker,
    ).toBe(3);
    // Wounded nearer… wounded *farther* enemy pulls the quarry off nearest.
    expect(
      acquireStrategicHunt(idle(), 0, teams, nearFoes, alive, { x: 0, z: 0 }, [], [1, 1, 1, 0]).threat
        ?.attacker,
    ).toBe(3);
  });

  it("is deterministic across repeated calls", () => {
    const teams = [0, 0, 1, 1];
    const alive = [true, true, true, true];
    const foes = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 500, z: 0 },
      { x: 900, z: 0 },
    ];
    const once = acquireStrategicHunt(idle(), 0, teams, foes, alive, { x: 0, z: 0 });
    const twice = acquireStrategicHunt(idle(), 0, teams, foes, alive, { x: 0, z: 0 });
    expect(twice).toEqual(once);
    expect(once.threat?.ttl).toBe(THREAT_MEMORY_DURATION);
  });
});

describe("pursuit tactics in the drive", () => {
  function flatRoute(): RoutePoint[] {
    return [
      { x: 0, z: 0 },
      { x: 0, z: 400 },
      { x: 400, z: 400 },
      { x: 400, z: 0 },
    ];
  }

  it("holds facing the threat instead of charging alone into a group", () => {
    const route = flatRoute();
    // Victim at origin threatened by a scout at 400 with its column behind it.
    const victim = { ...notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 1, 400, 0, route[0]), hull: 0 };
    const foes = [
      { x: 0, z: 0 },
      { x: 400, z: 0 },
      { x: 500, z: 0 },
      { x: 550, z: 0 },
    ];
    const teams = [0, 1, 1, 1];
    const alive = [true, true, true, true];
    // Without tactics the hull charges; with them it waits for backup.
    const charging = advanceMover("stump", victim, route, 1, 1, null, null, foes);
    expect(Math.hypot(charging.x - 400, charging.z - 0)).toBeLessThan(400);
    const waiting = advanceMover("stump", victim, route, 1, 1, null, null, foes, {
      self: 0, teams, alive,
    });
    expect(waiting.x).toBe(victim.x);
    expect(waiting.z).toBe(victim.z);
    expect(waiting.threat?.attacker).toBe(1);
    expect(waiting.threat?.ttl).toBeLessThan(THREAT_MEMORY_DURATION);
  });

  it("re-engages once backup arrives", () => {
    const route = flatRoute();
    const victim = { ...notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 2, 400, 0, route[0]), hull: 0 };
    const teams = [0, 0, 1, 1];
    const alive = [true, true, true, true];
    // Mate far away: the hull waits…
    const alone = [
      { x: 0, z: 0 },
      { x: -2000, z: 0 },
      { x: 400, z: 0 },
      { x: 450, z: 0 },
    ];
    const waiting = advanceMover("stump", victim, route, 1, 1, null, null, alone, {
      self: 0, teams, alive,
    });
    expect(waiting.x).toBe(victim.x);
    // …mate closes in: the same hull drives.
    const reinforced = [
      { x: 0, z: 0 },
      { x: -100, z: 0 },
      { x: 400, z: 0 },
      { x: 450, z: 0 },
    ];
    const engaging = advanceMover("stump", victim, route, 1, 1, null, null, reinforced, {
      self: 0, teams, alive,
    });
    expect(Math.hypot(engaging.x - 400, engaging.z - 0)).toBeLessThan(400);
  });

  it("keeps tactics-free drives byte-identical (no context, no change)", () => {
    const route = flatRoute();
    const victim = { ...notifyThreat(initMover(route, 0), { x: 0, z: 0 }, 1, 300, 0, route[0]), hull: 0 };
    const foes = [
      { x: 0, z: 0 },
      { x: 300, z: 0 },
    ];
    const plain = advanceMover("stump", victim, route, 0.5, 1, null, null, foes);
    const headless = advanceMover("stump", victim, route, 0.5, 1, null, null, foes, {
      self: 0, teams: [undefined, undefined], alive: [true, true],
    });
    expect(headless).toEqual(plain);
    // Roster stepping threads the context per index without disturbing patrol.
    const moved = advanceMovers(["stump", "flash"], [victim, initMover(route, 0)], [route, route], 0.5);
    expect(moved[0]?.threat?.attacker).toBe(1);
  });
});

describe("pickStrategicTarget", () => {
  it("shoots the nearest admitted enemy by default", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [], [
      { x: 700, z: 0 },
      { x: 400, z: 0 },
    ]);
    expect(pickStrategicTarget(0, positions, teams, alive, { maxDist: 900 })).toBe(2);
  });

  it("finishes wounded enemies and piles onto focused ones without thrashing", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [], [
      { x: 400, z: 0 },
      { x: 480, z: 0 },
    ]);
    // Burning at 480 beats pristine at 400.
    expect(pickStrategicTarget(0, positions, teams, alive, { hp: [1, 1, 0.1] })).toBe(2);
    // Two teammates on the farther target: join them.
    expect(pickStrategicTarget(0, positions, teams, alive, { focusCounts: [2, 2] })).toBe(2);
    // Stay on the current aim even when a marginally closer target appears.
    expect(pickStrategicTarget(0, positions, teams, alive, { sticky: 2 })).toBe(2);
  });

  it("prefers admitted targets but still answers far ones (retry rhythm)", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [], [
      { x: 2000, z: 0 },
      { x: 500, z: 0 },
    ]);
    // In-range at 500 wins over the wounded-but-far contact.
    expect(pickStrategicTarget(0, positions, teams, alive, { hp: [1, 0, 1], maxDist: 900 })).toBe(2);
    // Nothing admitted: the far enemy still draws (the launch gate retries).
    const far = roster({ x: 0, z: 0 }, [], [{ x: 2000, z: 0 }]);
    expect(pickStrategicTarget(0, far.positions, far.teams, far.alive, { maxDist: 900 })).toBe(1);
  });

  it("never shoots mates, wrecks, itself, or unknown sides", () => {
    const { positions, teams, alive } = roster({ x: 0, z: 0 }, [{ x: 100, z: 0 }], [
      { x: 200, z: 0 },
    ]);
    expect(pickStrategicTarget(0, positions, teams, [true, true, false])).toBe(-1);
    const matesOnly = roster({ x: 0, z: 0 }, [{ x: 100, z: 0 }], []);
    expect(pickStrategicTarget(0, matesOnly.positions, matesOnly.teams, matesOnly.alive)).toBe(-1);
    expect(pickStrategicTarget(0, positions, [undefined, undefined, undefined], alive)).toBe(-1);
    expect(pickStrategicTarget(9, positions, teams, alive)).toBe(-1);
  });
});
