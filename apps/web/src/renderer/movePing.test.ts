import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  MOVE_PING_DURATION,
  MOVE_PING_LIFT,
  MOVE_PING_RENDER_ORDER,
  buildMovePing,
  buildMovePingGeometry,
  buildMovePingMaterial,
  movePingOpacity,
  movePingScale,
} from "./movePing";
import {
  SCORCH_RENDER_ORDER,
  SELECTION_CORE,
  SELECTION_RENDER_ORDER,
  buildSelectionMarker,
  disposeSelectionAssets,
} from "./selectionFx";

describe("move-order ping shares the unit circle logic", () => {
  it("uses the selection core color and render-order band", () => {
    expect(MOVE_PING_RENDER_ORDER).toBe(SELECTION_RENDER_ORDER);
    expect(MOVE_PING_RENDER_ORDER).toBeGreaterThan(SCORCH_RENDER_ORDER);
    const mat = buildMovePingMaterial();
    expect(mat.color.getHex()).toBe(SELECTION_CORE);
    mat.dispose();
  });

  it("ignores depth like selection rings so hills never cut it off", () => {
    const marker = buildSelectionMarker();
    try {
      const selectMat = (marker.getObjectByName("select-core") as THREE.Mesh)
        .material as THREE.MeshBasicMaterial;
      const pingMat = buildMovePingMaterial();
      try {
        // Same robust compositing path: depth-test off, depth-write off.
        expect(pingMat.depthTest).toBe(false);
        expect(pingMat.depthWrite).toBe(false);
        expect(pingMat.depthTest).toBe(selectMat.depthTest);
        expect(pingMat.depthWrite).toBe(selectMat.depthWrite);
        expect(pingMat.transparent).toBe(true);
      } finally {
        pingMat.dispose();
      }
    } finally {
      disposeSelectionAssets();
    }
  });

  it("builds a flat ground-hugging ring mesh in the selection band", () => {
    const geo = buildMovePingGeometry();
    try {
      const mesh = buildMovePing(geo, 100, -50, () => 42);
      try {
        expect(mesh.name).toBe("move-ping");
        expect(mesh.position.x).toBe(100);
        expect(mesh.position.z).toBe(-50);
        expect(mesh.position.y).toBe(42 + MOVE_PING_LIFT);
        expect(mesh.renderOrder).toBeGreaterThanOrEqual(SELECTION_RENDER_ORDER);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        expect(mat.depthTest).toBe(false);
        expect(mat.depthWrite).toBe(false);
        expect(mesh.userData.noHighlight).toBe(true);
        // Flat on the XZ plane: ring normal points +Y.
        geo.computeBoundingBox();
        const box = geo.boundingBox!;
        expect(box.max.y - box.min.y).toBeLessThan(1e-6);
        expect(box.max.x).toBeGreaterThan(0);
        expect(box.max.z).toBeGreaterThan(0);
      } finally {
        (mesh.material as THREE.Material).dispose();
      }
    } finally {
      geo.dispose();
    }
  });

  it("expands and fades over its lifetime", () => {
    expect(MOVE_PING_DURATION).toBeCloseTo(0.8, 10);
    expect(movePingScale(0)).toBe(1);
    expect(movePingScale(1)).toBeCloseTo(3.5, 10);
    expect(movePingOpacity(0)).toBeCloseTo(0.9, 10);
    expect(movePingOpacity(1)).toBeCloseTo(0, 10);
    // Monotonic: grows while fading.
    expect(movePingScale(0.5)).toBeGreaterThan(movePingScale(0.25));
    expect(movePingOpacity(0.5)).toBeLessThan(movePingOpacity(0.25));
  });
});
