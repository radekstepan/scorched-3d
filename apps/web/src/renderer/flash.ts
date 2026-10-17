import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { UNIT_DEFS } from "@scorched-3d/core";
import { armor, Assembly } from "./vehicleGeometry";
import { unitHullMaterial } from "./unitFog";

// A fast, compact raider: swept track fairings and a low arrowhead turret.
// All fixed details are welded by finish within the three moving assemblies.
const PAINT = 0x487b9e;
const PANEL = 0x769bad;
const METAL = 0x64777e;
const DARK = 0x263438;
const MARK = 0xd7b85a;

function roadWheel(): THREE.BufferGeometry {
  const a = new Assembly(PAINT);
  for (const [r, w, color] of [[2.6, 1.25, 0x455157], [1.95, 1.45, 0x9babb1], [0.7, 1.6, 0xc4c8b2]] as const) {
    const g = new THREE.CylinderGeometry(r, r, w, 10); g.rotateZ(Math.PI / 2); a.add(g, color);
  }
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(1.5, 0.32, 1.25);
    g.translate(0, 1.15, 0); g.rotateX(i * Math.PI * 2 / 5); a.add(g, 0x54676d);
  }
  const parts = a.bake().map(([color, g]) => {
    const c = new THREE.Color(color), count = g.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3)); return g;
  });
  const g = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return g;
}

