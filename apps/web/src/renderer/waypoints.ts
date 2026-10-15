import * as THREE from "three";
import {
  ARRIVE_RADIUS,
  hasOrder,
  predictDrivenPath,
  type Mover,
  type RoutePoint,
  type SeatField,
  type UnitKind,
} from "@scorched-3d/core";

/**
 * Waypoint overlay for the View menu: each live unit's looping patrol route
 * plus its in-progress move-order path, drawn as ground-hugging lines with a
 * diamond marker on every patrol waypoint and the order destination.
 *
 * Patrol loops are static per regen (re-seated on exaggeration change); the
 * live path each unit is actually trying to take redraws per tick — the
 * driven line the hull will really follow (simulated forward through the
 * same turn-rate caps, alignment grip, and terrain gating the movers drive,
 * so corners read as arcs and walls read as stops instead of straight
 * waypoint chords), amber for orders and bright slate for patrols — with an
 * animated tracer diamond flowing along it so the overlay reads direction
 * at a glance. The next patrol waypoint's diamond scales up to mark the
 * current leg. Wrecks and holders show nothing (they hold forever),
 * degenerate hold-routes (all waypoints coincident) show no patrol, and
 * ordered units hide their patrol loop so the overlay never promises two
 * futures at once. Owns one `THREE.Group` in the scene; `dispose()` removes
 * it and frees GPU resources.
 */

export const WAYPOINT_PATROL_COLOR = 0xe2e8f0;
export const WAYPOINT_ORDER_COLOR = 0xfbbf24;
/** Bright slate for the live patrol trail (static loops stay dimmer). */
export const WAYPOINT_TRAIL_COLOR = 0xf1f5f9;
/** Height above the terrain surface so lines never z-fight the mesh. */
export const WAYPOINT_LIFT = 3;
/** Below selection markers (10), above scorch decals (2). */
export const WAYPOINT_RENDER_ORDER = 9;
/** Tracer speed along the live path, world units per second. */
export const WAYPOINT_FLOW_SPEED = 70;
/** Spacing offset between units' tracers so they never march in sync. */
export const WAYPOINT_FLOW_STRIDE = 53;
/** Scale factor of the next-waypoint diamond vs the rest. */
export const WAYPOINT_NEXT_SCALE = 1.7;

export interface WaypointEnv {
  /** Terrain surface height at world (x, z), tracking live exaggeration. */
  groundY: (x: number, z: number) => number;
  /**
   * Static heightfield for driven-path prediction (terrain gating), so the
   * trail refuses the same slopes the hulls refuse. Absent, trails still
   * curve through turn arcs — just without the wall stops.
   */
  field?: SeatField | null;
}

