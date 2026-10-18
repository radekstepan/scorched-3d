import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  countTreesOnSegment,
  HUNT_LEASH_RADIUS,
  initMover,
  mulberry32,
  muzzleHeight,
  muzzleYaw,
  notifyThreat,
  wrapAngle,
  yawToTarget,
  type Mover,
  type RoutePoint,
  type UnitKind,
} from "@scorched-3d/core";
import { CombatFx } from "./combatFx";
import { UnitMovement } from "./movement";
import { WAYPOINT_PURSUIT_COLOR, WaypointFx, activeTrailMode } from "./waypoints";

function makePair(): THREE.Group {
  const group = new THREE.Group();
  group.userData.units = [
    { kind: "flash", cellX: 10, cellZ: 10, rotation: 0 },
    { kind: "stump", cellX: 40, cellZ: 40, rotation: Math.PI },
  ];
  for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(500, 120, 300)]) {
    const body = new THREE.Group();
    body.rotation.order = "YXZ";
    body.position.copy(pos);
    const turret = new THREE.Group();
    turret.name = "turret";
    body.add(turret);
    body.userData.turret = turret;
    group.add(body);
  }
  return group;
}

/** Backdoor into the private splash, with shooter + hostility like the live path. */
function splash(
  fx: CombatFx,
  x: number,
  y: number,
  z: number,
  kind: UnitKind = "hammer",
  shooter: number | null = null,
  hostile = true,
): void {
  (
    fx as unknown as {
      damageUnits(at: THREE.Vector3, kind: UnitKind, slope: null, shooter: number | null, hostile: boolean): void;
    }
  ).damageUnits(new THREE.Vector3(x, y, z), kind, null, shooter, hostile);
}

function sizedFx(): { fx: CombatFx; units: THREE.Group } {
  const scene = new THREE.Scene();
  const units = makePair();
  const fx = new CombatFx(scene, units, mulberry32(7));
  fx.update(1 / 60); // size the damage roster; hooks assigned after, so no stray calls
  return { fx, units };
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
      { x: 500, z: 300 },
      { x: 500, z: 700 },
      { x: 900, z: 700 },
      { x: 900, z: 300 },
    ],
  ];
}

function makeMovement(): { movement: UnitMovement; units: THREE.Group } {
  const group = new THREE.Group();
  group.userData.units = [
    { kind: "flash", cellX: 10, cellZ: 10, rotation: 0 },
    { kind: "stump", cellX: 40, cellZ: 40, rotation: Math.PI },
  ];
  for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(500, 120, 300)]) {
    const body = new THREE.Group();
    body.rotation.y = 0;
    body.position.copy(pos);
    group.add(body);
  }
  const movement = new UnitMovement(group, routes(), { groundY: () => 100 });
  return { movement, units: group };
}

describe("CombatFx retaliation hook", () => {
  it("points a survivor at its live shooter", () => {
    const { fx } = sizedFx();
    const threats: { victim: number; attacker: number; ax: number; az: number }[] = [];
    fx.onUnitThreatened = (victim, attacker, ax, az) => threats.push({ victim, attacker, ax, az });
    splash(fx, 10, 100, 0, "hammer", 1);
    expect(threats).toHaveLength(1);
    // Victim 0 blames the live shooter 1 at its current body position.
    expect(threats[0]).toMatchObject({ victim: 0, attacker: 1, ax: 500, az: 300 });
    fx.dispose();
  });

  it("stays silent on self-splashes, dead shooters, and non-hostile bursts", () => {
    const { fx } = sizedFx();
    const threats: unknown[] = [];
    const stuns: unknown[] = [];
    fx.onUnitThreatened = (...args: unknown[]) => threats.push(args);
    fx.onUnitStunned = (...args: unknown[]) => stuns.push(args);
    // Own blast splashing the shooter: still hesitates, never pursues itself.
    splash(fx, 10, 100, 0, "hammer", 0);
    expect(stuns).toHaveLength(1);
    expect(threats).toHaveLength(0);
    // Dead shooter (killed out of band): blames nobody.
    (fx as unknown as { destroyed: boolean[] }).destroyed[1] = true;
    splash(fx, 10, 100, 0, "hammer", 1);
    expect(threats).toHaveLength(0);
    (fx as unknown as { destroyed: boolean[] }).destroyed[1] = false;
    // Wreck cook-off: hostile=false never threatens, even with a shooter id.
    splash(fx, 10, 100, 0, "hammer", 1, false);
    expect(threats).toHaveLength(0);
    fx.dispose();
  });

  it("falls back to the nearest live hull when the shooter is unknown", () => {
    const { fx } = sizedFx();
    const threats: { victim: number; attacker: number }[] = [];
    fx.onUnitThreatened = (victim, attacker) => threats.push({ victim, attacker });
    splash(fx, 10, 100, 0, "hammer", null, true);
    expect(threats).toEqual([{ victim: 0, attacker: 1 }]);
    fx.dispose();
  });

  it("guesses nothing when no live hull sits inside the engage gate", () => {
    const scene = new THREE.Scene();
    const units = makePair();
    // Attacker parked far outside the gate: the heuristic stays quiet.
    (units.children[1] as THREE.Group).position.set(5000, 120, 5000);
    const fx = new CombatFx(scene, units, mulberry32(7));
    fx.update(1 / 60);
    const threats: unknown[] = [];
    fx.onUnitThreatened = (...args: unknown[]) => threats.push(args);
    splash(fx, 10, 100, 0, "hammer", null, true);
    expect(threats).toHaveLength(0);
    fx.dispose();
  });

  it("never threatens on a killing blow", () => {
    const { fx } = sizedFx();
    (fx as unknown as { damage: number[] }).damage[0] = 0.99;
    const threats: unknown[] = [];
    const killed: number[] = [];
    fx.onUnitThreatened = (...args: unknown[]) => threats.push(args);
    fx.onUnitKilled = (i) => killed.push(i);
    splash(fx, 10, 100, 0, "hammer", 1);
    expect(killed).toEqual([0]);
    expect(threats).toHaveLength(0);
    fx.dispose();
  });
});

describe("CombatFx even-team fire", () => {
  /** Two hulls facing each other 400 apart, on the given sides. */
  function makeTeamPair(teams: [number, number]): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 1, cellZ: 1, rotation: Math.PI / 2, team: teams[0] },
      { kind: "flash", cellX: 2, cellZ: 2, rotation: -Math.PI / 2, team: teams[1] },
    ];
    for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(400, 100, 0)]) {
      const body = new THREE.Group();
      body.position.copy(pos);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    (group.children[0] as THREE.Group).rotation.y = Math.PI / 2;
    (group.children[1] as THREE.Group).rotation.y = -Math.PI / 2;
    return group;
  }

  it("holds fire when both hulls fight for the same side", () => {
    const scene = new THREE.Scene();
    const units = makeTeamPair([0, 0]);
    const fx = new CombatFx(scene, units, mulberry32(21));
    // Pre-aimed down the line, well inside range: any cross-team pair would
    // have fired dozens of rounds in this window.
    for (let n = 0; n < 1200; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBe(0);
    expect(fx.activeCount).toBe(0);
    fx.dispose();
  });

  it("fires across team lines (and only across them)", () => {
    const scene = new THREE.Scene();
    const units = makeTeamPair([0, 1]);
    const fx = new CombatFx(scene, units, mulberry32(21));
    let fired = false;
    for (let n = 0; n < 1200 && !fired; n++) {
      const before = fx.totalFired;
      fx.update(1 / 60);
      fired = fx.totalFired > before;
    }
    expect(fired).toBe(true);
    fx.dispose();
  });

  it("stays quiet when one side is wiped (nothing hostile left)", () => {
    const scene = new THREE.Scene();
    const units = makeTeamPair([0, 1]);
    const fx = new CombatFx(scene, units, mulberry32(21));
    (fx as unknown as { destroyed: boolean[] }).destroyed[1] = true;
    for (let n = 0; n < 600; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBe(0);
    fx.dispose();
  });

  it("blames the nearest live enemy, never a same-team mate", () => {
    // Victim 0 (team 0) at the origin, mate 1 (team 0) 40 aside, enemy 2
    // (team 1) 400 downrange: a shooter-unknown splash must point the victim
    // at the enemy, not the closer mate.
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 1, cellZ: 1, rotation: 0, team: 0 },
      { kind: "flash", cellX: 2, cellZ: 2, rotation: 0, team: 0 },
      { kind: "flash", cellX: 3, cellZ: 3, rotation: 0, team: 1 },
    ];
    for (const pos of [
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(40, 100, 0),
      new THREE.Vector3(400, 100, 0),
    ]) {
      const body = new THREE.Group();
      body.position.copy(pos);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    const fx = new CombatFx(scene, group, mulberry32(7));
    fx.update(1 / 60);
    const threats: { victim: number; attacker: number }[] = [];
    fx.onUnitThreatened = (victim, attacker) => threats.push({ victim, attacker });
    splash(fx, 0, 100, 0, "hammer", null, true);
    const victim = threats.find((t) => t.victim === 0);
    expect(victim?.attacker).toBe(2);
    // The blast still splashes the nearby mate (friendly fire is honest —
    // only targeting is team-aware), and the mate blames the enemy too.
    expect(fx.unitDamageAt(1)).toBeGreaterThan(0);
    expect(threats.find((t) => t.victim === 1)?.attacker).toBe(2);
    fx.dispose();
  });
});

