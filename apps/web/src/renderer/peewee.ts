import * as THREE from "three";
import { UNIT_DEFS } from "@scorched-3d/core";
import { armor, Assembly } from "./vehicleGeometry";
import { unitHullMaterial } from "./unitFog";
import type { TeamLivery } from "./teamPaint";

const PAINT = UNIT_DEFS.peewee.color;
const PANEL = 0xd0c29a;
const DARK = 0x303d43;
const METAL = 0x78888b;
const OPTIC = 0x92cece;
type Point = [number, number, number];

/** Tapered limb armor aligned between actual mechanical joint positions. */
function link(a: Assembly, from: Point, to: Point, width: number, depth: number, color: number): void {
  const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
  const direction = end.sub(start), length = direction.length();
  const c = Math.min(width, depth) * 0.2;
  const g = armor([[0, width, depth, c], [length * 0.17, width * 1.08, depth, c],
    [length, width * 0.75, depth * 0.8, c * 0.8]]);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  a.add(g, color, ...from);
}

function legDesign() {
  const leg = new Assembly(PAINT);
  // Coordinates relative to the unchanged hip at (±2.5,5,0). The leg mesh
  // itself remains a direct body child so existing gait and settling own it.
  link(leg, [0, -0.1, 0], [0, -2.25, 0.55], 1.6, 1.65, PAINT);
  link(leg, [0, -2.25, 0.55], [0, -4.25, -0.15], 1.85, 1.5, PANEL);
  link(leg, [0, -2.7, 1.05], [0, -3.85, 0.55], 0.9, 0.3, PAINT);
  for (const [y, z, radius] of [[-0.2, 0, 0.75], [-2.2, 0.5, 0.78], [-4.15, -0.1, 0.5]] as const) {
    const joint = new THREE.CylinderGeometry(radius, radius, 2, 10);
    joint.rotateZ(Math.PI / 2); leg.add(joint, DARK, 0, y, z);
    const hub = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, 2.08, 8);
    hub.rotateZ(Math.PI / 2); leg.add(hub, METAL, 0, y, z);
  }
  leg.add(armor([[-5, 2.65, 3.75, 0.5, 0.35], [-4.55, 2.7, 3.85, 0.5, 0.35],
    [-4.15, 2.1, 2.8, 0.4, 0.2]]), PAINT);
  leg.add(armor([[-4.98, 2.7, 3.8, 0.5, 0.35], [-4.8, 2.75, 3.85, 0.5, 0.35]]), DARK);
  leg.block(1.8, 0.13, 0.06, 0, -4.6, 2.29, DARK);
  return leg.bake();
}

