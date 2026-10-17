import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { UNIT_DEFS } from "@scorched-3d/core";
import { armor, Assembly } from "./vehicleGeometry";
import { unitHullMaterial } from "./unitFog";
import type { TeamLivery } from "./teamPaint";

// Hammer is a mobile howitzer, with a split armored cradle rather than a tank
// turret wrapped around the gun. Buffers and breech elevate with the barrel.
const PAINT = 0x68747c;
const PANEL = 0x939c9c;
const DARK = 0x293337;
const ORANGE = UNIT_DEFS.hammer.accent;

function wheelGeometry(): THREE.BufferGeometry {
  const a = new Assembly(PAINT);
  for (const [radius, width, color] of [[3.5, 1.5, 0x455055], [2.65, 1.7, 0x9ba5a5], [0.95, 1.9, 0xe2be78]] as const) {
    const g = new THREE.CylinderGeometry(radius, radius, width, 12);
    g.rotateZ(Math.PI / 2); a.add(g, color);
  }
  for (let i = 0; i < 6; i++) {
    const g = new THREE.BoxGeometry(1.82, 0.48, 1.55);
    g.translate(0, 1.65, 0); g.rotateX(i * Math.PI / 3); a.add(g, 0x56686d);
  }
  const parts = a.bake().map(([color, g]) => {
    const c = new THREE.Color(color), data = new Float32Array(g.getAttribute("position").count * 3);
    for (let i = 0; i < data.length; i += 3) data.set([c.r, c.g, c.b], i);
    g.setAttribute("color", new THREE.BufferAttribute(data, 3)); return g;
  });
  const geometry = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return geometry;
}

