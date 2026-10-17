import * as THREE from "three";
import { applyCamo } from "./camo";
import { unitHullMaterial } from "./unitFog";
import {
  advanceGait,
  GAIT_SETTLE_RATE,
  LEG_STRIDE,
  legLift,
  legSwing,
  settleToward,
  TEAM_DEFS,
  UNIT_DEFS,
  seatHull,
  unitAnchor,
  WHEEL_RADIUS,
  wheelSpinFor,
  type PlacedUnit,
  type TeamId,
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
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), unitHullMaterial(color));
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
    unitHullMaterial(color),
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

/**
 * Road wheels for a tracked hull: `stations.length` wheels per side at the
 * given half-track `x`, rolling radius `radius` (mesh origin on the axle so
 * `rotation.x` spins them). Geometry is pre-rotated (axle along X), so the
 * meshes stay direct hull children and the hull-bbox tests keep reading the
 * same footprint.
 */
function addWheels(
  parent: THREE.Group,
  radius: number,
  width: number,
  stations: readonly number[],
  halfTrack: number,
  axleY: number,
): void {
  for (const z of stations) {
    for (const x of [-halfTrack, halfTrack]) {
      const geo = new THREE.CylinderGeometry(radius, radius, width, 10);
      geo.rotateZ(Math.PI / 2);
      const wheel = new THREE.Mesh(geo, unitHullMaterial(0x3a3a40));
      wheel.name = "wheel";
      wheel.position.set(x, axleY, z);
      parent.add(wheel);
    }
  }
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
    case "peewee":
      return 0.04;
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
    // Hull longer than wide along +Z (direction of travel): a tank wider
    // than long reads as driving sideways.
    box(parent, 13, 6, 18, 0, 4, 0, def.color);
    addWheels(parent, 3, 1.6, [-6, 0, 6], 6.9, 3);
    box(turret, 8, 5, 9, 0, 9.5, -1, def.color);
    box(turret, 8.5, 1.5, 9.5, 0, 7, -1, def.accent);
    barrel(turret, 1.2, 14, 0, 9.5, 3, 0.03, def.accent);
  } else if (kind === "stump") {
    box(parent, 18, 8, 26, 0, 5, 0, def.color);
    box(parent, 19, 2.5, 27, 0, 2, 0, def.accent);
    addWheels(parent, 4, 2, [-8, 0, 8], 9.4, 4);
    box(turret, 12, 7, 14, 0, 12.5, -2, def.color);
    barrel(turret, 1.6, 22, 0, 12.5, 4, 0.05, def.accent);
  } else if (kind === "hammer") {
    box(parent, 16, 8, 24, 0, 5, 0, def.color);
    addWheels(parent, 4, 2, [-7, 0, 7], 8.4, 4);
    box(turret, 10, 6, 10, 0, 11, -2, def.accent);
    barrel(turret, 1.8, 32, 0, 13, 0, Math.PI / 4.5, def.accent);
  } else if (kind === "peewee") {
    // peewee: light infantry scout bot — a small two-leg walker with a
    // hand-cannon on a light torso mount, the smallest silhouette on the
    // field. Legs pivot at the hip (geometry translated to the joint) so
    // the commander's alternating walk gait strides it via `getLegs`.
    for (const x of [-2.5, 2.5]) {
      const geo = new THREE.BoxGeometry(3, 5, 4);
      geo.translate(0, -2.5, 0);
      const leg = new THREE.Mesh(geo, unitHullMaterial(def.accent));
      leg.name = "leg";
      leg.position.set(x, 5, 0);
      leg.userData.baseY = 5;
      parent.add(leg);
    }
    box(turret, 7, 4.5, 8, 0, 7.25, 0, def.color);
    box(turret, 7.5, 1.5, 8.5, 0, 5.5, 0, def.accent);
    box(turret, 3.5, 3, 3.5, 0, 11, 0, def.color);
    box(turret, 1.5, 2, 1.5, 0, 11, 2.25, def.accent);
    barrel(turret, 0.9, 10, 0, 8, 2, 0.04, def.accent);
  } else {
    // commander: biped construction kbot, the tallest silhouette on the field.
    // Legs pivot at the hip (geometry translated so the mesh origin sits at
    // the hip joint) for the alternating walk gait in `advanceLocomotion`.
    for (const x of [-4, 4]) {
      const geo = new THREE.BoxGeometry(5, 14, 6);
      geo.translate(0, -7, 0);
      const leg = new THREE.Mesh(geo, unitHullMaterial(def.color));
      leg.name = "leg";
      leg.position.set(x, 14, 0);
      leg.userData.baseY = 14;
      parent.add(leg);
    }
    box(turret, 15, 15, 11, 0, 21.5, 0, def.color);
    box(turret, 16, 3, 12, 0, 26, 0, def.accent);
    box(turret, 7, 6, 7, 0, 32, 0, def.color);
    box(turret, 2, 3, 2, 0, 32, 4, def.accent);
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 14, 6),
      unitHullMaterial(def.accent),
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

