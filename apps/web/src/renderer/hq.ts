import * as THREE from "three";
import { buildHqArchitecture } from "./hqModel";
import { HQ_FOUNDATION_MARGIN, TEAM_DEFS, type TeamId } from "@scorched-3d/core";
import { buildTeamRing } from "./units";

/**
 * Team HQ factory structures: one fortified works per side at its map end,
 * with a sliding front door and an open hall running toward the map center
 * that reinforcements drive out of. The massing reads as a factory, not a
 * pillbox: a walled production hall under a monitor (clerestory) roof with
 * vents and a skylight, twin chimney stacks + caps at the back corners, a
 * silo tank and a side workshop annex on the slab, and a framed sectional
 * door under an armored shutter cassette. Chamfered lofts and layered
 * service panels are cached and batched by Lambert finish in `hqModel`.
 * Each instance owns its resources; the door animation remains one position write per tick
 * and the wreck pose is a one-time recolor. A red warning beacon on the
 * canopy top (a clear lens over a hot centered core, wrapped in a soft
 * additive halo, with twin diffused light-tower cones circling on a rotor)
 * burns while the works stands as the "working building" signal and dies
 * with it.
 *
 * Local frame: the door faces +X. The canvas mirrors team 1 (east) so its
 * door faces the map center (-X world).
 *
 * Nanolathe inspiration (adapted): retail TA-style factories keep the
 * front (+Z) exit lane clear of buildings over its full width and deliver
 * products at the factory exit; here the open hall + hall mouth serve the
 * same role — a clear lane toward the map center where each reinforcement
 * appears at the door-side hall start facing out, then walks the hall out
 * of the mouth into the normal movement pipeline.
 */

/** Bunker base footprint, world units (fits easily inside a map-end column). */
export const HQ_BASE_W = 96;
export const HQ_BASE_D = 76;
/** Wall height above the base slab; the door is slightly shorter. */
export const HQ_WALL_H = 34;
export const HQ_DOOR_W = 34;
export const HQ_DOOR_H = 32;
/** How far the door slides up when a reinforcement drives out (fully clears the opening). */
export const HQ_DOOR_TRAVEL = 32;
/** Hall floor length from the bunker mouth toward the map center. */
export const HQ_HALL_LEN = 130;
/** Hall mouth offset from the HQ origin (door face + hall length). */
export const HQ_EXIT_OFFSET = 48 + HQ_HALL_LEN;
/**
 * Reinforcement spawn offset from the HQ origin: just outside the door
 * (front face + longest spawnable half-hull + door-slab clearance), so the
 * release appears at the works and walks the hall out of the mouth instead
 * of popping in at the mouth.
 */
export const HQ_SPAWN_OFFSET = 64;
/** Concrete + dark trim palette (team color comes from TEAM_DEFS). */
export const HQ_CONCRETE = 0x6b6f75;
export const HQ_DARK = 0x3a3d42;
/** Red warning-beacon lens color: the "working building" signal. */
export const HQ_BEACON_COLOR = 0xff2a1a;
/** One full sweep of the beacon rotor, seconds (slow light-tower circling). */
export const HQ_BEACON_PERIOD = 6;
/** Beacon PointLight peak intensity (physical falloff, combat-pool order). */
export const HQ_BEACON_PEAK = 3200;
/**
 * Beacon falloff range: a faded red wash that travels well past the works
 * + hall + staging apron onto the surrounding ground (the renderer windows
 * the cutoff smoothly, so there is no harsh border at the edge).
 */
export const HQ_BEACON_DISTANCE = 900;
/**
 * Beacon physical-falloff decay: gentler than the combat pools (1.8), so
 * the wash disperses more widely and fades softly with distance instead of
 * dropping off hard — the near-field peak stays `HQ_BEACON_PEAK`.
 */
export const HQ_BEACON_DECAY = 1.5;
/** Beacon dome radius (a bare hemisphere, no mast or platform). */
export const HQ_BEACON_RADIUS = 2;
/**
 * Light-tower beam length, world units: apex at the hot core, far end well
 * past the works over the surroundings, fading out before the rim. Long
 * enough to read at range without reaching the PointLight wash edge.
 */
