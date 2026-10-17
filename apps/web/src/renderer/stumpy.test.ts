import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildUnitIconBody, getBarrel, getMuzzleTip, getTurret, getWheels, muzzleWorld, setBarrelElevation, setUnitAim } from "./units";
import { applyUnitDamageTint, applyWreckChar } from "./unitDamageFx";
import { getCamoTexture } from "./camo";

describe("Stumpy asset contract", () => {
  it("retains the footprint, trunnion, muzzle length and direct spinning wheels", () => {
    const body = buildUnitIconBody("stump");
    const hullBounds = new THREE.Box3();
    body.children.forEach(o => { if (o instanceof THREE.Mesh) hullBounds.union(new THREE.Box3().setFromObject(o)); });
    const size = hullBounds.getSize(new THREE.Vector3());
    expect(size.x).toBeLessThan(21.2); expect(size.z).toBeLessThan(28);
    expect(hullBounds.min.y).toBeGreaterThanOrEqual(0);
    expect(getWheels(body)).toHaveLength(6);
    expect(getBarrel(body)!.position.toArray()).toEqual([0, 12.5, 4]);
    expect(getMuzzleTip(body)!.position.toArray()).toEqual([0, 0, 22]);
    setUnitAim(body, 0.8, 0.2); setBarrelElevation(body, 0.3);
    expect(muzzleWorld(body)!.direction.y).toBeCloseTo(Math.sin(0.3));
    expect(getTurret(body)!.rotation.y).toBeCloseTo(0.2);
  });
  it("keeps per-instance damage and disposable resources independent", () => {
    const a = buildUnitIconBody("stump"), b = buildUnitIconBody("stump");
    const am = a.getObjectByName("stumpy-hull") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
    const bm = b.getObjectByName("stumpy-hull") as typeof am;
    const pristine = bm.material.color.getHex();
    expect(am.geometry).not.toBe(bm.geometry); expect(am.material).not.toBe(bm.material);
    applyUnitDamageTint(a, 0.8); applyWreckChar(a);
    expect(am.material.color.getHex()).not.toBe(pristine);
    expect(bm.material.color.getHex()).toBe(pristine);
    expect(bm.material.map).toBe(getCamoTexture("stump"));
    let triangles = 0, draws = 0;
    b.traverse(o => { if (o instanceof THREE.Mesh) { draws++; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) / 3;
      expect(o.geometry.getAttribute("normal")).toBeDefined();
      const material = o.material as THREE.MeshLambertMaterial;
      if (o.userData.noCamo) expect(material.map).toBeNull();
    }});
    expect(triangles).toBeLessThan(5000); expect(draws).toBeLessThanOrEqual(24);
  });
});