describe("UnitMovement retaliation", () => {
  it("records a threat on an idle hull and drives it toward the attacker", () => {
    const { movement } = makeMovement();
    expect(movement.hasThreat(0)).toBe(false);
    movement.threatenUnit(0, 1, 500, 300);
    expect(movement.hasThreat(0)).toBe(true);
    const before = movement.moverState(0)!;
    const distBefore = Math.hypot(before.x - 500, before.z - 300);
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    const after = movement.moverState(0)!;
    // Flash stand-off is 220: a 583-unit chase visibly closes.
    expect(Math.hypot(after.x - 500, after.z - 300)).toBeLessThan(distBefore);
    expect(movement.hasThreat(0)).toBe(true);
    movement.dispose();
  });
  it("lets wrecks and self-hits refuse the memory (ordered hulls answer)", () => {
    const { movement } = makeMovement();
    // An ordered hull records a self-defense memory instead of refusing
    // (holds still refuse — covered at the core level, where holds live).
    movement.orderUnit(0, { x: 100, z: 100 });
    movement.threatenUnit(0, 1, 500, 300);
    expect(movement.hasThreat(0)).toBe(true);
    expect(movement.isFighting(0)).toBe(true);
    // A self-splash never steals it (victim === attacker refuses outright).
    movement.threatenUnit(0, 0, 500, 300);
    expect(movement.moverState(0)?.threat?.attacker).toBe(1);
    movement.markDestroyed(1);
    movement.threatenUnit(1, 0, 0, 0);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });

  it("runs the full loop: splash notifies, the victim pursues, then gives up", () => {
    const { movement } = makeMovement();
    // Splash-equivalent: point the idle victim at its shooter.
    movement.threatenUnit(0, 1, 500, 300);
    for (let n = 0; n < 30; n++) movement.update(1 / 60);
    const chasing = movement.moverState(0)!;
    expect(Math.hypot(chasing.x - 500, chasing.z - 300)).toBeLessThan(
      Math.hypot(0 - 500, 0 - 300),
    );
    movement.dispose();
  });
});

describe("UnitMovement LOS repositioning", () => {
  it("records a seek on an idle hull and drives it toward the target", () => {
    const { movement } = makeMovement();
    expect(movement.hasThreat(0)).toBe(false);
    movement.seekEngage(0, 1, 500, 300);
    expect(movement.hasThreat(0)).toBe(true);
    const before = movement.moverState(0)!;
    const distBefore = Math.hypot(before.x - 500, before.z - 300);
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    const after = movement.moverState(0)!;
    // Same pursuit drive as retaliation: visibly closes on the target.
    expect(Math.hypot(after.x - 500, after.z - 300)).toBeLessThan(distBefore);
    expect(movement.hasThreat(0)).toBe(true);
    movement.dispose();
  });

  it("lets player orders, holds, wrecks, and self-seeks refuse", () => {
    const { movement } = makeMovement();
    movement.orderUnit(0, { x: 100, z: 100 });
    movement.seekEngage(0, 1, 500, 300);
    expect(movement.hasThreat(0)).toBe(false);
    movement.seekEngage(1, 1, 500, 300);
    expect(movement.hasThreat(1)).toBe(false);
    movement.markDestroyed(1);
    movement.seekEngage(1, 0, 0, 0);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });
});

describe("UnitMovement hunt", () => {
  /** Two idle hulls 583 apart on opposite sides, anchors at their spawns. */
  function makeHuntMovement(teams: [number, number]): { movement: UnitMovement; units: THREE.Group } {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 10, cellZ: 10, rotation: 0, team: teams[0] },
      { kind: "flash", cellX: 40, cellZ: 40, rotation: Math.PI, team: teams[1] },
    ];
    for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(500, 120, 300)]) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.copy(pos);
      group.add(body);
    }
    const movement = new UnitMovement(group, routes(), { groundY: () => 100 });
    return { movement, units: group };
  }

  it("acquires a live enemy across team lines and closes on the hunt leash", () => {
    const { movement } = makeHuntMovement([0, 1]);
    expect(movement.hasThreat(0)).toBe(false);
    expect(movement.hasThreat(1)).toBe(false);
    movement.update(1 / 60);
    // Both hulls notice each other the first tick (583 < hunt engage, both
    // anchors inside the hunt leash).
    expect(movement.hasThreat(0)).toBe(true);
    expect(movement.hasThreat(1)).toBe(true);
    expect(movement.moverState(0)?.threat?.attacker).toBe(1);
    expect(movement.moverState(1)?.threat?.attacker).toBe(0);
    // The pair closes instead of walking their loops.
    const d0 = Math.hypot(500 - 0, 300 - 0);
    for (let n = 0; n < 120; n++) movement.update(1 / 60);
    const a = movement.moverState(0)!;
    const b = movement.moverState(1)!;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(d0);
    movement.dispose();
  });

  it("ignores same-team neighbours (no civil war)", () => {
    const { movement } = makeHuntMovement([0, 0]);
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    expect(movement.hasThreat(0)).toBe(false);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });

  it("never hunts while ordered, and drops memories of dead attackers", () => {
    const { movement } = makeHuntMovement([0, 1]);
    movement.orderUnit(0, { x: -500, z: -500 });
    for (let n = 0; n < 30; n++) movement.update(1 / 60);
    // Player orders win: the ordered hull never acquires, the free one does.
    expect(movement.hasThreat(0)).toBe(false);
    expect(movement.hasThreat(1)).toBe(true);
    // The free hull's memory dies with its attacker instead of guarding a
    // corpse: kill the ordered hull out of band and sweep.
    movement.markDestroyed(0);
    movement.update(1 / 60);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });

  /** Four idle hulls with custom spawns: one scout vs a column, or a pair. */
  function makeSquadMovement(
    spawns: { x: number; z: number }[],
    teams: number[],
  ): { movement: UnitMovement; units: THREE.Group } {
    const group = new THREE.Group();
    group.userData.units = spawns.map((_, i) => ({
      kind: "flash",
      cellX: 10 + i,
      cellZ: 10,
      rotation: 0,
      team: teams[i],
    }));
    for (const pos of spawns) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.set(pos.x, 100, pos.z);
      group.add(body);
    }
    const routeSet = spawns.map((s) => [
      { x: s.x, z: s.z },
      { x: s.x, z: s.z + 400 },
      { x: s.x + 400, z: s.z + 400 },
      { x: s.x + 400, z: s.z },
    ]);
    const movement = new UnitMovement(group, routeSet, { groundY: () => 100 });
    return { movement, units: group };
  }

  it("waits instead of charging alone into a stronger column", () => {
    // Lone scout at the origin facing three enemies inside 650.
    const { movement } = makeSquadMovement(
      [
        { x: 0, z: 0 },
        { x: 500, z: 300 },
        { x: 530, z: 310 },
        { x: 560, z: 320 },
      ],
      [0, 1, 1, 1],
    );
    movement.update(1 / 60);
    // The scout patrols on (no suicide charge) while the column — each hull
    // backed by two mates — commits to the scout.
    expect(movement.hasThreat(0)).toBe(false);
    expect(movement.moverState(1)?.threat?.attacker).toBe(0);
    expect(movement.moverState(2)?.threat?.attacker).toBe(0);
    expect(movement.moverState(3)?.threat?.attacker).toBe(0);
    movement.dispose();
  });

  it("joins the squad focus instead of starting its own fight", () => {
    const { movement } = makeSquadMovement(
      [
        { x: 0, z: 0 },
        { x: 200, z: 0 },
        { x: 600, z: 100 },
        { x: 700, z: 120 },
      ],
      [0, 0, 1, 1],
    );
    // Mate already answering the farther enemy (retaliation memory).
    movement.threatenUnit(1, 3, 700, 120);
    expect(movement.hasThreat(1)).toBe(true);
    movement.update(1 / 60);
    // The free hull piles onto the squad's target (farther, but focused)
    // instead of duelling the nearer enemy alone.
    expect(movement.moverState(0)?.threat?.attacker).toBe(3);
    movement.dispose();
  });
});

