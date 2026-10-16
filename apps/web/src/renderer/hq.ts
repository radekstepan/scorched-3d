import * as THREE from "three";
import { HQ_FOUNDATION_MARGIN, TEAM_DEFS, type TeamId } from "@scorched-3d/core";
import { buildTeamRing } from "./units";

/**
 * Team HQ factory structures: one fortified works per side at its map end,
 * with a sliding front door and an open hall running toward the map center
 * that reinforcements drive out of. The massing reads as a factory, not a
 * pillbox: a walled production hall under a monitor (clerestory) roof with
 * vents and a skylight, twin chimney stacks + caps at the back corners, a
 * silo tank and a side workshop annex on the slab, and a framed sectional
 * door with gate lamps under a canopy. Built from plain Lambert boxes and
 * cylinders (no new materials per frame — everything is created once in
 * `buildHq`), so the door animation is a single position write per tick
 * and the wreck pose is a one-time recolor. A red warning beacon on the
 * canopy top (a bare translucent hemisphere with a light + bulb spinning
 * inside it) sweeps while the works stands as the "working building"
 * signal and dies with it.
 *
 * Local frame: the door faces +X. The canvas mirrors team 1 (east) so its
 * door faces the map center (-X world).
 *
 * Nanolathe inspiration (adapted): retail TA-style factories keep the
 * front (+Z) exit lane clear of buildings over its full width and deliver
 * products at the factory exit; here the open hall + hall mouth serve the
 * same role — a clear lane toward the map center where each reinforcement
 * appears facing out, then drives through the normal movement pipeline.
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
/** Red warning-beacon lens color: the "working building" signal. */
export const HQ_BEACON_COLOR = 0xff2a1a;
/** One full sweep of the beacon rotor, seconds (continuous rotation). */
export const HQ_BEACON_PERIOD = 1.4;
/** Beacon PointLight peak intensity (physical falloff, combat-pool order). */
export const HQ_BEACON_PEAK = 3200;
/** Beacon falloff range: washes the whole works + hall + staging apron. */
export const HQ_BEACON_DISTANCE = 340;
/** Beacon physical-falloff decay (same curve as the combat pools). */
export const HQ_BEACON_DECAY = 1.8;
/** Beacon dome radius (a bare hemisphere, no mast or platform). */
export const HQ_BEACON_RADIUS = 2;
/** Rotor orbit inside the dome: bulb + light sweep this radius. */
export const HQ_BEACON_ORBIT = 1.1;
/** Beacon dome seat, local frame (bare hemisphere on the canopy top, over the door). */
export const HQ_BEACON_X = 58;
export const HQ_BEACON_Y = 33;
/**
 * Default footing depth under the slab/hall (world units, straight down
 * from the slab underside at local y=0). `HqFx` re-sizes both footings per
 * site via `setHqFoundation` from live terrain sampling, so a bare
 * `buildHq` still reads seated while sited forts reach their own low
 * corner plus `HQ_FOUNDATION_MARGIN` (re-exported from core).
 */
export const HQ_FOUNDATION_DEPTH = 24;
export { HQ_FOUNDATION_MARGIN };

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

