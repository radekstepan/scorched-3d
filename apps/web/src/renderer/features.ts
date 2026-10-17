import * as THREE from "three";
import {
  CELL_PIXELS,
  fallenDecay,
  fallenSink,
  FEATURE_EMPTY,
  worldHeight,
  type DamageField,
  type RockDamage,
  type TNTMap,
  type TreeDamage,
} from "@scorched-3d/core";
import { applyFireflyTreeGlow, type FireflyFieldUniforms } from "./fireflies";

/**
 * Tree/rock feature posing: instanced trunk + crown buffers with one shared
 * posing helper per kind, so blast damage and exaggeration re-snaps can never
 * disagree. Damage state lives in a caller-owned core `DamageField` indexed
 * by feature id (trees: round first, then pines — matching trunk order);
 * poses are a transient view of that field, which is why re-snaps preserve
 * burns instead of resurrecting features.
 *
 * Per-instance colors carry the char: intact instances stay white (base
 * material color), burning canopies glow ember, smouldering crowns go dark,
 * and terminal states (toppled / stump / snag) pose charred wood.
 */

const scratchColor = new THREE.Color();

function tint(mesh: THREE.InstancedMesh, index: number, r: number, g: number, b: number): void {
  mesh.setColorAt(index, scratchColor.setRGB(r, g, b));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function cellWorld(map: TNTMap, x: number, z: number, exaggeration: number): THREE.Vector3 {
  return new THREE.Vector3(
    (x - (map.width - 1) / 2) * CELL_PIXELS,
    worldHeight(map.heights[z * map.width + x] ?? 0, exaggeration),
    (z - (map.height - 1) / 2) * CELL_PIXELS,
  );
}

export function buildTrees(
  map: TNTMap,
  exaggeration: number,
  fireflyField?: FireflyFieldUniforms,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "trees";

  const trunkGeo = new THREE.CylinderGeometry(2.2, 3.2, 18, 5);
  const canopyGeo = new THREE.IcosahedronGeometry(14, 0);
  const pineGeo = new THREE.ConeGeometry(11, 32, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3b2a16 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2d5a22 });
  const pineMat = new THREE.MeshLambertMaterial({ color: 0x1f4a28 });
  // Every firefly reflects off bark and crowns: the three materials alias
  // the terrain's field uniforms, so one per-tick mirror feeds both.
  if (fireflyField) {
    for (const mat of [trunkMat, leafMat, pineMat]) applyFireflyTreeGlow(mat, fireflyField);
  }

  const round: THREE.Vector3[] = [];
  const pines: THREE.Vector3[] = [];
  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      const word = map.features[z * map.width + x] ?? FEATURE_EMPTY;
      if (word > 2) continue;
      const p = cellWorld(map, x, z, exaggeration);
      if (word === 1) pines.push(p);
      else round.push(p);
    }
  }

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(round.length + pines.length, 1));
  const canopies = new THREE.InstancedMesh(canopyGeo, leafMat, Math.max(round.length, 1));
  const cones = new THREE.InstancedMesh(pineGeo, pineMat, Math.max(pines.length, 1));
  trunks.count = round.length + pines.length;
  canopies.count = round.length;
  cones.count = pines.length;
  const dummy = new THREE.Object3D();
  let ti = 0;
  round.forEach((p, i) => {
    dummy.position.set(p.x, p.y + 9, p.z);
    dummy.scale.setScalar(0.85 + (i % 5) * 0.08);
    dummy.updateMatrix();
    trunks.setMatrixAt(ti++, dummy.matrix);
    dummy.position.set(p.x, p.y + 24, p.z);
    dummy.scale.setScalar(0.9 + (i % 4) * 0.12);
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);
  });
  pines.forEach((p, i) => {
    dummy.position.set(p.x, p.y + 9, p.z);
    dummy.scale.set(0.7, 1, 0.7);
    dummy.updateMatrix();
    trunks.setMatrixAt(ti++, dummy.matrix);
    dummy.position.set(p.x, p.y + 28, p.z);
    dummy.scale.setScalar(0.85 + (i % 3) * 0.1);
    dummy.updateMatrix();
    cones.setMatrixAt(i, dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  cones.instanceMatrix.needsUpdate = true;
  // White base tints so damaged instances can char per-instance later.
  for (let i = 0; i < round.length + pines.length; i++) tint(trunks, i, 1, 1, 1);
  for (let i = 0; i < round.length; i++) tint(canopies, i, 1, 1, 1);
  for (let i = 0; i < pines.length; i++) tint(cones, i, 1, 1, 1);
  trunks.frustumCulled = false;
  canopies.frustumCulled = false;
  cones.frustumCulled = false;
  group.add(trunks, canopies, cones);
  group.userData.positions = { round, pines };
  group.userData.all = [...round, ...pines];
  return group;
}

/**
 * Deterministic per-instance rock bulk, in the sibling viewer's non-uniform
 * style (`scale.set(1.8 + (i % 3), 1.4 + (i % 4), 2.5 + (i % 3))` on a
 * detail-0 dodecahedron): each axis varies on its own small cycle around the
 * shared base size, so neighbouring instances read as different stones
 * instead of resized copies. Shared by `buildRocks` and `writeRockPose` so
 * the intact pose can never disagree; `shrink` is the damage-level factor.
 */
export function rockAxisScale(i: number, shrink = 1): { x: number; y: number; z: number } {
  const s = 0.7 + (i % 5) * 0.18;
  return {
    x: s * (0.85 + (i % 3) * 0.15) * shrink,
    y: s * (0.7 + (i % 4) * 0.12) * shrink,
    z: s * (0.9 + ((i + 1) % 3) * 0.15) * shrink,
  };
}

/** Deterministic per-instance rock tumble; shared for the same reason. */
export function rockRotation(i: number): { x: number; y: number; z: number } {
  return { x: i * 0.7, y: i * 1.1, z: i * 0.3 };
}

export function buildRocks(map: TNTMap, exaggeration: number): THREE.InstancedMesh {
  const geo = new THREE.DodecahedronGeometry(9, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x6a5e50 });
  const pts: THREE.Vector3[] = [];
  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      const word = map.features[z * map.width + x] ?? FEATURE_EMPTY;
      if (word === 3 || word === 4) pts.push(cellWorld(map, x, z, exaggeration));
    }
  }
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(pts.length, 1));
  mesh.name = "rocks";
  const dummy = new THREE.Object3D();
  pts.forEach((p, i) => {
    dummy.position.copy(p).add(new THREE.Vector3(0, 2, 0));
    const rot = rockRotation(i);
    dummy.rotation.set(rot.x, rot.y, rot.z);
    const s = rockAxisScale(i);
    dummy.scale.set(s.x, s.y, s.z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    tint(mesh, i, 1, 1, 1);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.positions = pts;
  mesh.count = pts.length;
  mesh.frustumCulled = false;
  return mesh;
}

/** All tree/rock base positions (X/Z authoritative; Y is re-seated live). */
export function treePositions(trees: THREE.Group): THREE.Vector3[] {
  return trees.userData.all as THREE.Vector3[];
}

export function rockPositions(rocks: THREE.InstancedMesh): THREE.Vector3[] {
  return rocks.userData.positions as THREE.Vector3[];
}

/**
 * Decay sink for a tree state: fallen (terminal, non-gone) trees ride below
 * their fell seat by the core pacing for their fell age; everything else
 * poses at grade. Shared by re-snaps and the per-tick sink pass so both
 * agree.
 */
export function decaySink(state: TreeDamage, fellAge: number): number {
  if (state !== "toppled" && state !== "stump" && state !== "snag") return 0;
  return fallenSink(fallenDecay(fellAge));
}

/** Re-seat every feature after an exaggeration change; damage survives. */
export function placeFeatures(
  trees: THREE.Group,
  rocks: THREE.InstancedMesh,
  map: TNTMap,
  exaggeration: number,
  field?: DamageField,
): void {
  const { round, pines } = trees.userData.positions as { round: THREE.Vector3[]; pines: THREE.Vector3[] };
  const dummy = new THREE.Object3D();
  for (let fid = 0; fid < round.length + pines.length; fid++) {
    const p = (fid < round.length ? round[fid] : pines[fid - round.length])!;
    const x = Math.round(p.x / CELL_PIXELS + (map.width - 1) / 2);
    const z = Math.round(p.z / CELL_PIXELS + (map.height - 1) / 2);
    const y = worldHeight(map.heights[z * map.width + x] ?? 0, exaggeration);
    const state = field?.trees[fid] ?? "intact";
    writeTreePose(trees, dummy, fid, y, state, decaySink(state, field?.treeAge[fid] ?? 0));
  }

  const pts = rockPositions(rocks);
  pts.forEach((p, i) => {
    const x = Math.round(p.x / CELL_PIXELS + (map.width - 1) / 2);
    const z = Math.round(p.z / CELL_PIXELS + (map.height - 1) / 2);
    const y = worldHeight(map.heights[z * map.width + x] ?? 0, exaggeration);
    writeRockPose(rocks, dummy, i, y, field?.rocks[i] ?? 0);
  });
}

/** Hide one crown instance (stump/snag have no live canopy). */
function hideCrown(mesh: THREE.InstancedMesh, dummy: THREE.Object3D, index: number, y: number, x: number, z: number): void {
  dummy.position.set(x, y, z);
  dummy.scale.setScalar(0);
  dummy.rotation.set(0, 0, 0);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
  tint(mesh, index, 1, 1, 1);
}

/**
 * Pose one tree for a damage state. Feature id `fid` indexes round trees
 * first, then pines — matching the trunk order in `buildTrees`. Shared by
 * blast damage, fire ticks, crush falls, decay sinks, and exaggeration
 * re-snaps so damage survives. `sink` lowers fallen (terminal, non-gone)
 * trees toward the ground as they decay (husk pattern); `gone` hides the
 * instance entirely.
 */
export function writeTreePose(
  trees: THREE.Group,
  dummy: THREE.Object3D,
  fid: number,
  y: number,
  damage: TreeDamage = "intact",
  sink = 0,
): void {
  const { round, pines } = trees.userData.positions as { round: THREE.Vector3[]; pines: THREE.Vector3[] };
  const trunks = trees.children[0] as THREE.InstancedMesh;
  const canopies = trees.children[1] as THREE.InstancedMesh;
  const cones = trees.children[2] as THREE.InstancedMesh;
  // Fallen wood rides below its fell seat while decaying; standing and
  // burning wood never sinks.
  const ty = damage === "toppled" || damage === "stump" || damage === "snag" ? y - sink : y;
  if (fid < round.length) {
    const p = round[fid]!;
    const i = fid;
    const s = 0.85 + (i % 5) * 0.08;
    const cs = 0.9 + (i % 4) * 0.12;
    switch (damage) {
      case "intact":
        dummy.position.set(p.x, y + 9, p.z);
        dummy.scale.setScalar(s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        tint(trunks, i, 1, 1, 1);
        dummy.position.set(p.x, y + 24, p.z);
        dummy.scale.setScalar(cs);
        dummy.updateMatrix();
        canopies.setMatrixAt(i, dummy.matrix);
        tint(canopies, i, 1, 1, 1);
        break;
      case "burning":
        // Full silhouette (the flame instance does the talking) with an
        // ember canopy; the smoulder state shows the consumption.
        dummy.position.set(p.x, y + 9, p.z);
        dummy.scale.setScalar(s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        tint(trunks, i, 1, 1, 1);
        dummy.position.set(p.x, y + 24, p.z);
        dummy.scale.setScalar(cs);
        dummy.updateMatrix();
        canopies.setMatrixAt(i, dummy.matrix);
        tint(canopies, i, 0.55, 0.22, 0.1);
        break;
      case "smouldering":
        // Half-consumed: shrunken charred crown, darkened trunk.
        dummy.position.set(p.x, y + 9, p.z);
        dummy.scale.setScalar(s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        tint(trunks, i, 0.25, 0.19, 0.14);
        dummy.position.set(p.x, y + 20, p.z);
        dummy.scale.setScalar(cs * 0.7);
        dummy.updateMatrix();
        canopies.setMatrixAt(i, dummy.matrix);
        tint(canopies, i, 0.16, 0.13, 0.11);
        break;
      case "toppled": {
        // Knocked on its side: trunk lies along +X, crown sprawls past it.
        dummy.position.set(p.x, ty + 4, p.z);
        dummy.scale.setScalar(s);
        dummy.rotation.set(0, 0, 1.35);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        tint(trunks, i, 0.22, 0.17, 0.12);
        dummy.position.set(p.x + 13 * s, ty + 4, p.z);
        dummy.scale.setScalar(cs * 0.8);
        dummy.rotation.set(0, 0, 1.35);
        dummy.updateMatrix();
        canopies.setMatrixAt(i, dummy.matrix);
        tint(canopies, i, 0.15, 0.12, 0.1);
        break;
      }
      case "stump":
        dummy.position.set(p.x, ty + 3, p.z);
        dummy.scale.set(s, 0.3, s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        tint(trunks, i, 0.3, 0.22, 0.15);
        hideCrown(canopies, dummy, i, y, p.x, p.z);
        break;
      case "snag":
        // Charred standing trunk, crown burnt away.
        dummy.position.set(p.x, ty + 7, p.z);
        dummy.scale.set(s, 0.75, s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        tint(trunks, i, 0.18, 0.14, 0.11);
        hideCrown(canopies, dummy, i, y, p.x, p.z);
        break;
      case "gone":
        // Decayed away: trunk and crown both hidden (zeroed matrices), like
        // a finished husk — the fid slot is retained, only the instance
        // vanishes.
        dummy.position.set(p.x, y, p.z);
        dummy.scale.setScalar(0);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        tint(trunks, i, 1, 1, 1);
        hideCrown(canopies, dummy, i, y, p.x, p.z);
        break;
    }
  } else {
    const k = fid - round.length;
    const p = pines[k]!;
    const cs = 0.85 + (k % 3) * 0.1;
    switch (damage) {
      case "intact":
        dummy.position.set(p.x, y + 9, p.z);
        dummy.scale.set(0.7, 1, 0.7);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(round.length + k, dummy.matrix);
        tint(trunks, round.length + k, 1, 1, 1);
        dummy.position.set(p.x, y + 28, p.z);
        dummy.scale.setScalar(cs);
        dummy.updateMatrix();
        cones.setMatrixAt(k, dummy.matrix);
        tint(cones, k, 1, 1, 1);
        break;
      case "burning":
        dummy.position.set(p.x, y + 9, p.z);
        dummy.scale.set(0.7, 1, 0.7);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(round.length + k, dummy.matrix);
        tint(trunks, round.length + k, 1, 1, 1);
        dummy.position.set(p.x, y + 28, p.z);
        dummy.scale.setScalar(cs);
        dummy.updateMatrix();
        cones.setMatrixAt(k, dummy.matrix);
        tint(cones, k, 0.55, 0.24, 0.1);
        break;
      case "smouldering":
        dummy.position.set(p.x, y + 9, p.z);
        dummy.scale.set(0.7, 1, 0.7);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(round.length + k, dummy.matrix);
        tint(trunks, round.length + k, 0.25, 0.19, 0.14);
        dummy.position.set(p.x, y + 23, p.z);
        dummy.scale.setScalar(cs * 0.7);
        dummy.updateMatrix();
        cones.setMatrixAt(k, dummy.matrix);
        tint(cones, k, 0.14, 0.13, 0.11);
        break;
      case "toppled":
        dummy.position.set(p.x, ty + 4, p.z);
        dummy.scale.set(0.7, 1, 0.7);
        dummy.rotation.set(0, 0, 1.35);
        dummy.updateMatrix();
        trunks.setMatrixAt(round.length + k, dummy.matrix);
        tint(trunks, round.length + k, 0.22, 0.17, 0.12);
        dummy.position.set(p.x + 13, ty + 4, p.z);
        dummy.scale.setScalar(cs * 0.8);
        dummy.rotation.set(0, 0, 1.35);
        dummy.updateMatrix();
        cones.setMatrixAt(k, dummy.matrix);
        tint(cones, k, 0.12, 0.15, 0.12);
        break;
      case "stump":
        dummy.position.set(p.x, ty + 3, p.z);
        dummy.scale.set(0.7, 0.3, 0.7);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(round.length + k, dummy.matrix);
        tint(trunks, round.length + k, 0.3, 0.22, 0.15);
        hideCrown(cones, dummy, k, y, p.x, p.z);
        break;
      case "snag":
        dummy.position.set(p.x, ty + 7, p.z);
        dummy.scale.set(0.7, 0.75, 0.7);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(round.length + k, dummy.matrix);
        tint(trunks, round.length + k, 0.18, 0.14, 0.11);
        hideCrown(cones, dummy, k, y, p.x, p.z);
        break;
      case "gone":
        // Decayed away: trunk and cone both hidden (zeroed matrices).
        dummy.position.set(p.x, y, p.z);
        dummy.scale.setScalar(0);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(round.length + k, dummy.matrix);
        tint(trunks, round.length + k, 1, 1, 1);
        hideCrown(cones, dummy, k, y, p.x, p.z);
        break;
    }
  }
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  cones.instanceMatrix.needsUpdate = true;
}

/**
 * Pose one rock for a damage level: intact sits proud, chipped shrinks with
 * a sideways knock, cracked sinks darker and smaller, buried is low rubble.
 */
export function writeRockPose(
  rocks: THREE.InstancedMesh,
  dummy: THREE.Object3D,
  i: number,
  y: number,
  damage: RockDamage = 0,
): void {
  const pts = rockPositions(rocks);
  const p = pts[i]!;
  const rot = rockRotation(i);
  const pose = (shrink: number): void => {
    const s = rockAxisScale(i, shrink);
    dummy.rotation.set(rot.x, rot.y, rot.z);
    dummy.scale.set(s.x, s.y, s.z);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  };
  switch (damage) {
    case 0:
      dummy.position.set(p.x, y + 2, p.z);
      pose(1);
      tint(rocks, i, 1, 1, 1);
      break;
    case 1:
      dummy.position.set(p.x + 3, y + 1, p.z);
      pose(0.85);
      tint(rocks, i, 0.85, 0.8, 0.75);
      break;
    case 2:
      dummy.position.set(p.x - 5, y + 0.5, p.z);
      pose(0.6);
      tint(rocks, i, 0.5, 0.42, 0.35);
      break;
    case 3:
      dummy.position.set(p.x, y - 1, p.z);
      pose(0.35);
      tint(rocks, i, 0.35, 0.28, 0.22);
      break;
  }
  rocks.instanceMatrix.needsUpdate = true;
}