describe("UnitMovement team advance", () => {
  /** A (team 0) guards its loop while B (team 0) bloodies C (team 1). */
  function makeAdvanceMovement(): { movement: UnitMovement; units: THREE.Group } {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 10, cellZ: 10, rotation: 0, team: 0 },
      { kind: "flash", cellX: 11, cellZ: 10, rotation: 0, team: 0 },
      { kind: "flash", cellX: 12, cellZ: 10, rotation: Math.PI, team: 1 },
    ];
    const spawns = [
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(1000, 100, 0),
      new THREE.Vector3(1200, 100, 0),
    ];
    for (const pos of spawns) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.copy(pos);
      group.add(body);
    }
    const routeSet = spawns.map((s) => [
      { x: s.x, z: s.z },
      { x: s.x, z: s.z + 400 },
      { x: s.x + 400, z: s.z + 400 },
      { x: s.x + 400, z: s.z },
    ]);
    const movement = new UnitMovement(group, routeSet, { groundY: () => 100 });
    return { movement, units: group };
  }

  it("advances toward the squad's last-known contact after notice is lost", () => {
    const { movement } = makeAdvanceMovement();
    movement.update(1 / 60);
    // B (200 from C) notices and commits, and B's sighting feeds the
    // side's shared intel the same sweep — so A (1200 from C, past its own
    // notice) advances on a position memory (attacker -1, never a grudge
    // against a mate) instead of guarding its loop.
    expect(movement.moverState(1)?.threat?.attacker).toBe(2);
    const issued = movement.moverState(0)!;
    expect(issued.threat?.attacker).toBe(-1);
    expect(movement.hasThreat(0)).toBe(true);
    const distAtIssue = Math.hypot(issued.x - 1200, issued.z - 0);
    // The push visibly closes on the enemy side instead of patrolling home.
    for (let n = 0; n < 240; n++) movement.update(1 / 60);
    const after = movement.moverState(0)!;
    expect(movement.hasThreat(0)).toBe(true);
    expect(after.x).toBeGreaterThan(issued.x);
    expect(Math.hypot(after.x - 1200, after.z - 0)).toBeLessThan(distAtIssue);
    movement.dispose();
  });

  it("keeps patrolling when its side has never made contact", () => {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 10, cellZ: 10, rotation: 0, team: 0 },
      { kind: "flash", cellX: 12, cellZ: 10, rotation: Math.PI, team: 1 },
    ];
    for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(3000, 100, 0)]) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.copy(pos);
      group.add(body);
    }
    const movement = new UnitMovement(
      group,
      [
        [
          { x: 0, z: 0 },
          { x: 0, z: 400 },
          { x: 400, z: 400 },
          { x: 400, z: 0 },
        ],
        [
          { x: 3000, z: 0 },
          { x: 3000, z: 400 },
          { x: 3400, z: 400 },
          { x: 3400, z: 0 },
        ],
      ],
      { groundY: () => 100 },
    );
    // Far past notice and past the leash: no contact ever, no advance.
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    expect(movement.hasThreat(0)).toBe(false);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });

  it("lets player orders win over the team advance", () => {
    const { movement } = makeAdvanceMovement();
    movement.orderUnit(0, { x: -500, z: -500 });
    for (let n = 0; n < 3; n++) movement.update(1 / 60);
    // The side still finds the enemy (B commits) but the ordered hull stays
    // on its order instead of pushing.
    expect(movement.moverState(1)?.threat?.attacker).toBe(2);
    expect(movement.hasThreat(0)).toBe(false);
    movement.dispose();
  });

  it("answers fire while ordered, then holds the destination on arrival", () => {
    // A (team 0) ordered across the pocket while E (team 1) sits near the
    // destination: the hit records a self-defense memory that never steers
    // the march, and arrival holds the destination — the memory ticks out
    // in place (the guns keep answering it) instead of converting to a
    // pursuit, and the hull never peels off onto its patrol loop.
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 10, cellZ: 10, rotation: 0, team: 0 },
      { kind: "flash", cellX: 12, cellZ: 10, rotation: Math.PI, team: 1 },
    ];
    for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(250, 100, 80)]) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.copy(pos);
      group.add(body);
    }
    const movement = new UnitMovement(
      group,
      [
        [
          { x: 0, z: 0 },
          { x: 0, z: 400 },
          { x: 400, z: 400 },
          { x: 400, z: 0 },
        ],
        [
          { x: 250, z: 80 },
          { x: 250, z: 480 },
          { x: 650, z: 480 },
          { x: 650, z: 80 },
        ],
      ],
      { groundY: () => 100 },
    );
    movement.orderUnit(0, { x: 300, z: 0 });
    movement.threatenUnit(0, 1, 250, 80);
    movement.update(1 / 60);
    // The ordered hull answers the fire (live grudge, fighting) without
    // abandoning its order — and never acquires a hunt of its own.
    expect(movement.hasOrder(0)).toBe(true);
    expect(movement.hasThreat(0)).toBe(true);
    expect(movement.isFighting(0)).toBe(true);
    expect(movement.moverState(0)?.threat?.attacker).toBe(1);
    // It drives the full march to the destination with the memory live.
    let ticks = 0;
    while (movement.hasOrder(0) && ticks < 1200) {
      movement.update(1 / 60);
      ticks++;
    }
    expect(movement.hasOrder(0)).toBe(false);
    const arrived = movement.moverState(0)!;
    expect(arrived.x).toBeGreaterThan(200);
    expect(arrived.hold).toBe(true);
    // On arrival the memory stays live but never steers a held hull: the
    // leg stays frozen and the guns keep answering the attacker.
    expect(movement.hasThreat(0)).toBe(true);
    expect(movement.isFighting(0)).toBe(true);
    expect(arrived.leg).toBe(1);
    for (let n = 0; n < 30; n++) movement.update(1 / 60);
    const held = movement.moverState(0)!;
    expect(held.leg).toBe(1);
    expect(held.x).toBe(arrived.x);
    expect(held.z).toBe(arrived.z);
    // The memory ticks out in place (no re-hits) and the hull stays held —
    // wrecking the attacker changes nothing about the guard.
    movement.markDestroyed(1);
    for (let n = 0; n < 600; n++) movement.update(1 / 60);
    expect(movement.hasThreat(0)).toBe(false);
    const stayed = movement.moverState(0)!;
    expect(stayed.hold).toBe(true);
    expect(stayed.x).toBe(arrived.x);
    expect(stayed.z).toBe(arrived.z);
    movement.dispose();
  });

  it("waits for backup instead of advancing alone into a column", () => {
    const group = new THREE.Group();
    const spawns = [
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(900, 100, 0),
      new THREE.Vector3(500, 100, 0),
      new THREE.Vector3(530, 100, 10),
      new THREE.Vector3(560, 100, 20),
    ];
    group.userData.units = [
      { kind: "flash", cellX: 10, cellZ: 10, rotation: 0, team: 0 },
      { kind: "flash", cellX: 11, cellZ: 10, rotation: 0, team: 0 },
      { kind: "flash", cellX: 12, cellZ: 10, rotation: Math.PI, team: 1 },
      { kind: "flash", cellX: 13, cellZ: 10, rotation: Math.PI, team: 1 },
      { kind: "flash", cellX: 14, cellZ: 10, rotation: Math.PI, team: 1 },
    ];
    for (const pos of spawns) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.copy(pos);
      group.add(body);
    }
    const movement = new UnitMovement(
      group,
      spawns.map((s) => [
        { x: s.x, z: s.z },
        { x: s.x, z: s.z + 400 },
        { x: s.x + 400, z: s.z + 400 },
        { x: s.x + 400, z: s.z },
      ]),
      { groundY: () => 100 },
    );
    // B is bloodied by the column (forced retaliation memory inside the
    // engage gate), so team 0 knows the enemy direction…
    movement.threatenUnit(1, 2, 500, 0);
    expect(movement.hasThreat(1)).toBe(true);
    movement.update(1 / 60);
    // …but A faces three fresh hulls alone: it waits instead of advancing.
    expect(movement.hasThreat(0)).toBe(false);
    movement.dispose();
  });
});

describe("peewee scout", () => {
  /** Idle hulls with custom spawns, sides, and kinds (anchors at spawns). */
  function makeScoutMovement(
    spawns: { x: number; z: number }[],
    teams: number[],
    kinds: UnitKind[],
  ): { movement: UnitMovement; units: THREE.Group } {
    const group = new THREE.Group();
    group.userData.units = spawns.map((_, i) => ({
      kind: kinds[i] ?? "flash",
      cellX: 10 + i,
      cellZ: 10,
      rotation: 0,
      team: teams[i],
    }));
    for (const pos of spawns) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.set(pos.x, 100, pos.z);
      group.add(body);
    }
    const routeSet = spawns.map((s) => [
      { x: s.x, z: s.z },
      { x: s.x, z: s.z + 400 },
      { x: s.x + 400, z: s.z + 400 },
      { x: s.x + 400, z: s.z },
    ]);
    const movement = new UnitMovement(group, routeSet, { groundY: () => 100 });
    return { movement, units: group };
  }

  it("spots a distant column past tank notice and pulls its side in", () => {
    // Scout + tank (team 0) at the origin, enemy (team 1) at 1300 — past
    // the 1100 regular notice, inside the 1500 scout notice.
    const { movement } = makeScoutMovement(
      [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
        { x: 1300, z: 0 },
      ],
      [0, 0, 1],
      ["peewee", "flash", "flash"],
    );
    movement.update(1 / 60);
    // The scout acquires what its heavier teammate cannot see…
    expect(movement.moverState(0)?.threat?.attacker).toBe(2);
    // …and the sighting focuses the side the same sweep: the tank advances
    // on the shared intel (a position, never a grudge) instead of guarding
    // its loop.
    const issued = movement.moverState(1)!;
    expect(issued.threat?.attacker).toBe(-1);
    expect(movement.hasThreat(1)).toBe(true);
    const distAtIssue = Math.hypot(issued.x - 1300, issued.z - 0);
    for (let n = 0; n < 240; n++) movement.update(1 / 60);
    const after = movement.moverState(1)!;
    expect(movement.hasThreat(1)).toBe(true);
    expect(after.x).toBeGreaterThan(issued.x);
    expect(Math.hypot(after.x - 1300, after.z - 0)).toBeLessThan(distAtIssue);
    movement.dispose();
  });

  it("probes alone into a column where a heavier hull would wait", () => {
    // Same geometry as the "waits instead of charging" squad test, but the
    // lone hull is a peewee: it acquires the nearest live enemy instead of
    // patrolling on, while the backed column still commits to it.
    const { movement } = makeScoutMovement(
      [
        { x: 0, z: 0 },
        { x: 500, z: 300 },
        { x: 530, z: 310 },
        { x: 560, z: 320 },
      ],
      [0, 1, 1, 1],
      ["peewee", "flash", "flash", "flash"],
    );
    movement.update(1 / 60);
    expect(movement.moverState(0)?.threat?.attacker).toBe(1);
    expect(movement.moverState(1)?.threat?.attacker).toBe(0);
    movement.dispose();
  });

  it("pulls the whole side onto a stale contact inside the team leash", () => {
    // Mate bloodies an enemy at 1800 while the scout sits at the origin:
    // past scout notice (so no live hunt), inside the team-advance leash.
    // The whole side marches on the shared contact now (reinforce), not
    // just the scout — the old 1400 tank leash is what stranded heavies.
    const build = (scoutKind: UnitKind): { movement: UnitMovement; units: THREE.Group } =>
      makeScoutMovement(
        [
          { x: 0, z: 0 },
          { x: 1700, z: 0 },
          { x: 1800, z: 0 },
        ],
        [0, 0, 1],
        [scoutKind, "flash", "flash"],
      );
    const { movement: scouting } = build("peewee");
    scouting.update(1 / 60);
    expect(scouting.moverState(1)?.threat?.attacker).toBe(2);
    scouting.update(1 / 60);
    const issued = scouting.moverState(0)!;
    expect(issued.threat?.attacker).toBe(-1);
    for (let n = 0; n < 120; n++) scouting.update(1 / 60);
    expect(scouting.moverState(0)!.x).toBeGreaterThan(issued.x);
    scouting.dispose();
    // A heavier hull in the same spot reinforces too.
    const { movement: reinforcing } = build("flash");
    for (let n = 0; n < 3; n++) reinforcing.update(1 / 60);
    expect(reinforcing.moverState(0)?.threat?.attacker).toBe(-1);
    reinforcing.dispose();
  });

  it("holds both scouts and tanks past the team-advance leash", () => {
    // Same bloodied-mate shape, but the contact sits past the 3500
    // team-advance leash of the origin anchor: nobody marches across the
    // map on it, scouts included.
    const build = (kind: UnitKind): { movement: UnitMovement; units: THREE.Group } =>
      makeScoutMovement(
        [
          { x: 0, z: 0 },
          { x: 3600, z: 0 },
          { x: 3700, z: 0 },
        ],
        [0, 0, 1],
        [kind, "flash", "flash"],
      );
    for (const kind of ["peewee", "flash"] as UnitKind[]) {
      const { movement } = build(kind);
      for (let n = 0; n < 3; n++) movement.update(1 / 60);
      // The mate still commits to its neighbour; the far hull holds.
      expect(movement.moverState(1)?.threat?.attacker).toBe(2);
      expect(movement.hasThreat(0)).toBe(false);
      movement.dispose();
    }
  });

  it("lets player orders win over scouting", () => {
    // Ordered peewee with an enemy sitting in the scout-only band: the
    // order holds, no probe, no advance.
    const { movement } = makeScoutMovement(
      [
        { x: 0, z: 0 },
        { x: 1300, z: 0 },
      ],
      [0, 1],
      ["peewee", "flash"],
    );
    movement.orderUnit(0, { x: -500, z: -500 });
    for (let n = 0; n < 3; n++) movement.update(1 / 60);
    expect(movement.hasThreat(0)).toBe(false);
    movement.dispose();
  });
});

