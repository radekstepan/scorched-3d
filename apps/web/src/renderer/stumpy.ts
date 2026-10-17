import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { armor, Assembly } from "./vehicleGeometry";
import { UNIT_DEFS } from "@scorched-3d/core";
import { unitHullMaterial } from "./unitFog";

// Stumpy's fixed parts are welded by finish, separately for each moving assembly.
// Geometry templates are baked once; each body owns disposable copies and materials
// so damage, wreck charring and the renderer's existing cleanup remain independent.
const PAINT = 0x8a9870;
const EDGE = 0xa4ae87;
const STEEL = 0x69736a;
const DARK = 0x303b38;

function wheelGeometry(): THREE.BufferGeometry {
  const a = new Assembly(PAINT);
  const cylinder = (r: number, w: number, x: number, color: number) => {
    const g = new THREE.CylinderGeometry(r, r, w, 12);
    g.rotateZ(Math.PI / 2);
    a.add(g, color, x);
  };
  cylinder(3.45, 1.5, 0, 0x48504a);
  cylinder(2.55, 1.8, 0, 0x87947c);
  // Raised hubs and three spokes create a readable rotation cue. One draw/wheel.
  cylinder(0.85, 2.1, 0, 0xc1c9ac);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.BoxGeometry(2.02, 0.38, 1.7);
    g.translate(0, 1.5, 0);
    g.rotateX(i * Math.PI / 3);
    a.add(g, 0xb0b99e);
  }
  const parts = a.bake().map(([color, geo]) => {
    const c = new THREE.Color(color), colors: number[] = [];
    for (let i = 0; i < geo.getAttribute("position").count; i++) colors.push(c.r, c.g, c.b);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  });
  const geo = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return geo;
}