function hqStack(
  parent: THREE.Group,
  rTop: number,
  rBottom: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBottom, h, 12),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/**
 * Build one HQ factory + hall for `team`, door facing local +X. The
 * sliding door carries the name `hq-door` (see `getHqDoor` / `setDoorLift`);
 * chimneys carry `hq-chimney` so the wreck pose can topple them; every
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
  // Factory roof furniture: a monitor (clerestory) hall crown with vents
  // and a skylight strip, so the roofline reads as works sheds.
  const monitor = hqBox(group, 56, 7, 22, -4, 4 + HQ_WALL_H + 5 + 3.5, 0, HQ_DARK);
  monitor.name = "hq-monitor";
  tag(monitor);
  tag(hqBox(group, 40, 1.5, 8, -4, 4 + HQ_WALL_H + 5 + 7.75, 0, HQ_CONCRETE));
  for (const vx of [-24, 18]) {
    tag(hqBox(group, 8, 5, 8, vx, 4 + HQ_WALL_H + 5 + 2.5, vx > 0 ? -14 : 14, HQ_CONCRETE));
  }
  // Twin chimney stacks at the back corners, with dark caps.
  for (const s of [-1, 1]) {
    const stack = hqStack(group, 4, 5, 36, -38, 4 + 18, s * 28, HQ_CONCRETE);
    stack.name = "hq-chimney";
    tag(stack);
    tag(hqStack(group, 5.5, 5.5, 2, -38, 4 + 36 + 1, s * 28, HQ_DARK));
  }
  // Silo tank + side workshop annex on the slab (kept inside the base so
  // the whole works sits on seated ground).
  const silo = hqStack(group, 9, 9, 30, 18, 4 + 15, -28, HQ_CONCRETE);
  silo.name = "hq-silo";
  tag(silo);
  tag(hqStack(group, 9.5, 9.5, 2, 18, 4 + 30 + 1, -28, HQ_DARK));
  const annex = hqBox(group, 30, 14, 24, -20, 4 + 7, 24, HQ_DARK);
  annex.name = "hq-annex";
  tag(annex);
  tag(hqBox(group, 32, 2, 26, -20, 4 + 14 + 1, 24, HQ_CONCRETE));
  // Team trim stripe across the front, above the door.
  const trim = hqBox(group, 4, 3, HQ_BASE_D, 45, 4 + HQ_WALL_H - 1.5, 0, TEAM_DEFS[team]?.color ?? 0xffffff);
  tag(trim);

  // Sliding sectional door: thin shutter in the front opening, base seated
  // on the slab, framed by jambs + lintel with team gate lamps and a
  // canopy over the hall mouth.
  for (const s of [-1, 1]) {
    tag(hqBox(group, 4, HQ_WALL_H, 3, 44, 4 + HQ_WALL_H / 2, s * 18.5, HQ_CONCRETE));
    tag(hqBox(group, 2, 2, 2, 46.5, 12, s * 21, TEAM_DEFS[team]?.color ?? 0xffffff));
  }
  tag(hqBox(group, 4, 4, 40, 44, 4 + HQ_WALL_H + 1, 0, HQ_CONCRETE));
  tag(hqBox(group, 14, 2, 44, 53, 4 + HQ_WALL_H + 2, 0, HQ_DARK));

  // Sliding door: thin shutter in the front opening, base seated on the slab.
  const door = hqBox(group, 3, HQ_DOOR_H, HQ_DOOR_W, 46, 4 + HQ_DOOR_H / 2, 0, HQ_DARK);
  door.name = "hq-door";
  door.userData.baseY = door.position.y;
  tag(door);

  // Warning beacon on the canopy top, centered over the door: a bare
  // red hemisphere (`hq-beacon`, no mast, no platform) with a small rotor
  // inside (`hq-beacon-rotor`) carrying the bulb (`hq-beacon-bulb`) and one
  // cheap no-shadow PointLight (`hq-beacon-light`). The rotor spins so the
  // light sweeps inside the lens as the "working building" signal; the
  // HqFx tick rotates it via `setHqBeaconAngle`, wrecks kill it for good.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(HQ_BEACON_RADIUS, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({
      color: HQ_BEACON_COLOR,
      emissive: HQ_BEACON_COLOR,
      emissiveIntensity: 2.2,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  dome.name = "hq-beacon";
  dome.position.set(HQ_BEACON_X, HQ_BEACON_Y, 0);
  tag(dome);
  group.add(dome);
  const rotor = new THREE.Group();
  rotor.name = "hq-beacon-rotor";
  rotor.position.set(HQ_BEACON_X, HQ_BEACON_Y, 0);
  group.add(rotor);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 10, 8),
    new THREE.MeshLambertMaterial({
      color: 0xffd0c0,
      emissive: HQ_BEACON_COLOR,
      emissiveIntensity: 3,
    }),
  );
  bulb.name = "hq-beacon-bulb";
  bulb.position.set(HQ_BEACON_ORBIT, 1, 0);
  tag(bulb);
  rotor.add(bulb);
  const beaconLight = new THREE.PointLight(HQ_BEACON_COLOR, HQ_BEACON_PEAK, HQ_BEACON_DISTANCE, HQ_BEACON_DECAY);
  beaconLight.name = "hq-beacon-light";
  beaconLight.position.set(HQ_BEACON_ORBIT, 1, 0);
  rotor.add(beaconLight);

  // Open hall toward the map center: floor strip + low guide curbs the
  // reinforcement drives between on its way out.
  const hallCx = 48 + HQ_HALL_LEN / 2;
  tag(hqBox(group, HQ_HALL_LEN, 2, 30, hallCx, 1, 0, HQ_CONCRETE));
  for (const s of [-1, 1]) {
    tag(hqBox(group, HQ_HALL_LEN, 6, 4, hallCx, 3, s * 17, HQ_DARK));
  }
  // Deep foundations: a concrete footing under the slab plus one under the
  // hall floor, both hanging straight down from the slab underside (local
  // y=0). On flat ground they sit fully buried and invisible; on a slope
  // the downhill side shows concrete instead of an air gap, so the works
  // reads as set into the hill. `setHqFoundation` sizes them per site.
  const footing = hqBox(group, HQ_BASE_W - 8, HQ_FOUNDATION_DEPTH, HQ_BASE_D - 8, 0, -HQ_FOUNDATION_DEPTH / 2, 0, HQ_CONCRETE);
  footing.name = "hq-foundation";
  footing.userData.baseH = HQ_FOUNDATION_DEPTH;
  tag(footing);
  const hallFooting = hqBox(group, HQ_HALL_LEN, HQ_FOUNDATION_DEPTH, 26, hallCx, -HQ_FOUNDATION_DEPTH / 2, 0, HQ_CONCRETE);
  hallFooting.name = "hq-hall-foundation";
  hallFooting.userData.baseH = HQ_FOUNDATION_DEPTH;
  tag(hallFooting);
  return group;
}

/** Sliding door of an HQ group, or null (plain test groups). */
export function getHqDoor(group: THREE.Group): THREE.Mesh | null {
  return (group.getObjectByName("hq-door") as THREE.Mesh | undefined) ?? null;
}