export const HQ_BEACON_BEAM_LEN = 90;
/**
 * Light-tower beam cone base radius, world units: equals the beam length,
 * so each cone opens to a 45-degree half-angle (up from ~7.6) — a broad
 * wash of red rather than a narrow laser line, its far disc spanning the
 * works and surroundings as it sweeps.
 */
export const HQ_BEACON_BEAM_RADIUS = 90;
/** Light-tower beam peak alpha at full level (additive, per the glow convention). */
export const HQ_BEACON_BEAM_OPACITY = 0.22;
/**
 * Beam axial fade span in cone-UV units (apex v=1, far rim v=0): alpha
 * ramps 0 → 1 over [0, HQ_BEACON_BEAM_FADE], so the far rim melts away with
 * no hard edge. Spans most of the beam for a long gentle melt into the
 * distance rather than a quicker step to full. Shared by the beam GLSL and
 * the pure `hqBeaconBeamAxial` mirror.
 */
export const HQ_BEACON_BEAM_FADE = 0.8;
/**
 * Beam silhouette-fade exponent: alpha scales with |dot(N, V)| ^ EDGE, so
 * the cone flanks melt away at grazing view angles instead of drawing a
 * hard border. Deliberately sublinear: exponents above 1 concentrate the
 * glow at facing-center and leave a dark fringe that outlines the cone —
 * the visible "line" of the angle. Below 1 the flanks hold glow and the
 * whole cone reads as one soft wash; alpha still reaches exactly 0 at the
 * silhouette (0 ^ EDGE = 0), so there is no hard clip, just no fringe.
 * Shared by the beam GLSL below.
 */
export const HQ_BEACON_BEAM_EDGE = 0.7;
/**
 * Diffused halo sprite width/height, world units: a borderless radial glow
 * centered on the hot core, reaching well past the glass.
 */
export const HQ_BEACON_GLOW_SIZE = 14;
/** Diffused halo opacity at full level (additive, per the glow convention). */
export const HQ_BEACON_GLOW_OPACITY = 0.5;
/** Procedural halo texture resolution (square). */
export const HQ_BEACON_GLOW_TEX_SIZE = 64;
/** Beacon dome seat, local frame (bare hemisphere on the canopy top, over the door). */
export const HQ_BEACON_X = 58;
export const HQ_BEACON_Y = 41;
/** Team-flag mast seat, local frame (rear roof crown, clear of the beacon + door). */
export const HQ_FLAG_X = -40;
export const HQ_FLAG_BASE_Y = 36;
/** Flagpole height above its seat; the finial caps the tip. */
export const HQ_FLAG_POLE_H = 34;
/** Flagpole radius (slight taper toward the tip). */
export const HQ_FLAG_POLE_R = 0.9;
/** Team-flag cloth width (streams rearward, away from the door) and height. */
export const HQ_FLAG_W = 20;
export const HQ_FLAG_H = 11;
/** Cloth top edge below the pole tip (finial clearance). */
export const HQ_FLAG_DROP = 1.5;
/** Flagpole + finial steel (the cloth carries the team color). */
export const HQ_FLAG_STEEL = 0x485654;
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

/** World-space door-side spawn position for an HQ anchor + facing. */
export function hqSpawnWorld(anchor: { x: number; z: number }, facing: HqFacing): { x: number; z: number } {
  return { x: anchor.x + facing * HQ_SPAWN_OFFSET, z: anchor.z };
}

/**
 * Departure lead-in for a release, past the hall mouth along `facing`: the
 * one-shot straight walk out of the hall. Sits ON the anchor row just past
 * the mouth — past the curb ends (which terminate at the mouth), so the
 * veer onto the loop can only start once the hull is clear of the hall, and
 * close enough that the exit drive stays short. Arrival joins the loop the
 * same tick and never repeats, so the straight exit does not need a loop
 * leg of its own (a cyclic patrol alone cannot express "lead in, then
 * loop": any on-lane loop waypoint gets revisited every cycle, which kept
 * staged hulls re-entering the road twice per cycle and the road occupied
 * ~95% of the time with a full cap of releases).
 */