function design() {
  const hull = new Assembly(PAINT), turret = new Assembly(PAINT), gun = new Assembly(PAINT);
  hull.add(armor([[1.4, 13, 22, 2], [4, 17.8, 26, 2.6], [5.8, 18, 25.8, 2.3], [9, 14, 19.5, 2.4, -1.8]]), PAINT);
  hull.add(armor([[1.1, 13, 22, 2], [2.1, 16, 24.6, 2]]), UNIT_DEFS.stump.color);
  // Armored sponsons follow the track envelope; the slit below exposes the wheels.
  for (const s of [-1, 1]) {
    hull.add(armor([[6.5, 3.8, 25.8, 1.8], [7.6, 4, 26.8, 1.7], [8.5, 3.2, 24.8, 1.3]]), PAINT, s * 8.25);
    for (const z of [-8.4, -2.8, 2.8, 8.4]) hull.plate(0.55, 4.8, 7.8, 0.75, s * 9.75, z, EDGE);
    // Continuous stadium-shaped tread belt, including its inside opening.
    const shape = new THREE.Shape();
    shape.moveTo(-9, 0.35); shape.lineTo(9, 0.35); shape.lineTo(12.8, 2.9);
    shape.lineTo(12.8, 5); shape.lineTo(9.4, 7.4); shape.lineTo(-9.4, 7.4);
    shape.lineTo(-12.8, 5); shape.lineTo(-12.8, 2.9); shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-8.8, 1.45); hole.lineTo(-11.5, 3.4); hole.lineTo(-11.5, 4.6);
    hole.lineTo(-8.8, 6.3); hole.lineTo(8.8, 6.3); hole.lineTo(11.5, 4.6);
    hole.lineTo(11.5, 3.4); hole.lineTo(8.8, 1.45); hole.closePath();
    shape.holes.push(hole);
    const belt = new THREE.ExtrudeGeometry(shape, { depth: 2.5, bevelEnabled: false, steps: 1, curveSegments: 1 });
    belt.rotateY(Math.PI / 2);
    hull.add(belt, DARK, s * 9.05 - 1.25, 0, 0);
    for (let z = -9; z <= 9; z += 1.5) {
      hull.block(2.65, 0.3, 0.7, s * 9.05, 0.45, z, STEEL);
      hull.block(2.65, 0.25, 0.65, s * 9.05, 7.3, z, STEEL);
    }
    for (const end of [-1, 1]) for (let i = 0; i < 4; i++) {
      const g = new THREE.BoxGeometry(2.65, 0.32, 0.65);
      g.rotateX(end * 0.65);
      hull.add(g, STEEL, s * 9.05, 1.1 + i * 0.58, end * (9.7 + i * 0.72));
    }
    // End sprockets, suspension links and exhaust shields are fixed to the hull.
    for (const z of [-10, 10]) {
      const g = new THREE.CylinderGeometry(2.15, 2.15, 1.9, 10); g.rotateZ(Math.PI / 2);
      hull.add(g, STEEL, s * 9.05, 3.8, z);
    }
    hull.plate(2, 4.8, 7.65, 0.7, s * 6.5, -9, STEEL);
    for (let z = -10.5; z < -7.5; z += 0.7) hull.block(1.5, 0.15, 0.26, s * 6.5, 8.4, z, DARK);
    hull.block(0.65, 0.65, 2.3, s * 6.7, 9.05, 7.3, DARK);
    hull.block(0.5, 0.42, 1.4, s * 6.7, 9.4, 7.3, 0xc6cfaa);
  }
  // Bow applique follows the glacis rather than covering it with a square slab.
  hull.add(armor([[6.9, 12.3, 5.4, 1.2, 9.4], [8.3, 10.7, 4.5, 1, 8.5]]), EDGE);
  hull.plate(9, 4, 8.7, 0.4, 0, -9.2, STEEL);
  for (let z = -10.6; z < -7.7; z += 0.55) hull.block(7.5, 0.18, 0.22, 0, 9.2, z, DARK);
  const ring = new THREE.CylinderGeometry(5.5, 5.8, 0.8, 16);
  hull.add(ring, DARK, 0, 9.2, -2);
  turret.add(armor([[9.6, 12.2, 13.8, 2.7, -2], [11.3, 13, 14.3, 2.8, -2], [14.8, 10.3, 10.6, 2.4, -2.8], [15.2, 9.6, 10, 2.2, -2.8]]), PAINT);
  for (const s of [-1, 1]) {
    turret.add(armor([[11, 3.3, 7.6, 1.1], [12, 3.8, 7.4, 1.2], [14.5, 2.5, 5.8, 1]]), EDGE, s * 4.7, 0, -0.2);
    turret.plate(1.6, 3.4, 14.3, 0.8, s * 3.3, -4.5, STEEL);
  }
  // Split dorsal armor leaves a purposeful recessed service channel.
  for (const s of [-1, 1]) turret.plate(1.5, 5.4, 15.05, 0.3, s * 3.1, -2, EDGE);
  // Small painted recognition bars on the dorsal panels read at RTS distance.
  for (const s of [-1, 1]) {
    turret.block(0.85, 0.06, 1.8, s * 3.1, 15.42, -1, 0xc6cfaa);
    hull.plate(1.2, 1.8, 3.9, 0.65, s * 5.1, 12.2, STEEL);
    // Recessed panel division across the cheek follows the armor slope.
    turret.block(0.07, 0.38, 3.1, s * 6.42, 11.55, -0.2, DARK);
  }
  turret.plate(4.1, 4, 15.2, 0.55, -0.8, -3.5, DARK);
  turret.plate(3.6, 3.5, 15.65, 0.45, -0.8, -3.5, EDGE);
  turret.plate(2, 2.6, 15.1, 0.75, 2.6, -1.7, STEEL);
  turret.block(1.45, 0.48, 0.15, 2.6, 15.6, -0.32, 0x85b7bc);
  turret.plate(5.1, 1.5, 11, 3, 0, 4.15, DARK);
  // Everything below uses the original (0,12.5,4) trunnion frame, length 22.
  gun.add(armor([[-1.65, 4.1, 3.4, 0.7, 0.2], [1.65, 3.6, 3.2, 0.6, 0.2]]), STEEL);
  for (const [r, length, z, color] of [[1.25, 5, 3, PAINT], [0.83, 14.7, 11.5, STEEL], [1.1, 0.65, 6, EDGE], [1, 0.7, 15.5, EDGE]] as const) {
    const g = new THREE.CylinderGeometry(r, r, length, 8); g.rotateX(Math.PI / 2);
    gun.add(g, color, 0, 0, z);
  }
  gun.add(armor([[-1.15, 2.6, 3.5, 0.45, 20.25], [0.95, 2.9, 3.5, 0.45, 20.25]]), PAINT);
  gun.block(1.65, 1.05, 0.05, 0, 0, 22.01, DARK);
  for (const s of [-1, 1]) for (const z of [19.6, 20.65]) gun.block(0.06, 0.85, 0.48, s * 1.4, 0, z, DARK);
  return { hull: hull.bake(), turret: turret.bake(), gun: gun.bake(), wheel: wheelGeometry() };
}
let template: ReturnType<typeof design> | undefined;

export function buildStumpy(parent: THREE.Group, turret: THREE.Group): void {
  const source = template ??= design();
  const attach = (target: THREE.Group, parts: [number, THREE.BufferGeometry][], name: string) => {
    for (const [color, geometry] of parts) {
      const mesh = new THREE.Mesh(geometry.clone(), unitHullMaterial(color));
      mesh.name = name;
      mesh.userData.noCamo = color !== PAINT && color !== EDGE && color !== UNIT_DEFS.stump.color;
      target.add(mesh);
    }
  };
  attach(parent, source.hull, "stumpy-hull");
  attach(turret, source.turret, "stumpy-turret");
  const pivot = new THREE.Group(); pivot.name = "barrel";
  pivot.position.set(0, 12.5, 4); pivot.rotation.x = -0.05;
  attach(pivot, source.gun, "stumpy-gun");
  const tip = new THREE.Object3D(); tip.name = "tip"; tip.position.z = 22;
  pivot.add(tip); turret.add(pivot);
  for (const x of [-9.4, 9.4]) for (const z of [-6.8, 0, 6.8]) {
    const wheel = new THREE.Mesh(source.wheel.clone(), unitHullMaterial(0x657065));
    wheel.material.vertexColors = true;
    wheel.name = "wheel"; wheel.position.set(x, 3.85, z); parent.add(wheel);
  }
}
