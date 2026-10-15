import * as THREE from "three";
import {
  advanceMovers,
  findWorldPath,
  formationTargets,
  hasOrder,
  HULL_TILT_SLEW,
  initMover,
  orderMover,
  slewTilt,
  snappedFormationTargets,
  type HullSeat,
  type Mover,
  type PlacedUnit,
  type RoutePoint,
  type SeatField,
  type UnitKind,
} from "@scorched-3d/core";

/**
 * Thin three.js patrol driver: each unit body follows its core looping route
 * (positions + hull yaw from `advanceMovers`), seated on the terrain surface
 * every tick via the `seat` pose (continuous height + hull pitch/roll to the
 * local grade, so hulls ride slopes instead of clipping through them) with a
 * `groundY + 0.5` flat fallback when no seat is provided. Height-exaggeration
 * changes only need a re-seat.
 * The turret/torso subgroup rotation is never touched here — combat aim
 * (external-hull mode) owns it, so turrets track targets independently
 * while hulls face the direction of travel. Owns no scene objects, so
 * dispose just stops updates; regen builds a fresh instance.
 */
export interface MovementEnv {
  /** Terrain surface height at world (x, z), tracking live exaggeration. */
  groundY: (x: number, z: number) => number;
  /**
   * Full seated pose (surface height + hull pitch/roll) at world (x, z) for
   * a hull on the given yaw. Optional so headless tests can drive on flat
   * `groundY` alone; live play always provides it.
   */
  seat?: (x: number, z: number, hull: number, kind: UnitKind) => HullSeat;
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
  private field: SeatField | null;
  private disposed = false;

  constructor(
    units: THREE.Group,
    routes: RoutePoint[][],
    env: MovementEnv,
    field?: SeatField | null,
  ) {
    this.units = units;
    this.routes = routes;
    this.env = env;
    this.field = field ?? null;
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
    return mover ? { ...mover, order: mover.order ? { ...mover.order } : undefined } : null;
  }

  /** Live world-space X/Z of every unit, for selection projection + minimap. */
  positions(): { x: number; z: number }[] {
    return this.movers.map((m) => ({ x: m.x, z: m.z }));
  }

  /** True while the unit is driving a player-issued move order. */
  hasOrder(index: number): boolean {
    const mover = this.movers[index];
    return mover ? hasOrder(mover) : false;
  }

  /**
   * Issue a move order to one unit: A* from its live position to the target
   * (straight drive when no heightfield was provided), replacing any patrol
   * leg or previous order. Repathing just calls this again.
   */
  orderUnit(index: number, target: { x: number; z: number }): boolean {
    const mover = this.movers[index];
    if (!mover) return false;
    const path = this.field
      ? findWorldPath(this.field, { x: mover.x, z: mover.z }, target)
      : [{ x: target.x, z: target.z }];
    this.movers[index] = orderMover(mover, path);
    return true;
  }

  /**
   * Issue a group move order: each unit gets its own formation-fan slot
   * around the clicked point (slot 0 takes the point itself) with an
   * independent A* path, so the group fans out instead of stacking. With a
   * heightfield the slots are snapped onto walkable ground up front with a
   * separation guarantee (`snappedFormationTargets`) — independent per-unit
   * snaps of adjacent slots could otherwise collapse onto one cell and park
   * the pair inside the mutual spacing stop.
   */
  orderGroup(indices: readonly number[], target: { x: number; z: number }): number {
    const slots = this.field
      ? snappedFormationTargets(this.field, target, indices.length)
      : formationTargets(target, indices.length);
    let issued = 0;
    indices.forEach((index, i) => {
      if (this.orderUnit(index, slots[i] ?? target)) issued++;
    });
    return issued;
  }

  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    const next = advanceMovers(this.kinds, this.movers, this.routes, dt, this.field);
    next.forEach((mover, i) => {
      const body = this.units.children[i] as THREE.Group | undefined;
      const prev = this.movers[i];
      if (!body || !prev) return;
      const dx = mover.x - prev.x;
      const dz = mover.z - prev.z;
      if (dx !== 0 || dz !== 0) this.env.onShift?.(i, dx, dz);
      this.pose(body, mover, this.kinds[i] ?? "flash", dt);
    });
    this.movers = next;
  }

  /** Re-seat every body on the terrain surface (exaggeration change). */
  resnap(): void {
    if (this.disposed) return;
    this.movers.forEach((mover, i) => {
      const body = this.units.children[i] as THREE.Group | undefined;
      if (!body) return;
      this.pose(body, mover, this.kinds[i] ?? "flash", Number.POSITIVE_INFINITY);
    });
  }

  /**
   * Seat one body: live X/Z, surface height + hull pitch/roll from the seat
   * (flat `groundY + 0.5` fallback), yaw from the mover. `YXZ` order so the
   * pitch/roll apply in the hull frame after yawing — nose up uphill. Tilt
   * slews toward the seat at `HULL_TILT_SLEW` (suspension settling instead
   * of a snap when cresting a grade break); height applies instantly so
   * tracks never float or sink, and re-snaps pass infinite `dt` to land
   * exactly.
   */
  private pose(body: THREE.Group, mover: Mover, kind: UnitKind, dt: number): void {
    const seat = this.env.seat?.(mover.x, mover.z, mover.hull, kind);
    body.position.set(mover.x, seat?.y ?? this.env.groundY(mover.x, mover.z) + 0.5, mover.z);
    body.rotation.order = "YXZ";
    body.rotation.y = mover.hull;
    const maxStep = HULL_TILT_SLEW * dt;
    body.rotation.x = seat ? slewTilt(body.rotation.x, seat.pitch, maxStep) : 0;
    body.rotation.z = seat ? slewTilt(body.rotation.z, seat.roll, maxStep) : 0;
  }

  dispose(): void {
    this.disposed = true;
  }
}