describe("CombatFx shell investigate", () => {
  it("marks shell splashes so victims investigate the firing position", () => {
    const { fx } = sizedFx();
    const threats: { victim: number; attacker: number; shell: boolean }[] = [];
    fx.onUnitThreatened = (victim, attacker, _ax, _az, _damageAdd, shell) =>
      threats.push({ victim, attacker, shell });
    // Hammer shells arc in: the hook carries shell=true.
    splash(fx, 10, 100, 0, "hammer", 1);
    expect(threats).toHaveLength(1);
    expect(threats[0]).toMatchObject({ victim: 0, attacker: 1, shell: true });
    fx.dispose();
  });

  it("marks direct-fire bolts as non-shell", () => {
    const { fx } = sizedFx();
    const threats: { shell: boolean }[] = [];
    fx.onUnitThreatened = (_victim, _attacker, _ax, _az, _damageAdd, shell) => threats.push({ shell });
    splash(fx, 2, 100, 0, "flash", 1);
    expect(threats).toHaveLength(1);
    expect(threats[0]?.shell).toBe(false);
    fx.dispose();
  });

  it("never blames a same-team shooter (friendly shells ignored)", () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 1, cellZ: 1, rotation: 0, team: 0 },
      { kind: "flash", cellX: 2, cellZ: 2, rotation: 0, team: 0 },
    ];
    for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(400, 100, 0)]) {
      const body = new THREE.Group();
      body.position.copy(pos);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    const fx = new CombatFx(scene, group, mulberry32(7));
    fx.update(1 / 60);
    const threats: unknown[] = [];
    const stuns: unknown[] = [];
    fx.onUnitThreatened = (...args: unknown[]) => threats.push(args);
    fx.onUnitStunned = (...args: unknown[]) => stuns.push(args);
    // Mate 1 shells victim 0 (past the 64-unit hammer blast only the victim
    // is touched): honest splash damage, never a grudge.
    splash(fx, 10, 100, 0, "hammer", 1);
    expect(stuns).toHaveLength(1);
    expect(threats).toHaveLength(0);
    fx.dispose();
  });

  it("traverses the victim turret onto its live attacker", () => {
    const { fx, units } = sizedFx();
    const a = units.children[0] as THREE.Group;
    const b = units.children[1] as THREE.Group;
    const want = yawToTarget({ x: a.position.x, z: a.position.z }, { x: b.position.x, z: b.position.z });
    fx.trackThreat(0, 1);
    const gunBefore = muzzleYaw(fx.aimState(0)!.hull, fx.aimState(0)!.turret);
    const errBefore = Math.abs(wrapAngle(gunBefore - want));
    expect(errBefore).toBeGreaterThan(0.1);
    for (let n = 0; n < 30; n++) fx.update(1 / 60);
    expect(fx.isDestroyedAt(0)).toBe(false);
    const aimed = fx.aimState(0)!;
    const errAfter = Math.abs(wrapAngle(muzzleYaw(aimed.hull, aimed.turret) - want));
    expect(errAfter).toBeLessThan(errBefore);
    fx.dispose();
  });

  it("refuses self-tracks, wrecks, and unknown indices", () => {
    const { fx } = sizedFx();
    fx.trackThreat(0, 0);
    fx.trackThreat(0, 5);
    fx.trackThreat(5, 1);
    (fx as unknown as { destroyed: boolean[] }).destroyed[1] = true;
    fx.trackThreat(0, 1);
    // Nothing tracked and no live pair drawable: the aim never slews.
    const before = fx.aimState(0)!;
    for (let n = 0; n < 30; n++) fx.update(1 / 60);
    expect(fx.aimState(0)).toEqual(before);
    fx.dispose();
  });
});

describe("UnitMovement shell investigate", () => {
  /** Victim at the origin, hammer parked 1000 east — past the bolt gates. */
  function makeShellMovement(teams?: [number, number]): { movement: UnitMovement; units: THREE.Group } {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 10, cellZ: 10, rotation: 0, ...(teams ? { team: teams[0] } : {}) },
      { kind: "hammer", cellX: 40, cellZ: 40, rotation: Math.PI, ...(teams ? { team: teams[1] } : {}) },
    ];
    for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(1000, 120, 0)]) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.copy(pos);
      group.add(body);
    }
    const movement = new UnitMovement(
      group,
      [
        [
          { x: 0, z: 0 },
          { x: 0, z: 400 },
          { x: 400, z: 400 },
          { x: 400, z: 0 },
        ],
        [
          { x: 1000, z: 0 },
          { x: 1000, z: 400 },
          { x: 1400, z: 400 },
          { x: 1400, z: 0 },
        ],
      ],
      { groundY: () => 100 },
    );
    return { movement, units: group };
  }

  it("investigates a distant shell source past the bolt gates", () => {
    const { movement } = makeShellMovement();
    // The same geometry without the shell flag stays silent (bolt-identical).
    movement.threatenUnit(0, 1, 1000, 0);
    expect(movement.hasThreat(0)).toBe(false);
    // The shell wound investigates: attacker + firing position on the hunt leash.
    movement.threatenUnit(0, 1, 1000, 0, true);
    expect(movement.hasThreat(0)).toBe(true);
    expect(movement.moverState(0)?.threat).toMatchObject({
      attacker: 1,
      x: 1000,
      z: 0,
      leash: HUNT_LEASH_RADIUS,
    });
    movement.dispose();
  });

  it("turns the hull toward the shell source and closes on it", () => {
    // Team-less, so the hunt sweep stays out of it: only the investigate steers.
    const { movement } = makeShellMovement();
    movement.threatenUnit(0, 1, 1000, 0, true);
    const before = movement.moverState(0)!;
    const want = yawToTarget({ x: before.x, z: before.z }, { x: 1000, z: 0 });
    const turnBefore = Math.abs(wrapAngle(before.hull - want));
    expect(turnBefore).toBeGreaterThan(0.5);
    const distBefore = Math.hypot(before.x - 1000, before.z - 0);
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    const after = movement.moverState(0)!;
    expect(movement.hasThreat(0)).toBe(true);
    expect(Math.abs(wrapAngle(after.hull - want))).toBeLessThan(turnBefore);
    // Flash stand-off is 220: a 1000-unit investigate visibly closes.
    expect(Math.hypot(after.x - 1000, after.z - 0)).toBeLessThan(distBefore);
    movement.dispose();
  });

  it("ignores friendly shells, answers enemy ones", () => {
    const mate = makeShellMovement([0, 0]);
    mate.movement.threatenUnit(0, 1, 1000, 0, true);
    expect(mate.movement.hasThreat(0)).toBe(false);
    mate.movement.dispose();
    const enemy = makeShellMovement([0, 1]);
    enemy.movement.threatenUnit(0, 1, 1000, 0, true);
    expect(enemy.movement.hasThreat(0)).toBe(true);
    enemy.movement.dispose();
  });

  it("runs the shell loop: a distant splash investigates the firing position", () => {
    // CombatFx splash with the shooter parked 1000 out, wired like the
    // canvas: the hook's shell flag drives the victim's investigate memory.
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 10, cellZ: 10, rotation: 0 },
      { kind: "hammer", cellX: 40, cellZ: 40, rotation: Math.PI },
    ];
    for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(1000, 120, 0)]) {
      const body = new THREE.Group();
      body.position.copy(pos);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    const fx = new CombatFx(scene, group, mulberry32(7));
    fx.update(1 / 60);
    const { movement } = makeShellMovement();
    fx.onUnitThreatened = (victim, attacker, ax, az, _damageAdd, shell) => {
      movement.threatenUnit(victim, attacker, ax, az, shell);
      fx.trackThreat(victim, attacker);
    };
    // The blast lands on the victim; the round came from the hammer 1000 east.
    splash(fx, 10, 100, 0, "hammer", 1);
    expect(movement.moverState(0)?.threat).toMatchObject({
      attacker: 1,
      x: 1000,
      z: 0,
      leash: HUNT_LEASH_RADIUS,
    });
    movement.dispose();
    fx.dispose();
  });
});