/** Movement state the overlay reads: kinds are optional (default flash). */
export interface WaypointMovement {
  moverState(index: number): Mover | null;
  isDestroyed(index: number): boolean;
  kindAt?(index: number): UnitKind;
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

/**
 * Remaining patrol path: live position + the upcoming loop waypoints in
 * visit order, wrapping around (leg, leg+1, …, leg-1), so the trail starts
 * where the hull is and ends where it will have looped once. Empty for
 * holders, ordered units (their live path is the order tail), degenerate
 * hold-routes, and short routes.
 */
export function remainingPatrolPoints(mover: Mover, route: readonly RoutePoint[]): RoutePoint[] {
  if (!route || route.length < 2 || isHoldingRoute(route)) return [];
  if (mover.hold || hasOrder(mover)) return [];
  const n = route.length;
  const leg = ((mover.leg % n) + n) % n;
  const pts: RoutePoint[] = [{ x: mover.x, z: mover.z }];
  for (let k = 0; k < n; k++) {
    const p = route[(leg + k) % n]!;
    pts.push({ x: p.x, z: p.z });
  }
  return pts;
}

/** Which live path a unit is trying to take (null = holding still). */
export function activeTrailMode(mover: Mover, route: readonly RoutePoint[] | undefined): "order" | "patrol" | null {
  if (!mover || mover.hold) return null;
  if (hasOrder(mover)) return "order";
  if (!route || isHoldingRoute(route)) return null;
  return "patrol";
}

/**
 * Walk `distance` world units along a polyline; returns the point plus the
 * segment direction (for tests; the renderer only needs the position).
 * Pure helper — the animated tracer rides on this.
 */
export function pointAlongPath(
  points: readonly RoutePoint[],
  distance: number,
): { x: number; z: number; dx: number; dz: number } {
  if (points.length === 0) return { x: 0, z: 0, dx: 0, dz: 0 };
  const first = points[0]!;
  if (points.length === 1 || !(distance > 0)) return { x: first.x, z: first.z, dx: 0, dz: 0 };
  let remaining = distance;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg <= 1e-9) continue;
    if (remaining <= seg) {
      const k = remaining / seg;
      return {
        x: a.x + (b.x - a.x) * k,
        z: a.z + (b.z - a.z) * k,
        dx: (b.x - a.x) / seg,
        dz: (b.z - a.z) / seg,
      };
    }
    remaining -= seg;
  }
  const last = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const seg = Math.hypot(last.x - prev.x, last.z - prev.z) || 1;
  return { x: last.x, z: last.z, dx: (last.x - prev.x) / seg, dz: (last.z - prev.z) / seg };
}

export class WaypointFx {
  private scene: THREE.Scene;
  private env: WaypointEnv;
  private routes: RoutePoint[][];
  readonly group = new THREE.Group();
  private patrol: { loop: THREE.LineLoop; dots: THREE.Mesh[]; route: RoutePoint[] }[] = [];
  private orders: { line: THREE.Line; marker: THREE.Mesh }[] = [];
  private trails: THREE.Line[] = [];
  private flows: THREE.Mesh[] = [];
  private visible = true;
  private lastMovers: Mover[] = [];
  private lastDestroyed: boolean[] = [];
  private lastKinds: UnitKind[] = [];
  private lastTime = 0;
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

  /** Live patrol trail of a unit (live position + upcoming loop), for tests. */
  trailPoints(index: number): RoutePoint[] {
    const line = this.trails[index];
    if (!line || !line.visible) return [];
    const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const out: RoutePoint[] = [];
    for (let i = 0; i < pos.count; i++) out.push({ x: pos.getX(i), z: pos.getZ(i) });
    return out;
  }

  /** Which live path a unit is currently showing, for tests. */
  trailMode(index: number): "order" | "patrol" | null {
    if (this.orders[index]?.line.visible) return "order";
    if (this.trails[index]?.visible) return "patrol";
    return null;
  }

  /** Tracer position of a unit along its live path, for tests. */
  flowPosition(index: number): { x: number; z: number } | null {
    const flow = this.flows[index];
    if (!flow || !flow.visible) return null;
    return { x: flow.position.x, z: flow.position.z };
  }

  /** Whether the patrol loop for a unit is currently drawn. */
  hasPatrol(index: number): boolean {
    return this.patrol[index]?.loop.visible ?? false;
  }

  /** Rebuild static patrol loops after regen (routes are fixed per seed). */
  setRoutes(routes: RoutePoint[][]): void {
    this.routes = routes;
    this.rebuildPatrol();
    this.refreshLive();
    this.applyVisibility();
  }

  /** Per-tick refresh of live paths from movement state. */
  update(movement: WaypointMovement, count: number, time = 0): void {
    if (this.disposed) return;
    this.lastTime = time;
    this.lastMovers = [];
    this.lastDestroyed = [];
    this.lastKinds = [];
    for (let i = 0; i < count; i++) {
      const mover = movement.moverState(i);
      if (!mover) continue;
      this.lastMovers[i] = mover;
      this.lastDestroyed[i] = movement.isDestroyed(i);
      this.lastKinds[i] = movement.kindAt?.(i) ?? "flash";
    }
    // Overlay off: stash state for the toggle but skip the per-tick
    // re-simulation (predictions cost up to hundreds of drive steps each).
    if (!this.visible) return;
    this.refreshLive();
    this.applyVisibility();
  }

