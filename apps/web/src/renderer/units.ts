import * as THREE from "three";
import {
  UNIT_DEFS,
  seatHull,
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
  // Elevating pivot at the trunnion: the tube lies straight along +Z inside
  // it so combat FX can aim barrel pitch by setting pivot.rotation.x, and a
  // "tip" marker at the muzzle gives the exact barrel-tip world position
  // (including hull grade pitch/roll and turret yaw) for muzzle solutions.
  const pivot = new THREE.Group();
  pivot.name = "barrel";
  pivot.position.set(x, y, z);
  pivot.rotation.x = -elevation;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.25, length, 8),
    new THREE.MeshLambertMaterial({ color }),
  );
  // CylinderGeometry runs along +Y; rotate to lie along +Z.
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(0, 0, length / 2);
  pivot.add(mesh);
  const tip = new THREE.Object3D();
  tip.name = "tip";
  tip.position.set(0, 0, length);
  pivot.add(tip);
  parent.add(pivot);
}

/** Rest barrel elevation per tank kind, radians (matches the build poses). */
export function restBarrelElevation(kind: UnitKind): number {
  switch (kind) {
    case "flash":
      return 0.03;
    case "stump":
      return 0.05;
    case "hammer":
      return Math.PI / 4.5;
    case "commander":
      return 0;
  }
}

function buildBody(kind: UnitKind, parent: THREE.Group): void {
  const def = UNIT_DEFS[kind];
  // Traverse-limited turret subgroup: tanks carry the turret box + barrel
  // here, the commander its whole upper torso. Combat FX yaws the body
  // (hull) and this group (relative) separately.
  const turret = new THREE.Group();
  turret.name = "turret";
  parent.add(turret);
  parent.userData.turret = turret;
  if (kind === "flash") {
    box(parent, 18, 6, 13, 0, 4, 0, def.color);
    box(turret, 9, 5, 8, 0, 9.5, -1, def.color);
    box(turret, 9.5, 1.5, 8.5, 0, 7, -1, def.accent);
    barrel(turret, 1.2, 14, 0, 9.5, 3, 0.03, def.accent);
  } else if (kind === "stump") {
    box(parent, 26, 8, 18, 0, 5, 0, def.color);
    box(parent, 27, 2.5, 19, 0, 2, 0, def.accent);
    box(turret, 14, 7, 12, 0, 12.5, -2, def.color);
    barrel(turret, 1.6, 22, 0, 12.5, 4, 0.05, def.accent);
  } else if (kind === "hammer") {
    box(parent, 24, 8, 16, 0, 5, 0, def.color);
    box(turret, 10, 6, 10, 0, 11, -2, def.accent);
    barrel(turret, 1.8, 32, 0, 13, 0, Math.PI / 4.5, def.accent);
  } else {
    // commander: biped construction kbot, the tallest silhouette on the field.
    box(parent, 5, 14, 6, -4, 7, 0, def.color);
    box(parent, 5, 14, 6, 4, 7, 0, def.color);
    box(turret, 15, 15, 11, 0, 21.5, 0, def.color);
    box(turret, 16, 3, 12, 0, 26, 0, def.accent);
    box(turret, 7, 6, 7, 0, 32, 0, def.color);
    box(turret, 2, 3, 2, 0, 32, 4, def.accent);
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 14, 6),
      new THREE.MeshLambertMaterial({ color: def.accent }),
    );
    antenna.position.set(3, 40, -2);
    turret.add(antenna);
    // No gun tube: the bolt leaves from a chest-height muzzle marker so the
    // muzzle solution reads live world state like every other kind.
    const tip = new THREE.Object3D();
    tip.name = "tip";
    tip.position.set(0, 30, 6);
    turret.add(tip);
  }
}

/** Turret/torso subgroup of a unit body, or null when absent. */
export function getTurret(body: THREE.Group): THREE.Group | null {
  return (body.userData.turret as THREE.Group | undefined) ?? null;
}

/** Elevating barrel pivot of a unit body, or null (commander, plain groups). */
export function getBarrel(body: THREE.Group): THREE.Group | null {
  const turret = getTurret(body);
  const barrel = turret?.getObjectByName("barrel");
  return (barrel as THREE.Group | undefined) ?? null;
}