describe("waypoint pursuit display", () => {
  it("promises the chase in rose, hiding the patrol loop", () => {
    const routeSet = routes();
    const base = { ...initMover(routeSet[0]!, 0), x: 0, z: 0, hull: 0 };
    const chasing = notifyThreat(base, base, 1, 500, 300, routeSet[0]![0]);
    expect(activeTrailMode(chasing, routeSet[0])).toBe("pursue");
    const movers: Mover[] = [chasing];
    const movement = {
      moverState: (i: number): Mover | null =>
        movers[i]
          ? {
              ...movers[i]!,
              order: movers[i]!.order
                ? { at: movers[i]!.order!.at, points: movers[i]!.order!.points }
                : undefined,
              threat: movers[i]!.threat ? { ...movers[i]!.threat! } : undefined,
            }
          : null,
      isDestroyed: () => false,
    };
    const scene = new THREE.Scene();
    const fx = new WaypointFx(scene, [routeSet[0]!], { groundY: () => 100 });
    fx.update(movement, 1, 0);
    expect(fx.trailMode(0)).toBe("pursue");
    expect(fx.hasPatrol(0)).toBe(false);
    expect(fx.trailPoints(0).length).toBeGreaterThanOrEqual(2);
    expect(fx.flowPosition(0)).not.toBeNull();
    // The live trail repaints from slate to the pursuit rose.
    const trail = (fx as unknown as { trails: THREE.Line[] }).trails[0]!;
    expect((trail.material as THREE.LineBasicMaterial).color.getHex()).toBe(WAYPOINT_PURSUIT_COLOR);
    fx.dispose();
  });
});

describe("UnitMovement HQ assault", () => {
  /** Assaulter + mate (team 0) vs one enemy (team 1) at `enemyX`. */
  function makeAssaultMovement(enemyX: number): { movement: UnitMovement; units: THREE.Group } {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "stump", cellX: 10, cellZ: 10, rotation: 0, team: 0 },
      { kind: "flash", cellX: 11, cellZ: 10, rotation: 0, team: 0 },
      { kind: "hammer", cellX: 60, cellZ: 60, rotation: Math.PI, team: 1 },
    ];
    for (const pos of [
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(-100, 100, 0),
      new THREE.Vector3(enemyX, 100, 0),
    ]) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.copy(pos);
      group.add(body);
    }
    const routeSet = [0, -100, enemyX].map((ax) => [
      { x: ax, z: 0 },
      { x: ax, z: 400 },
      { x: ax + 400, z: 400 },
      { x: ax + 400, z: 0 },
    ]);
    const movement = new UnitMovement(group, routeSet, { groundY: () => 100 });
    return { movement, units: group };
  }

  it("marks an obstructed fort shot as a structure assault", () => {
    const { movement } = makeAssaultMovement(3000);
    movement.seekEngage(0, -1, 400, 100);
    expect(movement.moverState(0)?.threat).toMatchObject({ attacker: -1, structure: true });
    movement.dispose();
  });

  it("holds the assault through the hunt sweep (no team-advance clobber)", () => {
    const { movement } = makeAssaultMovement(3000);
    movement.seekEngage(0, -1, 400, 100);
    movement.sweepHunt();
    // No live enemy in notice and no team contact: the fort push stands with
    // its assault flag, instead of turning into a team-advance waypoint.
    expect(movement.moverState(0)?.threat).toMatchObject({
      attacker: -1,
      x: 400,
      z: 100,
      structure: true,
    });
    movement.dispose();
  });

  it("still upgrades an assault to a live hunt when the enemy is in notice", () => {
    const { movement } = makeAssaultMovement(500);
    movement.seekEngage(0, -1, 400, 100);
    movement.sweepHunt();
    // The enemy stands inside the hunt eyes: self-defense preempts the fort.
    expect(movement.moverState(0)?.threat?.attacker).toBe(2);
    movement.dispose();
  });

  it("turns an assault onto a consistent challenger through threatenUnit", () => {
    const { movement } = makeAssaultMovement(3000);
    movement.seekEngage(0, -1, 400, 100);
    // Two stray splashes from the far gun: the push holds, counting them.
    movement.threatenUnit(0, 2, 500, 300);
    expect(movement.moverState(0)?.threat?.attacker).toBe(-1);
    movement.threatenUnit(0, 2, 510, 310);
    expect(movement.moverState(0)?.threat?.attacker).toBe(-1);
    // The third in a row: the hull turns to deal with the enemy first.
    movement.threatenUnit(0, 2, 520, 320);
    expect(movement.moverState(0)?.threat?.attacker).toBe(2);
    movement.dispose();
  });

  it("reports fighting only for live enemy grudges (the gun-layer gate)", () => {
    const { movement } = makeAssaultMovement(3000);
    expect(movement.isFighting(0)).toBe(false);
    movement.seekEngage(0, -1, 400, 100);
    // Assaulting a fort is not fighting: unpressured guns keep shelling.
    expect(movement.isFighting(0)).toBe(false);
    movement.threatenUnit(0, 2, 500, 300);
    movement.threatenUnit(0, 2, 510, 310);
    expect(movement.isFighting(0)).toBe(false);
    movement.threatenUnit(0, 2, 520, 320);
    expect(movement.isFighting(0)).toBe(true);
    movement.dispose();
  });
});

describe("UnitMovement active battlefield", () => {
  /** Idle hulls with custom spawns, sides, and kinds (anchors at spawns). */
  function makeFieldMovement(
    spawns: { x: number; z: number }[],
    teams: number[],
    kinds: UnitKind[],
  ): { movement: UnitMovement; units: THREE.Group } {
    const group = new THREE.Group();
    group.userData.units = spawns.map((_, i) => ({
      kind: kinds[i] ?? "flash",
      cellX: 10 + i,
      cellZ: 10,
      rotation: 0,
      team: teams[i],
    }));
    for (const pos of spawns) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.set(pos.x, 100, pos.z);
      group.add(body);
    }
    const routeSet = spawns.map((s) => [
      { x: s.x, z: s.z },
      { x: s.x, z: s.z + 400 },
      { x: s.x + 400, z: s.z + 400 },
      { x: s.x + 400, z: s.z },
    ]);
    const movement = new UnitMovement(group, routeSet, { groundY: () => 100 });
    return { movement, units: group };
  }

  it("reinforces a bloodied mate: the far side advances on the attack", () => {
    // A (team 0) at the origin trades with C (team 1) at 500; B (team 0)
    // guards its loop 2000 west — far past every notice gate.
    const { movement } = makeFieldMovement(
      [
        { x: 0, z: 0 },
        { x: -2000, z: 0 },
        { x: 500, z: 0 },
      ],
      [0, 0, 1],
      ["flash", "flash", "flash"],
    );
    movement.threatenUnit(0, 2, 500, 0);
    expect(movement.hasThreat(0)).toBe(true);
    movement.update(1 / 60);
    // B never saw the enemy itself, but the side was alerted: it advances
    // on a position memory (never a grudge) instead of guarding its loop.
    const issued = movement.moverState(1)!;
    expect(issued.threat?.attacker).toBe(-1);
    expect(movement.hasThreat(1)).toBe(true);
    for (let n = 0; n < 240; n++) movement.update(1 / 60);
    const after = movement.moverState(1)!;
    expect(movement.hasThreat(1)).toBe(true);
    expect(after.x).toBeGreaterThan(issued.x);
    movement.dispose();
  });

  it("alerts the side even when the victim is under orders", () => {
    const { movement } = makeFieldMovement(
      [
        { x: 0, z: 0 },
        { x: -2000, z: 0 },
        { x: 500, z: 0 },
      ],
      [0, 0, 1],
      ["flash", "flash", "flash"],
    );
    // A is driving a player order: it records a self-defense memory itself…
    movement.orderUnit(0, { x: -500, z: -500 });
    movement.threatenUnit(0, 2, 500, 0);
    expect(movement.hasThreat(0)).toBe(true);
    movement.update(1 / 60);
    // …and the side still reinforces the firing position.
    expect(movement.hasThreat(0)).toBe(true);
    expect(movement.moverState(1)?.threat?.attacker).toBe(-1);
    movement.dispose();
  });

  it("shares a scout's HQ sighting team-wide and pushes the fort", () => {
    // Scout + heavy (team 0) west, one enemy hull far east, and the enemy
    // works at 1300 — inside scout notice (1500), past tank notice (1100).
    const { movement } = makeFieldMovement(
      [
        { x: 0, z: 0 },
        { x: -500, z: 0 },
        { x: 3000, z: 0 },
      ],
      [0, 0, 1],
      ["peewee", "flash", "flash"],
    );
    movement.setHqProvider(() => [{ x: 1300, z: 0, team: 1 }]);
    movement.update(1 / 60);
    // The scout assaults the works it found (a structure memory, never a
    // corpse-grudge)…
    expect(movement.moverState(0)?.threat).toMatchObject({
      attacker: -1,
      x: 1300,
      z: 0,
      structure: true,
    });
    // …and the heavy, which sees nothing itself, marches on the shared
    // contact instead of standing around.
    const issued = movement.moverState(1)!;
    expect(issued.threat?.attacker).toBe(-1);
    expect(issued.threat?.structure).toBeUndefined();
    for (let n = 0; n < 240; n++) movement.update(1 / 60);
    const scout = movement.moverState(0)!;
    const heavy = movement.moverState(1)!;
    expect(movement.hasThreat(0)).toBe(true);
    expect(movement.hasThreat(1)).toBe(true);
    expect(scout.x).toBeGreaterThan(0);
    expect(heavy.x).toBeGreaterThan(issued.x);
    movement.setHqProvider(null);
    movement.dispose();
  });

  it("sends scouts ranging with no contact while heavies hold their loops", () => {
    // Scout + heavy (team 0) west, one enemy heavy far east: no hits, no
    // sightings, no forts — the cold-start stalemate.
    const { movement } = makeFieldMovement(
      [
        { x: 0, z: 0 },
        { x: -100, z: 0 },
        { x: 3000, z: 0 },
      ],
      [0, 0, 1],
      ["peewee", "flash", "flash"],
    );
    movement.update(1 / 60);
    // The scout recons toward the enemy anchors on a position memory…
    expect(movement.moverState(0)?.threat?.attacker).toBe(-1);
    // …while the heavy keeps patrolling (no contact, no advance).
    expect(movement.hasThreat(1)).toBe(false);
    expect(movement.hasThreat(2)).toBe(false);
    for (let n = 0; n < 120; n++) movement.update(1 / 60);
    // Recon drives east (patrol would hold x near 0, marching +z first).
    expect(movement.moverState(0)!.x).toBeGreaterThan(50);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });
});