export const HQ_STAGING_LEAD_AHEAD = 24;
/** Near loop point ahead of the mouth (halfway to the legacy lane end). */
export const HQ_STAGING_NEAR_AHEAD = 160;
/** Far loop point ahead of the mouth (the legacy lane-end distance). */
export const HQ_STAGING_FAR_AHEAD = 320;
/**
 * Loop lateral off the anchor row: clear of the graded lane (2.5 cells ≈
 * 40) plus a full spacing stop (48), so a staged hull never pins an
 * exiting hull — and every loop leg runs parallel to the road instead of
 * crossing back onto it.
 */
export const HQ_STAGING_SIDE = 96;

/** Which side of the exit lane a release stages on (releases alternate). */
export type HqStagingSide = 1 | -1;

/** A release's departure plus its off-lane staging loop. */
export interface HqStagingRoute {
  /** One-shot straight exit past the mouth, on the anchor row. */
  leadIn: { x: number; z: number };
  /** [near, far] staging loop, both points off the lane. */
  loop: { x: number; z: number }[];
}

/**
 * Staging route for an HQ mouth `exit` + facing + side: the mover seeds at
 * the door on the departure (straight down the hall, past the mouth — a
 * straight leg from inside the hall to an off-road point would grind
 * through the curb wall, so the veer must happen past the mouth), then
 * joins the loop at the near point. Both loop points sit past the mouth on
 * the release's side of the lane, so staged hulls drive beside the road
 * and the entrance stays passable for the next release.
 */