/** Muzzle-tip marker of a unit body, or null for plain test groups. */
export function getMuzzleTip(body: THREE.Group): THREE.Object3D | null {
  const turret = getTurret(body);
  return turret?.getObjectByName("tip") ?? null;
}

/**
 * Aim the barrel at `elevation` radians above horizontal. No-op when the
 * body has no elevating pivot (commander ASMs its bolt from the chest
 * marker; plain test groups keep the math fallback in combatFx).
 */
export function setBarrelElevation(body: THREE.Group, elevation: number): void {
  const pivot = getBarrel(body);
  if (pivot) pivot.rotation.x = -elevation;
}

/** Current barrel elevation of a body, radians above horizontal. */
export function barrelElevation(body: THREE.Group): number {
  const pivot = getBarrel(body);
  return pivot ? -pivot.rotation.x : 0;
}

const _tipPos = new THREE.Vector3();
const _tipDir = new THREE.Vector3();
const _tipQuat = new THREE.Quaternion();

/**
 * Live muzzle state: barrel-tip world position plus the barrel direction
 * (+Z of the tip, so hull grade pitch/roll, turret yaw, and barrel
 * elevation all contribute). Returns null when the body has no tip marker
 * (plain test groups) — callers fall back to the flat `muzzlePoint` math.
 */
export function muzzleWorld(
  body: THREE.Group,
): { position: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } } | null {
  const tip = getMuzzleTip(body);
  if (!tip) return null;
  tip.getWorldPosition(_tipPos);
  tip.getWorldQuaternion(_tipQuat);
  _tipDir.set(0, 0, 1).applyQuaternion(_tipQuat);
  return {
    position: { x: _tipPos.x, y: _tipPos.y, z: _tipPos.z },
    direction: { x: _tipDir.x, y: _tipDir.y, z: _tipDir.z },
  };
}

/**
 * Aim a unit body: yaw the hull (body group) and the turret subgroup
 * relative to it. Traverse clamping lives in core (`clampTurret` /
 * `aimStep`); this only applies the pose.
 */
export function setUnitAim(body: THREE.Group, hullYaw: number, turretRel: number): void {
  // Keep the YXZ order buildUnits sets (yaw, then hull-frame pitch/roll) so
  // aiming never flattens a grade-posed hull.
  body.rotation.order = "YXZ";
  body.rotation.y = hullYaw;
  getTurret(body)?.rotation.set(0, turretRel, 0);
}

export function buildUnits(map: TNTMap, exaggeration: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "units";
  group.userData.units = map.units as PlacedUnit[];
  for (const unit of map.units) {
    const body = new THREE.Group();
    buildBody(unit.kind, body);
    // YXZ so hull pitch/roll pose in the hull frame after yawing.
    body.rotation.order = "YXZ";
    body.rotation.y = unit.rotation;
    const anchor = unitAnchor(map, unit, exaggeration);
    body.position.set(anchor.x, anchor.y + 0.5, anchor.z);
    seatBody(body, map, unit.kind, unit.rotation, exaggeration);
    group.add(body);
  }
  return group;
}

/**
 * Seat one body on the surface: max footprint-tap height plus grade
 * pitch/roll for its hull yaw. Reads X/Z already on the body, writes Y and
 * the X/Z tilt only — aim yaw is never touched.
 */
function seatBody(
  body: THREE.Group,
  map: TNTMap,
  kind: UnitKind,
  hull: number,
  exaggeration: number,
): void {
  const seat = seatHull(map, kind, body.position.x, body.position.z, hull, exaggeration);
  body.position.y = seat.y;
  body.rotation.x = seat.pitch;
  body.rotation.z = seat.roll;
}

/** Re-snap every unit to the terrain surface after the exaggeration changes. */
export function placeUnitsGroup(group: THREE.Group, map: TNTMap, exaggeration: number): void {
  const units = group.userData.units as PlacedUnit[];
  units.forEach((unit, i) => {
    const child = group.children[i] as THREE.Group | undefined;
    if (!child) return;
    // Re-snap moves origins and grade tilt only; aim yaw is preserved.
    seatBody(child, map, unit.kind, child.rotation.y, exaggeration);
  });
}
