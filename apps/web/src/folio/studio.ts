import * as THREE from "three";
import type { UnitKind } from "@scorched-3d/core";
import { buildUnitIconBody } from "../renderer/units";

export type StudyView = "perspective" | "front" | "rear" | "top" | "rts";
export const STUDY_VIEWS: StudyView[] = ["perspective", "front", "rear", "top", "rts"];

/** Own copies of textures: the battlefield's cached camouflage must survive studio teardown. */
export function buildStudioBody(kind: UnitKind): THREE.Group {
  const body = buildUnitIconBody(kind);
  const copies = new Map<THREE.Texture, THREE.Texture>();
  const materials = new Set<THREE.Material>();
  body.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (materials.has(material)) continue;
      materials.add(material);
      for (const [key, value] of Object.entries(material)) {
        if (!(value instanceof THREE.Texture)) continue;
        if (!copies.has(value)) copies.set(value, value.clone());
        (material as unknown as Record<string, unknown>)[key] = copies.get(value);
      }
    }
  });
  return body;
}

/** Deduplicate resources shared by multiple mesh parts, disposing every owned GPU allocation once. */
export function disposeStudioObject(root: THREE.Object3D): void {
  const resources = new Set<{ dispose(): void }>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      resources.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.add(value);
    }
  });
  resources.forEach((resource) => resource.dispose());
  root.clear();
}

/** Frame actual geometry, including long barrels, at any studio aspect ratio. */
export function frameStudioBody(body: THREE.Group, camera: THREE.PerspectiveCamera, view: StudyView): THREE.Vector3 {
  const box = new THREE.Box3().setFromObject(body);
  const target = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const angle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
  const distance = radius / Math.sin(angle) * (view === "rts" ? 2.7 : 1.12);
  const direction = view === "front" ? [0, 0.12, 1] : view === "rear" ? [-0.5, 0.25, -1] : view === "top" ? [0, 1, 0.001] : view === "rts" ? [116, 165, 146] : [1, 0.65, 1.3];
  camera.position.copy(new THREE.Vector3(...direction).normalize().multiplyScalar(distance).add(target));
  camera.near = 0.1;
  camera.far = Math.max(distance * 20, 2000);
  camera.updateProjectionMatrix();
  camera.lookAt(target);
  return target;
}
