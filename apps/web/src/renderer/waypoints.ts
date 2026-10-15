import * as THREE from "three";
import { ARRIVE_RADIUS, type Mover, type RoutePoint } from "@scorched-3d/core";
import type { UnitMovement } from "./movement";

/**
 * Waypoint overlay for the View menu: each live unit's looping patrol route
 * plus its in-progress move-order path, drawn as ground-hugging lines with a
 * diamond marker on every patrol waypoint and the order destination.
 *
 * Patrol loops are static per regen (re-seated on exaggeration change);
 * order paths rebuild per tick from the mover's remaining order points.
 * Wrecks show nothing (they hold forever), and degenerate hold-routes
 * (all waypoints coincident, e.g. a spawn with no gentle ground nearby)
 * show no patrol loop. Owns one `THREE.Group` in the scene; `dispose()`
 * removes it and frees GPU resources.
 */

export const WAYPOINT_PATROL_COLOR = 0xe2e8f0;
export const WAYPOINT_ORDER_COLOR = 0xfbbf24;
/** Height above the terrain surface so lines never z-fight the mesh. */
export const WAYPOINT_LIFT = 3;
/** Below selection markers (10), above scorch decals (2). */
export const WAYPOINT_RENDER_ORDER = 9;

export interface WaypointEnv {
  /** Terrain surface height at world (x, z), tracking live exaggeration. */
  groundY: (x: number, z: number) => number;
}

/** True when every waypoint sits on the same spot (a holding unit). */
export function isHoldingRoute(route: readonly RoutePoint[]): boolean {
  if (route.length < 2) return true;
  const first = route[0]!;
  return route.every(
    (p) => (p.x - first.x) * (p.x - first.x) + (p.z - first.z) * (p.z - first.z) <= ARRIVE_RADIUS * ARRIVE_RADIUS,
  );
}

/** Remaining order path: live position + unvisited order points. */
export function remainingOrderPoints(mover: Mover): RoutePoint[] {
  const order = mover.order;
  if (!order || order.at < 0 || order.at >= order.points.length) return [];
  return [{ x: mover.x, z: mover.z }, ...order.points.slice(order.at)];
}

export class WaypointFx {
  private scene: THREE.Scene;
  private env: WaypointEnv;
  private routes: RoutePoint[][];
  readonly group = new THREE.Group();
  private patrol: { loop: THREE.LineLoop; dots: THREE.Mesh[]; route: RoutePoint[] }[] = [];
  private orders: { line: THREE.Line; marker: THREE.Mesh }[] = [];
  private visible = true;
  private lastMovers: Mover[] = [];
  private lastDestroyed: boolean[] = [];
  private disposed = false;

  constructor(scene: THREE.Scene, routes: RoutePoint[][], env: WaypointEnv) {
    this.scene = scene;
    this.env = env;
    this.routes = routes;
    this.group.name = "waypoints";
    this.scene.add(this.group);
    this.rebuildPatrol();
  }

  /** Live order path of a unit (remaining points), for tests. */
  orderPoints(index: number): RoutePoint[] {
    const line = this.orders[index]?.line;
    if (!line || !line.visible) return [];
    const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const out: RoutePoint[] = [];
    for (let i = 0; i < pos.count; i++) out.push({ x: pos.getX(i), z: pos.getZ(i) });
    return out;
  }

  /** Whether the patrol loop for a unit is currently drawn. */
  hasPatrol(index: number): boolean {
    return this.patrol[index]?.loop.visible ?? false;
  }

  /** Rebuild static patrol loops after regen (routes are fixed per seed). */
  setRoutes(routes: RoutePoint[][]): void {
    this.routes = routes;
    this.rebuildPatrol();
    this.refreshOrders();
    this.applyVisibility();
  }

  /** Per-tick refresh of live order paths from movement state. */
  update(movement: Pick<UnitMovement, "moverState" | "isDestroyed">, count: number): void {
    if (this.disposed) return;
    this.lastMovers = [];
    this.lastDestroyed = [];
    for (let i = 0; i < count; i++) {
      const mover = movement.moverState(i);
      if (!mover) continue;
      this.lastMovers[i] = mover;
      this.lastDestroyed[i] = movement.isDestroyed(i);
    }
    this.refreshOrders();
    this.refreshPatrolVisibility();
    this.applyVisibility();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.applyVisibility();
  }