function design() {
  const torso = new Assembly(PAINT), gun = new Assembly(PAINT);
  const pelvis = new THREE.CylinderGeometry(2.1, 2.35, 0.9, 10);
  torso.add(pelvis, DARK, 0, 5.55, -0.1);
  torso.add(armor([[5.8, 4.7, 3.8, 0.8, -0.25], [7.3, 6.9, 5.3, 1.1, -0.45],
    [9.15, 6.5, 4.8, 1.1, -0.6], [9.7, 5.1, 3.9, 0.9, -0.65]]), PAINT);
  // Chest plate slopes into a narrow waist, rather than a tank turret on legs.
  torso.add(armor([[6.9, 3.7, 1.2, 0.35, 2], [8.8, 4.9, 1.35, 0.45, 1.8],
    [9.2, 4.1, 0.9, 0.3, 1.65]]), PANEL);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.CylinderGeometry(0.9, 0.9, 1.1, 10);
    shoulder.rotateZ(Math.PI / 2); torso.add(shoulder, DARK, side * 3.35, 8.4, -0.1);
    torso.add(armor([[8, 1.65, 3.3, 0.5], [9.05, 1.95, 3.6, 0.6], [9.75, 1.45, 2.6, 0.45]]), PANEL, side * 3.4, 0, -0.3);
    torso.block(0.43, 0.045, 1.3, side * 3.4, 9.78, -0.35, DARK);
    link(torso, [side * 3.4, 8.4, 0], [side * 3.35, 6.5, 1.05], 1.2, 1.35, PAINT);
    const elbow = new THREE.CylinderGeometry(0.62, 0.62, 1.4, 8);
    elbow.rotateZ(Math.PI / 2); torso.add(elbow, DARK, side * 3.35, 6.5, 1.05);
    link(torso, [side * 3.35, 6.5, 1.05], [side * 1.65, 7.35, 3.1], 1.15, 1.2, METAL);
    torso.plate(1.1, 1.5, 7, 0.8, side * 1.65, 3.1, DARK);
    // Two compact cooling packs on the back; no decorative shoulder stacks.
    torso.plate(1.65, 2.1, 7.2, 1.7, side * 1.7, -2.2, DARK);
    for (let y = 7.7; y < 8.7; y += 0.35) torso.block(1.15, 0.13, 0.2, side * 1.7, y, -3.3, METAL);
  }
  torso.add(armor([[7.2, 1.2, 0.25, 0.09, -3.1], [8.9, 1.7, 0.25, 0.09, -3]]), DARK);
  torso.add(armor([[7.4, 0.55, 0.25, 0.08, -3.25], [8.65, 0.8, 0.25, 0.08, -3.22]]), METAL);
  const neck = new THREE.CylinderGeometry(0.85, 1.15, 0.65, 8);
  torso.add(neck, DARK, 0, 9.85, -0.4);
  torso.add(armor([[10.05, 2.9, 2.7, 0.65, -0.3], [11.55, 3.5, 3, 0.7, -0.3],
    [12.35, 2.5, 2.35, 0.6, -0.65]]), PAINT);
  torso.add(armor([[10.65, 2.65, 0.7, 0.2, 1.3], [11.25, 3.15, 0.65, 0.2, 1.4],
    [11.65, 2.85, 0.55, 0.2, 1.3]]), DARK);
  torso.block(2.15, 0.22, 0.08, 0, 11.3, 1.75, OPTIC);
  torso.add(armor([[11.58, 3.3, 1.1, 0.3, 1.2], [11.94, 3.05, 0.9, 0.25, 1.05]]), PANEL);
  torso.plate(1.4, 1.3, 12.15, 0.22, 0, -0.6, PANEL);
  // The receiver pumps inside a fixed hand support. The complete weapon stays
  // under the existing elevating barrel pivot, preserving the live muzzle FX.
  gun.add(armor([[-0.6, 1.5, 5.1, 0.3, 2.4], [0.6, 1.65, 4.9, 0.35, 2.3]]), DARK);
  gun.add(armor([[0.3, 1.7, 4.2, 0.35, 2.2], [0.8, 1.3, 3.7, 0.3, 2.1]]), PAINT);
  const tube = new THREE.CylinderGeometry(0.43, 0.55, 5, 8); tube.rotateX(Math.PI / 2);
  gun.add(tube, METAL, 0, 0, 7.1);
  for (const z of [5, 7.8]) {
    const collar = new THREE.CylinderGeometry(0.64, 0.64, 0.4, 8); collar.rotateX(Math.PI / 2);
    gun.add(collar, DARK, 0, 0, z);
  }
  const sleeve = new THREE.CylinderGeometry(0.62, 0.68, 2.2, 8); sleeve.rotateX(Math.PI / 2);
  gun.add(sleeve, PAINT, 0, 0, 6.2);
  for (const side of [-1, 1]) for (const z of [5.7, 6.4, 7.1])
    gun.block(0.035, 0.25, 0.25, side * 0.65, 0, z, DARK);
  const muzzle = new THREE.Shape();
  muzzle.moveTo(-0.4, -0.5); muzzle.lineTo(0.4, -0.5); muzzle.lineTo(0.6, -0.3);
  muzzle.lineTo(0.6, 0.3); muzzle.lineTo(0.4, 0.5); muzzle.lineTo(-0.4, 0.5);
  muzzle.lineTo(-0.6, 0.3); muzzle.lineTo(-0.6, -0.3); muzzle.closePath();
  const bore = new THREE.Path(); bore.absarc(0, 0, 0.26, 0, Math.PI * 2, true); muzzle.holes.push(bore);
  gun.add(new THREE.ExtrudeGeometry(muzzle, {depth:1.3, bevelEnabled:true,
    bevelThickness:0.04, bevelSize:0.04, bevelSegments:1, steps:1, curveSegments:3}), DARK, 0, 0, 8.66);
  gun.block(0.6, 0.6, 0.025, 0, 0, 8.6, DARK);
  return {torso:torso.bake(), gun:gun.bake(), legs:legDesign()};
}
let template: ReturnType<typeof design> | undefined;

export function buildPeewee(parent: THREE.Group, turret: THREE.Group, livery?: TeamLivery): void {
  const source = template ??= design();
  // Team paint remaps the paint-family finishes at material time; the baked
  // geometry template is shared across teams.
  const paint = livery?.paint ?? PAINT;
  const panel = livery?.panel ?? PANEL;
  const remap = (color: number): number => {
    if (color === PAINT) return paint;
    if (color === PANEL) return panel;
    return color;
  };
  const material = (color: number) => unitHullMaterial(remap(color));
  const attach = (target: THREE.Object3D, parts: [number, THREE.BufferGeometry][], name: string) => {
    for (const [color, geometry] of parts) {
      const mesh = new THREE.Mesh(geometry.clone(), material(color)); mesh.name = name;
      mesh.userData.noCamo = color !== PAINT && color !== PANEL;
      target.add(mesh);
    }
  };
  attach(turret, source.torso, "peewee-torso");
  const pivot = new THREE.Group(); pivot.name = "barrel"; pivot.position.set(0, 8, 2); pivot.rotation.x = -0.04;
  attach(pivot, source.gun, "peewee-gun");
  const tip = new THREE.Object3D(); tip.name = "tip"; tip.position.z = 10; pivot.add(tip); turret.add(pivot);
  for (const x of [-2.5, 2.5]) {
    const [color, geometry] = source.legs[0]!;
    const leg = new THREE.Mesh(geometry.clone(), material(color)); leg.name = "leg";
    leg.position.set(x, 5, 0); leg.userData.baseY = 5;
    attach(leg, source.legs.slice(1), "peewee-leg-detail"); parent.add(leg);
  }
}
