import * as THREE from "three";
import { armor, Assembly } from "./vehicleGeometry";
import { unitHullMaterial } from "./unitFog";

const PAINT = 0x3d719b;
const PANEL = 0x85a0af;
const GOLD = 0xd4ad56;
const DARK = 0x29383e;
const METAL = 0x73858b;
const OPTIC = 0x9ad8d8;
type Point = [number, number, number];

function link(a: Assembly, from: Point, to: Point, width: number, depth: number, color: number): void {
  const direction = new THREE.Vector3(...to).sub(new THREE.Vector3(...from));
  const length = direction.length(), corner = Math.min(width, depth) * 0.2;
  const g = armor([[0, width, depth, corner], [length * 0.15, width * 1.08, depth, corner],
    [length, width * 0.78, depth * 0.85, corner * 0.8]]);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  a.add(g, color, ...from);
}

function legDesign() {
  const a = new Assembly(PAINT);
  link(a, [0, -0.3, 0], [0, -6.3, 1.15], 3.45, 3.7, PAINT);
  link(a, [0, -6.3, 1.15], [0, -11.8, -0.35], 4.05, 3.5, PAINT);
  a.add(armor([[-11.5, 4.3, 3.6, 0.7, 0.2], [-8.5, 4.55, 3.5, 0.75, 0.9],
    [-7.5, 3.8, 3.2, 0.65, 1.1]]), PAINT);
  // Raised shin rail and a pale knee shield give the load-bearing legs depth.
  link(a, [0, -7, 2.5], [0, -10.8, 1.1], 2.1, 0.75, PANEL);
  a.add(armor([[-7, 3.7, 2.1, 0.6, 1.9], [-5.6, 3.4, 1.8, 0.55, 1.9]]), GOLD);
  for (const [y, z, r] of [[-0.6, 0, 1.45], [-6.3, 1.15, 1.5], [-11.7, -0.3, 0.95]] as const) {
    const joint = new THREE.CylinderGeometry(r, r, 4.2, 10); joint.rotateZ(Math.PI / 2);
    a.add(joint, DARK, 0, y, z);
    const hub = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 4.35, 10); hub.rotateZ(Math.PI / 2);
    a.add(hub, METAL, 0, y, z);
  }
  a.add(armor([[-14, 5.3, 6.5, 0.8, 0.6], [-13.2, 5.5, 6.7, 0.9, 0.6],
    [-11.9, 4.2, 4.8, 0.7, 0.2]]), PAINT);
  a.add(armor([[-13.95, 5.4, 6.6, 0.8, 0.6], [-13.6, 5.55, 6.75, 0.85, 0.6]]), DARK);
  a.plate(3.7, 1.1, -12.9, 0.35, 0, 2.9, PANEL);
  a.block(3.8, 0.2, 0.1, 0, -13.25, 3.99, DARK);
  return a.bake();
}

