import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyBlastToRocks,
  applyBlastToTrees,
  createDamageField,
  type TNTMap,
} from "@scorched-3d/core";
import {
  buildRocks,
  buildTrees,
  placeFeatures,
  writeRockPose,
  writeTreePose,
} from "./features";

function makeMap(): TNTMap {
  const width = 8;
  const height = 8;
  const heights = new Uint8Array(width * height).fill(100);
  // Row 0: round, pine, round; row 1: two rocks. 0xffff = empty.
  const features = new Array<number>(width * height).fill(0xffff);
  features[0] = 0;
  features[1] = 1;
  features[2] = 2;
  features[width] = 3;
  features[width + 1] = 4;
  return { width, height, heights, features } as unknown as TNTMap;
}

function trunkPose(trees: THREE.Group, fid: number): { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } {
  const trunks = trees.children[0] as THREE.InstancedMesh;
  const m = new THREE.Matrix4();
  trunks.getMatrixAt(fid, m);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  return { pos, quat, scale };
}

function trunkTint(trees: THREE.Group, fid: number): THREE.Color {
  const trunks = trees.children[0] as THREE.InstancedMesh;
  const c = new THREE.Color();
  trunks.getColorAt(fid, c);
  return c;
}

describe("feature damage posing", () => {
  it("builds intact poses and flattens the blast core to a toppled lie", () => {
    const map = makeMap();
    const trees = buildTrees(map, 1);
    expect((trees.userData.all as THREE.Vector3[]).length).toBe(3);
    const field = createDamageField(3, 0);
    const pts = trees.userData.all as THREE.Vector3[];
    // Stub rng rolls 0 → resolveTerminal always picks "toppled".
    const res = applyBlastToTrees(field, pts, pts[0]!.x, pts[0]!.z, 200, () => 0);
    expect(res.flattened).toContain(0);
    const dummy = new THREE.Object3D();
    for (const fid of [...res.flattened, ...res.ignited]) {
      writeTreePose(trees, dummy, fid, 100, field.trees[fid]!);
    }
    // A flattened trunk lies on its side (roll ≈ 1.35 rad), not upright.
    const flat = trunkPose(trees, 0);
    const euler = new THREE.Euler().setFromQuaternion(flat.quat);
    expect(Math.abs(euler.z)).toBeGreaterThan(1);
    expect(flat.pos.y).toBeLessThan(110);
  });

  it("chars smouldering crowns and hides stump canopies", () => {
    const map = makeMap();
    const trees = buildTrees(map, 1);
    const dummy = new THREE.Object3D();
    writeTreePose(trees, dummy, 0, 100, "smouldering");
    const char = trunkTint(trees, 0);
    expect(char.r).toBeLessThan(0.5);
    // Stump: squashed trunk, zeroed crown.
    writeTreePose(trees, dummy, 1 - 1, 100, "stump");
    const stump = trunkPose(trees, 0);
    expect(stump.scale.y).toBeLessThan(0.5);
    const canopies = trees.children[1] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    canopies.getMatrixAt(0, m);
    // Hidden crown: zeroed basis columns (decompose is undefined on
    // degenerate zero-scale matrices, so assert the elements directly).
    expect(m.elements[0]).toBe(0);
    expect(m.elements[5]).toBe(0);
    expect(m.elements[10]).toBe(0);
  });

  it("preserves damage across exaggeration re-seats (no resurrection)", () => {
    const map = makeMap();
    const trees = buildTrees(map, 1);
    const rocks = buildRocks(map, 1);
    const field = createDamageField(3, 2);
    const pts = trees.userData.all as THREE.Vector3[];
    applyBlastToTrees(field, pts, pts[0]!.x, pts[0]!.z, 30, () => 0);
    applyBlastToRocks(field, rocks.userData.positions as THREE.Vector3[], pts[0]!.x, pts[0]!.z, 30);
    // Re-seat at 2× exaggeration from the persistent field, like the canvas
    // does on slider change: damage must survive, only heights move.
    placeFeatures(trees, rocks, map, 2, field);
    const flat = trunkPose(trees, 0);
    const euler = new THREE.Euler().setFromQuaternion(flat.quat);
    expect(Math.abs(euler.z)).toBeGreaterThan(1);
    expect(flat.pos.y).toBeGreaterThan(190);
    // all = [round… , pines…]: index 1 is the second round tree (cell 2,
    // 32 units out — spared); index 2 is the pine at 16 units (fringe-lit).
    expect(field.trees[1]).toBe("intact");
    // Intact trees stay upright after the same re-seat.
    const live = trunkPose(trees, 1);
    const liveEuler = new THREE.Euler().setFromQuaternion(live.quat);
    expect(Math.abs(liveEuler.z)).toBeCloseTo(0, 5);
  });

  it("chips rocks through visible levels toward buried rubble", () => {
    const map = makeMap();
    const rocks = buildRocks(map, 1);
    const dummy = new THREE.Object3D();
    const readScale = (i: number): number => {
      const m = new THREE.Matrix4();
      rocks.getMatrixAt(i, m);
      const s = new THREE.Vector3();
      m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
      return s.x;
    };
    const intact = readScale(0);
    writeRockPose(rocks, dummy, 0, 100, 1);
    expect(readScale(0)).toBeLessThan(intact);
    writeRockPose(rocks, dummy, 0, 100, 3);
    expect(readScale(0)).toBeLessThan(intact * 0.5);
    const c = new THREE.Color();
    rocks.getColorAt(0, c);
    expect(c.r).toBeLessThan(0.6);
  });
});
