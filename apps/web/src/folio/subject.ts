import * as THREE from "three";
import type { UnitKind } from "@scorched-3d/core";
import { buildLegacyStumpy } from "./legacy";
import { PreviewAnimation } from "./preview";
import { InspectionModel } from "./settings";
import { buildStudioBody, disposeStudioObject } from "./studio";

/**
 * Everything a roster switch replaces: the 1:1 battlefield model, the
 * original-Stumpy comparison, the visual-only animation rig, and the
 * measure grid (sized from the model's bounding diagonal). Renderer, scene,
 * lights, and study terrain persist across switches — rebuilding those per
 * kind locked the UI for seconds.
 */
export interface StudySubject {
  kind: UnitKind;
  root: THREE.Group;
  body: THREE.Group;
  legacy: THREE.Group;
  animation: PreviewAnimation;
  model: InspectionModel;
  legacyModel: InspectionModel;
  grid: THREE.GridHelper;
  size: number;
}

export function buildStudySubject(kind: UnitKind): StudySubject {
  const root = new THREE.Group();
  root.name = `study-${kind}`;
  const body = buildStudioBody(kind);
  body.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = true; });
  const animation = new PreviewAnimation(body, kind);
  const model = new InspectionModel(body);
  const legacy = buildLegacyStumpy();
  const legacyModel = new InspectionModel(legacy);
  const size = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).length();
  const grid = new THREE.GridHelper(size * 2.8, 24, 0x7d8c5e, 0x39432f);
  grid.position.y = -0.1;
  root.add(body, legacy, animation.effects, grid);
  return { kind, root, body, legacy, animation, model, legacyModel, grid, size };
}

/** Release every GPU allocation owned by a retired subject. */
export function disposeStudySubject(subject: StudySubject): void {
  disposeStudioObject(subject.root);
}