describe("UnitMovement shared intel", () => {
  /** Idle hulls with custom spawns, sides, and kinds (anchors at spawns). */
  function makeIntelMovement(
    spawns: { x: number; z: number }[],
    teams: number[],
    kinds: UnitKind[],
  ): { movement: UnitMovement; units: THREE.Group } {
    const group = new THREE.Group();
    group.userData.units = spawns.map((_, i) => ({
      kind: kinds[i] ?? "flash",
      cellX: 10 + i,
      cellZ: 10,
      rotation: 0,
      team: teams[i],
    }));
    for (const pos of spawns) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.set(pos.x, 100, pos.z);
      group.add(body);
    }
    const routeSet = spawns.map((s) => [
      { x: s.x, z: s.z },
      { x: s.x, z: s.z + 400 },
      { x: s.x + 400, z: s.z + 400 },
      { x: s.x + 400, z: s.z },
    ]);
    const movement = new UnitMovement(group, routeSet, { groundY: () => 100 });
    return { movement, units: group };
  }

  it("shares an ordered hull's sighting with the whole side", () => {
    // A (team 0) drives a player order past the enemy C at 500; B (team 0)
    // guards its loop 2000 west — far past every notice gate.
    const { movement } = makeIntelMovement(
      [
        { x: 0, z: 0 },
        { x: -2000, z: 0 },
        { x: 500, z: 0 },
      ],
      [0, 0, 1],
      ["flash", "flash", "flash"],
    );
    movement.orderUnit(0, { x: -500, z: -500 });
    movement.update(1 / 60);
    // Spotting is passive but pursuit is gated: the ordered hull reports
    // without engaging, and the far mate advances on the shared sighting
    // (never a grudge) instead of guarding its loop. Focus-only sharing
    // would leave B patrolling — A never pursues, so no focus ever forms.
    expect(movement.hasThreat(0)).toBe(false);
    const issued = movement.moverState(1)!;
    expect(issued.threat?.attacker).toBe(-1);
    expect(issued.threat?.x).toBe(500);
    for (let n = 0; n < 240; n++) movement.update(1 / 60);
    expect(movement.moverState(1)!.x).toBeGreaterThan(issued.x);
    movement.dispose();
  });

  it("shares an outnumbered spotter's sighting while it holds", () => {
    // A (team 0) faces three fresh enemies at ~500 and holds for backup;
    // B (team 0) guards its loop 2000 west with nothing near it.
    const { movement } = makeIntelMovement(
      [
        { x: 0, z: 0 },
        { x: -2000, z: 0 },
        { x: 500, z: 0 },
        { x: 530, z: 10 },
        { x: 560, z: 20 },
      ],
      [0, 0, 1, 1, 1],
      ["flash", "flash", "flash", "flash", "flash"],
    );
    movement.update(1 / 60);
    // A sees the column but waits instead of charging alone — and its
    // sighting still focuses the side: B advances on the nearest enemy
    // (never a grudge) instead of guarding its loop.
    expect(movement.hasThreat(0)).toBe(false);
    const issued = movement.moverState(1)!;
    expect(issued.threat?.attacker).toBe(-1);
    expect(issued.threat?.x).toBe(500);
    movement.dispose();
  });

  it("tracks each enemy separately: mates advance on their nearest", () => {
    // Two bloodied enemies on opposite sides of the field: B (team 0)
    // west takes fire from the western gun, D (team 0) east from the
    // eastern one — both too far to pursue, both alerting the side.
    const { movement } = makeIntelMovement(
      [
        { x: -2800, z: 0 },
        { x: 1900, z: 0 },
        { x: 500, z: 0 },
        { x: -1500, z: 0 },
      ],
      [0, 0, 1, 1],
      ["flash", "flash", "flash", "flash"],
    );
    movement.threatenUnit(0, 3, -1500, 0);
    movement.threatenUnit(1, 2, 500, 0);
    expect(movement.hasThreat(0)).toBe(false);
    expect(movement.hasThreat(1)).toBe(false);
    movement.update(1 / 60);
    // One shared point would march both mates at the same spot; per-enemy
    // memories split the response — each advances on its nearest.
    expect(movement.moverState(0)?.threat).toMatchObject({ attacker: -1, x: -1500, z: 0 });
    expect(movement.moverState(1)?.threat).toMatchObject({ attacker: -1, x: 500, z: 0 });
    movement.dispose();
  });

  it("forgets a dead contact: the advance ends when the enemy dies", () => {
    // A (team 0) at the origin advances on B's (team 0) sighting of C.
    const { movement } = makeIntelMovement(
      [
        { x: 0, z: 0 },
        { x: 1000, z: 0 },
        { x: 1200, z: 0 },
      ],
      [0, 0, 1],
      ["flash", "flash", "flash"],
    );
    movement.update(1 / 60);
    expect(movement.moverState(0)?.threat?.attacker).toBe(-1);
    // C dies: the record drops in maintenance and A resumes its patrol
    // instead of marching on a corpse (B's grudge clears the same sweep).
    movement.markDestroyed(2);
    movement.update(1 / 60);
    expect(movement.hasThreat(0)).toBe(false);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });

  it("drops a stale firing position a mate already covers", () => {
    // V (team 0) takes fire attributed near M (team 0) while the live gun
    // C stands 2000 east: M already covers the reported spot, C is gone.
    const build = (): { movement: UnitMovement; units: THREE.Group } =>
      makeIntelMovement(
        [
          { x: 0, z: 0 },
          { x: 400, z: 0 },
          { x: 2000, z: 0 },
        ],
        [0, 0, 1],
        ["flash", "flash", "flash"],
      );
    const { movement: stale } = build();
    stale.threatenUnit(0, 2, 410, 0);
    stale.update(1 / 60);
    // The victim's grudge dies on the drive (the live gun stands past the
    // disengage bound) and the side forgets the covered spot — nobody
    // marches on a position a mate already holds.
    expect(stale.hasThreat(0)).toBe(false);
    expect(stale.hasThreat(1)).toBe(false);
    stale.dispose();
    // The same alert at the gun's true position holds: the side marches.
    const { movement: fresh } = build();
    fresh.threatenUnit(0, 2, 2000, 0);
    fresh.update(1 / 60);
    expect(fresh.moverState(0)?.threat?.attacker).toBe(-1);
    expect(fresh.moverState(1)?.threat?.attacker).toBe(-1);
    expect(fresh.moverState(1)?.threat?.x).toBe(2000);
    fresh.dispose();
  });
});

