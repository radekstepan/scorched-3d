import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HULL_FOOTPRINT, type TreeStand } from "@scorched-3d/core";
import { SELECTION_CORE } from "./selectionFx";
import { HEALTH_BAR_RENDER_ORDER } from "./healthBars";
import {
  disposeOcclusionAssets,
  ghostBoxFor,
  OCCLUSION_BLUE,
  OCCLUSION_RENDER_ORDER,
  OCCLUSION_TAPS,
  OcclusionFx,
  segmentBlockedByTerrain,
  unitOcclusion,
} from "./occlusionFx";

const flat = () => 0;
/** Ridge at z ≈ -100: 120 tall between z -120..-80, flat elsewhere. */
const ridge = (x: number, z: number): number => {
  void x;
  return z < -80 && z > -120 ? 120 : 0;
};
const cam: { x: number; y: number; z: number } = { x: 0, y: 80, z: -300 };

function stand(x: number, z: number, standing = true, groundY = 0): TreeStand {
  return { x, z, groundY, standing };
}

describe("segmentBlockedByTerrain", () => {
  it("sees over flat ground", () => {
    expect(
      segmentBlockedByTerrain(cam, { x: 0, y: 10, z: 0 }, flat),
    ).toBe(false);
  });

  it("is blocked by a ridge between camera and hull", () => {
    expect(
      segmentBlockedByTerrain(cam, { x: 0, y: 10, z: 0 }, ridge),
    ).toBe(true);
  });

  it("never self-occludes on the hull's own grade", () => {
    // Target seated on the surface it stands on: the ray only touches the
    // ground at its own endpoint, inside the 1-unit grace.
    const g = () => 40;
    expect(segmentBlockedByTerrain(cam, { x: 0, y: 41, z: 0 }, g)).toBe(false);
  });
});

describe("unitOcclusion (terrain + trees)", () => {
  it("is clear in the open", () => {
    const res = unitOcclusion(cam, { x: 0, y: 10, z: 0 }, { groundY: flat, stands: [] });
    expect(res.occluded).toBe(false);
    expect(res.blocked).toBe(0);
    expect(res.total).toBe(OCCLUSION_TAPS.length);
  });

  it("ghosts a hull fully behind a ridge", () => {
    const res = unitOcclusion(cam, { x: 0, y: 10, z: 0 }, { groundY: ridge, stands: [] });
    expect(res.occluded).toBe(true);
    expect(res.blocked).toBeGreaterThan(0);
  });

  it("ghosts partial cover: a low tap clipped while the mast clears", () => {
    // Step ridge covering only the low taps: camera low, ridge just tall
    // enough to clip the bottom tap but not the top one.
    const lowCam = { x: 0, y: 30, z: -300 };
    const step = (x: number, z: number): number => {
      void x;
      return z < -80 && z > -120 ? 28 : 0;
    };
    const res = unitOcclusion(lowCam, { x: 0, y: 10, z: 0 }, { groundY: step, stands: [] });
    expect(res.occluded).toBe(true);
    expect(res.blocked).toBeGreaterThan(0);
    expect(res.blocked).toBeLessThan(res.total);
  });

  it("ghosts a hull under a live crown, but not felled wood", () => {
    // Crown sphere: center groundY+24, radius 16. Camera low at z=-300,
    // hull at origin: the low-tap ray threads the crown mid-flight while
    // higher taps clear it (partial cover still ghosts).
    const trees = [stand(0, -150, true, 0)];
    const lowCam = { x: 0, y: 60, z: -300 };
    const blocked = unitOcclusion(lowCam, { x: 0, y: 10, z: 0 }, { groundY: flat, stands: trees });
    expect(blocked.occluded).toBe(true);
    expect(blocked.blocked).toBeLessThan(blocked.total);
    const felled = unitOcclusion(lowCam, { x: 0, y: 10, z: 0 }, {
      groundY: flat,
      stands: [stand(0, -150, false, 0)],
    });
    expect(felled.occluded).toBe(false);
  });

  it("ignores trees far off the camera→hull line", () => {
    const trees = [stand(400, -150, true, 0)];
    const res = unitOcclusion(cam, { x: 0, y: 10, z: 0 }, { groundY: flat, stands: trees });
    expect(res.occluded).toBe(false);
  });
});

