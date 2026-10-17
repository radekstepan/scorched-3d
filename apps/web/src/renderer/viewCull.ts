import * as THREE from "three";

/**
 * Radius of the per-unit view sphere, world units: covers the hull plus
 * every overhead view readout — the occlusion x-ray taps (up to +30), the
 * health bar (lift 60) — with margin. A unit counts as visible while any
 * of that could intersect the frustum, so gating view-only work on this
 * sphere never drops a visible readout.
 */
export const UNIT_VIEW_RADIUS = 70;

/** Module scratch (the `_tap` precedent): the per-tick gate allocates nothing. */
const _viewMatrix = new THREE.Matrix4();
const _viewFrustum = new THREE.Frustum();
const _viewSphere = new THREE.Sphere(new THREE.Vector3(), UNIT_VIEW_RADIUS);

/**
 * Per-unit camera visibility for one tick: true when the unit's view
 * sphere intersects the camera frustum. Pure over the camera + body
 * origins (module scratch is reused synchronously; only the returned
 * array allocates). The camera matrices are refreshed inside, so callers
 * pass the live camera right after the controls tick with no manual
 * `updateMatrixWorld`.
 *
 * Callers gate VIEW-ONLY work on this (occlusion sampling, ghost pose
 * syncs, health-bar re-seats) — never simulation: gated units keep
 * driving, fighting, and dying off-screen, and every gated readout
 * re-syncs the same tick its unit re-enters view, so the camera never
 * returns to stale poses.
 */
export function computeUnitVisibility(
  camera: THREE.Camera,
  bodies: readonly THREE.Object3D[],
): boolean[] {
  camera.updateMatrixWorld();
  _viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _viewFrustum.setFromProjectionMatrix(_viewMatrix);
  return bodies.map((body) => {
    _viewSphere.center.copy(body.position);
    return _viewFrustum.intersectsSphere(_viewSphere);
  });
}