/** Warning-beacon dome of an HQ group, or null (plain test groups). */
export function getHqBeacon(group: THREE.Group): THREE.Mesh | null {
  return (group.getObjectByName("hq-beacon") as THREE.Mesh | undefined) ?? null;
}

/** Warning-beacon light of an HQ group, or null (plain test groups). */
export function getHqBeaconLight(group: THREE.Group): THREE.PointLight | null {
  return (group.getObjectByName("hq-beacon-light") as THREE.PointLight | undefined) ?? null;
}

/** Warning-beacon rotor of an HQ group, or null (plain test groups). */
export function getHqBeaconRotor(group: THREE.Group): THREE.Group | null {
  return (group.getObjectByName("hq-beacon-rotor") as THREE.Group | undefined) ?? null;
}

/**
 * Rotor angle `timeS` seconds into the loop, radians: one full sweep per
 * `HQ_BEACON_PERIOD`. Pure, so headless tests can pin the spin without a
 * scene. Non-finite/negative time reads 0 (rotor parked facing +X).
 */
export function hqBeaconAngleAt(timeS: number): number {
  if (!isFinite(timeS) || timeS < 0) return 0;
  return ((timeS % HQ_BEACON_PERIOD) / HQ_BEACON_PERIOD) * Math.PI * 2;
}

/** Current rotor angle of an HQ group, radians (0 when missing). */
export function hqBeaconAngleOf(group: THREE.Group): number {
  return getHqBeaconRotor(group)?.rotation.y ?? 0;
}

/** Point the beacon rotor at `angle` radians (wrecks stay dark regardless). */
export function setHqBeaconAngle(group: THREE.Group, angle: number): void {
  const rotor = getHqBeaconRotor(group);
  if (rotor) rotor.rotation.y = angle;
}

/**
 * Drive the beacon to `level` 0..1 (clamped): the dome lens burns hot at
 * full flash and falls back to a faint lens when dark, while the PointLight
 * scales to its peak so the works + hall + staging-apron wash pulses with
 * it. A wrecked HQ stays dark — wrecks never re-light.
 */
