import * as THREE from "three";
import { Assembly, armor } from "./vehicleGeometry";

const SHELL = 0x747e7b, EDGE = 0xa0aaa2, DARK = 0x252f32, STEEL = 0x485654;
const INSET = 0x131e23, BRASS = 0xa58a50;
type Batch = [number, THREE.BufferGeometry][];
const cache = new Map<number, { fixed: Batch; roof: Batch; door: Batch; stack: Batch; silo: Batch; annex: Batch }>();

function source(team: number) {
  const old = cache.get(team);
  if (old) return old;
  const fixed = new Assembly(SHELL), roof = new Assembly(SHELL);
  const door = new Assembly(SHELL), stack = new Assembly(STEEL);
  const silo = new Assembly(STEEL), annex = new Assembly(STEEL);
  // The open production bay faces +X. Sloping side bastions leave the
  // original rectangular door aperture and reinforcement route unobstructed.
  fixed.plate(96, 76, 0, 4, 0, 0, STEEL);
  fixed.add(armor([[4, 12, 72, 3], [30, 9, 64, 2], [38, 8, 60, 2]]), SHELL, -42);
  for (const s of [-1, 1]) {
    fixed.add(armor([[4, 86, 13, 3], [28, 82, 10, 2], [38, 76, 8, 2]]), SHELL, 0, 0, s * 31);
    // Large separated wall panels, backed by dark mechanical channels.
    fixed.block(76, 12, 1, -2, 20, s * 35.5, INSET);
    for (const x of [-28, -4, 20]) {
      fixed.add(armor([[6, 19, 5, 1], [25, 16, 4, 1], [31, 13, 3, 1]]), SHELL, x, 0, s * 35);
      fixed.block(12, 2.2, 0.6, x, 23, s * 37.3, STEEL);
    }
    // Portal shoulders flare outward into the foundation, never into the lane.
    fixed.add(armor([[4, 15, 18, 3], [30, 11, 15, 2], [38, 10, 14, 2]]), SHELL, 42, 0, s * 26);
    fixed.block(2, 30, 2, 47.6, 20, s * 18.5, INSET);
    fixed.block(1.1, 23, 1.2, 48.8, 19, s * 20.4, team);
    fixed.block(2, 3, 2, 49, 10, s * 23, BRASS);
    // Continuous recessed mechanical belt beneath the roof rim.
    fixed.block(76, 2.4, 1.2, -1, 34, s * 34.5, DARK);
  }
  // Roof is its own moving assembly so the wreck settles the entire crown.
  roof.add(armor([[-2.5, 96, 76, 7], [0, 96, 76, 7], [2.5, 87, 68, 6]]), SHELL);
  for (const s of [1]) {
    roof.plate(66, 18, 2.7, 1.5, 1, s * 23, EDGE);
    roof.block(52, 0.5, 11, 0, 4.3, s * 23, DARK);
    for (let x = -22; x <= 22; x += 5.5) roof.block(2.6, 0.7, 9, x, 4.7, s * 23, STEEL);
    roof.block(57, 1, 1.4, 0, 4.6, s * 29, team);
  }
  roof.plate(65, 18, 2.7, 1.5, 0, -23, STEEL);
  for (const x of [-19, 3]) {
    roof.plate(19, 14, 4.3, 1.4, x, -23, SHELL);
    roof.block(8, 0.7, 1, x, 6, -23, EDGE);
  }
  roof.block(53, 0.8, 1.4, -4, 4.7, -30, team);
  roof.add(armor([[2.5, 65, 22, 4], [8, 56, 18, 3], [10, 49, 15, 3]]), DARK, -3);
  roof.plate(48, 14, 10.2, 1.5, -3, 0, SHELL);
  for (const s of [-1, 1]) for (let x = -23; x < 22; x += 8) {
    roof.block(5.5, 2.8, 0.65, x, 7.5, s * 9.5, 0x618b91);
  }
  roof.plate(15, 11, 12, 1.3, -10, 0, EDGE);
  roof.block(7, 0.5, 1, -10, 13.5, 0, STEEL);
  // Armored shutter cassette: tall enough to contain the translated door.
  fixed.add(armor([[38, 30, 42, 3], [64, 13, 38, 3], [69, 9, 33, 2]]), STEEL, 41);
  fixed.add(new THREE.BoxGeometry(1.2, 18, 29).rotateZ(0.316), SHELL, 51.8, 53, 0);
  fixed.add(new THREE.BoxGeometry(1.4, 2, 23).rotateZ(0.316), team, 49.5, 61, 0);
  for (const z of [-9, -3, 3, 9]) fixed.add(new THREE.BoxGeometry(1.6, 9, 1.5).rotateZ(0.316), DARK, 52.9, 51, z);
  // Deep lintel, gate hood and a forward canopy supporting the existing beacon.
  fixed.add(armor([[35, 17, 45, 4], [39, 17, 45, 4], [41, 12, 40, 3]]), STEEL, 51);
  fixed.block(2, 2, 34, 58, 37.5, 0, team);
  // Segmented shutter: all ribs and inset fields move with its single pivot.
  door.block(2, 32, 34, 0, 0, 0, INSET);
  for (let y = -13; y <= 13; y += 5.2) {
    door.block(1.1, 4.4, 31, 1.5, y, 0, STEEL);
    door.block(0.6, 0.7, 29, 2.1, y + 1.5, 0, SHELL);
  }
  door.block(0.6, 27, 1.4, 2.2, 0, -12, team);
  door.block(0.6, 27, 1.4, 2.2, 0, 12, team);
  door.block(1, 2, 34, 1.5, -15, 0, BRASS);
  // Rear exhaust towers: attached caps, collars and vents topple together.
  stack.add(armor([[-19, 11, 12, 2], [22, 9, 10, 2], [29, 8, 9, 2]]), STEEL);
  for (const y of [-12, 2, 25]) stack.plate(12, 13, y, 1.5, 0, 0, SHELL);
  stack.plate(11, 12, 29, 2, 0, 0, EDGE);
  stack.block(7, 0.6, 8, 0, 31.2, 0, INSET);
  for (const z of [-2.5, 0, 2.5]) stack.block(6, 0.8, 0.8, 0, 31.6, z, STEEL);
  // Rear service hatch and conduit protection are part of the wall, not clutter.
  fixed.block(1, 18, 27, -48.2, 15, 0, DARK);
  for (const z of [-9, 0, 9]) fixed.block(1, 14, 6, -49, 15, z, STEEL);
  // Equipment blister and workshop read as secondary masses within the base.
  annex.add(armor([[4, 25, 18, 3], [14, 23, 16, 3], [17, 18, 13, 2]]), STEEL, -16, 0, 28);
  annex.plate(18, 12, 17, 1.4, -16, 28, EDGE);
  silo.add(new THREE.CylinderGeometry(6, 7, 13, 10), STEEL, 25, 47, -24);
  silo.add(new THREE.CylinderGeometry(7.5, 7.5, 1.5, 10), EDGE, 25, 54, -24);
  silo.add(new THREE.CylinderGeometry(5.5, 6.5, 3, 10), SHELL, 25, 56, -24);
  // Apron expansion joints, guide rails and restrained painted lane marks.
  fixed.plate(130, 30, 0, 2, 113, 0, STEEL);
  for (const s of [-1, 1]) {
    fixed.add(armor([[0, 130, 4, 1], [5, 130, 4, 1], [6, 126, 3, 1]]), DARK, 113, 0, s * 17);
    fixed.block(124, 0.4, 0.7, 113, 6.2, s * 17, EDGE);
    for (let x = 66; x < 174; x += 20) fixed.block(7, 0.15, 1, x, 2.1, s * 11, BRASS);
  }
  for (const x of [78, 110, 142, 174]) fixed.block(0.6, 0.1, 27, x, 2.1, 0, DARK);
  const result = { fixed: fixed.bake(), roof: roof.bake(), door: door.bake(), stack: stack.bake(), silo: silo.bake(), annex: annex.bake() };
  cache.set(team, result);
  return result;
}

/** Cached source geometry; each HQ owns the clones disposed by HqFx. */
export function buildHqArchitecture(group: THREE.Group, teamColor: number): void {
  const data = source(teamColor);
  const attach = (batch: Batch, parent: THREE.Object3D, name: string) => {
    let root: THREE.Mesh | undefined;
    for (const [color, geometry] of batch) {
      const mesh = new THREE.Mesh(geometry.clone(), new THREE.MeshLambertMaterial({ color }));
      mesh.userData.noHighlight = true;
      if (!root) { root = mesh; mesh.name = name; parent.add(mesh); }
      else root.add(mesh);
    }
    return root!;
  };
  // Named architectural landmarks remain available to scene tooling.
  attach(data.fixed, group, "hq-shell");
  attach(data.annex, group, "hq-annex");
  attach(data.silo, group, "hq-silo");
  const roof = attach(data.roof, group, "hq-roof");
  roof.position.y = 40.5;
  roof.children[0]!.name = "hq-monitor";
  const door = attach(data.door, group, "hq-door");
  door.position.set(46, 20, 0); door.userData.baseY = 20;
  for (const s of [-1, 1]) {
    const tower = attach(data.stack, group, "hq-chimney");
    tower.position.set(-36, 28, s * 25);
  }
}
