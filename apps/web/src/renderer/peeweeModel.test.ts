import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { advanceLocomotion, barrelElevation, buildSpawnedUnit, buildUnitIconBody, getBarrel, getLegs, getMuzzleTip, getTurret, getWheels, muzzleWorld, setBarrelElevation, setUnitAim } from "./units";
import { applyUnitDamageTint, applyWreckChar } from "./unitDamageFx";
import { getCamoTexture } from "./camo";

function paintLeg(body: THREE.Group) {
  return getLegs(body)[0]! as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
}

describe("Peewee asset contract", () => {
  it("retains its infantry footprint, hip seats and original muzzle frame", () => {
    const body = buildUnitIconBody("peewee"), bounds = new THREE.Box3();
    body.children.forEach(o => { if (o instanceof THREE.Mesh) bounds.union(new THREE.Box3().setFromObject(o)); });
    getTurret(body)!.children.forEach(o => { if (o instanceof THREE.Mesh) bounds.union(new THREE.Box3().setFromObject(o)); });
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeLessThanOrEqual(9); expect(size.z).toBeLessThanOrEqual(8.6);
    expect(size.y).toBeLessThanOrEqual(12.7);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(getLegs(body).map(leg => leg.position.toArray())).toEqual([[-2.5, 5, 0], [2.5, 5, 0]]);
    expect(getWheels(body)).toHaveLength(0);
    expect(getBarrel(body)!.position.toArray()).toEqual([0, 8, 2]);
    expect(getMuzzleTip(body)!.position.toArray()).toEqual([0, 0, 10]);
    expect(barrelElevation(body)).toBeCloseTo(0.04);
    setUnitAim(body, 0.7, -0.2); setBarrelElevation(body, 0.3);
    expect(getTurret(body)!.rotation.y).toBeCloseTo(-0.2);
    const muzzle = muzzleWorld(body)!;
    expect(muzzle.direction.y).toBeCloseTo(Math.sin(0.3));
    expect(muzzle.direction.x).toBeCloseTo(Math.sin(0.5) * Math.cos(0.3));
  });
  it("strides both complete leg assemblies in antiphase and settles exactly", () => {
    const body = buildSpawnedUnit("peewee", 0, 0, 0, 0, () => 0), legs = getLegs(body);
    expect(legs).toHaveLength(2);
    advanceLocomotion(body, "peewee", 1.25, 0.3);
    expect(legs[0]!.rotation.x).toBeGreaterThan(0.2);
    expect(legs[0]!.rotation.x).toBeCloseTo(-legs[1]!.rotation.x);
    expect(legs[0]!.position.y).toBeGreaterThan(5);
    expect(legs[1]!.position.y).toBeCloseTo(5);
    legs.forEach(leg => { expect(leg.parent).toBe(body); expect(leg.children.length).toBeGreaterThan(0); });
    for (let i = 0; i < 60; i++) advanceLocomotion(body, "peewee", 0, 1 / 60);
    legs.forEach(leg => { expect(leg.rotation.x).toBeCloseTo(0); expect(leg.position.y).toBeCloseTo(5); });
  });
  it("allows the firing pump to move the weapon without shifting the hand supports", () => {
    const body = buildUnitIconBody("peewee"), barrel = getBarrel(body)!;
    setUnitAim(body, 0.7, 0.2);
    const torso = body.getObjectByName("peewee-torso")!;
    const support = torso.getWorldPosition(new THREE.Vector3());
    const before = muzzleWorld(body)!;
    barrel.position.z -= 1.2;
    const after = muzzleWorld(body)!;
    expect(new THREE.Vector3(after.position.x, after.position.y, after.position.z)
      .distanceTo(new THREE.Vector3(before.position.x, before.position.y, before.position.z))).toBeCloseTo(1.2);
    expect(after.direction).toEqual(before.direction);
    expect(torso.getWorldPosition(new THREE.Vector3()).distanceTo(support)).toBeCloseTo(0);
    barrel.position.z += 1.2;
    expect(muzzleWorld(body)!.position).toEqual(before.position);
  });
  it("keeps damage, camo and disposable resources independent within the budget", () => {
    const a = buildUnitIconBody("peewee"), b = buildUnitIconBody("peewee");
    const am = paintLeg(a), bm = paintLeg(b), pristine = bm.material.color.getHex();
    expect(am.geometry).not.toBe(bm.geometry); expect(am.material).not.toBe(bm.material);
    applyUnitDamageTint(a, 0.8); applyWreckChar(a);
    expect(am.material.color.getHex()).not.toBe(pristine); expect(bm.material.color.getHex()).toBe(pristine);
    expect(bm.material.map).toBe(getCamoTexture("peewee"));
    let triangles = 0, draws = 0;
    b.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      draws++; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) / 3;
      expect(o.geometry.getAttribute("normal")).toBeDefined();
      if (o.userData.noCamo) expect((o.material as THREE.MeshLambertMaterial).map).toBeNull();
    });
    expect(triangles).toBeLessThan(2600); expect(draws).toBeLessThanOrEqual(16);
  });
});
