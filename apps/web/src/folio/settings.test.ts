import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { UNIT_KINDS } from "@scorched-3d/core";
import { getTurret, getBarrel } from "../renderer/units";
import { buildStudioBody, disposeStudioObject, frameStudioBody } from "./studio";
import { buildLegacyStumpy } from "./legacy";
import { DEFAULT_INSPECTION, InspectionModel, applyStudyLighting } from "./settings";

const finishes = (body: THREE.Group) => {
  const colors: number[] = [];
  body.traverse((object) => {
    if (object instanceof THREE.Mesh && !Array.isArray(object.material) && "color" in object.material) colors.push((object.material.color as THREE.Color).getHex());
  });
  return colors;
};

describe("workshop inspection controls", () => {
  it.each(UNIT_KINDS)("restores %s production finishes after paint, damage and wreck adjustments", (kind) => {
    const body = buildStudioBody(kind), untouched = buildStudioBody(kind);
    const original = finishes(body), model = new InspectionModel(body);
    for (const livery of ["sand", "arctic"] as const) {
      model.update({ ...DEFAULT_INSPECTION, livery, turret: 45, elevation: 25, damage: 70, wreck: true }, true);
      expect(finishes(body)).not.toEqual(original);
      expect(finishes(untouched)).toEqual(original);
      expect(getTurret(body)!.rotation.y).toBeCloseTo(Math.PI / 4);
      expect(getTurret(body)!.rotation.z).toBeCloseTo(0.16);
      if (getBarrel(body)) expect(getBarrel(body)!.rotation.x).toBeCloseTo(-25 * Math.PI / 180);
      expect(body.position.y).toBe(-0.4);
      const damaged = finishes(body);
      model.update({ ...DEFAULT_INSPECTION, livery, turret: 45, elevation: 25, damage: 70, wreck: true }, true);
      expect(finishes(body)).toEqual(damaged);
      model.update(DEFAULT_INSPECTION, false);
      expect(finishes(body)).toEqual(original);
      expect(body.position.y).toBe(0);
      expect(getTurret(body)!.rotation.z).toBe(0);
      expect(body.userData.wreckCharred).toBe(false);
    }
    disposeStudioObject(body); disposeStudioObject(untouched);
  });

  it("changes paint without recoloring functional finishes or accumulating tint", () => {
    const body = buildStudioBody("stump"), model = new InspectionModel(body);
    const originals = new Map<THREE.Mesh, number>();
    body.traverse((object) => {
      if (object instanceof THREE.Mesh && !Array.isArray(object.material) && "color" in object.material) originals.set(object, (object.material.color as THREE.Color).getHex());
    });
    for (const livery of ["sand", "arctic"] as const) {
      model.update({ ...DEFAULT_INSPECTION, livery }, false);
      let repainted = 0;
      for (const [mesh, original] of originals) {
        const material = mesh.material as THREE.MeshLambertMaterial;
        if (mesh.userData.noCamo || material.vertexColors) expect(material.color.getHex()).toBe(original);
        else if (material.color.getHex() !== original) repainted++;
      }
      expect(repainted).toBeGreaterThan(0);
      const painted = finishes(body);
      model.update({ ...DEFAULT_INSPECTION, livery }, false);
      expect(finishes(body)).toEqual(painted);
    }
    disposeStudioObject(body);
  });

  it("changes terrain lighting and restores daylight without accumulating dimming", () => {
    const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(), hemi = new THREE.HemisphereLight(), rim = new THREE.DirectionalLight();
    expect(applyStudyLighting(scene, sun, hemi, rim, true, false)).toBe(1.05);
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    expect(rim.intensity).toBe(0);
    applyStudyLighting(scene, sun, hemi, rim, true, true);
    const night = sun.intensity;
    applyStudyLighting(scene, sun, hemi, rim, true, true);
    expect(sun.intensity).toBe(night);
    applyStudyLighting(scene, sun, hemi, rim, true, false);
    expect(sun.intensity).toBe(1.15);
    expect(sun.color.getHex()).toBe(0xfff0d0);
    expect(applyStudyLighting(scene, sun, hemi, rim, false, false)).toBe(1.15);
    expect(scene.fog).toBeNull(); expect(rim.intensity).toBe(0.8);
  });

  it("articulates the original Stumpy comparison and supports reversible damage", () => {
    const body = buildLegacyStumpy(), original = finishes(body), model = new InspectionModel(body);
    model.update({ ...DEFAULT_INSPECTION, turret: -75, wreck: true }, true);
    expect(getTurret(body)!.rotation.y).toBeCloseTo(-75 * Math.PI / 180);
    expect(finishes(body)).not.toEqual(original);
    model.update(DEFAULT_INSPECTION, false);
    expect(finishes(body)).toEqual(original);
    disposeStudioObject(body);
  });

  it("frames Gameplay farther out than the model study", () => {
    const body = buildStudioBody("stump"), camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
    const target = frameStudioBody(body, camera, "perspective"), close = camera.position.distanceTo(target);
    frameStudioBody(body, camera, "rts");
    expect(camera.position.distanceTo(target)).toBeGreaterThan(close * 2);
    disposeStudioObject(body);
  });
});
