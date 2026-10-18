import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { computeOnScreen, computeUnitVisibility, UNIT_VIEW_RADIUS } from "./viewCull";

/** Commander-style camera south of the map, looking north at the origin. */
function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(48, 1, 2, 14000);
  camera.position.set(0, 2000, 4000);
  camera.lookAt(0, 0, 0);
  return camera;
}

function bodyAt(x: number, y: number, z: number): THREE.Group {
  const body = new THREE.Group();
  body.position.set(x, y, z);
  return body;
}

describe("computeUnitVisibility", () => {
  it("sees units in view and skips units behind or beside the camera", () => {
    const camera = makeCamera();
    expect(computeUnitVisibility(camera, [bodyAt(0, 0, 0)])).toEqual([true]);
    // Behind the camera.
    expect(computeUnitVisibility(camera, [bodyAt(0, 2000, 8000)])).toEqual([false]);
    // Far east of the frustum (half-width at the origin row is ~1800).
    expect(computeUnitVisibility(camera, [bodyAt(4000, 0, 0)])).toEqual([false]);
    // Mixed roster preserves order.
    expect(
      computeUnitVisibility(camera, [bodyAt(0, 0, 0), bodyAt(4000, 0, 0), bodyAt(100, 0, -500)]),
    ).toEqual([true, false, true]);
  });

  it("covers the overhead bar inside the view radius", () => {
    // The radius must clear the health-bar lift (60) plus the bar itself —
    // a unit whose hull sits just past the frustum plane still counts while
    // any of its view readouts (bar, x-ray taps) could show.
    expect(UNIT_VIEW_RADIUS).toBeGreaterThanOrEqual(60);
    const camera = makeCamera();
    // Frustum half-width at the origin row, then a center just past the
    // plane but inside the view sphere.
    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const halfW =
      dist * Math.tan(THREE.MathUtils.degToRad(48 / 2)) * camera.aspect;
    expect(computeUnitVisibility(camera, [bodyAt(halfW + UNIT_VIEW_RADIUS - 10, 0, 0)])).toEqual([
      true,
    ]);
    expect(computeUnitVisibility(camera, [bodyAt(halfW + UNIT_VIEW_RADIUS + 100, 0, 0)])).toEqual([
      false,
    ]);
  });

  it("reads the live camera pose (no stale matrices)", () => {
    const camera = makeCamera();
    const bodies = [bodyAt(0, 0, 0)];
    expect(computeUnitVisibility(camera, bodies)).toEqual([true]);
    // Spin the camera to face away without touching matrices by hand — the
    // gate must refresh them itself or it would keep reporting visible.
    camera.position.set(0, 2000, -4000);
    camera.lookAt(0, 0, -8000);
    expect(computeUnitVisibility(camera, bodies)).toEqual([false]);
  });

  it("handles an empty roster", () => {
    expect(computeUnitVisibility(makeCamera(), [])).toEqual([]);
  });
});

describe("computeOnScreen", () => {
  it("sees bodies in view and skips bodies behind or beside the camera", () => {
    const camera = makeCamera();
    expect(computeOnScreen(camera, [bodyAt(0, 0, 0)])).toEqual([true]);
    // Behind the camera (projects with z > 1).
    expect(computeOnScreen(camera, [bodyAt(0, 2000, 8000)])).toEqual([false]);
    // Far east of the frustum (half-width at the origin row is ~1800).
    expect(computeOnScreen(camera, [bodyAt(4000, 0, 0)])).toEqual([false]);
    // Mixed roster preserves order.
    expect(
      computeOnScreen(camera, [bodyAt(0, 0, 0), bodyAt(4000, 0, 0), bodyAt(100, 0, -500)]),
    ).toEqual([true, false, true]);
  });

  it("is stricter than the view-sphere gate past the frustum edge", () => {
    // A hull just past the frustum plane still counts for view-only
    // readouts (health bar, x-ray taps) but is NOT on the screen, so
    // double-click same-type selection must leave it out.
    const camera = makeCamera();
    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const halfW = dist * Math.tan(THREE.MathUtils.degToRad(48 / 2)) * camera.aspect;
    const bodies = [bodyAt(halfW + 10, 0, 0)];
    expect(computeUnitVisibility(camera, bodies)).toEqual([true]);
    expect(computeOnScreen(camera, bodies)).toEqual([false]);
  });

  it("reads the live camera pose (no stale matrices)", () => {
    const camera = makeCamera();
    const bodies = [bodyAt(0, 0, 0)];
    expect(computeOnScreen(camera, bodies)).toEqual([true]);
    camera.position.set(0, 2000, -4000);
    camera.lookAt(0, 0, -8000);
    expect(computeOnScreen(camera, bodies)).toEqual([false]);
  });

  it("handles an empty roster", () => {
    expect(computeOnScreen(makeCamera(), [])).toEqual([]);
  });
});
