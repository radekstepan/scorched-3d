import type { UnitKind } from "./types.js";

/**
 * Drive-locomotion math for the ambient column: spinning road wheels on the
 * tracked kinds and a two-leg alternating gait for the commander walker.
 * Framework-free (no three.js) so the web renderer and vitest share it.
 *
 * Convention: everything keys off travelled distance, not wall-clock time —
 * wheels advance `distance / radius` radians and the gait advances one full
 * `2π` cycle per stride length, so a hull pinned against a slope or holding
 * in a crowd never spins its wheels or marches in place. When the hull
 * stops, the gait amplitude settles back to neutral instead of freezing
 * mid-stride.
 */

/** Rolling radius of the road wheels per kind, world units (0 = no wheels). */
export const WHEEL_RADIUS: Record<UnitKind, number> = {
  flash: 3,
  stump: 4,
  hammer: 4,
  commander: 0,
  // Infantry walks (no wheels).
  peewee: 0,
};

/**
 * Full gait-cycle stride length per kind, world units per `2π` of phase
 * (0 = no legs). The commander covers roughly one hull length per two
 * steps; tanks never step.
 */
export const LEG_STRIDE: Record<UnitKind, number> = {
  flash: 0,
  stump: 0,
  hammer: 0,
  commander: 16,
  // Infantry: short quick steps (a full gait cycle per 10 units).
  peewee: 10,
};

/** Hip swing amplitude of a walking leg, radians each way from vertical. */
export const LEG_SWING = 0.35;
/** Step lift of a walking leg, world units above the rest pose. */
export const LEG_LIFT = 2;
/**
 * Gait amplitude settle rate per second: how fast the stride grows when the
 * hull starts moving and collapses back to neutral when it stops.
 */
export const GAIT_SETTLE_RATE = 4;

/** Wheel spin for travelling `distance` world units on a `radius` wheel. */
export function wheelSpinFor(distance: number, radius: number): number {
  if (!(radius > 0)) return 0;
  return distance / radius;
}

/** Advance a wheel angle by the travelled distance. */
export function advanceWheel(angle: number, distance: number, radius: number): number {
  return angle + wheelSpinFor(distance, radius);
}

/** Advance a gait phase by the travelled distance over a stride length. */
export function advanceGait(phase: number, distance: number, stride: number): number {
  if (!(stride > 0) || !(distance > 0)) return phase;
  const tau = Math.PI * 2;
  return (phase + (distance / stride) * tau) % tau;
}

/**
 * Fore/aft swing of one leg at `phase`, radians about the hip. Legs are
 * antiphase (`legIndex` 0/1), so one leg plants while the other swings.
 */
export function legSwing(phase: number, legIndex: number, amplitude = 1): number {
  return Math.sin(phase + legIndex * Math.PI) * LEG_SWING * amplitude;
}

/**
 * Step lift of one leg at `phase`, world units above rest. The leg lifts
 * while it swings forward (positive-cosine half) and plants through the
 * back half, so feet alternate instead of dragging.
 */
export function legLift(phase: number, legIndex: number, amplitude = 1): number {
  return Math.max(0, Math.cos(phase + legIndex * Math.PI)) * LEG_LIFT * amplitude;
}

/**
 * Settle `current` toward `target` by at most `maxStep`. Used for the gait
 * amplitude so legs ease out of (and back into) the stride instead of
 * snapping when the hull stops or starts.
 */
export function settleToward(current: number, target: number, maxStep: number): number {
  if (!(maxStep > 0)) return current;
  const d = target - current;
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}
