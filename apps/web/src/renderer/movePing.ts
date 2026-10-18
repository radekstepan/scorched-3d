import * as THREE from "three";
import { SELECTION_CORE, SELECTION_RENDER_ORDER } from "./selectionFx";

/**
 * Move-order ping: the short-lived expanding circle where a right-click
 * move order landed.
 *
 * Previously this was a plain depth-tested ring at `groundY + 1.5`, so on
 * hilly terrain the far side dipped under the mesh and the circle read as
 * "cut off". Unit selection never does that: it composites with
 * `depthTest: false` above the terrain/scorch layers. The
 * ping now shares exactly that policy — same color, same depth-ignored
 * compositing, same render-order band — so the destination circle always
 * draws whole, like the ring around the unit itself.
 */

export const MOVE_PING_INNER = 10;
export const MOVE_PING_OUTER = 13;
export const MOVE_PING_SEGMENTS = 40;
/** Height above the terrain surface (matches the selection halo band). */
export const MOVE_PING_LIFT = 1.5;
/** Ping lifetime, seconds (matches the TerrainCanvas decay tick). */
export const MOVE_PING_DURATION = 0.8;
/** Final scale at the end of life (1 + k * 2.5 in the tick). */
export const MOVE_PING_END_SCALE = 3.5;
/** Cap on live pings (oldest is recycled). */
export const MOVE_PING_MAX = 8;
/** Pings composite in the selection band, above scorch decals. */
export const MOVE_PING_RENDER_ORDER = SELECTION_RENDER_ORDER;
/**
 * Attack-order ping tint: the waypoint pursuit rose (`WAYPOINT_PURSUIT_COLOR`
 * in waypoints.ts, duplicated as a literal so this module stays dependency-
 * free) — a move pings cyan like its selection ring, an attack pings rose
 * like the pursuit trail the ordered hulls will draw.
 */
export const ATTACK_PING_COLOR = 0xfb7185;

/** Shared flat ring geometry for pings (XZ plane, like the selection rings). */
export function buildMovePingGeometry(): THREE.RingGeometry {
  const geo = new THREE.RingGeometry(MOVE_PING_INNER, MOVE_PING_OUTER, MOVE_PING_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Ping material: selection-cyan by default (move orders) with the selection
 * compositing policy (transparent, depth-test off so hills never clip it,
 * depth-write off so it never z-fights the terrain). Attack orders pass
 * `ATTACK_PING_COLOR`. Clone per ping — opacity animates independently as
 * each ring expands and fades.
 */
export function buildMovePingMaterial(color: number = SELECTION_CORE): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });
}

/** Build one ping mesh at world (x, z), seated `LIFT` above `groundY`. */
export function buildMovePing(
  geo: THREE.BufferGeometry,
  x: number,
  z: number,
  groundY: (x: number, z: number) => number,
  color?: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, buildMovePingMaterial(color));
  mesh.name = "move-ping";
  mesh.position.set(x, groundY(x, z) + MOVE_PING_LIFT, z);
  mesh.renderOrder = MOVE_PING_RENDER_ORDER;
  mesh.userData.noHighlight = true;
  return mesh;
}

/** Ping expansion at life fraction `k` (0 = just ordered, 1 = gone). */
export function movePingScale(k: number): number {
  return 1 + k * 2.5;
}

/** Ping opacity at life fraction `k` (fades linearly to zero). */
export function movePingOpacity(k: number): number {
  return 0.9 * (1 - k);
}
