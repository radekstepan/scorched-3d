import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  HULL_FOOTPRINT,
  UNIT_DEFS,
  type TNTMap,
} from "@scorched-3d/core";
import {
  advanceLocomotion,
  barrelElevation,
  buildSpawnedUnit,
  buildUnitIconBody,
  buildUnits,
  getBarrel,
  getLegs,
  getMuzzleTip,
  getTeamRing,
  getTurret,
  getWheels,
  muzzleWorld,
  restBarrelElevation,
  setBarrelElevation,
  setUnitAim,
} from "./units";
import { ghostBoxFor } from "./occlusionFx";
import { getUnitIconDataUrl, unitIconFraming } from "./selectionIcons";
import {
  FOOTSTEP_OFFSET,
  trackLengthFor,
  trackOffsetFor,
  trackOffsetsFor,
  trackWidthFor,
} from "./tracks";

function scoutMap(): TNTMap {
  const width = 32;
  const height = 32;
  return {
    width,
    height,
    heights: new Uint8Array(width * height).fill(100),
    units: [
      { kind: "peewee", cellX: 8, cellZ: 8, rotation: 0, team: 0 },
      { kind: "flash", cellX: 20, cellZ: 20, rotation: 0, team: 1 },
    ],
  } as unknown as TNTMap;
}

describe("peewee infantry body", () => {
  it("builds a small legged scout with a gun, not a tank", () => {
    const group = buildUnits(scoutMap(), 1);
    const body = group.children[0] as THREE.Group;
    // Turret subgroup with an elevating hand-cannon + live muzzle tip.
    expect(getTurret(body)).not.toBeNull();
    expect(getBarrel(body)).not.toBeNull();
    expect(getMuzzleTip(body)).not.toBeNull();
    expect(barrelElevation(body)).toBeCloseTo(restBarrelElevation("peewee"), 12);
    expect(restBarrelElevation("peewee")).toBeCloseTo(0);
    // Two legs stride it, no road wheels roll it.
    expect(getLegs(body).length).toBe(2);
    expect(getWheels(body).length).toBe(0);
    // Team ring rides along like every mustered hull.
    expect(getTeamRing(body)).not.toBeNull();
  });

  it("reads smaller than the light tank beside it", () => {
    const group = buildUnits(scoutMap(), 1);
    for (const child of group.children) (child as THREE.Group).rotation.set(0, 0, 0);
    group.updateMatrixWorld(true);
    const boxOf = (body: THREE.Group): THREE.Vector3 => {
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      for (const child of body.children) {
        if (child.type !== "Mesh" || child.name === "team-ring") continue;
        tmp.setFromObject(child);
        box.union(tmp);
      }
      return box.getSize(new THREE.Vector3());
    };
    const scout = boxOf(group.children[0] as THREE.Group);
    const tank = boxOf(group.children[1] as THREE.Group);
    expect(scout.x).toBeLessThan(tank.x);
    expect(scout.z).toBeLessThan(tank.z);
    // Footprint table agrees: the scout turns inside the tank's pad.
    expect(HULL_FOOTPRINT.peewee.halfLen).toBeLessThan(HULL_FOOTPRINT.flash.halfLen);
    expect(HULL_FOOTPRINT.peewee.halfWid).toBeLessThan(HULL_FOOTPRINT.flash.halfWid);
  });

  it("throws its muzzle ahead of the hull nose and aims with hull + torso", () => {
    const group = buildUnits(scoutMap(), 1);
    const body = group.children[0] as THREE.Group;
    body.rotation.set(0, 0, 0);
    group.updateMatrixWorld(true);
    const live = muzzleWorld(body)!;
    expect(live).not.toBeNull();
    const hull = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const child of body.children) {
      if (child.type !== "Mesh" || child.name === "team-ring") continue;
      tmp.setFromObject(child);
      hull.union(tmp);
    }
    expect(live.position.z).toBeGreaterThan(hull.max.z);
    setUnitAim(body, 1.1, 0.4);
    expect(body.rotation.y).toBeCloseTo(1.1);
    expect(getTurret(body)!.rotation.y).toBeCloseTo(0.4);
    setBarrelElevation(body, 0.3);
    expect(barrelElevation(body)).toBeCloseTo(0.3);
  });

  it("strides antiphase on its legs and settles at rest", () => {
    const group = buildUnits(scoutMap(), 1);
    const body = group.children[0] as THREE.Group;
    const legs = getLegs(body);
    for (let n = 0; n < 60; n++) advanceLocomotion(body, "peewee", 20 / 60, 1 / 60);
    expect(legs[0]!.rotation.x).toBeCloseTo(-legs[1]!.rotation.x, 10);
    for (let n = 0; n < 60; n++) advanceLocomotion(body, "peewee", 0, 1 / 60);
    expect(legs[0]!.rotation.x).toBeCloseTo(0, 10);
    expect(legs[1]!.rotation.x).toBeCloseTo(0, 10);
  });

  it("spawns reinforcements seated with a team ring, and icons without one", () => {
    const body = buildSpawnedUnit("peewee", 1, 100, 200, 0, () => 100);
    expect(getLegs(body).length).toBe(2);
    expect(getTeamRing(body)).not.toBeNull();
    expect(body.position.y).toBe(100.5);
    const icon = buildUnitIconBody("peewee");
    expect(getLegs(icon).length).toBe(2);
    expect(getMuzzleTip(icon)).not.toBeNull();
    expect(getTeamRing(icon)).toBeNull();
  });

  it("paints the tan scout, distinct from every other kind", () => {
    expect(UNIT_DEFS.peewee.name).toBe("Peewee");
    expect(UNIT_DEFS.peewee.unitName).toBe("ARMPW");
  });
});

describe("peewee footprints and framing", () => {
  it("stamps narrow alternating footsteps on the centerline", () => {
    expect(trackWidthFor("peewee")).toBeLessThan(trackWidthFor("commander"));
    expect(trackOffsetFor("peewee")).toBe(0);
    expect(trackOffsetsFor("peewee", 0)).toEqual([-FOOTSTEP_OFFSET]);
    expect(trackOffsetsFor("peewee", 1)).toEqual([FOOTSTEP_OFFSET]);
    expect(trackLengthFor("peewee")).toBeLessThan(16);
  });

  it("frames the smallest thumbnail and ghosts the shortest silhouette", () => {
    const framing = unitIconFraming("peewee");
    expect(framing.distance).toBeGreaterThan(80);
    expect(framing.targetY).toBe(8);
    expect(framing.distance).toBeLessThan(unitIconFraming("flash").distance);
    expect(ghostBoxFor("peewee").h).toBeLessThan(ghostBoxFor("flash").h);
    // Icon fallback draws the scout walker, never tank wheels.
    const raw = decodeURIComponent(getUnitIconDataUrl("peewee"));
    expect(raw).not.toContain("<circle");
  });
});