function design() {
  const hull = new Assembly(PAINT), turret = new Assembly(PAINT), gun = new Assembly(PAINT);
  hull.add(armor([[1.2, 11.6, 20.7, 2], [3.8, 15.7, 24, 2.4], [6.3, 16, 23.8, 2.5], [8.8, 12.5, 18.9, 2.3, -0.8]]), PAINT);
  hull.add(armor([[0.9, 10.8, 20, 1.8], [2.3, 13.4, 22, 2]]), UNIT_DEFS.hammer.color);
  for (const side of [-1, 1]) {
    // Thick sponsons protect the running gear without hiding its open sides.
    for (const side of [-1, 1]) {
    hull.plate(1.7, 6.7, 8.65, 0.38, side * 3.8, 4.2, DARK);
    hull.plate(1.25, 6.2, 9.03, 0.28, side * 3.8, 4.2, PAINT);
    hull.block(0.7, 0.045, 1.9, side * 3.8, 9.34, 4.8, ORANGE);
  }
  hull.plate(2.65, 2.4, 8.8, 0.22, -1.4, 5.6, DARK);
  hull.plate(2.25, 2, 9.02, 0.2, -1.4, 5.6, PAINT);
  hull.block(1.65, 0.18, 0.13, -1.4, 9.35, 6.6, DARK);
  hull.add(armor([[6.2, 3.1, 24.2, 1.3], [7.3, 3.2, 24.8, 1.4], [8.15, 2.7, 22.4, 1.1]]), PAINT, side * 7.5);
    for (const z of [-7.8, 0, 7.8]) hull.plate(0.6, 6, 7.6, 0.7, side * 8.5, z, PANEL);
    const shape = new THREE.Shape();
    shape.moveTo(-8, 0.3); shape.lineTo(8, 0.3); shape.lineTo(12, 2.8);
    shape.lineTo(12, 4.9); shape.lineTo(8.3, 7.4); shape.lineTo(-8.3, 7.4);
    shape.lineTo(-12, 4.9); shape.lineTo(-12, 2.8); shape.closePath();
    const opening = new THREE.Path();
    opening.moveTo(-7.7, 1.3); opening.lineTo(-10.9, 3.3); opening.lineTo(-10.9, 4.4);
    opening.lineTo(-7.9, 6.35); opening.lineTo(7.9, 6.35); opening.lineTo(10.9, 4.4);
    opening.lineTo(10.9, 3.3); opening.lineTo(7.7, 1.3); opening.closePath(); shape.holes.push(opening);
    const belt = new THREE.ExtrudeGeometry(shape, {depth:2.15, bevelEnabled:false, steps:1, curveSegments:1});
    belt.rotateY(Math.PI / 2); hull.add(belt, DARK, side * 8.1 - 1.075);
    for (let z = -8; z <= 8; z += 1.6) hull.block(2.3, 0.25, 0.65, side * 8.1, 0.35, z, PANEL);
    for (const end of [-1, 1]) for (let i = 0; i < 4; i++) {
      const lower = new THREE.BoxGeometry(2.3, 0.23, 0.55); lower.rotateX(end * 0.55);
      hull.add(lower, PANEL, side * 8.1, 1.05 + i * 0.5, end * (8.8 + i * 0.8));
      const upper = new THREE.BoxGeometry(2.3, 0.23, 0.55); upper.rotateX(-end * 0.65);
      hull.add(upper, PANEL, side * 8.1, 4.9 + i * 0.5, end * (11.7 - i * 0.8));
    }
    // Paired engine cooling decks and shielded rear exhaust outlets.
    hull.plate(2, 4.9, 7.85, 0.4, side * 5.8, -8.4, DARK);
    for (let z = -10; z < -6.5; z += 0.65) hull.block(1.6, 0.16, 0.25, side * 5.8, 8.4, z, PANEL);
    hull.plate(2.1, 2.3, 4.8, 1.9, side * 5.5, -10.8, PAINT);
    hull.block(1.45, 0.75, 0.05, side * 5.5, 5.85, -11.98, DARK);
    hull.plate(1.2, 1.6, 7.6, 0.65, side * 5.3, 6.9, DARK);
    hull.block(0.8, 0.15, 0.85, side * 5.3, 8.3, 6.9, 0x94bdc4);
  }
  for (const side of [-1, 1]) {
    hull.plate(1.7, 6.7, 8.65, 0.38, side * 3.8, 4.2, DARK);
    hull.plate(1.25, 6.2, 9.03, 0.28, side * 3.8, 4.2, PAINT);
    hull.block(0.7, 0.045, 1.9, side * 3.8, 9.34, 4.8, ORANGE);
  }
  hull.plate(2.65, 2.4, 8.8, 0.22, -1.4, 5.6, DARK);
  hull.plate(2.25, 2, 9.02, 0.2, -1.4, 5.6, PAINT);
  hull.block(1.65, 0.18, 0.13, -1.4, 9.35, 6.6, DARK);
  hull.add(armor([[6.2, 11.2, 4.6, 1.2, 8.8], [8, 8.9, 3.6, 1.1, 7.2]]), PANEL);
  hull.plate(5.2, 3, 8.4, 0.3, 0, -8.5, DARK);
  for (let z = -9.4; z < -7.5; z += 0.5) hull.block(4.6, 0.16, 0.22, 0, 8.82, z, PANEL);
  const race = new THREE.CylinderGeometry(5, 5.4, 0.8, 16); hull.add(race, DARK, 0, 9, -2);
  // Rear ammunition bustle anchors two separated cheek shields around the gun.
  turret.add(armor([[9.4, 9.6, 9.2, 1.6, -3], [10.7, 10.1, 9.4, 1.8, -3], [14.4, 7.9, 7.3, 1.8, -3.7], [14.8, 7.3, 6.8, 1.7, -3.7]]), PAINT);
  for (const side of [-1, 1]) {
    turret.add(armor([[10, 2.5, 8.5, 1, -0.5], [12, 3, 8.2, 1.1, -0.5], [15.6, 2, 5.9, 0.8, -1.6]]), ORANGE, side * 3.6);
    turret.plate(1.1, 4.1, 15.58, 0.24, side * 3.6, -1.6, PANEL);
    const axle = new THREE.CylinderGeometry(1.45, 1.45, 3.1, 12); axle.rotateZ(Math.PI / 2);
    turret.add(axle, DARK, side * 3.6, 13, 0);
    const cap = new THREE.CylinderGeometry(0.85, 0.85, 0.15, 10); cap.rotateZ(Math.PI / 2);
    turret.add(cap, PANEL, side * 5.18, 13, 0);
  }
  // Rear access follows the bustle's sloped surface, with a recessed split seam.
  turret.add(armor([[11.25, 5.8, 0.24, 0.09, -7.76], [13.75, 4.8, 0.24, 0.09, -7.52]]), DARK);
  turret.add(armor([[11.5, 5.3, 0.13, 0.05, -7.85], [13.5, 4.5, 0.13, 0.05, -7.62]]), PAINT);
  turret.block(4.5, 0.1, 0.06, 0, 12.45, -7.84, DARK);
  turret.plate(3.2, 3, 14.8, 0.25, 0, -4.7, DARK);
  turret.plate(2.7, 2.5, 15.05, 0.35, 0, -4.7, PANEL);
  turret.plate(1.7, 2.1, 14.4, 0.8, -2, -2.6, DARK);
  turret.block(1.15, 0.25, 0.1, -2, 15.05, -1.5, 0x94bdc4);
  // Gun assembly in the original (0,13,0) trunnion frame, +Z along the bore.
  gun.add(armor([[-1.65, 4.4, 7.4, 0.9, -0.3], [1.6, 3.7, 6.6, 0.8, -0.6]]), DARK);
  for (const [radius, length, z, color] of [[1.13, 21.8, 17, PAINT], [1.6, 1.1, 9.2, PANEL], [1.4, 0.8, 23.8, PANEL]] as const) {
    const g = new THREE.CylinderGeometry(radius, radius * 1.06, length, 10); g.rotateX(Math.PI / 2);
    gun.add(g, color, 0, 0, z);
  }
  const jacket = armor([[0, 3.6, 3.1, 0.7], [1.1, 4.1, 3.5, 0.8], [7.8, 3.15, 2.65, 0.6]]);
  jacket.rotateX(Math.PI / 2); gun.add(jacket, ORANGE);
  // Two recoil buffers share the elevating carriage; no fake fixed pistons.
  for (const side of [-1, 1]) {
    const casing = new THREE.CylinderGeometry(0.55, 0.65, 6.4, 8); casing.rotateX(Math.PI / 2);
    gun.add(casing, PANEL, side * 1.65, -1.85, 3.2);
    const rod = new THREE.CylinderGeometry(0.29, 0.29, 3.2, 8); rod.rotateX(Math.PI / 2);
    gun.add(rod, DARK, side * 1.65, -1.85, 7.4);
  }
  // Cast brake with a through-bore and a dark throat recessed behind the face.
  const muzzle = new THREE.Shape();
  muzzle.moveTo(-1.3, -1.3); muzzle.lineTo(1.3, -1.3); muzzle.lineTo(1.8, -0.8);
  muzzle.lineTo(1.8, 0.75); muzzle.lineTo(1.3, 1.25); muzzle.lineTo(-1.3, 1.25);
  muzzle.lineTo(-1.8, 0.75); muzzle.lineTo(-1.8, -0.8); muzzle.closePath();
  const bore = new THREE.Path(); bore.moveTo(-1, -0.6); bore.lineTo(-1, 0.6);
  bore.lineTo(1, 0.6); bore.lineTo(1, -0.6); bore.closePath(); muzzle.holes.push(bore);
  gun.add(new THREE.ExtrudeGeometry(muzzle, {depth:3.88, bevelEnabled:true,
    bevelThickness:0.12, bevelSize:0.12, bevelSegments:1, steps:1}), ORANGE, 0, 0, 28);
  gun.block(2.2, 1.4, 0.04, 0, 0, 27.87, DARK);
  for (const side of [-1, 1]) for (const z of [28.9, 30, 31.1])
    gun.block(0.04, 1.05, 0.55, side * 1.93, 0, z, DARK);
  return {hull:hull.bake(), turret:turret.bake(), gun:gun.bake(), wheel:wheelGeometry()};
}
let template: ReturnType<typeof design> | undefined;