describe("ghostBoxFor", () => {
  it("matches the hull footprint with a per-kind height", () => {
    for (const kind of ["flash", "stump", "hammer", "commander"] as const) {
      const box = ghostBoxFor(kind);
      expect(box.w).toBe(HULL_FOOTPRINT[kind].halfWid * 2);
      expect(box.d).toBe(HULL_FOOTPRINT[kind].halfLen * 2);
      expect(box.h).toBeGreaterThan(0);
    }
    // Tanks read longer than wide (direction of travel), like the hulls.
    expect(ghostBoxFor("stump").d).toBeGreaterThan(ghostBoxFor("stump").w);
    // The walker clears its antenna band.
    expect(ghostBoxFor("commander").h).toBeGreaterThanOrEqual(47);
  });
});

describe("OcclusionFx ghost policy", () => {
  const kinds = ["flash", "stump"] as const;

  function bodies(): THREE.Group[] {
    return kinds.map((kind, i) => {
      const g = new THREE.Group();
      g.position.set(i * 60, 10, 0);
      g.rotation.y = 0.5 * i;
      void kind;
      return g;
    });
  }

  it("shows a ghost exactly while occluded, hiding it in the open", () => {
    const scene = new THREE.Scene();
    const fx = new OcclusionFx(scene, kinds);
    try {
      const list = bodies();
      const health = { isDestroyedAt: () => false };
      // Open: no ghosts.
      fx.update(cam, list, { groundY: flat, stands: [] }, health);
      expect(fx.isShown(0)).toBe(false);
      expect(fx.isShown(1)).toBe(false);
      // Ridge between camera and both hulls: ghosts on.
      fx.update(cam, list, { groundY: ridge, stands: [] }, health);
      expect(fx.isShown(0)).toBe(true);
      expect(fx.isShown(1)).toBe(true);
    } finally {
      fx.dispose();
      disposeOcclusionAssets();
    }
  });

  it("ghosts damaged and wrecked hulls alike, hiding only fully-gone husks", () => {
    const scene = new THREE.Scene();
    const fx = new OcclusionFx(scene, kinds);
    try {
      const list = bodies();
      const env = { groundY: ridge, stands: [] as TreeStand[] };
      // Wreck (destroyed but present): still ghosts — the smouldering husk
      // behind the ridge stays locatable.
      const wreck = { isDestroyedAt: () => true, isHuskGoneAt: () => false };
      fx.update(cam, list, env, wreck);
      expect(fx.isShown(0)).toBe(true);
      // Fully decayed husk: nothing left to outline.
      const gone = { isDestroyedAt: () => true, isHuskGoneAt: () => true };
      fx.update(cam, list, env, gone);
      expect(fx.isShown(0)).toBe(false);
    } finally {
      fx.dispose();
      disposeOcclusionAssets();
    }
  });

  it("ghosts read in the selection blue, above the health bars, off the hull", () => {
    expect(OCCLUSION_BLUE).toBe(SELECTION_CORE);
    expect(OCCLUSION_RENDER_ORDER).toBeGreaterThan(HEALTH_BAR_RENDER_ORDER);
    const scene = new THREE.Scene();
    const fx = new OcclusionFx(scene, kinds);
    try {
      const list = bodies();
      fx.update(cam, list, { groundY: ridge, stands: [] }, { isDestroyedAt: () => false });
      for (const child of fx.group.children) {
        const line = child as THREE.LineSegments;
        const mat = line.material as THREE.LineBasicMaterial;
        expect(mat.color.getHex()).toBe(SELECTION_CORE);
        expect(mat.depthTest).toBe(false);
        expect(mat.depthWrite).toBe(false);
        expect(line.renderOrder).toBe(OCCLUSION_RENDER_ORDER);
        expect(line.userData.noHighlight).toBe(true);
      }
      // Ghosts live in their own scene group — never body children — so
      // hull damage charring and picking can never touch them.
      for (const body of list) {
        expect(body.getObjectByName("occlusion-ghost")).toBeUndefined();
      }
      // Ghost box rides the body origin, yawed with the hull.
      const ghost = fx.group.children[0] as THREE.LineSegments;
      const size = ghostBoxFor(kinds[0]);
      expect(ghost.position.x).toBe(list[0]!.position.x);
      expect(ghost.position.y).toBeCloseTo(list[0]!.position.y + size.h / 2, 9);
      expect(ghost.rotation.y).toBeCloseTo(list[0]!.rotation.y, 9);
      expect(ghost.scale.x).toBeCloseTo(size.w, 9);
    } finally {
      fx.dispose();
      disposeOcclusionAssets();
    }
  });
});
