import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HULL_FOOTPRINT, type TreeStand } from "@scorched-3d/core";
import { SELECTION_CORE } from "./selectionFx";
import { HEALTH_BAR_RENDER_ORDER } from "./healthBars";
import {
  disposeOcclusionAssets,
  ghostBoxFor,
  OCCLUSION_BLUE,
  OCCLUSION_FILL_OPACITY,
  OCCLUSION_OUTLINE_OPACITY,
  OCCLUSION_OUTLINE_ORDER,
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

  it("reuses its tap scratch safely across consecutive calls", () => {
    // The per-tap probe target is a shared scratch (hot-loop sweep): results
    // must never leak from one call into the next.
    const env = { groundY: flat, stands: [] as TreeStand[] };
    expect(unitOcclusion(cam, { x: 0, y: 10, z: 0 }, env).occluded).toBe(false);
    expect(unitOcclusion(cam, { x: 50, y: 10, z: 40 }, env).occluded).toBe(false);
    expect(unitOcclusion(cam, { x: 0, y: 10, z: 0 }, { groundY: ridge, stands: [] }).occluded).toBe(
      true,
    );
    expect(unitOcclusion(cam, { x: 0, y: 10, z: 0 }, env).occluded).toBe(false);
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

  /** A real hull: box hull mesh + yawed turret subgroup with its own mesh. */
  function meshedBody(): THREE.Group {
    const body = new THREE.Group();
    body.position.set(0, 10, 0);
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(13, 6, 18),
      new THREE.MeshLambertMaterial({ color: 0x888866 }),
    );
    hull.position.set(0, 4, 0);
    body.add(hull);
    const turret = new THREE.Group();
    turret.name = "turret";
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(8, 5, 9),
      new THREE.MeshLambertMaterial({ color: 0x666677 }),
    );
    plate.position.set(0, 9.5, -1);
    turret.add(plate);
    body.add(turret);
    return body;
  }

  function disposeBody(body: THREE.Group): void {
    body.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      mat?.dispose();
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

  it("mirrors the true hull silhouette, not a bounding rectangle", () => {
    expect(OCCLUSION_BLUE).toBe(SELECTION_CORE);
    expect(OCCLUSION_RENDER_ORDER).toBeGreaterThan(HEALTH_BAR_RENDER_ORDER);
    expect(OCCLUSION_OUTLINE_ORDER).toBeGreaterThan(OCCLUSION_RENDER_ORDER);
    const scene = new THREE.Scene();
    const fx = new OcclusionFx(scene, ["stump"] as const);
    const body = meshedBody();
    try {
      fx.update(cam, [body], { groundY: ridge, stands: [] }, { isDestroyedAt: () => false });
      expect(fx.isShown(0)).toBe(true);
      const ghost = fx.group.children[0] as THREE.Group;
      // Ghost rides the body origin exactly (silhouette overlays the hull).
      expect(ghost.position.x).toBe(body.position.x);
      expect(ghost.position.y).toBe(body.position.y);
      expect(ghost.position.z).toBe(body.position.z);
      // Every hull mesh gets a fill sharing the source geometry (true shape)
      // plus an edge outline — no footprint-sized box anywhere.
      const fills: THREE.Mesh[] = [];
      const outlines: THREE.LineSegments[] = [];
      ghost.traverse((child) => {
        if (child.name === "occlusion-fill") fills.push(child as THREE.Mesh);
        if (child.name === "occlusion-outline") outlines.push(child as THREE.LineSegments);
      });
      expect(fills.length).toBe(2);
      expect(outlines.length).toBe(2);
      const hullGeo = (body.children[0] as THREE.Mesh).geometry;
      expect(fills.some((f) => f.geometry === hullGeo)).toBe(true);
      for (const fill of fills) {
        const mat = fill.material as THREE.MeshBasicMaterial;
        expect(mat.color.getHex()).toBe(SELECTION_CORE);
        expect(mat.transparent).toBe(true);
        expect(mat.opacity).toBeCloseTo(OCCLUSION_FILL_OPACITY, 5);
        expect(mat.depthTest).toBe(false);
        expect(mat.depthWrite).toBe(false);
        expect(fill.renderOrder).toBe(OCCLUSION_RENDER_ORDER);
        expect(fill.userData.noHighlight).toBe(true);
      }
      for (const outline of outlines) {
        const mat = outline.material as THREE.LineBasicMaterial;
        expect(mat.color.getHex()).toBe(SELECTION_CORE);
        expect(mat.opacity).toBeCloseTo(OCCLUSION_OUTLINE_OPACITY, 5);
        expect(mat.depthTest).toBe(false);
        expect(outline.renderOrder).toBe(OCCLUSION_OUTLINE_ORDER);
        expect(outline.userData.noHighlight).toBe(true);
      }
      // Ghosts live in their own scene group — never body children — so
      // hull damage charring and picking can never touch them.
      expect(body.getObjectByName("occlusion-ghost")).toBeUndefined();
      expect(body.getObjectByName("occlusion-fill")).toBeUndefined();
    } finally {
      fx.dispose();
      disposeOcclusionAssets();
      disposeBody(body);
    }
  });

  it("tracks the live turret yaw in the silhouette", () => {
    const scene = new THREE.Scene();
    const fx = new OcclusionFx(scene, ["stump"] as const);
    const body = meshedBody();
    const turret = body.getObjectByName("turret")!;
    try {
      turret.rotation.y = 0.6;
      fx.update(cam, [body], { groundY: ridge, stands: [] }, { isDestroyedAt: () => false });
      const ghost = fx.group.children[0] as THREE.Group;
      const ghostTurret = ghost.getObjectByName("turret")!;
      expect(ghostTurret.rotation.y).toBeCloseTo(0.6, 9);
      // Second tick with a new yaw: transform sync only, no rebuild.
      turret.rotation.y = -0.4;
      fx.update(cam, [body], { groundY: ridge, stands: [] }, { isDestroyedAt: () => false });
      expect(ghost.getObjectByName("turret")!.rotation.y).toBeCloseTo(-0.4, 9);
    } finally {
      fx.dispose();
      disposeOcclusionAssets();
      disposeBody(body);
    }
  });

  it("tracks the live turret recoil slide in the silhouette", () => {
    // Turret recoil (combatFx) slides the turret subgroup rearward along the
    // barrel on position — the ghost syncs transforms only, so the offset
    // follows with no recoil-aware code on this side.
    const scene = new THREE.Scene();
    const fx = new OcclusionFx(scene, ["stump"] as const);
    const body = meshedBody();
    const turret = body.getObjectByName("turret")!;
    try {
      turret.rotation.y = 0.6;
      turret.position.set(-Math.sin(0.6) * 1.4, 0, -Math.cos(0.6) * 1.4);
      fx.update(cam, [body], { groundY: ridge, stands: [] }, { isDestroyedAt: () => false });
      const ghostTurret = fx.group.children[0]!.getObjectByName("turret")!;
      expect(ghostTurret.position.x).toBeCloseTo(turret.position.x, 9);
      expect(ghostTurret.position.z).toBeCloseTo(turret.position.z, 9);
      // The slide restores: the ghost follows back to the seat exactly.
      turret.position.set(0, 0, 0);
      fx.update(cam, [body], { groundY: ridge, stands: [] }, { isDestroyedAt: () => false });
      expect(fx.group.children[0]!.getObjectByName("turret")!.position.x).toBe(0);
      expect(fx.group.children[0]!.getObjectByName("turret")!.position.z).toBe(0);
    } finally {
      fx.dispose();
      disposeOcclusionAssets();
      disposeBody(body);
    }
  });

  it("falls back to a footprint fill+outline box for mesh-less bodies", () => {
    const scene = new THREE.Scene();
    const fx = new OcclusionFx(scene, kinds);
    try {
      const list = bodies();
      fx.update(cam, list, { groundY: ridge, stands: [] }, { isDestroyedAt: () => false });
      const ghost = fx.group.children[0] as THREE.Group;
      const size = ghostBoxFor(kinds[0]);
      const fill = ghost.getObjectByName("occlusion-fill") as THREE.Mesh;
      const outline = ghost.getObjectByName("occlusion-outline") as THREE.LineSegments;
      expect(fill).toBeDefined();
      expect(outline).toBeDefined();
      expect(fill.scale.x).toBeCloseTo(size.w, 9);
      expect(fill.scale.y).toBeCloseTo(size.h, 9);
      expect(fill.scale.z).toBeCloseTo(size.d, 9);
      // Fallback yaws with the hull via the ghost origin.
      expect(ghost.quaternion.y).toBeCloseTo(
        new THREE.Quaternion().setFromEuler(list[0]!.rotation).y,
        9,
      );
    } finally {
      fx.dispose();
      disposeOcclusionAssets();
    }
  });
});
