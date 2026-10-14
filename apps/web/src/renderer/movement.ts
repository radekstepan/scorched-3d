import * as THREE from "three";
import {
  advanceMovers,
  initMover,
  type Mover,
  type PlacedUnit,
  type RoutePoint,
  type UnitKind,
} from "@scorched-3d/core";

/**
 * Thin three.js patrol driver: each unit body follows its core looping route
 * (positions + hull yaw from `advanceMovers`), re-seated on the terrain
 * surface every tick so height-exaggeration changes only need a re-seat.
 * The turret/torso subgroup rotation is never touched here — combat aim
 * (external-hull mode) owns it, so turrets track targets independently
 * while hulls face the direction of travel. Owns no scene objects, so
 * dispose just stops updates; regen builds a fresh instance.
 */
export interface MovementEnv {
  /** Terrain surface height at world (x, z), tracking live exaggeration. */
  groundY: (x: number, z: number) => number;
  /**
   * Fired for every moved unit per tick so recoil anchors in combat FX can
   * follow (otherwise the kick restore would snap the hull backward).
   */
  onShift?: (index: number, dx: number, dz: number) => void;
}

export class UnitMovement {
  private units: THREE.Group;
  private routes: RoutePoint[][];
  private kinds: UnitKind[];
  private movers: Mover[];
  private env: MovementEnv;
  private disposed = false;

  constructor(units: THREE.Group, routes: RoutePoint[][], env: MovementEnv) {
    this.units = units;
    this.routes = routes;
    this.env = env;
    const placed = (units.userData.units as PlacedUnit[] | undefined) ?? [];
    this.kinds = units.children.map((_, i) => placed[i]?.kind ?? "flash");
    // Seed patrol state from live bodies (spawn == route waypoint 0, so the
    // first leg starts without a teleport).
    this.movers = units.children.map((child, i) => {
      const body = child as THREE.Group;
      const mover = initMover(routes[i] ?? [], body.rotation.y);
      mover.x = body.position.x;
      mover.z = body.position.z;
      return mover;
    });
    this.resnap();
  }

  /** Live patrol state of a unit (position + hull + target leg), for tests. */
  moverState(index: number): Mover | null {
    const mover = this.movers[index];
    return mover ? { ...mover } : null;
  }

  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    const next = advanceMovers(this.kinds, this.movers, this.routes, dt);
    next.forEach((mover, i) => {
      const body = this.units.children[i] as THREE.Group | undefined;
      const prev = this.movers[i];
      if (!body || !prev) return;
      const dx = mover.x - prev.x;
      const dz = mover.z - prev.z;
      if (dx !== 0 || dz !== 0) this.env.onShift?.(i, dx, dz);
      body.position.set(mover.x, this.env.groundY(mover.x, mover.z) + 0.5, mover.z);
      body.rotation.y = mover.hull;
    });
    this.movers = next;
  }

  /** Re-seat every body on the terrain surface (exaggeration change). */
  resnap(): void {
    if (this.disposed) return;
    this.movers.forEach((mover, i) => {
      const body = this.units.children[i] as THREE.Group | undefined;
      if (!body) return;
      body.position.set(mover.x, this.env.groundY(mover.x, mover.z) + 0.5, mover.z);
      body.rotation.y = mover.hull;
    });
  }

  dispose(): void {
    this.disposed = true;
  }
}
