import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyBlastToRocks,
  applyBlastToTrees,
  createDamageField,
  FALLEN_DECAY_DURATION,
  FALLEN_SINK_DEPTH,
  worldHeight,
  type TNTMap,
} from "@scorched-3d/core";
import {
  buildRocks,
  buildTrees,
  decaySink,
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

describe("fallen-tree decay posing", () => {
  it("sinks toppled trunks below their fell seat, never standing wood", () => {
    const map = makeMap();
    const trees = buildTrees(map, 1);
    const dummy = new THREE.Object3D();
    // Fresh fall rides at grade; a half-decayed fall rides 3 units lower.
    writeTreePose(trees, dummy, 0, 100, "toppled", 0);
    const fresh = trunkPose(trees, 0).pos.y;
    writeTreePose(trees, dummy, 0, 100, "toppled", 3);
    expect(trunkPose(trees, 0).pos.y).toBeCloseTo(fresh - 3, 9);
    // Standing and burning wood ignore the sink.
    writeTreePose(trees, dummy, 0, 100, "intact", 0);
    const standing = trunkPose(trees, 0).pos.y;
    writeTreePose(trees, dummy, 0, 100, "intact", 3);
    expect(trunkPose(trees, 0).pos.y).toBeCloseTo(standing, 9);
    writeTreePose(trees, dummy, 0, 100, "burning", 0);
    const ember = trunkPose(trees, 0).pos.y;
    writeTreePose(trees, dummy, 0, 100, "burning", 3);
    expect(trunkPose(trees, 0).pos.y).toBeCloseTo(ember, 9);
  });

  it("hides gone trees entirely (trunk and crown zeroed)", () => {
    const map = makeMap();
    const trees = buildTrees(map, 1);
    const dummy = new THREE.Object3D();
    const zeroed = (mesh: THREE.InstancedMesh, index: number): boolean => {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(index, m);
      return m.elements[0] === 0 && m.elements[5] === 0 && m.elements[10] === 0;
    };
    // fid 0 is round (canopy child 1), fid 2 is the pine (cone child 2).
    writeTreePose(trees, dummy, 0, 100, "gone");
    expect(zeroed(trees.children[0] as THREE.InstancedMesh, 0)).toBe(true);
    expect(zeroed(trees.children[1] as THREE.InstancedMesh, 0)).toBe(true);
    writeTreePose(trees, dummy, 2, 100, "gone");
    expect(zeroed(trees.children[0] as THREE.InstancedMesh, 2)).toBe(true);
    expect(zeroed(trees.children[2] as THREE.InstancedMesh, 0)).toBe(true);
  });

  it("paces the sink from the core fell clock and re-seats decay on snaps", () => {
    // decaySink is the shared view helper: grade for standing wood, the
    // core sink curve for fallen wood.
    expect(decaySink("intact", 100)).toBe(0);
    expect(decaySink("burning", 100)).toBe(0);
    expect(decaySink("gone", 100)).toBe(0);
    expect(decaySink("toppled", 0)).toBe(0);
    expect(decaySink("stump", FALLEN_DECAY_DURATION / 2)).toBeCloseTo(FALLEN_SINK_DEPTH / 2, 9);
    expect(decaySink("snag", FALLEN_DECAY_DURATION)).toBe(FALLEN_SINK_DEPTH);
    // A re-snap (exaggeration change) keeps falls sunk and gone hidden —
    // decay is field state, never pose state.
    const map = makeMap();
    const trees = buildTrees(map, 1);
    const rocks = buildRocks(map, 1);
    const field = createDamageField(3, 2);
    field.trees[0] = "toppled";
    field.treeAge[0] = FALLEN_DECAY_DURATION / 2;
    field.trees[1] = "gone";
    placeFeatures(trees, rocks, map, 2, field);
    const sunk = trunkPose(trees, 0).pos.y;
    // Fell seat at 2× exaggeration is worldHeight(100, 2) + 4, sunk by half
    // the depth (3).
    expect(sunk).toBeCloseTo(worldHeight(100, 2) + 4 - FALLEN_SINK_DEPTH / 2, 9);
    const m = new THREE.Matrix4();
    (trees.children[0] as THREE.InstancedMesh).getMatrixAt(1, m);
    expect(m.elements[0]).toBe(0);
    expect(m.elements[5]).toBe(0);
    expect(m.elements[10]).toBe(0);
  });
});
