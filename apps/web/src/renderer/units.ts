import * as THREE from "three";
import {
  UNIT_DEFS,
  unitAnchor,
  type PlacedUnit,
  type TNTMap,
  type UnitKind,
} from "@scorched-3d/core";

/**
 * Low-poly static unit meshes. One THREE.Group per placed unit, children laid
 * out relative to the ground anchor (y = 0 at the terrain surface) so the
 * height-exaggeration slider only has to move the group origin. Forward is
 * +Z (south), matching the terrain frame; each group is yawed by the seeded
 * placement rotation. Scale note: one attribute cell is 16 world units, so a
 * ~26-unit tank hull reads as roughly a 2-cell footprint.
 */

function box(
  parent: THREE.Group,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
}

function barrel(
  parent: THREE.Group,
  radius: number,
  length: number,
  x: number,
  y: number,
  z: number,
  elevation: number,
  color: number,
): void {
  // CylinderGeometry runs along +Y; rotate to lie along +Z, then elevate.
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.25, length, 8),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.rotation.x = Math.PI / 2 - elevation;
  mesh.position.set(x, y + (Math.sin(elevation) * length) / 2, z + (Math.cos(elevation) * length) / 2);
  parent.add(mesh);
}

function buildBody(kind: UnitKind, parent: THREE.Group): void {
  const def = UNIT_DEFS[kind];
  if (kind === "flash") {
    box(parent, 18, 6, 13, 0, 4, 0, def.color);
    box(parent, 9, 5, 8, 0, 9.5, -1, def.color);
    box(parent, 9.5, 1.5, 8.5, 0, 7, -1, def.accent);
    barrel(parent, 1.2, 14, 0, 9.5, 3, 0.03, def.accent);
  } else if (kind === "stump") {
    box(parent, 26, 8, 18, 0, 5, 0, def.color);
    box(parent, 27, 2.5, 19, 0, 2, 0, def.accent);
    box(parent, 14, 7, 12, 0, 12.5, -2, def.color);
    barrel(parent, 1.6, 22, 0, 12.5, 4, 0.05, def.accent);
  } else if (kind === "hammer") {
    box(parent, 24, 8, 16, 0, 5, 0, def.color);
    box(parent, 10, 6, 10, 0, 11, -2, def.accent);
    barrel(parent, 1.8, 32, 0, 13, 0, Math.PI / 4.5, def.accent);
  } else {
    // commander: biped construction kbot, the tallest silhouette on the field.
    box(parent, 5, 14, 6, -4, 7, 0, def.color);
    box(parent, 5, 14, 6, 4, 7, 0, def.color);
    box(parent, 15, 15, 11, 0, 21.5, 0, def.color);
    box(parent, 16, 3, 12, 0, 26, 0, def.accent);
    box(parent, 7, 6, 7, 0, 32, 0, def.color);
    box(parent, 2, 3, 2, 0, 32, 4, def.accent);
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 14, 6),
      new THREE.MeshLambertMaterial({ color: def.accent }),
    );
    antenna.position.set(3, 40, -2);
    parent.add(antenna);
  }
}

export function buildUnits(map: TNTMap, exaggeration: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "units";
  group.userData.units = map.units as PlacedUnit[];
  for (const unit of map.units) {
    const body = new THREE.Group();
    buildBody(unit.kind, body);
    body.rotation.y = unit.rotation;
    const anchor = unitAnchor(map, unit, exaggeration);
    body.position.set(anchor.x, anchor.y + 0.5, anchor.z);
    group.add(body);
  }
  return group;
}

/** Re-snap every unit to the terrain surface after the exaggeration changes. */
export function placeUnitsGroup(group: THREE.Group, map: TNTMap, exaggeration: number): void {
  const units = group.userData.units as PlacedUnit[];
  units.forEach((unit, i) => {
    const child = group.children[i];
    if (!child) return;
    const anchor = unitAnchor(map, unit, exaggeration);
    child.position.set(anchor.x, anchor.y + 0.5, anchor.z);
  });
}
