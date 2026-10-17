import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { UNIT_KINDS } from "@scorched-3d/core";
import { getCamoTexture } from "../renderer/camo";
import { buildStudioBody, disposeStudioObject, frameStudioBody, STUDY_VIEWS } from "./studio";

describe("folio owns every preview's GPU resources", () => {
  it.each(UNIT_KINDS)("releases %s meshes/materials/textures without touching battlefield camouflage", (kind) => {
    const shared = getCamoTexture(kind);
    const sharedDispose = vi.spyOn(shared, "dispose");
    const body = buildStudioBody(kind);
    const resources = new Set<{ dispose(): void }>();
    body.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        resources.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            expect(value).not.toBe(shared);
            resources.add(value);
          }
        }
      }
    });
    expect(resources.size).toBeGreaterThan(10);
    const disposers = [...resources].map((resource) => vi.spyOn(resource, "dispose"));
    disposeStudioObject(body);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
    expect(sharedDispose).not.toHaveBeenCalled();
    expect(body.children).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

describe("geometry-based studio framing", () => {
  it.each(UNIT_KINDS)("fits %s including its extremities in portrait and landscape at every study angle", (kind) => {
    const body = buildStudioBody(kind);
    const box = new THREE.Box3().setFromObject(body);
    for (const aspect of [0.4, 1, 2.5]) for (const view of STUDY_VIEWS) {
      const camera = new THREE.PerspectiveCamera(30, aspect, 0.1, 2000);
      frameStudioBody(body, camera, view);
      camera.updateMatrixWorld();
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const point = new THREE.Vector3(x, y, z).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(1);
        expect(Math.abs(point.y)).toBeLessThan(1);
        expect(point.z).toBeGreaterThan(-1);
        expect(point.z).toBeLessThan(1);
      }
    }
    disposeStudioObject(body);
  });
});
