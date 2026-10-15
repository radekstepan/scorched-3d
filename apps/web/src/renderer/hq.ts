import * as THREE from "three";
import { TEAM_DEFS, type TeamId } from "@scorched-3d/core";
import { buildTeamRing } from "./units";

/**
 * Team HQ structures: one fortified bunker per side at its map end, with a
 * sliding front door and an open hall running toward the map center that
 * reinforcements drive out of. Built from plain Lambert boxes (no new
 * materials per frame — everything is created once in `buildHq`), so the
 * door animation is a single position write per tick and the wreck pose is
 * a one-time recolor.
 *
 * Local frame: the door faces +X. The canvas mirrors team 1 (east) so its
 * door faces the map center (-X world).
 */

/** Bunker base footprint, world units (fits easily inside a map-end column). */
export const HQ_BASE_W = 96;
export const HQ_BASE_D = 76;
/** Wall height above the base slab; the door is slightly shorter. */
export const HQ_WALL_H = 26;
export const HQ_DOOR_W = 34;
export const HQ_DOOR_H = 24;
/** How far the door slides up when a reinforcement drives out. */
export const HQ_DOOR_TRAVEL = 22;
/** Hall floor length from the bunker mouth toward the map center. */
export const HQ_HALL_LEN = 130;
/** Hall mouth offset from the HQ origin (door face + hall length). */
export const HQ_EXIT_OFFSET = 48 + HQ_HALL_LEN;
/** Concrete + dark trim palette (team color comes from TEAM_DEFS). */
export const HQ_CONCRETE = 0x6b6f75;
export const HQ_DARK = 0x3a3d42;

/** Which way an HQ's door faces: team 0 (west) opens east, team 1 mirrors. */
export type HqFacing = 1 | -1;

export function hqFacingFor(team: TeamId): HqFacing {
  return team === 0 ? 1 : -1;
}

/** World-space hall-mouth position for an HQ anchor + facing. */
export function hqExitWorld(anchor: { x: number; z: number }, facing: HqFacing): { x: number; z: number } {
  return { x: anchor.x + facing * HQ_EXIT_OFFSET, z: anchor.z };
}

function hqBox(
  parent: THREE.Group,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/**
 * Build one HQ bunker + hall for `team`, door facing local +X. The sliding
 * door carries the name `hq-door` (see `getHqDoor` / `setDoorLift`); every
 * mesh is tagged `userData.noHighlight` so damage-charring passes (which
 * only ever visit unit bodies) could never touch the structure anyway.
 */
export function buildHq(team: TeamId): THREE.Group {
  const group = new THREE.Group();
  group.name = "hq";
  group.userData.hqTeam = team;
  const tag = (o: THREE.Object3D): void => {
    o.userData.noHighlight = true;
  };

  // Base slab + team ground ring (scaled up from the hull-size ring: the
  // bunker reads as a team asset from the same signal as the hulls).
  const slab = hqBox(group, HQ_BASE_W, 4, HQ_BASE_D, 0, 2, 0, HQ_CONCRETE);
  tag(slab);
  const ring = buildTeamRing(team);
  ring.scale.setScalar(3);
  group.add(ring);

  // Bunker: back wall, full-length side walls, front segments flanking the
  // door opening (|z| < HQ_DOOR_W/2 stays open), and a roof slab.
  const wallY = 4 + HQ_WALL_H / 2;
  tag(hqBox(group, 8, HQ_WALL_H, HQ_BASE_D, -44, wallY, 0, HQ_DARK));
  for (const s of [-1, 1]) {
    tag(hqBox(group, HQ_BASE_W, HQ_WALL_H, 8, 0, wallY, s * 34, HQ_DARK));
    tag(hqBox(group, 8, HQ_WALL_H, 17, 44, wallY, s * 25.5, HQ_DARK));
  }
  tag(hqBox(group, HQ_BASE_W, 5, HQ_BASE_D, 0, 4 + HQ_WALL_H + 2.5, 0, HQ_CONCRETE));
  // Team trim stripe across the front, above the door.
  const trim = hqBox(group, 4, 3, HQ_BASE_D, 45, 4 + HQ_WALL_H - 1.5, 0, TEAM_DEFS[team]?.color ?? 0xffffff);
  tag(trim);

  // Sliding door: thin shutter in the front opening, base seated on the slab.
  const door = hqBox(group, 3, HQ_DOOR_H, HQ_DOOR_W, 46, 4 + HQ_DOOR_H / 2, 0, HQ_DARK);
  door.name = "hq-door";
  door.userData.baseY = door.position.y;
  tag(door);

  // Open hall toward the map center: floor strip + low guide curbs the
  // reinforcement drives between on its way out.
  const hallCx = 48 + HQ_HALL_LEN / 2;
  tag(hqBox(group, HQ_HALL_LEN, 2, 30, hallCx, 1, 0, HQ_CONCRETE));
  for (const s of [-1, 1]) {
    tag(hqBox(group, HQ_HALL_LEN, 6, 4, hallCx, 3, s * 17, HQ_DARK));
  }
  return group;
}

/** Sliding door of an HQ group, or null (plain test groups). */
export function getHqDoor(group: THREE.Group): THREE.Mesh | null {
  return (group.getObjectByName("hq-door") as THREE.Mesh | undefined) ?? null;
}

/** Seated door height (slab top + half door), for tests. */
export function hqDoorBaseY(): number {
  return 4 + HQ_DOOR_H / 2;
}

/** Slide the door `lift` world units up from its seat (clamped). */
export function setDoorLift(group: THREE.Group, lift: number): void {
  const door = getHqDoor(group);
  if (!door) return;
  const base = (door.userData.baseY as number | undefined) ?? hqDoorBaseY();
  door.position.y = base + Math.min(Math.max(lift, 0), HQ_DOOR_TRAVEL);
}

/** Current door lift above its seat, for tests. */
export function doorLiftOf(group: THREE.Group): number {
  const door = getHqDoor(group);
  if (!door) return 0;
  const base = (door.userData.baseY as number | undefined) ?? hqDoorBaseY();
  return door.position.y - base;
}

/**
 * Wreck an HQ in place (idempotent): char every Lambert surface toward
 * near-black, slam the door crooked, and drop the roof — the husk reads as
 * a breached fort while keeping its roster slot, like every other wreck.
 */
export function poseHqWreck(group: THREE.Group): void {
  if (group.userData.hqWrecked) return;
  group.userData.hqWrecked = true;
  const char = new THREE.Color(0x14100b);
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
    if (mesh.type === "Mesh" && mat && (mat as THREE.MeshLambertMaterial).color) {
      (mat as THREE.MeshLambertMaterial).color.copy(char);
    }
  });
  const door = getHqDoor(group);
  if (door) {
    const base = (door.userData.baseY as number | undefined) ?? hqDoorBaseY();
    door.position.y = base - 8;
    door.rotation.z = 0.18;
  }
  // Roof slab is the topmost wide box: settle it onto the walls.
  const roof = group.children.find(
    (c) => c.type === "Mesh" && Math.abs((c as THREE.Mesh).position.y - (4 + HQ_WALL_H + 2.5)) < 1,
  ) as THREE.Mesh | undefined;
  if (roof) {
    roof.position.y -= 6;
    roof.rotation.z = 0.05;
  }
}