describe("UnitMovement firing footwork", () => {
  function makeDuelMovement(
    spawns: { x: number; z: number }[],
    teams: number[],
    kinds: UnitKind[],
    treeStands?: () => { x: number; z: number; groundY: number; standing: boolean }[],
  ): { movement: UnitMovement; units: THREE.Group } {
    const group = new THREE.Group();
    group.userData.units = spawns.map((_, i) => ({
      kind: kinds[i] ?? "flash",
      cellX: 10 + i,
      cellZ: 10,
      rotation: 0,
      team: teams[i],
    }));
    for (const pos of spawns) {
      const body = new THREE.Group();
      body.rotation.y = 0;
      body.position.set(pos.x, 100, pos.z);
      group.add(body);
    }
    const routeSet = spawns.map((s) => [
      { x: s.x, z: s.z },
      { x: s.x, z: s.z + 400 },
      { x: s.x + 400, z: s.z + 400 },
      { x: s.x + 400, z: s.z },
    ]);
    const movement = new UnitMovement(group, routeSet, {
      groundY: () => 100,
      ...(treeStands ? { treeStands } : {}),
    });
    return { movement, units: group };
  }

  it("opens a stacked angle while respecting occupied shuffle lanes", () => {
    // Flash + stump (team 0) hold on a hammer (team 1) from ~26° apart —
    // stacked inside the flank angle, so the second gun opens away.
    const { movement } = makeDuelMovement(
      [
        { x: 0, z: 0 },
        { x: 0, z: 100 },
        { x: 200, z: 0 },
      ],
      [0, 0, 1],
      ["flash", "stump", "hammer"],
    );
    movement.threatenUnit(0, 2, 200, 0);
    movement.threatenUnit(1, 2, 200, 0);
    movement.threatenUnit(2, 0, 0, 0);
    // Orbit clock runs ahead of the seat clock: hull 1 (orbit stagger
    // ≈0.1 s) is already strafing after two seconds, while hull 0 (orbit
    // stagger 2.5 s, seat stagger 7 s) still holds its seat.
    for (let n = 0; n < 120; n++) movement.update(1 / 60);
    const early0 = movement.moverState(0)!;
    const early1 = movement.moverState(1)!;
    expect(Math.hypot(early1.x - 0, early1.z - 100)).toBeGreaterThan(10);
    expect(Math.abs(early0.x)).toBeLessThan(1);
    expect(Math.abs(early0.z)).toBeLessThan(1);
    // Past the seat clock the stacked mate flanks to the far side of the
    // line while admitting only shuffles with a clear travel lane: the
    // pair opens past the stack gate without forcing a wider orbit through
    // a mate's reserved seat.
    for (let n = 0; n < 480; n++) movement.update(1 / 60);
    const a = movement.moverState(0)!;
    const b = movement.moverState(1)!;
    const c = movement.moverState(2)!;
    const angleAt = (p: { x: number; z: number }): number => Math.atan2(p.x - c.x, p.z - c.z);
    let sep = Math.abs(angleAt(a) - angleAt(b));
    if (sep > Math.PI) sep = 2 * Math.PI - sep;
    expect(sep).toBeGreaterThan(Math.PI / 6);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(48);
    expect(movement.hasThreat(0)).toBe(true);
    expect(movement.hasThreat(1)).toBe(true);
    // The hammer faces 2v1 odds, so it waits for backup instead of
    // strafing — outnumbered holders still hold.
    expect(Math.abs(c.x - 200)).toBeLessThan(1);
    expect(Math.abs(c.z - 0)).toBeLessThan(1);
    movement.dispose();
  });

  it("holds a packed firing line instead of repeatedly orbiting into a mate", () => {
    const starts = [{ x: 0, z: 0 }, { x: 0, z: 60 }, { x: 200, z: 0 }];
    const { movement } = makeDuelMovement(starts, [0, 0, 1], ["flash", "flash", "hammer"]);
    movement.threatenUnit(0, 2, 200, 0);
    movement.threatenUnit(1, 2, 200, 0);
    movement.threatenUnit(2, 0, 0, 0);
    // Before the genuine flank clock: a clear firing seat gains nothing
    // from a routine orbit. Keep both allies planted for hundreds of ticks
    // while their guns retain their target and the outnumbered foe waits.
    for (let tick = 0; tick < 240; tick++) {
      movement.update(1 / 60);
      for (let i = 0; i < starts.length; i++) {
        const state = movement.moverState(i)!;
        expect(state.x).toBe(starts[i]!.x);
        expect(state.z).toBe(starts[i]!.z);
        expect(state.threat?.sidestep).toBeUndefined();
        expect(movement.hasThreat(i)).toBe(true);
      }
    }
    movement.dispose();
  });

  it("mirrors a routine strafe away from a wreck's occupied lane", () => {
    const { movement } = makeDuelMovement(
      [{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 0, z: -80 }],
      [0, 1, 0], ["flash", "hammer", "flash"],
    );
    movement.markDestroyed(2);
    movement.threatenUnit(0, 1, 200, 0);
    movement.threatenUnit(1, 0, 0, 0);
    // Index 0's usual minus-side shuffle would finish only 32 units from
    // the wreck. The free mirror opens instead; wrecks cannot yield.
    for (let tick = 0; tick < 240 && !movement.moverState(0)?.threat?.sidestep; tick++) movement.update(1 / 60);
    expect(movement.moverState(0)?.threat?.sidestep?.z).toBeGreaterThan(0);
    for (let tick = 0; tick < 300; tick++) {
      movement.update(1 / 60);
      const state = movement.moverState(0)!;
      expect(Math.hypot(state.x, state.z + 80)).toBeGreaterThanOrEqual(48);
      expect(movement.moverState(2)?.x).toBe(0);
      expect(movement.moverState(2)?.z).toBe(-80);
    }
    movement.dispose();
  });

  it("sidesteps out of a blocked lane toward clear ground", () => {
    // Flash vs hammer 200 apart with one crown centered on the lane: the
    // muzzle-to-muzzle line clips it, both laterals miss it.
    const { movement } = makeDuelMovement(
      [
        { x: 0, z: 0 },
        { x: 200, z: 0 },
      ],
      [0, 1],
      ["flash", "hammer"],
      () => [{ x: 100, z: 0, groundY: 104, standing: true }],
    );
    movement.threatenUnit(0, 1, 200, 0);
    movement.threatenUnit(1, 0, 0, 0);
    // Hull 1 (orbit stagger ≈0.1s) strafes first on pristine geometry: the
    // lane clips the crown and both laterals clear, so the orbit's
    // roster-side pick lands on the same minus-side point (z +48 off its
    // seat) the slower seat evaluator would have named.
    for (let n = 0; n < 600 && !movement.moverState(1)?.threat?.sidestep; n++) {
      movement.update(1 / 60);
    }
    expect(movement.moverState(1)?.threat?.sidestep).toEqual({ x: 200, z: 48 });
    // The holder walks the step and clears it on arrival.
    for (let n = 0; n < 600 && movement.moverState(1)?.threat?.sidestep; n++) {
      movement.update(1 / 60);
    }
    expect(movement.moverState(1)?.threat?.sidestep).toBeUndefined();
    expect(movement.moverState(1)!.z).toBeGreaterThan(30);
    movement.dispose();
  });

  it("steps laterally out of the wood on a forest-obstructed seek", () => {
    // Flash vs hammer 200 apart with one crown centered on the lane: the
    // obstructed gun reports (CombatFx forest futility) and the reposition
    // must step laterally off the blocked lane — not just close straight
    // through the wood firing into the crown the whole way.
    const stands = () => [{ x: 100, z: 0, groundY: 104, standing: true }];
    const { movement } = makeDuelMovement(
      [
        { x: 0, z: 0 },
        { x: 200, z: 0 },
      ],
      [0, 1],
      ["flash", "hammer"],
      stands,
    );
    movement.seekEngage(0, 1, 200, 0);
    const memory = movement.moverState(0)?.threat;
    expect(memory?.attacker).toBe(1);
    expect(memory?.sidestep).toBeDefined();
    // The stepped lane crosses strictly less wood than the direct lane.
    const wood = stands();
    const seat = { x: 0, y: 100 + muzzleHeight("flash"), z: 0 };
    const foe = { x: 200, y: 100 + muzzleHeight("hammer"), z: 0 };
    const direct = countTreesOnSegment(seat, foe, wood);
    expect(direct).toBeGreaterThan(0);
    const spot = memory!.sidestep!;
    const stepped = countTreesOnSegment({ x: spot.x, y: seat.y, z: spot.z }, foe, wood);
    expect(stepped).toBeLessThan(direct);
    // The hull walks the step instead of standing in the wood: off the
    // firing line, then arrived and cleared.
    movement.threatenUnit(1, 0, 0, 0);
    for (let n = 0; n < 120 && movement.moverState(0)?.threat?.sidestep; n++) {
      movement.update(1 / 60);
    }
    expect(movement.moverState(0)?.threat?.sidestep).toBeUndefined();
    expect(Math.abs(movement.moverState(0)!.z)).toBeGreaterThan(30);
    movement.dispose();
  });

  it("finishes a forest escape and returns fire while outnumbered under alternating threats", () => {
    const trees = [{ x: 100, z: 0, groundY: 86, standing: true }];
    const { movement, units } = makeDuelMovement(
      [{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 100 }],
      [0, 1, 1], ["flash", "hammer", "hammer"], () => trees,
    );
    // Stationary attackers keep the obstruction/odds geometry reproducible.
    const movers = (movement as unknown as { movers: Mover[] }).movers;
    for (const i of [1, 2]) movers[i] = { ...movers[i]!, hold: true };
    const fx = new CombatFx(new THREE.Scene(), units, () => 0, {
      groundY: () => 100, blastFeatures: () => {}, treeStands: () => trees,
    });
    fx.setExternalHull(true);
    fx.onObstructedShot = (self, target, x, z) => movement.seekEngage(self, target, x, z);
    fx.trackThreat(0, 1);
    movement.threatenUnit(0, 1, 200, 0);
    const internals = fx as unknown as { shots: { attacker: number }[] };
    // Probing shots leave through the wood while the escape is still
    // underway (repeated holds escalate to fire-through), so fire no longer
    // marks the escape's end: track it stickily and run until the
    // obstruction step is attached and then walked off on arrival.
    let returnedFire = false;
    let sawStep = false;
    let escapeZ = 0;
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 6 === 0) {
        const enemy = tick % 12 === 0 ? 1 : 2;
        movement.threatenUnit(0, enemy, 200, enemy === 1 ? 0 : 100);
        fx.trackThreat(0, enemy);
      }
      movement.update(1 / 60);
      fx.update(1 / 60);
      if (internals.shots.some((shot) => shot.attacker === 0)) returnedFire = true;
      if (movement.moverState(0)?.threat?.sidestep) sawStep = true;
      else if (sawStep) {
        escapeZ = Math.abs(movement.moverState(0)!.z);
        break;
      }
    }
    expect(sawStep).toBe(true);
    expect(escapeZ).toBeGreaterThan(20);
    expect(returnedFire).toBe(true);
    fx.dispose();
    movement.dispose();
  });

  it("steps laterally when a fort assault lane crosses wood", () => {
    // Same cure for structure seeks: the shell lane to the fort clips the
    // crown, so the assault carries a lateral step off the blocked lane.
    const { movement } = makeDuelMovement(
      [
        { x: 0, z: 0 },
        { x: 200, z: 0 },
      ],
      [0, 1],
      ["flash", "hammer"],
      () => [{ x: 100, z: 0, groundY: 104, standing: true }],
    );
    movement.seekEngage(0, -1, 200, 0);
    const memory = movement.moverState(0)?.threat;
    expect(memory?.attacker).toBe(-1);
    expect(memory?.structure).toBe(true);
    expect(memory?.sidestep).toEqual({ x: 0, z: 48, obstruction: true });
    movement.dispose();
  });

  it("keeps closing (no sidestep) when the obstructed lane has no wood", () => {
    // Ridge-blocked, not forest-blocked: the cure is a closer/higher
    // vantage, so the seek carries no lateral step — plain pursuit.
    const { movement } = makeDuelMovement(
      [
        { x: 0, z: 0 },
        { x: 200, z: 0 },
      ],
      [0, 1],
      ["flash", "hammer"],
    );
    movement.seekEngage(0, 1, 200, 0);
    const memory = movement.moverState(0)?.threat;
    expect(memory?.attacker).toBe(1);
    expect(memory?.sidestep).toBeUndefined();
    movement.dispose();
  });

  it("strafes an open 1v1 lane instead of holding still", () => {
    const { movement } = makeDuelMovement(
      [
        { x: 0, z: 0 },
        { x: 200, z: 0 },
      ],
      [0, 1],
      ["flash", "hammer"],
    );
    movement.threatenUnit(0, 1, 200, 0);
    movement.threatenUnit(1, 0, 0, 0);
    // Hull 1 (orbit stagger ≈0.1s) carries its first strafe half a second
    // in, while hull 0 (orbit stagger 2.5s) still holds its seat.
    for (let n = 0; n < 30; n++) movement.update(1 / 60);
    expect(movement.moverState(1)?.threat?.sidestep).toBeDefined();
    expect(movement.moverState(0)?.threat?.sidestep).toBeUndefined();
    expect(Math.abs(movement.moverState(0)!.x)).toBeLessThan(1);
    expect(Math.abs(movement.moverState(0)!.z)).toBeLessThan(1);
    // Ten engaged seconds: both guns circle instead of planting — still
    // engaged (live memories), still at brawl distance, never statues.
    for (let n = 0; n < 570; n++) movement.update(1 / 60);
    const a = movement.moverState(0)!;
    const b = movement.moverState(1)!;
    expect(movement.hasThreat(0)).toBe(true);
    expect(movement.hasThreat(1)).toBe(true);
    expect(Math.hypot(a.x - 0, a.z - 0)).toBeGreaterThan(50);
    expect(Math.hypot(b.x - 200, b.z - 0)).toBeGreaterThan(50);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(100);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(350);
    movement.dispose();
  });

  it("replays an orbiting duel bit-identically", () => {
    // The strafe carries no rng (index-hashed orbit sides, sim-clock
    // cadence), so two identical runs land on identical hulls.
    const run = (): { ax: number; az: number; bx: number; bz: number } => {
      const { movement } = makeDuelMovement(
        [
          { x: 0, z: 0 },
          { x: 200, z: 0 },
        ],
        [0, 1],
        ["flash", "hammer"],
      );
      movement.threatenUnit(0, 1, 200, 0);
      movement.threatenUnit(1, 0, 0, 0);
      for (let n = 0; n < 600; n++) movement.update(1 / 60);
      const a = movement.moverState(0)!;
      const b = movement.moverState(1)!;
      movement.dispose();
      return { ax: a.x, az: a.z, bx: b.x, bz: b.z };
    };
    const first = run();
    const second = run();
    expect(second.ax).toBe(first.ax);
    expect(second.az).toBe(first.az);
    expect(second.bx).toBe(first.bx);
    expect(second.bz).toBe(first.bz);
    // Sanity: the replayed duel actually moved (not two identical statues).
    expect(Math.hypot(first.ax - 0, first.az - 0)).toBeGreaterThan(50);
  });

  it("holds an outnumbered loser statue-still while the winners orbit", () => {
    // One flash facing three: the loser waits for backup instead of
    // strafing, while the winning side circles it.
    const { movement } = makeDuelMovement(
      [
        { x: 0, z: 0 },
        { x: 200, z: 0 },
        { x: 200, z: 60 },
        { x: 200, z: -60 },
      ],
      [0, 1, 1, 1],
      ["flash", "flash", "flash", "flash"],
    );
    movement.threatenUnit(0, 1, 200, 0);
    movement.threatenUnit(1, 0, 0, 0);
    movement.threatenUnit(2, 0, 0, 0);
    movement.threatenUnit(3, 0, 0, 0);
    let victimDrift = 0;
    let victimStepped = false;
    const winnerTravel = [0, 0, 0];
    let winnerPrev = [1, 2, 3].map((i) => ({ ...movement.moverState(i)! }));
    for (let n = 0; n < 600; n++) {
      movement.update(1 / 60);
      const victim = movement.moverState(0)!;
      victimDrift = Math.max(victimDrift, Math.hypot(victim.x - 0, victim.z - 0));
      if (victim.threat?.sidestep) victimStepped = true;
      [1, 2, 3].forEach((i, k) => {
        const s = movement.moverState(i)!;
        winnerTravel[k]! += Math.hypot(s.x - winnerPrev[k]!.x, s.z - winnerPrev[k]!.z);
        winnerPrev[k] = { ...s };
      });
    }
    // Engaged the whole time (live memory) yet never a single step.
    expect(movement.hasThreat(0)).toBe(true);
    expect(victimStepped).toBe(false);
    expect(victimDrift).toBeLessThan(1e-9);
    // Every winner strafes around the loser: path length, not endpoint —
    // the orbit's phase at tick 600 is steering detail (an endpoint pin
    // breaks on any glide retune), but circling 150u+ in 10 s is the
    // strafing itself, on either side of the separation-coast change.
    for (const travel of winnerTravel) {
      expect(travel).toBeGreaterThan(150);
    }
    movement.dispose();
  });
});

