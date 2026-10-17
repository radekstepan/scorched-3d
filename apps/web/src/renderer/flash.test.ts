import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { advanceLocomotion, buildSpawnedUnit, buildUnitIconBody, getBarrel, getMuzzleTip, getTurret, getWheels, muzzleWorld, setBarrelElevation, setUnitAim } from "./units";
import { applyUnitDamageTint, applyWreckChar } from "./unitDamageFx";
import { getCamoTexture } from "./camo";

describe("Flash asset contract", () => {
  it("retains its light footprint, trunnion and live muzzle solution", () => {
    const body = buildUnitIconBody("flash"), bounds = new THREE.Box3();
    body.children.forEach(o => { if (o instanceof THREE.Mesh) bounds.union(new THREE.Box3().setFromObject(o)); });
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeLessThanOrEqual(15.6); expect(size.z).toBeLessThanOrEqual(18.5);
    expect(bounds.min.y).toBeGreaterThanOrEqual(0);
    expect(getBarrel(body)!.position.toArray()).toEqual([0, 9.5, 3]);
    expect(getMuzzleTip(body)!.position.toArray()).toEqual([0, 0, 14]);
    setUnitAim(body, 0.7, -0.2); setBarrelElevation(body, 0.3);
    expect(getTurret(body)!.rotation.y).toBeCloseTo(-0.2);
    const muzzle = muzzleWorld(body)!;
    expect(muzzle.direction.y).toBeCloseTo(Math.sin(0.3));
    expect(muzzle.direction.x).toBeCloseTo(Math.sin(0.5) * Math.cos(0.3));
  });
  it("animates all six direct-child wheels through the existing locomotion path", () => {
    const body = buildSpawnedUnit("flash", 0, 0, 0, 0, () => 0);
    expect(getWheels(body)).toHaveLength(6);
    advanceLocomotion(body, "flash", 6, 1 / 60);
    getWheels(body).forEach(w => { expect(w.parent).toBe(body); expect(w.rotation.x).toBeCloseTo(2); });
  });
  it("keeps damage, camouflage and cleanup independent, within the model budget", () => {
    const a = buildUnitIconBody("flash"), b = buildUnitIconBody("flash");
    const am = a.getObjectByName("flash-hull") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
    const bm = b.getObjectByName("flash-hull") as typeof am;
    const pristine = bm.material.color.getHex();
    expect(am.geometry).not.toBe(bm.geometry); expect(am.material).not.toBe(bm.material);
    applyUnitDamageTint(a, 0.8); applyWreckChar(a);
    expect(am.material.color.getHex()).not.toBe(pristine); expect(bm.material.color.getHex()).toBe(pristine);
    expect(bm.material.map).toBe(getCamoTexture("flash"));
    let triangles = 0, draws = 0;
    b.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      draws++; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) / 3;
      expect(o.geometry.getAttribute("normal")).toBeDefined();
      if (o.userData.noCamo) expect((o.material as THREE.MeshLambertMaterial).map).toBeNull();
    });
    expect(triangles).toBeLessThan(3600); expect(draws).toBeLessThanOrEqual(22);
  });
});
