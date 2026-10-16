import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { TreeStand } from "@scorched-3d/core";
import { UnitMovement } from "./movement";

const FLAT = 100;
const flatGround = (_x: number, _z: number): number => FLAT;

/** Two idle enemy hulls on opposing teams, facing each other across `dist`. */
function makeDuel(
  dist: number,
  groundY: (x: number, z: number) => number,
  treeStands?: () => TreeStand[],
): UnitMovement {
  const spawns = [
    { x: 0, z: 0 },
    { x: dist, z: 0 },
  ];
  const group = new THREE.Group();
  group.userData.units = spawns.map((_, i) => ({
    kind: "flash",
    cellX: 10 + i,
    cellZ: 10,
    rotation: 0,
    team: i,
  }));
  for (const pos of spawns) {
    const body = new THREE.Group();
    body.rotation.y = 0;
    body.position.set(pos.x, FLAT, pos.z);
    group.add(body);
  }
  const routes = spawns.map((s) => [
    { x: s.x, z: s.z },
    { x: s.x, z: s.z + 400 },
    { x: s.x + 400, z: s.z + 400 },
    { x: s.x + 400, z: s.z },
  ]);
  return new UnitMovement(group, routes, { groundY, treeStands });
}

function stand(x: number, z: number): TreeStand {
  return { x, z, groundY: FLAT, standing: true };
}

describe("sight-gated hunts", () => {
  it("acquires across open ground inside notice", () => {
    const movement = makeDuel(600, flatGround);
    movement.update(1 / 60);
    expect(movement.moverState(0)?.threat?.attacker).toBe(1);
    expect(movement.moverState(1)?.threat?.attacker).toBe(0);
    movement.dispose();
  });

  it("cannot see through a mountain between the hulls", () => {
    const ridge = (x: number, _z: number): number => (x > 200 && x < 400 ? 400 : FLAT);
    const movement = makeDuel(600, ridge);
    movement.update(1 / 60);
    expect(movement.hasThreat(0)).toBe(false);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });

  it("sees farther from high ground, but not back up at it", () => {
    const hill = (x: number, _z: number): number => (x < 100 ? FLAT + 80 : FLAT);
    const movement = makeDuel(1200, hill);
    movement.update(1 / 60);
    // The ridge-top hull spots 100 past the base gate; the valley hull sees nothing.
    expect(movement.moverState(0)?.threat?.attacker).toBe(1);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });

  it("holds fire on the flat past notice (high-ground control)", () => {
    const movement = makeDuel(1200, flatGround);
    movement.update(1 / 60);
    expect(movement.hasThreat(0)).toBe(false);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });

  it("loses mid-range contact through thick forest", () => {
    const woods = [stand(200, 0), stand(300, 0), stand(400, 0), stand(500, 0), stand(600, 0)];
    const movement = makeDuel(900, flatGround, () => woods);
    movement.update(1 / 60);
    expect(movement.hasThreat(0)).toBe(false);
    expect(movement.hasThreat(1)).toBe(false);
    movement.dispose();
  });

  it("keeps mid-range contact on the same lane without wood (forest control)", () => {
    const movement = makeDuel(900, flatGround);
    movement.update(1 / 60);
    expect(movement.moverState(0)?.threat?.attacker).toBe(1);
    expect(movement.moverState(1)?.threat?.attacker).toBe(0);
    movement.dispose();
  });
});

describe("sight-gated fort spotting", () => {
  function makeScout(groundY: (x: number, z: number) => number): UnitMovement {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 10, cellZ: 10, rotation: 0, team: 0 },
      { kind: "flash", cellX: 40, cellZ: 40, rotation: 0, team: 1 },
    ];
    for (const pos of [
      { x: 0, z: 0 },
      { x: 3000, z: 3000 },
    ]) {
      const body = new THREE.Group();
      body.position.set(pos.x, FLAT, pos.z);
      group.add(body);
    }
    const routes = [
      [
        { x: 0, z: 0 },
        { x: 0, z: 400 },
      ],
      [
        { x: 3000, z: 3000 },
        { x: 3000, z: 2600 },
      ],
    ];
    const movement = new UnitMovement(group, routes, { groundY });
    movement.setHqProvider(() => [{ x: 900, z: 0, team: 1 }]);
    return movement;
  }

  it("assaults a visible fort", () => {
    const movement = makeScout(flatGround);
    movement.update(1 / 60);
    const threat = movement.moverState(0)?.threat;
    expect(threat?.attacker).toBe(-1);
    expect(threat?.structure).toBe(true);
    movement.dispose();
  });

  it("ignores a fort hidden behind a ridge", () => {
    const ridge = (x: number, _z: number): number => (x > 300 && x < 600 ? 400 : FLAT);
    const movement = makeScout(ridge);
    movement.update(1 / 60);
    expect(movement.hasThreat(0)).toBe(false);
    movement.dispose();
  });
});