export function buildHammer(parent: THREE.Group, turret: THREE.Group, livery?: TeamLivery): void {
  const source = template ??= design();
  // Team paint remaps the paint-family finishes (dominant paint, light
  // plates, and the darker lower strake, which joins the main paint) at
  // attach time; the baked geometry template is shared across teams. The
  // orange breech accent stays functional on both sides.
  const paint = livery?.paint ?? PAINT;
  const panel = livery?.panel ?? PANEL;
  const remap = (color: number): number => {
    // Neutral builds keep every kind finish byte-identical (the lower
    // strake only joins the main paint under a team livery).
    if (!livery) return color;
    if (color === PAINT) return paint;
    if (color === PANEL) return panel;
    if (color === UNIT_DEFS.hammer.color) return paint;
    return color;
  };
  const attach = (target: THREE.Group, parts: [number, THREE.BufferGeometry][], name: string) => {
    for (const [color, geometry] of parts) {
      const mesh = new THREE.Mesh(geometry.clone(), unitHullMaterial(remap(color))); mesh.name = name;
      mesh.userData.noCamo = color !== PAINT && color !== ORANGE && color !== UNIT_DEFS.hammer.color;
      target.add(mesh);
    }
  };
  attach(parent, source.hull, "hammer-hull"); attach(turret, source.turret, "hammer-turret");
  const pivot = new THREE.Group(); pivot.name = "barrel"; pivot.position.set(0, 13, 0); pivot.rotation.x = -Math.PI / 4.5;
  attach(pivot, source.gun, "hammer-gun");
  const tip = new THREE.Object3D(); tip.name = "tip"; tip.position.z = 32; pivot.add(tip); turret.add(pivot);
  for (const x of [-8.4, 8.4]) for (const z of [-7, 0, 7]) {
    const material = unitHullMaterial(0x929c9f); material.vertexColors = true;
    const wheel = new THREE.Mesh(source.wheel.clone(), material); wheel.name = "wheel";
    wheel.position.set(x, 3.9, z); parent.add(wheel);
  }
}