export function hqStagingRoute(
  exit: { x: number; z: number },
  facing: HqFacing,
  side: HqStagingSide,
): HqStagingRoute {
  const s = side < 0 ? -1 : 1;
  return {
    leadIn: { x: exit.x + facing * HQ_STAGING_LEAD_AHEAD, z: exit.z },
    loop: [
      { x: exit.x + facing * HQ_STAGING_NEAR_AHEAD, z: exit.z + s * HQ_STAGING_SIDE },
      { x: exit.x + facing * HQ_STAGING_FAR_AHEAD, z: exit.z + s * HQ_STAGING_SIDE },
    ],
  };
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
 * Diffused light-tower beam material: an additive shader over an open cone
 * whose alpha melts away both along the beam (bright at the hot-core apex,
 * gone at the far rim) and across the silhouette (flanks fade at grazing
 * view angles), so the circling cones read as volumeless glow with no hard
 * borders. `uLevel` (0..1) follows `setHqBeaconLevel`; wrecks park it at 0.
 */
function makeHqBeaconBeamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(HQ_BEACON_COLOR) },
      uOpacity: { value: HQ_BEACON_BEAM_OPACITY },
      uLevel: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalMatrix * normal;
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uLevel;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float axial = smoothstep(0.0, ${HQ_BEACON_BEAM_FADE.toFixed(2)}, vUv.y);
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float edge = pow(facing, ${HQ_BEACON_BEAM_EDGE.toFixed(2)});
        gl_FragColor = vec4(uColor, uOpacity * uLevel * axial * edge);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
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

  buildHqArchitecture(group, TEAM_DEFS[team]?.color ?? 0xffffff);
  const ring = buildTeamRing(team);
  ring.scale.setScalar(3);
  group.add(ring);

  // Warning beacon on the canopy top, centered over the door: a clear red
  // lens (`hq-beacon`, bare hemisphere — no mast, no platform) over a
  // white-hot core (`hq-beacon-bulb`) on the dome's center axis with one
  // cheap no-shadow PointLight (`hq-beacon-light`) beside it, so the light
  // reads as emanating from the center instead of a red disc pasted on
  // top. A single additive halo sprite (`hq-beacon-glow`, a radial
  // gradient fading to transparent at the rim) wraps the core in a soft
  // diffused glow while the PointLight washes the same red onto the
  // surrounding surfaces, and twin diffused light-tower cones
  // (`hq-beacon-beam-*`) circle on a rotor (`hq-beacon-rotor`) around the
  // core like a lighthouse — the visible sweep that sells the tower. The
  // level tick drives the whole stack via `setHqBeaconLevel` and spins the
  // rotor via `setHqBeaconAngle`; wrecks kill it for good.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(HQ_BEACON_RADIUS, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({
      color: HQ_BEACON_COLOR,
      emissive: HQ_BEACON_COLOR,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.3,
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
  // Twin light-tower beams: open diffused-shader cones with their apexes
  // at the hot core, pointing in opposite horizontal directions from the
  // rotor. The cone geometry starts apex-up along +Y, so seat the apex at
  // the origin and tip it onto +X; the second mesh mirrors it with a half
  // turn. Each mesh owns its material (per-HQ level drive) over one shared
  // geometry — the axial fade runs apex-bright → rim-gone along the cone
  // UVs (v=1 at the apex, v=0 at the far rim).
  const beamGeo = new THREE.ConeGeometry(HQ_BEACON_BEAM_RADIUS, HQ_BEACON_BEAM_LEN, 12, 1, true);
  beamGeo.translate(0, -HQ_BEACON_BEAM_LEN / 2, 0);
  beamGeo.rotateZ(Math.PI / 2);
  for (const s of [1, -1]) {
    const beam = new THREE.Mesh(beamGeo, makeHqBeaconBeamMaterial());
    beam.name = s > 0 ? "hq-beacon-beam-a" : "hq-beacon-beam-b";
    beam.position.set(0, 1, 0);
    if (s < 0) beam.rotation.y = Math.PI;
    tag(beam);
    rotor.add(beam);
  }
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 12, 10),
    new THREE.MeshLambertMaterial({
      color: 0xfff2ea,
      emissive: HQ_BEACON_COLOR,
      emissiveIntensity: 3.2,
    }),
  );
  bulb.name = "hq-beacon-bulb";
  bulb.position.set(HQ_BEACON_X, HQ_BEACON_Y + 1, 0);
  bulb.userData.baseY = bulb.position.y;
  tag(bulb);
  group.add(bulb);
  // Diffused halo: one view-facing billboard with a procedural radial
  // falloff texture (a DataTexture, safe in headless/node tests — the same
  // approach as the day-fog banks), so the glow fades out with no edge.
  const glowTex = new THREE.DataTexture(
    makeHqBeaconGlowTextureData(HQ_BEACON_GLOW_TEX_SIZE),
    HQ_BEACON_GLOW_TEX_SIZE,
    HQ_BEACON_GLOW_TEX_SIZE,
  );
  glowTex.needsUpdate = true;
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: HQ_BEACON_COLOR,
      transparent: true,
      opacity: HQ_BEACON_GLOW_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.name = "hq-beacon-glow";
  glow.position.set(HQ_BEACON_X, HQ_BEACON_Y + 1, 0);
  glow.scale.set(HQ_BEACON_GLOW_SIZE, HQ_BEACON_GLOW_SIZE, 1);
  tag(glow);
  group.add(glow);
  const beaconLight = new THREE.PointLight(HQ_BEACON_COLOR, HQ_BEACON_PEAK, HQ_BEACON_DISTANCE, HQ_BEACON_DECAY);
  beaconLight.name = "hq-beacon-light";
  beaconLight.position.set(HQ_BEACON_X, HQ_BEACON_Y + 1, 0);
  group.add(beaconLight);
  group.userData.hqBeaconLevel = 1;

  // Team flag on the rear roof crown: a steel pole (`hq-flag-pole`) with a
  // finial ball, flying a team-colored cloth (`hq-flag`, a DoubleSide
  // Lambert plane so it reads from any orbit angle) that streams rearward
  // (-X local, away from the door + beacon). The color comes straight from
  // TEAM_DEFS — the same source as the ground ring and architecture trim —
  // with no emissive, so the wreck char pass kills it like every other
  // Lambert surface. The whole mast rides one group (`hq-flag-mast`) so the
  // wreck pose can lean it in one write; team 1's canvas mirror keeps the
  // cloth streaming toward its own map edge.
  const teamColor = TEAM_DEFS[team]?.color ?? 0xffffff;
  const mast = new THREE.Group();
  mast.name = "hq-flag-mast";
  mast.position.set(HQ_FLAG_X, HQ_FLAG_BASE_Y, 0);
  group.add(mast);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(HQ_FLAG_POLE_R * 0.75, HQ_FLAG_POLE_R, HQ_FLAG_POLE_H, 10),
    new THREE.MeshLambertMaterial({ color: HQ_FLAG_STEEL }),
  );
  pole.name = "hq-flag-pole";
  pole.position.set(0, HQ_FLAG_POLE_H / 2, 0);
  tag(pole);
  mast.add(pole);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(HQ_FLAG_W, HQ_FLAG_H),
    new THREE.MeshLambertMaterial({ color: teamColor, side: THREE.DoubleSide }),
  );
  cloth.name = "hq-flag";
  cloth.position.set(
    -(HQ_FLAG_W / 2 + HQ_FLAG_POLE_R),
    HQ_FLAG_POLE_H - HQ_FLAG_DROP - HQ_FLAG_H / 2,
    0,
  );
  tag(cloth);
  mast.add(cloth);
  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(HQ_FLAG_POLE_R * 1.6, 12, 10),
    new THREE.MeshLambertMaterial({ color: HQ_FLAG_STEEL }),
  );
  finial.name = "hq-flag-finial";
  finial.position.set(0, HQ_FLAG_POLE_H, 0);
  tag(finial);
  mast.add(finial);

  const hallCx = 48 + HQ_HALL_LEN / 2;
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

