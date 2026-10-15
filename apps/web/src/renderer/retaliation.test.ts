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