function design() {
  const torso = new Assembly(PAINT), mastAssembly = new Assembly(PAINT);
  const waist = new THREE.CylinderGeometry(4, 4.6, 2.2, 12);
  torso.add(waist, DARK, 0, 15.5, -0.2);
  torso.add(armor([[16, 8.8, 7.3, 1.4, -0.4], [22, 13.1, 10.2, 2, -0.7],
    [26.6, 14.4, 10.8, 2.3, -0.8], [30.5, 11.6, 7.9, 1.8, -0.9]]), PAINT);
  torso.add(armor([[18.5, 4.8, 1.1, 0.35, 3.5], [22.6, 6.8, 1.1, 0.4, 4.2]]), DARK);
  for (const [y, z] of [[19.6, 4.38], [20.8, 4.58], [22, 4.78]])
    torso.block(4, 0.22, 0.2, 0, y!, z!, METAL);
  for (const side of [-1, 1]) {
    torso.add(armor([[23.9, 4.2, 1.8, 0.5, 4.5], [27.8, 4.6, 1.3, 0.5, 4.4]]), PANEL, side * 3.35);
    const piston = new THREE.CylinderGeometry(0.32, 0.32, 4.6, 8);
    torso.add(piston, METAL, side * 3.1, 20.3, 4.15);
    const housing = new THREE.CylinderGeometry(0.58, 0.65, 2, 8);
    torso.add(housing, DARK, side * 3.1, 18.5, 4.15);
  }
  // Split shoulder pauldrons surround actual shoulder bearings and upper arms.
  for (const side of [-1, 1]) {
    const shoulder = new THREE.CylinderGeometry(1.8, 1.8, 2.2, 10); shoulder.rotateZ(Math.PI / 2);
    torso.add(shoulder, DARK, side * 6.5, 25.6, -0.3);
    torso.add(armor([[24.8, 3.4, 6.5, 1], [27.1, 3.9, 6.8, 1.1],
      [29.1, 2.9, 5.3, 0.9, -0.6]]), PAINT, side * 6.7);
    torso.plate(1.4, 3, 29.08, 0.25, side * 6.7, -0.6, GOLD);
    torso.add(armor([[26, 3.55, 3.2, 0.7, 2.2], [27.4, 3.8, 3.1, 0.7, 2.1]]), GOLD, side * 6.7);
    link(torso, [side * 6.65, 25.5, -0.3], [side * 7.1, 20.9, 0.8], 2.6, 3, PAINT);
    const elbow = new THREE.CylinderGeometry(1.15, 1.15, 2.9, 10); elbow.rotateZ(Math.PI / 2);
    torso.add(elbow, DARK, side * 7.1, 20.9, 0.8);
    link(torso, [side * 7.1, 20.9, 0.8], [side * 7.1, 16.9, 2], 3, 3.6, PANEL);
    torso.plate(3.25, 3.9, 15, 2.4, side * 7.1, 2.1, DARK);
    torso.plate(2.5, 2.9, 17.25, 0.6, side * 7.1, 2.1, GOLD);
    // Twin reactor/cooling packs support the command mast and dorsal armor.
    torso.add(armor([[20.2, 2.8, 2.8, 0.6, -5.5], [27.8, 3.2, 3.1, 0.7, -5.7],
      [29.2, 2.5, 2.7, 0.6, -5.3]]), DARK, side * 3.4);
    torso.plate(1.1, 2.5, 29, 0.25, side * 3.4, -5.3, GOLD);
    for (let y = 22; y < 27.5; y += 1.1) torso.block(2.3, 0.28, 0.22, side * 3.4, y, -7.33, METAL);
  }
  torso.add(armor([[21.2, 2.6, 0.35, 0.1, -5.9], [25.5, 3.8, 0.4, 0.1, -6.2],
    [28.7, 3, 0.35, 0.1, -5.6]]), DARK);
  torso.add(armor([[21.6, 2.1, 0.3, 0.1, -6.03], [25.4, 3.2, 0.3, 0.1, -6.38],
    [28.3, 2.5, 0.3, 0.1, -5.9]]), PAINT);
  // One utility claw, one armored fist: construction capability in the silhouette.
  for (const side of [-1, 1]) {
    link(torso, [-7.1 + side * 0.95, 16.5, 3.5], [-7.1 + side, 15.8, 6], 0.8, 1, METAL);
    link(torso, [-7.1 + side, 15.8, 6], [-7.1 + side * 0.65, 15.4, 6.6], 0.8, 0.9, METAL);
  }
  for (const x of [6.35, 7.1, 7.85]) torso.block(0.17, 1.3, 0.08, x, 16.1, 4.1, METAL);
  const neck = new THREE.CylinderGeometry(1.8, 2.3, 1.3, 10);
  torso.add(neck, DARK, 0, 30.7, -0.8);
  torso.add(armor([[30.8, 5.4, 4.7, 1, -0.4], [33.7, 6.8, 6.1, 1.3, -0.5],
    [35.4, 5.2, 4.7, 1.1, -0.8]]), PAINT);
  torso.add(armor([[32, 5.1, 1.3, 0.4, 2.5], [33.3, 5.8, 1.4, 0.5, 2.4],
    [33.8, 5.1, 1.1, 0.4, 2.25]]), DARK);
  torso.block(4.15, 0.45, 0.12, 0, 33.15, 3.15, OPTIC);
  torso.add(armor([[33.75, 6.1, 2, 0.55, 2], [34.4, 5.6, 1.7, 0.5, 1.7]]), GOLD);
  torso.plate(2.7, 2.6, 35.15, 0.35, 0, -0.9, PANEL);
  // Fixed chest emitter is centered on the existing (0,30,6) muzzle marker.
  torso.add(armor([[27.9, 5.8, 2.8, 0.7, 3.8], [30.5, 5.1, 2.4, 0.7, 3.8]]), GOLD);
  const muzzle = new THREE.Shape();
  muzzle.moveTo(-1.1, -1.5); muzzle.lineTo(1.1, -1.5); muzzle.lineTo(1.7, -0.9);
  muzzle.lineTo(1.7, 0.9); muzzle.lineTo(1.1, 1.5); muzzle.lineTo(-1.1, 1.5);
  muzzle.lineTo(-1.7, 0.9); muzzle.lineTo(-1.7, -0.9); muzzle.closePath();
  const opening = new THREE.Path(); opening.absarc(0, 0, 0.95, 0, Math.PI * 2, true); muzzle.holes.push(opening);
  torso.add(new THREE.ExtrudeGeometry(muzzle, {depth:1, bevelEnabled:true,
    bevelThickness:0.08, bevelSize:0.08, bevelSegments:1, steps:1, curveSegments:3}), METAL, 0, 30, 4.92);
  const emitter = new THREE.CylinderGeometry(0.85, 0.85, 0.08, 10); emitter.rotateX(Math.PI / 2);
  torso.add(emitter, OPTIC, 0, 30, 5.25);
  // Telescoping comms mast: the original tall recognition feature, not a tower.
  torso.add(armor([[28.7, 1.8, 2, 0.4, -4.4], [33.3, 1.2, 1.5, 0.3, -4.1]]), PANEL, 3);
  const mast = new THREE.CylinderGeometry(0.13, 0.3, 13.1, 6);
  mastAssembly.add(mast, DARK, 3, 39.6, -4.1);
  for (const y of [34, 39, 44.8]) {
    const collar = new THREE.CylinderGeometry(0.35, 0.35, 0.55, 6);
    mastAssembly.add(collar, GOLD, 3, y, -4.1);
  }
  return {torso:torso.bake(), mast:mastAssembly.bake(), legs:legDesign()};
}
let template: ReturnType<typeof design> | undefined;

export function buildCommander(parent: THREE.Group, turret: THREE.Group): void {
  const source = template ??= design();
  const attach = (target: THREE.Object3D, parts: [number, THREE.BufferGeometry][], name: string) => {
    for (const [color, geometry] of parts) {
      const mesh = new THREE.Mesh(geometry.clone(), unitHullMaterial(color)); mesh.name = name;
      mesh.userData.noCamo = color !== PAINT && color !== PANEL && color !== GOLD;
      target.add(mesh);
    }
  };
  attach(turret, source.torso, "commander-torso");
  attach(turret, source.mast, "commander-mast");
  const tip = new THREE.Object3D(); tip.name = "tip"; tip.position.set(0, 30, 6); turret.add(tip);
  for (const x of [-4, 4]) {
    const [color, geometry] = source.legs[0]!;
    const leg = new THREE.Mesh(geometry.clone(), unitHullMaterial(color)); leg.name = "leg";
    leg.position.set(x, 14, 0); leg.userData.baseY = 14;
    attach(leg, source.legs.slice(1), "commander-leg-detail"); parent.add(leg);
  }
}