/** Warning-beacon hot core of an HQ group, or null (plain test groups). */
export function getHqBeaconBulb(group: THREE.Group): THREE.Mesh | null {
  return (group.getObjectByName("hq-beacon-bulb") as THREE.Mesh | undefined) ?? null;
}

/** Warning-beacon light-tower beams riding the rotor (empty on plain test groups). */
export function getHqBeaconBeams(group: THREE.Group): THREE.Mesh[] {
  const rotor = getHqBeaconRotor(group);
  if (!rotor) return [];
  return rotor.children.filter(
    (c): c is THREE.Mesh => c.type === "Mesh" && c.name.startsWith("hq-beacon-beam"),
  );
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
 * Beam axial fade 0..1 at cone-UV `v` (apex v=1, far rim v=0): the pure
 * mirror of the `smoothstep(0, HQ_BEACON_BEAM_FADE, vUv.y)` in the beam
 * GLSL — 0 at the far rim, full past the fade span, clamped outside.
 */
export function hqBeaconBeamAxial(v: number): number {
  const t = Math.min(1, Math.max(0, v / HQ_BEACON_BEAM_FADE));
  return t * t * (3 - 2 * t);
}

/** Warning-beacon diffused halo of an HQ group, or null (plain test groups). */
export function getHqBeaconGlow(group: THREE.Group): THREE.Sprite | null {
  return (group.getObjectByName("hq-beacon-glow") as THREE.Sprite | undefined) ?? null;
}

/** Team-flag cloth of an HQ group, or null (plain test groups). */
export function getHqFlag(group: THREE.Group): THREE.Mesh | null {
  return (group.getObjectByName("hq-flag") as THREE.Mesh | undefined) ?? null;
}

/** Team-flag mast of an HQ group, or null (plain test groups). */
export function getHqFlagMast(group: THREE.Group): THREE.Group | null {
  return (group.getObjectByName("hq-flag-mast") as THREE.Group | undefined) ?? null;
}

/**
 * Halo texel alpha 0..1 at normalized coords (u, v) in [-1, 1]: a smooth
 * radial falloff, brightest at the hot core and exactly 0 at the rim, so
 * the glow fades out with no visible border. Pure math — the DataTexture
 * builder samples this per texel.
 */
export function hqBeaconGlowAlpha(u: number, v: number): number {
  const t = Math.min(1, Math.max(0, 1 - Math.hypot(u, v)));
  return t * t * (3 - 2 * t);
}

/** RGBA bytes for the halo texture (opaque-white RGB, radial alpha). */
export function makeHqBeaconGlowTextureData(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      const u = (ix / (size - 1)) * 2 - 1;
      const v = (iz / (size - 1)) * 2 - 1;
      const o = (iz * size + ix) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round(hqBeaconGlowAlpha(u, v) * 255);
    }
  }
  return data;
}