/** Team ground-ring radii (inner/outer), world units: outside the hull
 * footprint. This is the ONE ground circle per unit — selection never
 * stacks a second ring on top; the selected state widens this same band
 * (see `TEAM_RING_INNER_SELECTED`) so the eye reads "thicker", not
 * "double". The unselected band is deliberately thin (2 units) so it
 * reads as a quiet side marker. */
export const TEAM_RING_INNER = 25;
export const TEAM_RING_OUTER = 27;
/** Selected team-ring inner radius: the band widens inward (5 units wide)
 * while the outer edge stays put, so the circle thickens without growing
 * a second outline. */
export const TEAM_RING_INNER_SELECTED = 22;
/** Team rings sit just above the dirt, under scorch decals + selection. */
export const TEAM_RING_LIFT = 1.0;
/** Unselected team-ring opacity: a quiet marker, not a highlight — bumped
 * ~30% over the original 0.3 so the circle reads at a glance. */
export const TEAM_RING_OPACITY = 0.39;
/** Selected team-ring opacity: the ring brightens with selection. */
export const TEAM_RING_OPACITY_SELECTED = 0.9;

/** Team color of a roster side (falls back to white for unknown sides). */
export function teamRingColor(team: TeamId): number {
  return TEAM_DEFS[team]?.color ?? 0xffffff;
}

/**
 * Flat team-ring band geometry for the selection state: thin and quiet
 * unselected, widened inward (thicker, same outer edge) selected. Fresh
 * geometry per call — selection toggles are rare, and per-mesh ownership
 * keeps `dispose()` safe (no shared-geometry lifetime to manage).
 */
