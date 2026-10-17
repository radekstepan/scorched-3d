import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type Ring = [y: number, width: number, depth: number, corner: number, z?: number];

/** Loft matching chamfered eight-sided rings: real sloping faces, flat normals,
 * and planar UVs for the existing subtle paint texture. +Z is the bow. */
export function armor(rings: Ring[]): THREE.BufferGeometry {
  const p: number[] = [], indices: number[] = [];
  for (const [y, w, d, c, z = 0] of rings) {
    for (const [x, dz] of [[-w / 2 + c, -d / 2], [w / 2 - c, -d / 2],
      [w / 2, -d / 2 + c], [w / 2, d / 2 - c], [w / 2 - c, d / 2],
      [-w / 2 + c, d / 2], [-w / 2, d / 2 - c], [-w / 2, -d / 2 + c]]) p.push(x!, y, dz! + z);
  }
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < 8; i++) {
    const a = r * 8 + i, b = r * 8 + (i + 1) % 8;
    indices.push(a, a + 8, b + 8, a, b + 8, b);
  }
  for (let i = 1; i < 7; i++) {
    indices.push(0, i, i + 1);
    const t = (rings.length - 1) * 8;
    indices.push(t, t + i + 1, t + i);
  }
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  indexed.setIndex(indices);
  const geo = indexed.toNonIndexed();
  indexed.dispose();
  geo.computeVertexNormals();
  const pos = geo.getAttribute("position"), uv: number[] = [];
  for (let i = 0; i < pos.count; i++) uv.push(pos.getX(i) / 24 + 0.5, (pos.getZ(i) + pos.getY(i)) / 32 + 0.5);
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

export class Assembly {
  constructor(private readonly paint: number) {}
  parts = new Map<number, THREE.BufferGeometry[]>();
  add(g: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): void {
    g.translate(x, y, z);
    const list = this.parts.get(color) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    if (g.index) g.dispose();
    this.parts.set(color, list);
  }
  plate(w: number, d: number, y: number, h: number, x: number, z: number, color = this.paint): void {
    this.add(armor([[y, w, d, Math.min(w, d) * 0.15], [y + h * 0.75, w, d, Math.min(w, d) * 0.15],
      [y + h, w - 0.35, d - 0.35, Math.min(w, d) * 0.15]]), color, x, 0, z);
  }
  block(w: number, h: number, d: number, x: number, y: number, z: number, color: number): void {
    this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z);
  }
  bake(): [number, THREE.BufferGeometry][] {
    return [...this.parts].map(([color, parts]) => {
      const geo = mergeGeometries(parts)!;
      parts.forEach(p => p.dispose());
      return [color, geo];
    });
  }
}