  /** Re-seat every line/dot on the terrain surface (exaggeration change). */
  resnap(): void {
    if (this.disposed) return;
    for (const entry of this.patrol) {
      const pos = entry.loop.geometry.getAttribute("position") as THREE.BufferAttribute;
      entry.route.forEach((p, i) => pos.setY(i, this.env.groundY(p.x, p.z) + WAYPOINT_LIFT));
      pos.needsUpdate = true;
      entry.dots.forEach((dot, i) => {
        const p = entry.route[i]!;
        dot.position.set(p.x, this.env.groundY(p.x, p.z) + WAYPOINT_LIFT, p.z);
      });
    }
    this.refreshOrders();
    this.applyVisibility();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      const mesh = child as THREE.Line | THREE.Mesh;
      const geo = (mesh as THREE.Line).geometry as THREE.BufferGeometry | undefined;
      geo?.dispose();
      const mat = (mesh as THREE.Line).material as THREE.Material | undefined;
      if (mat && !(mat as { __sharedWaypoint?: boolean }).__sharedWaypoint) mat.dispose();
    });
    this.group.clear();
  }

  private rebuildPatrol(): void {
    for (const entry of this.patrol) {
      this.group.remove(entry.loop);
      entry.loop.geometry.dispose();
      for (const dot of entry.dots) {
        this.group.remove(dot);
        dot.geometry.dispose();
      }
    }
    for (const order of this.orders) {
      this.group.remove(order.line, order.marker);
      order.line.geometry.dispose();
      order.marker.geometry.dispose();
    }
    this.patrol = [];
    this.orders = [];
    const dotGeo = new THREE.OctahedronGeometry(6);
    this.routes.forEach((route) => {
      const positions = new Float32Array(route.length * 3);
      route.forEach((p, i) => {
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = this.env.groundY(p.x, p.z) + WAYPOINT_LIFT;
        positions[i * 3 + 2] = p.z;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: WAYPOINT_PATROL_COLOR,
        transparent: true,
        opacity: 0.55,
      });
      const loop = new THREE.LineLoop(geo, mat);
      loop.name = "waypoint-patrol";
      loop.renderOrder = WAYPOINT_RENDER_ORDER;
      this.group.add(loop);
      const dots = route.map((p) => {
        const dot = new THREE.Mesh(
          dotGeo.clone(),
          new THREE.MeshBasicMaterial({ color: WAYPOINT_PATROL_COLOR, transparent: true, opacity: 0.85 }),
        );
        dot.name = "waypoint-dot";
        dot.position.set(p.x, this.env.groundY(p.x, p.z) + WAYPOINT_LIFT, p.z);
        dot.renderOrder = WAYPOINT_RENDER_ORDER;
        this.group.add(dot);
        return dot;
      });
      this.patrol.push({ loop, dots, route });
      const orderGeo = new THREE.BufferGeometry();
      orderGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
      const orderLine = new THREE.Line(
        orderGeo,
        new THREE.LineBasicMaterial({ color: WAYPOINT_ORDER_COLOR, transparent: true, opacity: 0.9 }),
      );
      orderLine.name = "waypoint-order";
      orderLine.renderOrder = WAYPOINT_RENDER_ORDER + 1;
      orderLine.visible = false;
      orderLine.frustumCulled = false;
      this.group.add(orderLine);
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(9),
        new THREE.MeshBasicMaterial({ color: WAYPOINT_ORDER_COLOR, transparent: true, opacity: 0.95 }),
      );
      marker.name = "waypoint-dest";
      marker.visible = false;
      marker.renderOrder = WAYPOINT_RENDER_ORDER + 1;
      this.group.add(marker);
      this.orders.push({ line: orderLine, marker });
    });
  }

  private refreshPatrolVisibility(): void {
    this.patrol.forEach((entry, i) => {
      const show = !this.lastDestroyed[i] && !isHoldingRoute(entry.route);
      entry.loop.visible = show;
      entry.dots.forEach((dot) => {
        dot.visible = show;
      });
    });
  }

  private refreshOrders(): void {
    this.refreshPatrolVisibility();
    this.orders.forEach((order, i) => {
      const mover = this.lastMovers[i];
      const destroyed = this.lastDestroyed[i] ?? false;
      const pts = mover && !destroyed ? remainingOrderPoints(mover) : [];
      if (pts.length < 2) {
        order.line.visible = false;
        order.marker.visible = false;
        return;
      }
      const positions = new Float32Array(pts.length * 3);
      pts.forEach((p, j) => {
        positions[j * 3] = p.x;
        positions[j * 3 + 1] = this.env.groundY(p.x, p.z) + WAYPOINT_LIFT + 1;
        positions[j * 3 + 2] = p.z;
      });
      order.line.geometry.dispose();
      order.line.geometry = new THREE.BufferGeometry();
      order.line.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      order.line.visible = true;
      const dest = pts[pts.length - 1]!;
      order.marker.position.set(dest.x, this.env.groundY(dest.x, dest.z) + WAYPOINT_LIFT + 1, dest.z);
      order.marker.visible = true;
    });
  }

  private applyVisibility(): void {
    this.group.visible = this.visible;
  }
}