describe("1v1 defender retaliation", () => {
  it("lets a slow-traverse defender answer a rapid attacker instead of only taking hits", () => {
    // The full game loop (movement → combat, canvas hook wiring): a hammer
    // with its back to a peewee at 500u. Before the fix the hammer's hull
    // oscillated — stuns faced the patrol leg while pursuit gaps faced the
    // threat — all at the 0.35× pivot floor, so its ±50° turret never bore
    // and it died having fired 0 volleys (peewee untouched). Stunned hulls
    // now face their attacker urgently, so the gun answers mid-duel.
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "hammer", team: 0, cellX: 1, cellZ: 1, rotation: Math.PI },
      { kind: "peewee", team: 1, cellX: 2, cellZ: 2, rotation: Math.PI },
    ];
    for (const spot of [
      { pos: new THREE.Vector3(0, 100, 0), rot: Math.PI },
      { pos: new THREE.Vector3(0, 100, 500), rot: Math.PI },
    ]) {
      const body = new THREE.Group();
      body.rotation.order = "YXZ";
      body.rotation.y = spot.rot;
      body.position.copy(spot.pos);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    const routeSet: RoutePoint[][] = [
      [
        { x: 0, z: 0 },
        { x: 300, z: 0 },
      ],
      [
        { x: 0, z: 500 },
        { x: -300, z: 500 },
      ],
    ];
    const fx = new CombatFx(new THREE.Scene(), group, mulberry32(7), {
      groundY: () => 100,
      blastFeatures: () => {},
    });
    fx.setExternalHull(true);
    const movement = new UnitMovement(group, routeSet, { groundY: () => 100 });
    fx.onUnitKilled = (i) => movement.markDestroyed(i);
    fx.onUnitStunned = (i, damageAdd, blastX, blastZ) => movement.stunUnit(i, damageAdd, blastX, blastZ);
    fx.onUnitThreatened = (victim, attacker, ax, az, _damageAdd, shell) => {
      movement.threatenUnit(victim, attacker, ax, az, shell);
      fx.trackThreat(victim, attacker);
    };
    fx.onObstructedShot = (attacker, target, x, z) => movement.seekEngage(attacker, target, x, z);
    const priv = fx as unknown as { shots: { attacker: number }[] };
    const seen = new Set<unknown>();
    let hammerVolleys = 0;
    for (let frame = 0; frame < 60 * 40; frame++) {
      movement.update(1 / 60);
      fx.update(1 / 60);
      movement.setDamage(fx.damageList());
      for (const shot of priv.shots) {
        if (!seen.has(shot)) {
          seen.add(shot);
          if (shot.attacker === 0) hammerVolleys++;
        }
      }
      if (fx.isDestroyedAt(0) || fx.isDestroyedAt(1)) break;
    }
    // The defender fights back: multiple aimed volleys downrange, real
    // damage on the attacker (a hammer shell chips 0.16 point-blank).
    expect(hammerVolleys).toBeGreaterThanOrEqual(2);
    expect(fx.damageList()[1]!).toBeGreaterThan(0.2);
    movement.dispose();
    fx.dispose();
  });
});