export function setHqBeaconLevel(group: THREE.Group, level: number): void {
  if (group.userData.hqWrecked) {
    const dome = getHqBeacon(group);
    const mat = dome?.material as THREE.MeshLambertMaterial | undefined;
    if (dome && mat && "emissive" in mat) {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }
    const bulb = group.getObjectByName("hq-beacon-bulb") as THREE.Mesh | undefined;
    const bulbMat = bulb?.material as THREE.MeshLambertMaterial | undefined;
    if (bulb && bulbMat && "emissive" in bulbMat) {
      bulbMat.emissive.setHex(0x000000);
      bulbMat.emissiveIntensity = 0;
    }
    const light = getHqBeaconLight(group);
    if (light) light.intensity = 0;
    return;
  }
  const l = Math.min(Math.max(level, 0), 1);
  const dome = getHqBeacon(group);
  const mat = dome?.material as THREE.MeshLambertMaterial | undefined;
  if (dome && mat && "emissive" in mat) {
    mat.emissive.setHex(HQ_BEACON_COLOR);
    mat.emissiveIntensity = 0.12 + 2.2 * l;
  }
  const light = getHqBeaconLight(group);
  if (light) light.intensity = l * HQ_BEACON_PEAK;
}

/** Seated door height (slab top + half door), for tests. */
export function hqDoorBaseY(): number {
  return 4 + HQ_DOOR_H / 2;
}

/**
 * Size both footings so their bottoms sit `drop` world units below the slab
 * underside (local y=0): the footing spans -depth..0 via Y scale + re-seat,
 * so exaggeration re-snaps just call this again. `drop` already includes
 * the burial margin (see `hqFoundationDropWorld`). Clamped at 0 — the
 * footing never pokes above the slab.
 */
export function setHqFoundation(group: THREE.Group, drop: number): void {
  const depth = Math.max(0, drop);
  for (const name of ["hq-foundation", "hq-hall-foundation"]) {
    const mesh = group.getObjectByName(name) as THREE.Mesh | undefined;
    if (!mesh) continue;
    const base = (mesh.userData.baseH as number | undefined) ?? HQ_FOUNDATION_DEPTH;
    if (!(base > 0)) continue;
    mesh.scale.y = depth / base;
    mesh.position.y = -depth / 2;
  }
}

/** Current footing depth below the slab underside, for tests. */
export function foundationDepthOf(group: THREE.Group): number {
  const mesh = group.getObjectByName("hq-foundation") as THREE.Mesh | undefined;
  if (!mesh) return 0;
  const base = (mesh.userData.baseH as number | undefined) ?? HQ_FOUNDATION_DEPTH;
  return base * mesh.scale.y;
}

/**
 * World-space footing drop for an HQ anchor: sample the terrain under the
 * works footprint — the base slab corners/edges/center plus the hall strip
 * toward the map center — and return the drop from the anchor to the lowest
 * sampled ground plus the burial margin. The group stays seated at the
 * anchor while the footings reach the low corner, so uphill concrete buries
 * into the hill and downhill concrete shows instead of air.
 */
export function hqFoundationDropWorld(
  anchor: { x: number; y: number; z: number },
  facing: HqFacing,
  groundY: (x: number, z: number) => number,
): number {
  let low = Infinity;
  const at = (x: number, z: number): void => {
    const g = groundY(x, z);
    if (g < low) low = g;
  };
  for (const dx of [-HQ_BASE_W / 2, -HQ_BASE_W / 4, 0, HQ_BASE_W / 4, HQ_BASE_W / 2]) {
    for (const dz of [-HQ_BASE_D / 2, -HQ_BASE_D / 4, 0, HQ_BASE_D / 4, HQ_BASE_D / 2]) {
      at(anchor.x + dx, anchor.z + dz);
    }
  }
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const hx = anchor.x + facing * (HQ_BASE_W / 2 + HQ_HALL_LEN * t);
    for (const dz of [-15, 0, 15]) at(hx, anchor.z + dz);
  }
  if (!isFinite(low)) return HQ_FOUNDATION_MARGIN;
  return Math.max(0, anchor.y - low) + HQ_FOUNDATION_MARGIN;
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
 * near-black, slam the door crooked, drop the roof, and lean the chimney
 * stacks — the husk reads as a breached works while keeping its roster
 * slot, like every other wreck.
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
  // Chimney stacks lean and sink a little — breached works, not a clean
  // pillbox. Guarded by the wrecked flag above, so this runs exactly once.
  for (const child of group.children) {
    if (child.name === "hq-chimney") {
      child.position.y -= 3;
      child.rotation.z = 0.14;
    }
  }
  // The warning beacon dies with the works: the char pass above already
  // darkened the lens color, but its red emissive would keep glowing, so
  // kill the lens and the wash light outright (and the wrecked flag keeps
  // `setHqBeaconLevel` from ever re-lighting it).
  setHqBeaconLevel(group, 0);
}
