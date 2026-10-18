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

  it("keeps the study light rig identical with terrain on or off and only swaps the backdrop", () => {
    const rig = (terrain: boolean, night: boolean) => {
      const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(), hemi = new THREE.HemisphereLight(), rim = new THREE.DirectionalLight();
      const exposure = applyStudyLighting(scene, sun, hemi, rim, terrain, night);
      return {
        exposure,
        sun: sun.intensity, hemi: hemi.intensity, rim: rim.intensity,
        position: sun.position.toArray(),
        sunColor: sun.color.getHex(), rimColor: rim.color.getHex(),
        background: (scene.background as THREE.Color).getHex(),
        fog: scene.fog ? { near: (scene.fog as THREE.Fog).near, color: (scene.fog as THREE.Fog).color.getHex() } : null,
      };
    };
    for (const night of [false, true]) {
      const on = rig(true, night), off = rig(false, night);
      // Everything that lights the unit is terrain-independent ...
      expect({ ...on, background: 0, fog: null }).toEqual({ ...off, background: 0, fog: null });
      // ... only the backdrop follows the toggle.
      expect(on.background).not.toBe(off.background);
      expect(on.fog).not.toBeNull();
      expect(off.fog).toBeNull();
    }
    // Pinned rig values (daylight): the studio setup, never the dimmed outdoor one.
    expect(rig(true, false)).toMatchObject({ exposure: 1.15, sun: 1.8, hemi: 0.85, rim: 0.8, position: [-35, 65, 40] });
    const night = rig(false, true);
    expect(night.sun).toBeCloseTo(0.9);
    expect(night.hemi).toBeCloseTo(0.51);
    expect(night.rim).toBe(0.8);
  });

  it("restores daylight without accumulating dimming", () => {
    const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(), hemi = new THREE.HemisphereLight(), rim = new THREE.DirectionalLight();
    applyStudyLighting(scene, sun, hemi, rim, true, true);
    const dimmed = sun.intensity;
    applyStudyLighting(scene, sun, hemi, rim, true, true);
    expect(sun.intensity).toBe(dimmed);
    applyStudyLighting(scene, sun, hemi, rim, false, false);
    expect(sun.intensity).toBe(1.8);
    expect(sun.color.getHex()).toBe(0xfff0d0);
    expect(applyStudyLighting(scene, sun, hemi, rim, true, false)).toBe(1.15);
  });

  it("starts studio fog past the farthest camera stop so it never hazes the subject", () => {
    const scene = new THREE.Scene();
    applyStudyLighting(scene, new THREE.DirectionalLight(), new THREE.HemisphereLight(), new THREE.DirectionalLight(), true, false);
    const near = (scene.fog as THREE.Fog).near;
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    for (const kind of UNIT_KINDS) {
      const body = buildStudioBody(kind);
      const size = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).length();
      // UnitFolio clamps zoom-out to size * 8; the farthest hull pixel sits ~size/2 past the target.
      expect(near).toBeGreaterThan(size * 8 + size / 2);
      disposeStudioObject(body);
    }
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