export function teamRingGeometry(selected: boolean): THREE.RingGeometry {
  const geo = new THREE.RingGeometry(
    selected ? TEAM_RING_INNER_SELECTED : TEAM_RING_INNER,
    TEAM_RING_OUTER,
    48,
  );
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Build one team ground ring: a flat team-colored band under the hull that
 * carries side identity in 3D without tinting the hull itself (the no-tint
 * policy from the selection task: hulls keep their normal paint including
 * damage charring). This is the unit's only ground circle — selection
 * thickens + brightens this same mesh (see `setTeamRingSelected`) instead
 * of adding a second ring. The mesh carries `userData.noHighlight` so
 * damage charring never touches it, and the name `team-ring` so the
 * occlusion ghost (which mirrors hull silhouettes, not markers) skips it
 * like the selection beacon. Owned by the body group so it rides motion
 * and exaggeration re-snaps for free.
 */
export function buildTeamRing(team: TeamId): THREE.Mesh {
  const geo = teamRingGeometry(false);
  const mat = new THREE.MeshBasicMaterial({
    color: teamRingColor(team),
    transparent: true,
    opacity: TEAM_RING_OPACITY,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.name = "team-ring";
  ring.position.y = TEAM_RING_LIFT;
  ring.renderOrder = 1;
  ring.userData.noHighlight = true;
  return ring;
}

/** Team-ring opacity for the selection state (pure: pins the subtle policy). */
export function teamRingOpacity(selected: boolean): number {
  return selected ? TEAM_RING_OPACITY_SELECTED : TEAM_RING_OPACITY;
}

/**
 * Thicken (or quiet) a unit body's team ring for the selection state:
 * selected rings run opaque + widened, unselected rings fall back to the
 * subtle thin marker. Exactly one ring either way — never a stacked pair.
 * Team color is never touched. No-op for plain test groups without a ring.
 */
export function setTeamRingSelected(body: THREE.Group, selected: boolean): void {
  const ring = getTeamRing(body);
  if (!ring) return;
  const mat = ring.material as THREE.MeshBasicMaterial;
  mat.opacity = teamRingOpacity(selected);
  ring.geometry.dispose();
  ring.geometry = teamRingGeometry(selected);
  ring.scale.setScalar(1);
}

/** Team ground ring of a unit body, or null (plain test groups). */
export function getTeamRing(body: THREE.Group): THREE.Mesh | null {
  const ring = body.getObjectByName("team-ring");
  return (ring as THREE.Mesh | undefined) ?? null;
}

/**
 * Hide a dead hull's ground/selection circles immediately on death: the
 * team ring plus the selection beacon (when the canvas has attached one).
 * The husk body itself stays rendered (smouldering/sinking until decay) —
 * only the circles drop, mirroring the health-bar policy (wrecks report no
 * live state). Idempotent and safe on plain test groups. Later
 * `setTeamRingSelected` calls never resurrect the ring: they only retint
 * the hidden mesh in place.
 */
export function hideUnitCircles(body: THREE.Group): void {
  const ring = body.getObjectByName("team-ring");
  if (ring) ring.visible = false;
  const marker = body.getObjectByName("select-marker");
  if (marker) marker.visible = false;
}

/** Turret/torso subgroup of a unit body, or null when absent. */
export function getTurret(body: THREE.Group): THREE.Group | null {
  return (body.userData.turret as THREE.Group | undefined) ?? null;
}

/**
 * Standalone unit body for icon/thumbnail renders: the same hull + turret +
 * camo construction the battlefield uses, without team rings or selection
 * markers (tray boxes carry team color on their own top border). Side +
 * slightly-above thumbnail cameras pose this group directly.
 */
export function buildUnitIconBody(kind: UnitKind): THREE.Group {
  const body = new THREE.Group();
  buildBody(kind, body);
  applyCamo(body, kind);
  return body;
}

/**
 * Build one reinforcement body at world (x, z), yawed `yaw`: hull + camo +
 * team ring, seated flat on `groundY`. The movement re-snap seats the grade
 * tilt on the next tick; the hull drives out of the HQ hall from here.
 */
export function buildSpawnedUnit(
  kind: UnitKind,
  team: TeamId,
  x: number,
  z: number,
  yaw: number,
  groundY: (x: number, z: number) => number,
): THREE.Group {
  const body = new THREE.Group();
  buildBody(kind, body);
  applyCamo(body, kind);
  body.add(buildTeamRing(team));
  body.rotation.order = "YXZ";
  body.rotation.y = yaw;
  body.position.set(x, groundY(x, z) + 0.5, z);
  return body;
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
 * `aimStep`); this only applies the pose. Aim owns yaw only — turret
 * pitch/roll belong to the commander's firing brace and the wreck slump,
 * which compose on top of the aim pose instead of being wiped by it.
 */
export function setUnitAim(body: THREE.Group, hullYaw: number, turretRel: number): void {
  // Keep the YXZ order buildUnits sets (yaw, then hull-frame pitch/roll) so
  // aiming never flattens a grade-posed hull.
  body.rotation.order = "YXZ";
  body.rotation.y = hullYaw;
  const turret = getTurret(body);
  if (turret) turret.rotation.y = turretRel;
}

/** Road-wheel meshes of a unit body (empty for the walker, plain groups). */
export function getWheels(body: THREE.Group): THREE.Mesh[] {
  return body.children.filter(
    (c): c is THREE.Mesh => c.type === "Mesh" && c.name === "wheel",
  );
}

/** Leg meshes of a unit body (commander only; empty otherwise). */
export function getLegs(body: THREE.Group): THREE.Mesh[] {
  return body.children.filter(
    (c): c is THREE.Mesh => c.type === "Mesh" && c.name === "leg",
  );
}

interface LocomotionState {
  /** Accumulated wheel spin, radians. */
  spin?: number;
  /** Walker gait phase, radians. */
  gait?: number;
  /** Gait amplitude 0 (neutral) .. 1 (full stride). */
  amp?: number;
}

/**
 * Pose drive locomotion for `distance` world units travelled this tick:
 * tracked wheels spin `distance / radius`, the commander's legs stride
 * antiphase with step lift, and the stride amplitude settles back to
 * neutral when the hull stops so legs never freeze mid-step. No-op for
 * bodies without wheels/legs (plain test groups). Re-snaps only move body
 * origins/tilt, so spin and gait survive exaggeration changes.
 */
export function advanceLocomotion(
  body: THREE.Group,
  kind: UnitKind,
  distance: number,
  dt: number,
): void {
  const state = body.userData as LocomotionState;
  const travel = Math.max(distance, 0);
  const step = Math.max(dt, 0);
  const radius = WHEEL_RADIUS[kind] ?? 0;
  if (radius > 0) {
    const wheels = getWheels(body);
    if (wheels.length > 0) {
      state.spin = (state.spin ?? 0) + wheelSpinFor(travel, radius);
      for (const wheel of wheels) wheel.rotation.x = state.spin;
    }
  }
  const stride = LEG_STRIDE[kind] ?? 0;
  if (stride > 0) {
    const legs = getLegs(body);
    if (legs.length > 0) {
      state.gait = advanceGait(state.gait ?? 0, travel, stride);
      state.amp = settleToward(
        state.amp ?? 0,
        travel > 1e-6 ? 1 : 0,
        GAIT_SETTLE_RATE * step,
      );
      const gait = state.gait;
      const amp = state.amp;
      legs.forEach((leg, i) => {
        leg.rotation.x = legSwing(gait, i, amp);
        const baseY = (leg.userData.baseY as number | undefined) ?? leg.position.y;
        leg.position.y = baseY + legLift(gait, i, amp);
      });
    }
  }
}

/**
 * Engine-idle footprint, retired: hulls no longer slide on their tracks at
 * rest — the old ±0.35 u positional jitter at ~2 Hz read as a distracting
 * shake/dance rather than a running engine (a real idling hull breathes in
 * place; it never translates). Kept at zero so existing bounds imports keep
 * compiling and keep asserting exact seating; `idleTremble` always shapes
 * x/z as 0 and `applyIdleTremble` never touches position.
 */
export const IDLE_POS = 0;
/**
 * Engine-idle breathing: max hull sway per tilt axis, radians. A ~0.09°
 * slow sway against the grade seat — an order below the old 0.005 judder
 * and two orders below the 0.16 rad hit-reaction clamp. Felt, not seen:
 * neighbouring hulls visibly hold still unless watched.
 */
export const IDLE_TILT = 0.0015;
/** Per-unit tremble phase step (golden angle, matching the scorch-jitter style). */
const IDLE_PHASE = 2.39996;

interface IdleTrembleState {
  /** Hull pitch judder applied by the last pose (un-applied before re-seating). */
  idlePitch?: number;
  /** Hull roll judder applied by the last pose (un-applied before re-seating). */
  idleRoll?: number;
}

/** Shared scratch for `idleTremble` (no per-frame allocation; copy on read). */
const _idle = { x: 0, z: 0, pitch: 0, roll: 0 };

/**
 * Shape the engine-idle breathing for unit `index` at clock `elapsed`: a
 * slow pitch/roll sway (averaged sine pairs at ~0.5–0.8 Hz, phased per
 * unit), so the same tick sequence replays the same breath with no rng.
 * Position is always zero — the hull never slides. Returns a shared
 * scratch object — copy the fields before the next call. Visual only:
 * callers apply it to the body, never to the mover.
 */
export function idleTremble(
  elapsed: number,
  index: number,
): { x: number; z: number; pitch: number; roll: number } {
  const t = Math.max(elapsed, 0);
  const p = index * IDLE_PHASE;
  _idle.x = 0;
  _idle.z = 0;
  _idle.pitch = IDLE_TILT * 0.5 * (Math.sin(5.1 * t + 1.7 * p) + Math.sin(3.3 * t + 3.1 * p));
  _idle.roll = IDLE_TILT * 0.5 * (Math.sin(4.6 * t + 2.3 * p) + Math.sin(3.9 * t + 1.1 * p));
  return _idle;
}

/**
 * Breathe a seated body with engine-idle sway: the shaped tilt on top of
 * the grade pose. Position is never touched (the seat owns X/Z absolutely,
 * so the hull sits bit-exact on its mover); the tilt sway is recorded for
 * `clearIdleTremble`. Plain test groups breathe like built bodies.
 */
export function applyIdleTremble(body: THREE.Group, index: number, elapsed: number): void {
  const j = idleTremble(elapsed, index);
  body.rotation.x += j.pitch;
  body.rotation.z += j.roll;
  const state = body.userData as IdleTrembleState;
  state.idlePitch = j.pitch;
  state.idleRoll = j.roll;
}

/**
 * Remove the last pose's breathing sway from the hull tilt, restoring the
 * grade pose exactly. No-op when the body never breathed. Position is never
 * touched (the seat owns X/Z absolutely).
 */
export function clearIdleTremble(body: THREE.Group): void {
  const state = body.userData as IdleTrembleState;
  body.rotation.x -= state.idlePitch ?? 0;
  body.rotation.z -= state.idleRoll ?? 0;
  state.idlePitch = 0;
  state.idleRoll = 0;
}

export function buildUnits(map: TNTMap, exaggeration: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "units";
  group.userData.units = map.units as PlacedUnit[];
  for (const unit of map.units) {
    const body = new THREE.Group();
    buildBody(unit.kind, body);
    // Subtle procedural camo on the hull paint (shared per-kind texture;
    // wheels stay flat rubber, markers are skipped inside applyCamo).
    applyCamo(body, unit.kind);
    // Team ground ring: side identity without hull tint (see buildTeamRing).
    body.add(buildTeamRing(unit.team ?? 0));
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
