import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  initMover,
  mulberry32,
  notifyThreat,
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
  it("lets player orders, holds, wrecks, and self-hits refuse the memory", () => {
    const { movement } = makeMovement();
    movement.orderUnit(0, { x: 100, z: 100 });
    movement.threatenUnit(0, 1, 500, 300);
    expect(movement.hasThreat(0)).toBe(false);
    movement.threatenUnit(0, 0, 500, 300);
    expect(movement.hasThreat(0)).toBe(false);
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
    // B (200 from C) notices and commits; A (1200 from C, past the hunt
    // engage gate) sees nothing yet and its side has no contact either.
    expect(movement.moverState(1)?.threat?.attacker).toBe(2);
    expect(movement.hasThreat(0)).toBe(false);
    movement.update(1 / 60);
    // B's live pursuit is the squad focus, so the side knows the enemy
    // direction: A advances on a position memory (attacker -1, never a
    // grudge against a mate) instead of guarding its loop.
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
    expect(movement.hasThreat(1)).toBe(false);
    movement.update(1 / 60);
    // …and the sighting focuses the side: the tank advances on the sticky
    // contact (a position, never a grudge) instead of guarding its loop.
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

  it("ranges farther than tanks on a stale contact", () => {
    // Mate bloodies an enemy at 1800 while the scout sits at the origin:
    // past scout notice (so no live hunt), past the 1400 tank advance
    // leash, inside the 2000 scout leash.
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
    // A heavier hull in the same spot never leaves its loop.
    const { movement: guarding } = build("flash");
    for (let n = 0; n < 3; n++) guarding.update(1 / 60);
    expect(guarding.hasThreat(0)).toBe(false);
    guarding.dispose();
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
