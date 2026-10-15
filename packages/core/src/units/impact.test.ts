import { describe, expect, it } from "vitest";
import {
  accumulateImpact,
  accumulateStun,
  IMPACT_DURATION,
  IMPACT_MAX_SHOVE,
  IMPACT_MAX_TILT,
  IMPACT_SHOVE_PER_DAMAGE,
  IMPACT_SIDE_BIAS,
  IMPACT_TILT_PER_DAMAGE,
  impactKick,
  STUN_MAX_DURATION,
  STUN_MIN_DURATION,
  STUN_PER_DAMAGE,
  stunDuration,
  tickStun,
  zeroImpact,
} from "./impact.js";

describe("impactKick", () => {
  it("returns zeros for non-positive damage or a coincident blast", () => {
    expect(impactKick(0, 0, 10, 0, 0, 0)).toEqual(zeroImpact());
    expect(impactKick(0, 0, 10, 0, 0, -0.1)).toEqual(zeroImpact());
    expect(impactKick(0, 0, 10, 0, 0, Number.NaN)).toEqual(zeroImpact());
    // Directly overhead: damage is real but there is no flank to favour.
    const direct = impactKick(5, 5, 5, 5, 0, 0.16);
    expect(direct).toEqual(zeroImpact());
  });

  it("shoves away from the blast and tips the nose up for a frontal hit", () => {
    // Yaw 0 faces +Z; a blast 30 ahead (+Z) pushes the hull backward (−Z)
    // and lifts the nose (negative pitch), with no roll.
    const kick = impactKick(0, 30, 0, 0, 0, 0.16);
    expect(kick.shoveX).toBeCloseTo(0, 12);
    expect(kick.shoveZ).toBeLessThan(0);
    expect(kick.pitch).toBeLessThan(0);
    expect(Math.abs(kick.roll)).toBeLessThan(1e-12);
  });

  it("tips the nose down for a blast astern", () => {
    const kick = impactKick(0, -30, 0, 0, 0, 0.16);
    expect(kick.shoveZ).toBeGreaterThan(0);
    expect(kick.pitch).toBeGreaterThan(0);
    expect(Math.abs(kick.roll)).toBeLessThan(1e-12);
  });

  it("lifts the struck flank for a side hit", () => {
    // Blast on the right flank (+X): the hull is shoved left (−X) and the
    // right side lifts (positive roll), with no pitch.
    const right = impactKick(30, 0, 0, 0, 0, 0.16);
    expect(right.shoveX).toBeLessThan(0);
    expect(right.shoveZ).toBeCloseTo(0, 12);
    expect(right.roll).toBeGreaterThan(0);
    expect(Math.abs(right.pitch)).toBeLessThan(1e-12);
    // Blast on the left flank mirrors it.
    const left = impactKick(-30, 0, 0, 0, 0, 0.16);
    expect(left.shoveX).toBeGreaterThan(0);
    expect(left.roll).toBeLessThan(0);
    expect(left.roll).toBeCloseTo(-right.roll, 12);
  });

  it("hits the flank harder than the face at equal damage (side bias)", () => {
    const dmg = 0.1;
    const front = impactKick(0, 30, 0, 0, 0, dmg);
    const side = impactKick(30, 0, 0, 0, 0, dmg);
    const frontShove = Math.hypot(front.shoveX, front.shoveZ);
    const sideShove = Math.hypot(side.shoveX, side.shoveZ);
    expect(sideShove).toBeCloseTo(frontShove * (1 + IMPACT_SIDE_BIAS), 12);
    expect(Math.abs(side.roll)).toBeCloseTo(Math.abs(front.pitch) * (1 + IMPACT_SIDE_BIAS), 12);
    expect(sideShove).toBeGreaterThan(frontShove);
  });

  it("scales linearly with dealt damage below the caps", () => {
    const small = impactKick(30, 0, 0, 0, 0, 0.05);
    const big = impactKick(30, 0, 0, 0, 0, 0.1);
    expect(big.shoveX).toBeCloseTo(small.shoveX * 2, 12);
    expect(big.roll).toBeCloseTo(small.roll * 2, 12);
    expect(small.shoveX).toBeCloseTo(-0.05 * IMPACT_SHOVE_PER_DAMAGE * (1 + IMPACT_SIDE_BIAS), 9);
    expect(small.roll).toBeCloseTo(0.05 * IMPACT_TILT_PER_DAMAGE * (1 + IMPACT_SIDE_BIAS), 12);
  });

  it("clamps runaway kicks (stacked point-blank heavies)", () => {
    const kick = impactKick(30, 0, 0, 0, 0, 10);
    expect(Math.hypot(kick.shoveX, kick.shoveZ)).toBeLessThanOrEqual(IMPACT_MAX_SHOVE + 1e-9);
    expect(Math.abs(kick.roll)).toBeLessThanOrEqual(IMPACT_MAX_TILT + 1e-9);
  });

  it("reads the same local kick under any hull yaw (yaw invariance)", () => {
    // A blast dead ahead must always tip the nose up, whatever compass
    // heading "ahead" is: rotate hull and blast together.
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const bx = Math.sin(yaw) * 30;
      const bz = Math.cos(yaw) * 30;
      const kick = impactKick(bx, bz, 0, 0, yaw, 0.1);
      expect(kick.pitch).toBeLessThan(0);
      expect(Math.abs(kick.roll)).toBeLessThan(1e-9);
      // And the shove opposes the facing (backward along the hull line).
      expect(kick.shoveX * Math.sin(yaw) + kick.shoveZ * Math.cos(yaw)).toBeLessThan(0);
    }
  });

  it("is deterministic (no rng, no clocks)", () => {
    const run = (): ReturnType<typeof impactKick> => impactKick(17, -23, 4, 9, 1.2, 0.11);
    expect(run()).toEqual(run());
  });
});