  setVisible(visible: boolean): void {
    const was = this.visible;
    this.visible = visible;
    // Toggling on repaints immediately from the stashed movers instead of
    // waiting a tick, so the overlay reads as instant.
    if (visible && !was) this.refreshLive();
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
    this.refreshLive();
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
      (entry.loop.material as THREE.Material).dispose();
      for (const dot of entry.dots) {
        this.group.remove(dot);
        dot.geometry.dispose();
        (dot.material as THREE.Material).dispose();
      }
    }
    for (const order of this.orders) {
      this.group.remove(order.line, order.marker);
      order.line.geometry.dispose();
      (order.line.material as THREE.Material).dispose();
      order.marker.geometry.dispose();
      (order.marker.material as THREE.Material).dispose();
    }
    for (const trail of this.trails) {
      this.group.remove(trail);
      trail.geometry.dispose();
      (trail.material as THREE.Material).dispose();
    }
    for (const flow of this.flows) {
      this.group.remove(flow);
      flow.geometry.dispose();
      (flow.material as THREE.Material).dispose();
    }
    this.patrol = [];
    this.orders = [];
    this.trails = [];
    this.flows = [];
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
      // Live patrol trail: rebuilt per tick from the driven-path prediction
      // (live position through the arcs the hull will really steer), not the
      // straight waypoint chords. One line + one tracer per unit is trivial
      // next to the per-frame combat/scene work (roster is ~6 hulls).
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
      const trail = new THREE.Line(
        trailGeo,
        new THREE.LineBasicMaterial({ color: WAYPOINT_TRAIL_COLOR, transparent: true, opacity: 0.85 }),
      );
      trail.name = "waypoint-trail";
      trail.renderOrder = WAYPOINT_RENDER_ORDER + 1;
      trail.visible = false;
      trail.frustumCulled = false;
      this.group.add(trail);
      this.trails.push(trail);
      const flow = new THREE.Mesh(
        new THREE.OctahedronGeometry(7),
        new THREE.MeshBasicMaterial({ color: WAYPOINT_TRAIL_COLOR, transparent: true, opacity: 0.95 }),
      );
      flow.name = "waypoint-flow";
      flow.visible = false;
      flow.renderOrder = WAYPOINT_RENDER_ORDER + 2;
      this.group.add(flow);
      this.flows.push(flow);
    });
  }

  /**
   * Patrol loops are context, not the live path: they draw only while the
   * unit is actually walking them — not wrecked, not holding, not ordered,
   * and not on a degenerate hold-route. Ordered/holding units hide the loop
   * so the overlay promises exactly one future per hull.
   */
  private refreshPatrolVisibility(): void {
    this.patrol.forEach((entry, i) => {
      const mover = this.lastMovers[i];
      const show =
        !this.lastDestroyed[i] &&
        !isHoldingRoute(entry.route) &&
        !!mover &&
        !mover.hold &&
        !hasOrder(mover);
      entry.loop.visible = show;
      const n = entry.route.length;
      const leg = mover && n > 0 ? ((mover.leg % n) + n) % n : -1;
      entry.dots.forEach((dot, d) => {
        dot.visible = show;
        // The waypoint the hull is steering at reads larger.
        const next = show && d === leg;
        dot.scale.setScalar(next ? WAYPOINT_NEXT_SCALE : 1);
      });
    });
  }

  /**
   * The polyline a hull will actually drive: the core forward simulation
   * (turn arcs, terrain gating) with a straight waypoint-tail fallback when
   * the prediction stalls on its first step (e.g. a hull ordered into a
   * wall pins immediately) — the overlay still promises exactly one future
   * per active hull. The fallback cannot be degenerate here: callers only
   * ask while the mode is live, and both tail helpers return ≥2 points then.
   */
  private livePath(index: number, mover: Mover, route: RoutePoint[], mode: "order" | "patrol"): RoutePoint[] {
    const predicted = predictDrivenPath(
      this.lastKinds[index] ?? "flash",
      mover,
      route,
      this.env.field ?? null,
    );
    if (predicted.length >= 2) return predicted;
    return mode === "order" ? remainingOrderPoints(mover) : remainingPatrolPoints(mover, route);
  }

  /** Rebuild live order tails, patrol trails, and tracer positions. */
  private refreshLive(): void {
    this.refreshPatrolVisibility();
    for (let i = 0; i < this.orders.length; i++) {
      const entry = this.orders[i]!;
      const trail = this.trails[i]!;
      const flow = this.flows[i];
      const mover = this.lastMovers[i];
      const destroyed = this.lastDestroyed[i] ?? false;
      const route = this.routes[i];
      const mode = mover && !destroyed && route ? activeTrailMode(mover, route) : null;
      const pts = mode ? this.livePath(i, mover!, mode === "patrol" ? route! : [], mode) : [];
      if (mode === "order" && pts.length >= 2) {
        this.paintLine(entry.line, pts, WAYPOINT_LIFT + 1);
        entry.line.visible = true;
        // The marker pins the true destination: the driven line may stop
        // short of it (arrival radius, or a wall it cannot climb).
        const dest =
          mover?.order && mover.order.points.length > 0
            ? mover.order.points[mover.order.points.length - 1]!
            : pts[pts.length - 1]!;
        entry.marker.position.set(dest.x, this.env.groundY(dest.x, dest.z) + WAYPOINT_LIFT + 1, dest.z);
        entry.marker.visible = true;
      } else {
        entry.line.visible = false;
        entry.marker.visible = false;
      }
      if (!flow) {
        trail.visible = false;
        continue;
      }
      const flowMat = flow.material as THREE.MeshBasicMaterial;
      if (mode === "patrol" && pts.length >= 2) {
        this.paintLine(trail, pts, WAYPOINT_LIFT + 1);
        trail.visible = true;
        flowMat.color.setHex(WAYPOINT_TRAIL_COLOR);
        this.placeFlow(flow, pts, i);
      } else {
        trail.visible = false;
        // Ordered units still get a tracer — amber, riding the driven order
        // line — so every live path animates in its own color.
        if (mode === "order" && pts.length >= 2) {
          flowMat.color.setHex(WAYPOINT_ORDER_COLOR);
          this.placeFlow(flow, pts, i);
        } else {
          flow.visible = false;
        }
      }
    }
  }

  /** Fill a live line's geometry from a path, re-seated on the terrain. */
  private paintLine(line: THREE.Line, pts: RoutePoint[], lift: number): void {
    const positions = new Float32Array(pts.length * 3);
    pts.forEach((p, j) => {
      positions[j * 3] = p.x;
      positions[j * 3 + 1] = this.env.groundY(p.x, p.z) + lift;
      positions[j * 3 + 2] = p.z;
    });
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    line.visible = true;
  }

  /** Park a tracer `distance`-along its path (loops forever), re-seated. */
  private placeFlow(flow: THREE.Mesh, pts: RoutePoint[], index: number): void {
    let total = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      total += Math.hypot(pts[k + 1]!.x - pts[k]!.x, pts[k + 1]!.z - pts[k]!.z);
    }
    if (!(total > 1e-6)) {
      flow.visible = false;
      return;
    }
    const d = (WAYPOINT_FLOW_SPEED * this.lastTime + index * WAYPOINT_FLOW_STRIDE) % total;
    const at = pointAlongPath(pts, d);
    flow.position.set(at.x, this.env.groundY(at.x, at.z) + WAYPOINT_LIFT + 2, at.z);
    flow.visible = true;
  }

  private applyVisibility(): void {
    this.group.visible = this.visible;
  }
}