function design() {
  const hull = new Assembly(PAINT), turret = new Assembly(PAINT), gun = new Assembly(PAINT);
  hull.add(armor([[1.1, 9.3, 15.7, 1.7], [3.8, 12.8, 18, 2.2], [5.1, 13, 17.8, 2.4], [6.9, 9.5, 13.2, 2.2, -0.8]]), PAINT);
  hull.add(armor([[0.9, 8.7, 14.6, 1.5], [2, 10.5, 16, 1.6]]), UNIT_DEFS.flash.color);
  // Separate blade-like track guards taper to the bow and leave the wheels open.
  for (const side of [-1, 1]) {
    const guard = armor([[4.9, 2.7, 18, 1.15], [6, 2.9, 18.3, 1.2], [6.7, 2.1, 15.6, 0.85, -0.6]]);
    const positions = guard.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const sweep = (positions.getZ(i) + 9.15) / 18.3;
      positions.setX(i, positions.getX(i) * (1 - 0.18 * sweep) - side * 0.75 * sweep);
    }
    guard.computeVertexNormals();
    hull.add(guard, PANEL, side * 6.2);
    const shape = new THREE.Shape();
    shape.moveTo(-6, 0.25); shape.lineTo(6, 0.25); shape.lineTo(9.1, 2.5);
    shape.lineTo(9.1, 3.8); shape.lineTo(6.1, 5.7); shape.lineTo(-6.1, 5.7);
    shape.lineTo(-9.1, 3.8); shape.lineTo(-9.1, 2.5); shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-5.8, 1); hole.lineTo(-8.25, 2.8); hole.lineTo(-8.25, 3.5);
    hole.lineTo(-5.8, 4.95); hole.lineTo(5.8, 4.95); hole.lineTo(8.25, 3.5);
    hole.lineTo(8.25, 2.8); hole.lineTo(5.8, 1); hole.closePath(); shape.holes.push(hole);
    const belt = new THREE.ExtrudeGeometry(shape, {depth:1.55, bevelEnabled:false, steps:1, curveSegments:1});
    belt.rotateY(Math.PI / 2); hull.add(belt, DARK, side * 6.7 - 0.775);
    for (let z = -6; z <= 6; z += 1.5) hull.block(1.65, 0.24, 0.55, side * 6.7, 0.3, z, METAL);
    for (const end of [-1, 1]) for (let i = 0; i < 3; i++) {
      const g = new THREE.BoxGeometry(1.65, 0.22, 0.55); g.rotateX(end * 0.65);
      hull.add(g, METAL, side * 6.7, 0.9 + i * 0.62, end * (6.6 + i * 0.8));
    }
    for (const end of [-1, 1]) for (let i = 0; i < 3; i++) {
      const g = new THREE.BoxGeometry(1.65, 0.2, 0.5); g.rotateX(-end * 0.85);
      hull.add(g, METAL, side * 6.7, 4.1 + i * 0.45, end * (8.65 - i * 0.7));
    }
    // Recessed cooling cassettes and protected headlights follow the sponsons.
    hull.plate(1.7, 4, 6.5, 0.18, side * 5.9, -5.2, DARK);
    for (let z = -6.6; z < -3.7; z += 0.65) hull.block(1.45, 0.16, 0.25, side * 5.9, 6.76, z, METAL);
    hull.plate(1.25, 1.5, 6.15, 0.6, side * 4.1, 5.9, DARK);
    hull.block(0.8, 0.15, 0.95, side * 4.1, 6.82, 5.9, 0xb7d4d4);
    const stripe = new THREE.BoxGeometry(0.38, 0.045, 4.4);
    stripe.rotateY(-side * 0.04);
    hull.add(stripe, MARK, side * 5.65, 6.88, 1.2);
  }
  // Offset driver's access hatch sits clear of the turret's bow sweep.
  hull.plate(2.1, 1.7, 6.9, 0.18, -2.2, 4.5, DARK);
  hull.plate(1.75, 1.4, 7.08, 0.15, -2.2, 4.5, PANEL);
  hull.block(1.3, 0.15, 0.13, -2.2, 7.3, 5.2, DARK);
  hull.add(armor([[4.9, 8.3, 4.1, 1.1, 6.7], [6.5, 6.6, 3.1, 0.9, 5.3]]), PANEL);
  hull.plate(5.9, 2.6, 6.8, 0.25, 0, -6.2, DARK);
  for (let z = -7; z < -5.2; z += 0.45) hull.block(5, 0.15, 0.18, 0, 7.12, z, METAL);
  const race = new THREE.CylinderGeometry(3.7, 4, 0.5, 12); hull.add(race, DARK, 0, 7.1, -1);
  turret.add(armor([[7.35, 8.6, 9.4, 2.3, -1], [8.4, 9.1, 9.8, 2.7, -1], [10.7, 7.4, 7.2, 2.2, -1.7], [11.05, 7, 6.8, 2.1, -1.7]]), PAINT);
  for (const side of [-1, 1]) {
    turret.add(armor([[8.2, 1.6, 5.8, 0.65], [8.8, 1.8, 5.4, 0.75], [10.1, 1.05, 4.8, 0.5, -0.4]]), PANEL, side * 3.4, 0, 0.2);
    turret.plate(0.6, 2.4, 10.95, 0.2, side * 1.85, -1.9, MARK);
  }
  turret.plate(2.7, 2.8, 11.05, 0.3, -0.45, -2.2, DARK);
  turret.plate(2.3, 2.4, 11.35, 0.25, -0.45, -2.2, PANEL);
  turret.plate(1.3, 1.5, 10.95, 0.55, 1.5, 0.2, DARK);
  turret.block(0.85, 0.2, 0.12, 1.5, 11.35, 0.95, 0xb7d4d4);
  // The shrouded mantlet elevates with the existing (0,9.5,3) barrel pivot.
  turret.plate(3.2, 1.3, 8.1, 2.8, 0, 3, DARK);
  gun.add(armor([[-1.1, 2.6, 2.2, 0.4, 0.2], [1.1, 2.3, 2, 0.4, 0.2]]), METAL);
  for (const [r, length, z, color] of [[0.95, 3.6, 2.2, PANEL], [0.61, 8.8, 8.1, METAL], [0.85, 0.6, 4.25, MARK]] as const) {
    const g = new THREE.CylinderGeometry(r, r, length, 8); g.rotateX(Math.PI / 2); gun.add(g, color, 0, 0, z);
  }
  // Vented thermal jacket around the rapid-fire tube, clear of the mantlet.
  const jacket = new THREE.CylinderGeometry(0.8, 0.95, 4.3, 8);
  jacket.rotateX(Math.PI / 2); gun.add(jacket, PANEL, 0, 0, 6.7);
  for (const side of [-1, 1]) for (const z of [5.5, 6.5, 7.5])
    gun.block(0.045, 0.38, 0.55, side * 0.81, 0, z, DARK);
  // Open muzzle with an actual recessed bore, not a black decal on a cap.
  const muzzle = new THREE.Shape();
  muzzle.moveTo(-0.65, -0.8); muzzle.lineTo(0.65, -0.8); muzzle.lineTo(0.95, -0.5);
  muzzle.lineTo(0.95, 0.4); muzzle.lineTo(0.65, 0.7); muzzle.lineTo(-0.65, 0.7);
  muzzle.lineTo(-0.95, 0.4); muzzle.lineTo(-0.95, -0.5); muzzle.closePath();
  const bore = new THREE.Path(); bore.moveTo(-0.48, -0.3); bore.lineTo(-0.48, 0.3);
  bore.lineTo(0.48, 0.3); bore.lineTo(0.48, -0.3); bore.closePath(); muzzle.holes.push(bore);
  gun.add(new THREE.ExtrudeGeometry(muzzle, {depth:2.14, bevelEnabled:true,
    bevelThickness:0.08, bevelSize:0.08, bevelSegments:1, steps:1}), METAL, 0, 0, 11.78);
  gun.block(1, 0.65, 0.04, 0, 0, 11.74, DARK);
  for (const side of [-1, 1]) for (const z of [12.35, 13.15]) gun.block(0.035, 0.55, 0.35, side * 0.92, -0.1, z, DARK);
  return {hull:hull.bake(), turret:turret.bake(), gun:gun.bake(), wheel:roadWheel()};
}
let template: ReturnType<typeof design> | undefined;

export function buildFlash(parent: THREE.Group, turret: THREE.Group): void {
  const source = template ??= design();
  const attach = (target: THREE.Group, parts: [number, THREE.BufferGeometry][], name: string) => {
    for (const [color, geometry] of parts) {
      const mesh = new THREE.Mesh(geometry.clone(), unitHullMaterial(color)); mesh.name = name;
      mesh.userData.noCamo = color !== PAINT && color !== PANEL && color !== UNIT_DEFS.flash.color;
      target.add(mesh);
    }
  };
  attach(parent, source.hull, "flash-hull"); attach(turret, source.turret, "flash-turret");
  const pivot = new THREE.Group(); pivot.name = "barrel"; pivot.position.set(0, 9.5, 3); pivot.rotation.x = -0.03;
  attach(pivot, source.gun, "flash-gun");
  const tip = new THREE.Object3D(); tip.name = "tip"; tip.position.z = 14; pivot.add(tip); turret.add(pivot);
  for (const x of [-6.9, 6.9]) for (const z of [-5.8, 0, 5.8]) {
    const material = unitHullMaterial(0x87949a); material.vertexColors = true;
    const wheel = new THREE.Mesh(source.wheel.clone(), material); wheel.name = "wheel";
    wheel.position.set(x, 2.95, z); parent.add(wheel);
  }
}
