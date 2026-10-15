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
  stunMover,
  type CrushContext,
  type HullSeat,
  type Mover,
  type PlacedUnit,
  type RoutePoint,
  type SeatField,
  type UnitKind,
} from "@scorched-3d/core";
import { advanceLocomotion, applyIdleTremble, clearIdleTremble } from "./units";

/**
 * Thin three.js patrol driver: each unit body follows its core looping route
 * (positions + hull yaw from `advanceMovers`), seated on the terrain surface
 * every tick via the `seat` pose (continuous height + hull pitch/roll to the
 * local grade, so hulls ride slopes instead of clipping through them) with a
 * `groundY + 0.5` flat fallback when no seat is provided. Height-exaggeration
 * changes only need a re-seat.
 * The turret/torso subgroup rotation is never touched here — combat aim
 * (external-hull mode) owns it, so turrets track targets independently
 * while hulls face the direction of travel. Drive locomotion (wheel spin,
 * walker gait from travelled distance per tick) is posed here alongside
 * the seat, and live hulls at rest tremble faintly with engine-idle
 * instability (visual only: movers never move). Owns no scene objects, so
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
  private crush: CrushContext | null;
  private disposed = false;
  /**
   * Deterministic engine-idle clock, seconds (advanced by `update` only):
   * the tremble phase reads this, so the same tick sequence replays the
   * same shiver with no rng and no per-frame allocation.
   */
  private elapsed = 0;
  /**
   * Wreck flags by unit index: a destroyed hull holds position forever
   * (mover frozen, orders refused) while its body stays in the scene as a
   * smouldering wreck. Live hulls still spacing-avoid wrecks through the
   * shared core separation (positions stay in the field), so nobody drives
   * through a wreck — but wrecks themselves never move.
   */
  private destroyed: boolean[] = [];

  constructor(
    units: THREE.Group,
    routes: RoutePoint[][],
    env: MovementEnv,
    field?: SeatField | null,
    crush?: CrushContext | null,
  ) {
    this.units = units;
    this.routes = routes;
    this.env = env;
    this.field = field ?? null;
    this.crush = crush ?? null;
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
   * Unit kind per index, for driven-path prediction (per-kind speed and
   * turn rate shape the arcs). Falls back to flash for unknown indices so
   * headless tests can drive without a roster.
   */
  kindAt(index: number): UnitKind {
    return this.kinds[index] ?? "flash";
  }

  /** True once the unit has died and holds as a wreck. */
  isDestroyed(index: number): boolean {
    return this.destroyed[index] ?? false;
  }

  /**
   * Freeze a unit as a wreck: drop any live order/patrol leg, hold position,
   * and refuse all future orders. The body is untouched (combat owns the
   * char tint; the pose stays seated where it died). Idempotent.
   */
  markDestroyed(index: number): void {
    const mover = this.movers[index];
    if (!mover) return;
    this.destroyed[index] = true;
    const { stun: _dropped, ...rest } = mover;
    this.movers[index] = { ...rest, order: undefined, hold: true };
  }

  /**
   * Hesitate a live hull's drive from a splash dealing `damageAdd`
   * fractional damage (core `stunMover`: refresh the countdown under the
   * caps). The hull holds its drive while the renderer-side impact rock
   * plays the visible jerk back, then resumes — it is never displaced, so
   * spacing, separation, and slope gating never fight the pause. Wrecks
   * refuse the stun (they hold forever); non-positive damage is a no-op.
   * Idempotent per tick: re-hits refresh, they never stack past the cap.
   */
  stunUnit(index: number, damageAdd: number): void {
    const mover = this.movers[index];
    if (!mover || this.destroyed[index]) return;
    this.movers[index] = stunMover(mover, damageAdd);
  }

  /**
   * Issue a move order to one unit: A* from its live position to the target
   * (straight drive when no heightfield was provided), replacing any patrol
   * leg or previous order. Repathing just calls this again.
   */
  orderUnit(index: number, target: { x: number; z: number }): boolean {
    const mover = this.movers[index];
    if (!mover || this.destroyed[index]) return false;
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
    const live = indices.filter((index) => !this.destroyed[index]);
    const slots = this.field
      ? snappedFormationTargets(this.field, target, live.length)
      : formationTargets(target, live.length);
    let issued = 0;
    live.forEach((index, i) => {
      if (this.orderUnit(index, slots[i] ?? target)) issued++;
    });
    return issued;
  }

  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    this.elapsed += dt;
    const next = advanceMovers(this.kinds, this.movers, this.routes, dt, this.field, this.crush);
    // Wrecks never move: freeze their movers at the pre-tick state (core
    // separation may have shoved them). Live hulls still spacing-avoid the
    // wreck positions, so nobody drives through a wreck.
    for (let i = 0; i < next.length; i++) {
      if (this.destroyed[i]) next[i] = this.movers[i]!;
    }
    next.forEach((mover, i) => {
      const body = this.units.children[i] as THREE.Group | undefined;
      const prev = this.movers[i];
      if (!body || !prev) return;
      const dx = mover.x - prev.x;
      const dz = mover.z - prev.z;
      if (dx !== 0 || dz !== 0) this.env.onShift?.(i, dx, dz);
      // Wheels stride with travelled distance; legs settle at rest.
      advanceLocomotion(body, this.kinds[i] ?? "flash", Math.hypot(dx, dz), dt);
      // Live hulls tremble at rest (zero travel this tick); driving hulls
      // and wrecks hold their grade pose exactly.
      this.pose(body, mover, this.kinds[i] ?? "flash", dt, i, !this.destroyed[i] && dx === 0 && dz === 0);
    });
    this.movers = next;
  }

  /** Re-seat every body on the terrain surface (exaggeration change). */
  resnap(): void {
    if (this.disposed) return;
    this.movers.forEach((mover, i) => {
      const body = this.units.children[i] as THREE.Group | undefined;
      if (!body) return;
      this.pose(body, mover, this.kinds[i] ?? "flash", Number.POSITIVE_INFINITY, i, false);
    });
  }

  /**
   * Seat one body: live X/Z, surface height + hull pitch/roll from the seat
   * (flat `groundY + 0.5` fallback), yaw from the mover. `YXZ` order so the
   * pitch/roll apply in the hull frame after yawing — nose up uphill. Tilt
   * slews toward the seat at `HULL_TILT_SLEW` (suspension settling instead
   * of a snap when cresting a grade break); height applies instantly so
   * tracks never float or sink, and re-snaps pass infinite `dt` to land
   * exactly. Last tick's tremble judder is always shed first (even when the
   * fresh one is skipped for driving hulls, wrecks, and re-snaps), so the
   * shiver never leaks into the slew state or survives a re-seat.
   */
  private pose(body: THREE.Group, mover: Mover, kind: UnitKind, dt: number, index: number, tremble: boolean): void {
    // Shed last tick's tremble judder first (exact — combat nudge tilts
    // un-apply their own offsets, so only the tremble remains on top of the
    // slewed grade pose); the seat then absolute-sets position, which also
    // discards last tick's positional jitter with no bookkeeping.
    clearIdleTremble(body);
    const seat = this.env.seat?.(mover.x, mover.z, mover.hull, kind);
    body.position.set(mover.x, seat?.y ?? this.env.groundY(mover.x, mover.z) + 0.5, mover.z);
    body.rotation.order = "YXZ";
    body.rotation.y = mover.hull;
    const maxStep = HULL_TILT_SLEW * dt;
    body.rotation.x = seat ? slewTilt(body.rotation.x, seat.pitch, maxStep) : 0;
    body.rotation.z = seat ? slewTilt(body.rotation.z, seat.roll, maxStep) : 0;
    // Engine idling: a tiny positional/tilt shiver on the seated hull.
    // Driving hulls already read as alive through locomotion and wrecks hold
    // still, so only live hulls at rest tremble — visual only, the mover
    // never moves.
    if (tremble) applyIdleTremble(body, index, this.elapsed);
  }

  dispose(): void {
    this.disposed = true;
  }
}