/**
 * Seat the beacon core + halo + beams from the stored level (0..1): the
 * hot core holds a steady burn on the dome axis (no swell, no bob) while
 * the halo holds a steady opacity past the lens and the rotor beams follow
 * through their `uLevel` uniform (the tick owns the rotor angle — the
 * level never touches it). Wrecks and level 0 keep the whole stack dark
 * and hide the halo + beams.
 */
function applyBeaconCore(group: THREE.Group): void {
  const wrecked = group.userData.hqWrecked === true;
  const level = wrecked ? 0 : ((group.userData.hqBeaconLevel as number | undefined) ?? 1);
  const bulb = getHqBeaconBulb(group);
  if (bulb) {
    const mat = bulb.material as THREE.MeshLambertMaterial | undefined;
    if (mat && "emissive" in mat) {
      if (wrecked) {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      } else {
        mat.emissive.setHex(HQ_BEACON_COLOR);
        mat.emissiveIntensity = 3.2 * level;
      }
    }
    const baseY = (bulb.userData.baseY as number | undefined) ?? HQ_BEACON_Y + 1;
    bulb.position.y = baseY;
    bulb.scale.setScalar(1);
  }
  const glow = getHqBeaconGlow(group);
  if (glow) {
    const mat = glow.material as THREE.SpriteMaterial | undefined;
    if (mat) mat.opacity = level * HQ_BEACON_GLOW_OPACITY;
    glow.visible = !wrecked && level > 0;
  }
  for (const beam of getHqBeaconBeams(group)) {
    const mat = beam.material as THREE.ShaderMaterial | undefined;
    const uLevel = mat?.uniforms?.uLevel as { value: number } | undefined;
    if (uLevel) uLevel.value = level;
    beam.visible = !wrecked && level > 0;
  }
}

/**
 * Drive the beacon to `level` 0..1 (clamped): the lens burns at full flash
 * and falls back to faint glass when dark, the PointLight scales to `peak`
 * (default `HQ_BEACON_PEAK` — night passes the boosted peak) so the faded
 * wash over the works + hall + staging apron holds steady with it, and the
 * core + halo + rotor beams follow through `applyBeaconCore`. A wrecked HQ
 * stays dark — wrecks never re-light.
 */
export function setHqBeaconLevel(group: THREE.Group, level: number, peak = HQ_BEACON_PEAK): void {
  const l = Math.min(Math.max(level, 0), 1);
  group.userData.hqBeaconLevel = l;
  if (group.userData.hqWrecked) {
    const dome = getHqBeacon(group);
    const mat = dome?.material as THREE.MeshLambertMaterial | undefined;
    if (dome && mat && "emissive" in mat) {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }
    const light = getHqBeaconLight(group);
    if (light) light.intensity = 0;
    applyBeaconCore(group);
    return;
  }
  const dome = getHqBeacon(group);
  const mat = dome?.material as THREE.MeshLambertMaterial | undefined;
  if (dome && mat && "emissive" in mat) {
    mat.emissive.setHex(HQ_BEACON_COLOR);
    mat.emissiveIntensity = 0.1 + 1.1 * l;
  }
  const light = getHqBeaconLight(group);
  if (light) light.intensity = l * peak;
  applyBeaconCore(group);
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
  // The complete roof crown settles together, including its vents and trim.
  const roof = group.getObjectByName("hq-roof");
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
  // The flag mast topples with the works (the char pass above already
  // killed the cloth's team color — plain Lambert, no emissive to quench).
  const mast = getHqFlagMast(group);
  if (mast) {
    mast.position.y -= 2;
    mast.rotation.z = 0.22;
  }
  // The warning beacon dies with the works: the char pass above already
  // darkened the lens color, but its red emissive would keep glowing, so
  // kill the lens, core, halo, beams, and wash light outright (and the
  // wrecked flag keeps `setHqBeaconLevel` from ever re-lighting them).
  setHqBeaconLevel(group, 0);
}