describe("accumulateImpact", () => {
  it("adds kicks component-wise and clamps the stack", () => {
    // Sub-cap damage doubles exactly; point-blank heavies pin at the caps.
    const light = impactKick(30, 0, 0, 0, 0, 0.05);
    const stacked = accumulateImpact(light, light);
    expect(stacked.shoveX).toBeCloseTo(light.shoveX * 2, 9);
    expect(stacked.roll).toBeCloseTo(light.roll * 2, 12);
    // A long barrage pins at the caps instead of launching the hull.
    let run = zeroImpact();
    for (let i = 0; i < 50; i++) {
      run = accumulateImpact(run, impactKick(30, 0, 0, 0, 0, 0.16));
    }
    expect(Math.hypot(run.shoveX, run.shoveZ)).toBeLessThanOrEqual(IMPACT_MAX_SHOVE + 1e-9);
    expect(Math.abs(run.pitch)).toBeLessThanOrEqual(IMPACT_MAX_TILT + 1e-9);
    expect(Math.abs(run.roll)).toBeLessThanOrEqual(IMPACT_MAX_TILT + 1e-9);
  });

  it("keeps opposing hits from cancelling past the caps asymmetrically", () => {
    const run = accumulateImpact(
      impactKick(30, 0, 0, 0, 0, 0.16),
      impactKick(-30, 0, 0, 0, 0, 0.16),
    );
    expect(Math.abs(run.shoveX)).toBeLessThan(1e-9);
    expect(Math.abs(run.roll)).toBeLessThan(1e-9);
  });
});

describe("impact pacing", () => {
  it("settles in about a second (suspension rock, not a permanent lean)", () => {
    expect(IMPACT_DURATION).toBeGreaterThanOrEqual(0.5);
    expect(IMPACT_DURATION).toBeLessThanOrEqual(2);
  });
});

describe("stunDuration", () => {
  it("returns 0 for non-positive damage (a miss never pauses the drive)", () => {
    expect(stunDuration(0)).toBe(0);
    expect(stunDuration(-0.1)).toBe(0);
    expect(stunDuration(Number.NaN)).toBe(0);
  });

  it("scales linearly with dealt damage inside the band", () => {
    // Mid-band hits scale exactly: a 0.12 hit hesitates twice as long as a
    // flash point-blank hit (0.06).
    expect(stunDuration(0.06)).toBeCloseTo(0.06 * STUN_PER_DAMAGE, 12);
    expect(stunDuration(0.12)).toBeCloseTo(stunDuration(0.06) * 2, 12);
  });

  it("pins fringe chips at the floor and heavies at the cap", () => {
    expect(stunDuration(0.001)).toBe(STUN_MIN_DURATION);
    // A hammer point-blank hit (0.16) lands the max pause, and runaway
    // volleys can never park a hull past it.
    expect(stunDuration(0.16)).toBe(STUN_MAX_DURATION);
    expect(stunDuration(10)).toBe(STUN_MAX_DURATION);
  });

  it("stays a brief beat: bounded well under a second", () => {
    expect(STUN_MIN_DURATION).toBeGreaterThanOrEqual(0.1);
    expect(STUN_MAX_DURATION).toBeLessThanOrEqual(1);
    expect(STUN_MIN_DURATION).toBeLessThan(STUN_MAX_DURATION);
  });

  it("is deterministic (no rng, no clocks)", () => {
    expect(stunDuration(0.11)).toBe(stunDuration(0.11));
  });
});

describe("accumulateStun / tickStun", () => {
  it("refreshes the countdown with the longer beat, capped at the max", () => {
    expect(accumulateStun(0, 0.06)).toBeCloseTo(stunDuration(0.06), 12);
    // A fresh heavy re-hit extends a fading chip instead of restarting it.
    expect(accumulateStun(0.1, 0.16)).toBe(STUN_MAX_DURATION);
    // A chip landing mid-heavy never shortens the clock...
    expect(accumulateStun(STUN_MAX_DURATION, 0.001)).toBe(STUN_MAX_DURATION);
    // ...and a barrage pins at the cap instead of parking the hull.
    let run = 0;
    for (let i = 0; i < 50; i++) run = accumulateStun(run, 0.16);
    expect(run).toBeLessThanOrEqual(STUN_MAX_DURATION + 1e-9);
  });

  it("ignores non-positive damage and zero clocks", () => {
    expect(accumulateStun(0.4, 0)).toBe(0.4);
    expect(accumulateStun(0, 0)).toBe(0);
  });

  it("ticks the clock down by dt, floored at 0, leaving bad steps alone", () => {
    expect(tickStun(0.5, 0.2)).toBeCloseTo(0.3, 12);
    expect(tickStun(0.1, 0.5)).toBe(0);
    expect(tickStun(0, 0.5)).toBe(0);
    expect(tickStun(0.5, 0)).toBe(0.5);
    expect(tickStun(0.5, -1)).toBe(0.5);
  });
});
