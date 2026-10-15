/**
 * Hit-reaction math for blasted hulls. Framework-free (no three.js) so the
 * web renderer and vitest share the same kick shapes.
 *
 * Problem: hulls used to take splashes with total composure — paint charred
 * and smoke trailed, but the body never flinched, so near-misses read as
 * cosmetic. Every splash now also rocks the hull with a directional kick:
 * a short positional shove away from the blast plus a pitch/roll rock in
 * the hull frame, both scaled by the damage the blast actually dealt (which
 * already carries kind weight and linear falloff, so a hammer point-blank
 * hit jolts while a fringe flash-chip barely trembles).
 *
 * Side bias: a shell landing on the flank should shove and heel the hull
 * harder than the same shell landing dead ahead, where the long hull and
 * the driver's bracing take it better. The kick magnitude scales with the
 * lateral share of the blast direction: `1 + SIDE_BIAS * |lateral|`, so a
 * pure flank hit lands ~1.6× the rock of a pure frontal one at equal
 * damage. Sign convention matches the grade seating (`seatHull` under a
 * three.js `YXZ` order): a blast ahead tips the nose up (negative pitch),
 * a blast on the right flank lifts the right side (positive roll), and the
 * shove always points away from the blast.
 *
 * The renderer owns the envelope (entries decay back to the seated pose
 * over `IMPACT_DURATION`, re-hits refresh and stack under the clamps), so
 * this module only shapes single kicks: no clocks, no rng, deterministic
 * given the same blast and hull pose.
 */

/** Shove per unit of dealt damage, in world units (hammer point-blank ≈ 3.5). */
export const IMPACT_SHOVE_PER_DAMAGE = 22;
/** Rock per unit of dealt damage, in radians (hammer point-blank ≈ 0.09). */
export const IMPACT_TILT_PER_DAMAGE = 0.55;
/**
 * Extra kick weight for flank hits: magnitude scales with
 * `1 + SIDE_BIAS * |lateral share|`, so a pure side hit lands 1.6× the
 * rock of a pure frontal one at the same damage.
 */
export const IMPACT_SIDE_BIAS = 0.6;
/** Hard cap on one stacked shove, world units (hull footprints are ~20). */
export const IMPACT_MAX_SHOVE = 7;
/** Hard cap on one stacked rock axis, radians (well under MAX_HULL_TILT). */
export const IMPACT_MAX_TILT = 0.16;
/**
 * Seconds for a kick to decay back to the seated pose. Slow enough to read
 * as suspension rocking (~a wobble), fast enough to settle before the next
 * exchange. Re-hits refresh the envelope instead of stacking duration.
 */
export const IMPACT_DURATION = 1.1;

/** Directional kick for one splash on one hull (hull-frame rock + shove). */
export interface ImpactKick {
  /** World X shove, away from the blast (scaled by side bias). */
  shoveX: number;
  /** World Z shove, away from the blast (scaled by side bias). */
  shoveZ: number;
  /** Hull pitch kick (`rotation.x`, negative = nose up). */
  pitch: number;
  /** Hull roll kick (`rotation.z`, positive = right side up). */
  roll: number;
}

/** Zero kick (out-of-range splash, degenerate geometry, no damage). */
export function zeroImpact(): ImpactKick {
  return { shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 };
}

/**
 * Shape the kick for a blast at (`blastX`, `blastZ`) dealing `damageAdd`
 * fractional damage to a hull at (`unitX`, `unitZ`) facing `hullYaw`.
 * Pure: no rng, no clocks. Returns zeros for non-positive damage or a
 * coincident blast (no direction to shove along — an overhead hit has no
 * flank to favour).
 */
export function impactKick(
  blastX: number,
  blastZ: number,
  unitX: number,
  unitZ: number,
  hullYaw: number,
  damageAdd: number,
): ImpactKick {
  if (!(damageAdd > 0)) return zeroImpact();
  const dx = unitX - blastX;
  const dz = unitZ - blastZ;
  const dist = Math.hypot(dx, dz);
  if (!(dist > 1e-6)) return zeroImpact();
  const nx = dx / dist;
  const nz = dz / dist;
  // Hull frame: forward is +Z at yaw 0, right flank is +X at yaw 0 (the
  // same frame `hullPitchRoll` taps for grade tilt).
  const fx = Math.sin(hullYaw);
  const fz = Math.cos(hullYaw);
  const rx = Math.cos(hullYaw);
  const rz = -Math.sin(hullYaw);
  const forward = nx * fx + nz * fz;
  const lateral = nx * rx + nz * rz;
  const sideWeight = 1 + IMPACT_SIDE_BIAS * Math.abs(lateral);
  // Absolute caps hold after the bias: flank hits rock harder below the
  // ceiling, and nothing — single heavy or stacked volley — exceeds it.
  const shove = Math.min(damageAdd * IMPACT_SHOVE_PER_DAMAGE * sideWeight, IMPACT_MAX_SHOVE);
  const tilt = Math.min(damageAdd * IMPACT_TILT_PER_DAMAGE * sideWeight, IMPACT_MAX_TILT);
  return {
    shoveX: nx * shove,
    shoveZ: nz * shove,
    // Blast ahead (forward < 0) tips the nose up (negative pitch); a blast
    // astern tips it down. Blast on the right flank (lateral < 0, the push
    // comes from the right) lifts the right side (positive roll).
    pitch: forward * tilt,
    roll: -lateral * tilt,
  };
}

/**
 * Stack a fresh kick onto a standing one (sustained fire keeps the hull
 * rocking instead of restarting it): add component-wise, clamped to the
 * shove/tilt caps. Pure — the renderer stores the result.
 */
export function accumulateImpact(current: ImpactKick, kick: ImpactKick): ImpactKick {
  const shoveX = current.shoveX + kick.shoveX;
  const shoveZ = current.shoveZ + kick.shoveZ;
  const mag = Math.hypot(shoveX, shoveZ);
  let cx = shoveX;
  let cz = shoveZ;
  if (mag > IMPACT_MAX_SHOVE && mag > 0) {
    cx = (shoveX / mag) * IMPACT_MAX_SHOVE;
    cz = (shoveZ / mag) * IMPACT_MAX_SHOVE;
  }
  const clampTilt = (v: number): number =>
    v < -IMPACT_MAX_TILT ? -IMPACT_MAX_TILT : v > IMPACT_MAX_TILT ? IMPACT_MAX_TILT : v;
  return {
    shoveX: cx,
    shoveZ: cz,
    pitch: clampTilt(current.pitch + kick.pitch),
    roll: clampTilt(current.roll + kick.roll),
  };
}
