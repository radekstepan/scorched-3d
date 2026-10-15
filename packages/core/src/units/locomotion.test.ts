import { describe, expect, it } from "vitest";
import {
  advanceGait,
  advanceWheel,
  GAIT_SETTLE_RATE,
  LEG_LIFT,
  LEG_STRIDE,
  LEG_SWING,
  legLift,
  legSwing,
  settleToward,
  WHEEL_RADIUS,
  wheelSpinFor,
} from "./locomotion.js";
import { UNIT_KINDS } from "./types.js";

describe("wheel spin", () => {
  it("scales linearly with travelled distance", () => {
    expect(wheelSpinFor(10, 4)).toBeCloseTo(2.5);
    // Double the distance, double the spin.
    expect(wheelSpinFor(20, 4)).toBeCloseTo(2 * wheelSpinFor(10, 4));
    // Smaller wheels spin faster for the same road covered.
    expect(wheelSpinFor(10, 2)).toBeCloseTo(2 * wheelSpinFor(10, 4));
  });

  it("accumulates through advanceWheel and holds at rest", () => {
    let angle = 0;
    angle = advanceWheel(angle, 8, 4);
    angle = advanceWheel(angle, 8, 4);
    expect(angle).toBeCloseTo(advanceWheel(0, 16, 4));
    // No travel, no spin: a hull pinned on a slope never spins its wheels.
    expect(advanceWheel(angle, 0, 4)).toBe(angle);
  });

  it("gives tracked kinds rolling wheels and the walker none", () => {
    for (const kind of ["flash", "stump", "hammer"] as const) {
      expect(WHEEL_RADIUS[kind]).toBeGreaterThan(0);
    }
    expect(WHEEL_RADIUS.commander).toBe(0);
    expect(wheelSpinFor(10, 0)).toBe(0);
  });

  it("pins wheel radii for every kind", () => {
    for (const kind of UNIT_KINDS) {
      expect(WHEEL_RADIUS[kind]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("walker gait", () => {
  it("advances phase proportionally to distance", () => {
    const stride = LEG_STRIDE.commander!;
    expect(stride).toBeGreaterThan(0);
    const one = advanceGait(0, stride / 2, stride);
    expect(one).toBeCloseTo(Math.PI);
    // Double the distance, double the phase.
    expect(advanceGait(0, stride, stride)).toBeCloseTo(0, 10);
    expect(advanceGait(0, stride / 4, stride)).toBeCloseTo(one / 2);
  });

  it("holds phase at rest and wraps past a full cycle", () => {
    expect(advanceGait(1.2, 0, LEG_STRIDE.commander!)).toBe(1.2);
    const stride = LEG_STRIDE.commander!;
    // 1.5 strides from 0 lands at PI (wraps the full cycle away).
    expect(advanceGait(0, stride * 1.5, stride)).toBeCloseTo(Math.PI);
  });

  it("swings legs antiphase and lifts only the forward leg", () => {
    // At phase 0 leg 0 plants back while leg 1 swings forward and lifts.
    expect(legSwing(0, 0)).toBeCloseTo(0);
    expect(legSwing(0, 1)).toBeCloseTo(0);
    expect(legSwing(Math.PI / 2, 0)).toBeCloseTo(LEG_SWING);
    expect(legSwing(Math.PI / 2, 1)).toBeCloseTo(-LEG_SWING);
    expect(legLift(0, 0)).toBeCloseTo(LEG_LIFT);
    expect(legLift(0, 1)).toBeCloseTo(0);
    expect(legLift(Math.PI, 0)).toBeCloseTo(0);
    expect(legLift(Math.PI, 1)).toBeCloseTo(LEG_LIFT);
  });

  it("scales the stride with amplitude and only walkers stride", () => {
    expect(legSwing(Math.PI / 2, 0, 0)).toBe(0);
    expect(legLift(0, 0, 0)).toBe(0);
    expect(legSwing(Math.PI / 2, 0, 0.5)).toBeCloseTo(LEG_SWING / 2);
    for (const kind of ["flash", "stump", "hammer"] as const) {
      expect(LEG_STRIDE[kind]).toBe(0);
    }
  });
});

describe("settleToward", () => {
  it("returns legs to neutral at rest and eases back in on drive", () => {
    expect(GAIT_SETTLE_RATE).toBeGreaterThan(0);
    // Amplitude collapses toward 0 (neutral) in bounded steps.
    expect(settleToward(1, 0, 0.25)).toBeCloseTo(0.75);
    expect(settleToward(0.1, 0, 0.25)).toBe(0);
    // ... and grows back toward 1 (full stride) the same way.
    expect(settleToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(settleToward(0.9, 1, 0.25)).toBe(1);
    expect(settleToward(0.5, 0.5, 0.25)).toBe(0.5);
  });
});
