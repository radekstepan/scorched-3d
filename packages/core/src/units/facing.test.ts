import { describe, expect, it } from "vitest";
import {
  aimError,
  aimStep,
  canFire,
  clampTurret,
  FIRE_TOLERANCE,
  HULL_TURN_RATE,
  muzzleYaw,
  slewTurret,
  stepAngle,
  TURRET_LIMIT,
  TURRET_OVERSHOOT,
  TURRET_OVERSHOOT_SWING,
  TURRET_SLEW_RATE,
  wrapAngle,
  yawToTarget,
} from "./facing.js";
import { UNIT_KINDS, type UnitKind } from "./types.js";

describe("wrapAngle", () => {
  it("keeps angles inside (-PI, PI]", () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });
});

describe("yawToTarget", () => {
  it("faces +Z at zero and grows toward +X", () => {
    const o = { x: 0, z: 0 };
    expect(yawToTarget(o, { x: 0, z: 10 })).toBeCloseTo(0);
    expect(yawToTarget(o, { x: 10, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(yawToTarget(o, { x: -10, z: 0 })).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(yawToTarget(o, { x: 0, z: -10 }))).toBeCloseTo(Math.PI);
  });

  it("matches the muzzle forward convention (sin/cos)", () => {
    const o = { x: 0, z: 0 };
    const yaw = yawToTarget(o, { x: 30, z: 40 });
    // Forward (sin, cos) must point along the (30, 40) direction.
    expect(Math.sin(yaw)).toBeCloseTo(0.6);
    expect(Math.cos(yaw)).toBeCloseTo(0.8);
  });
});

describe("stepAngle", () => {
  it("takes the shortest arc across the wrap boundary", () => {
    const stepped = stepAngle(Math.PI - 0.1, -Math.PI + 0.1, 1);
    expect(stepped).toBeCloseTo(-Math.PI + 0.1);
  });

  it("caps the step and snaps when close", () => {
    expect(stepAngle(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(stepAngle(0, 1, 5)).toBe(1);
    expect(stepAngle(0, -1, 0.3)).toBeCloseTo(-0.3);
  });
});

describe("clampTurret", () => {
  it("clamps each kind to its traverse limit", () => {
    for (const kind of UNIT_KINDS) {
      const limit = TURRET_LIMIT[kind]!;
      expect(clampTurret(kind, 99)).toBeCloseTo(limit);
      expect(clampTurret(kind, -99)).toBeCloseTo(-limit);
      expect(clampTurret(kind, 0)).toBe(0);
    }
  });

  it("keeps artillery narrower than the medium tank", () => {
    expect(TURRET_LIMIT.hammer).toBeLessThan(TURRET_LIMIT.stump!);
  });
});

describe("muzzleYaw / aimError / canFire", () => {
  it("sums hull and turret-relative yaws", () => {
    expect(muzzleYaw(1, 0.2)).toBeCloseTo(1.2);
  });

  it("measures the wrapped residual, not the raw difference", () => {
    expect(aimError(Math.PI - 0.01, -Math.PI, 0)).toBeCloseTo(0.01, 5);
  });

  it("fires only inside the tolerance", () => {
    expect(canFire(0.05, 0, 0)).toBe(true);
    expect(canFire(0.5, 0, 0)).toBe(false);
    expect(canFire(0.5, 0.5, 0)).toBe(true);
    expect(canFire(0.5, 0, 0.5, FIRE_TOLERANCE)).toBe(true);
  });
});

describe("slewTurret (traverse overshoot)", () => {
  const dt = 1 / 60;

  /** Thread the latch from `current` to a fixed `want`, recording the trace. */
  function run(
    kind: UnitKind,
    current: number,
    want: number,
    maxSteps = 600,
  ): { trace: number[]; overshoot: number } {
    let angle = current;
    let hold = 0;
    const trace = [angle];
    for (let n = 0; n < maxSteps; n++) {
      const s = slewTurret(kind, angle, want, dt, hold);
      angle = s.angle;
      hold = s.overshoot;
      trace.push(angle);
      if (hold === 0 && angle === want) break;
    }
    return { trace, overshoot: hold };
  }

  it("stops dead on small corrections (no overshoot inside the swing)", () => {
    const { trace, overshoot } = run("stump", 0, 0.3);
    expect(overshoot).toBe(0);
    expect(trace[trace.length - 1]).toBe(0.3);
    for (const a of trace) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(0.3);
    }
  });

  it("overshoots far swings past the goal, then corrects back", () => {
    const { trace, overshoot } = run("stump", 0, 1.2);
    expect(overshoot).toBe(0);
    expect(Math.max(...trace)).toBeCloseTo(1.2 + TURRET_OVERSHOOT, 10);
    expect(trace[trace.length - 1]).toBe(1.2);
    // Non-monotonic: the trace passes the goal and comes back.
    const atGoal = trace.findIndex((a) => a >= 1.2);
    expect(atGoal).toBeGreaterThanOrEqual(0);
    expect(trace[atGoal + 1]).toBeGreaterThan(1.2);
  });

  it("mirrors for negative swings", () => {
    const { trace, overshoot } = run("stump", 0, -1.2);
    expect(overshoot).toBe(0);
    expect(Math.min(...trace)).toBeCloseTo(-1.2 - TURRET_OVERSHOOT, 10);
    expect(trace[trace.length - 1]).toBe(-1.2);
  });

  it("never exceeds the traverse stop, even overshooting onto it", () => {
    const limit = TURRET_LIMIT.stump!;
    const { trace } = run("stump", -1.2, limit);
    for (const a of trace) {
      expect(Math.abs(a)).toBeLessThanOrEqual(limit + 1e-9);
    }
    expect(trace[trace.length - 1]).toBe(limit);
  });

  it("re-latches when the goal jumps far across the arc mid-swing", () => {
    const first = slewTurret("stump", 0, 1.2, dt, 0);
    expect(first.overshoot).toBeCloseTo(TURRET_OVERSHOOT);
    const re = slewTurret("stump", first.angle, -1.2, dt, first.overshoot);
    expect(re.overshoot).toBeCloseTo(-TURRET_OVERSHOOT);
  });

  it("is non-positive-dt safe", () => {
    expect(slewTurret("stump", 0, 1.2, 0, 0)).toEqual({ angle: 0, overshoot: 0 });
    expect(slewTurret("stump", 0.5, 1.2, -1, 0.1)).toEqual({ angle: 0.5, overshoot: 0.1 });
  });

  it("pins the tune: far means 45 degrees, a little means past the fire gate", () => {
    expect(TURRET_OVERSHOOT_SWING).toBeCloseTo(Math.PI / 4);
    expect(TURRET_OVERSHOOT).toBeCloseTo(0.1);
    // The settle-back must read as a real correction, outside the fire gate.
    expect(TURRET_OVERSHOOT).toBeGreaterThan(FIRE_TOLERANCE);
  });
});

describe("aimStep", () => {
  const kinds: UnitKind[] = [...UNIT_KINDS];

  it("slews the turret for small off-boresight targets, hull barely moves", () => {
    const first = aimStep("stump", 0, 0, 0.3, 0.05);
    // Hull turns at most rate * dt; the turret takes the rest.
    expect(Math.abs(first.hull)).toBeLessThanOrEqual(HULL_TURN_RATE.stump! * 0.05 + 1e-9);
    expect(first.turret).not.toBe(0);
    expect(Math.abs(first.turret)).toBeLessThanOrEqual(TURRET_LIMIT.stump! + 1e-9);
  });

  it("never lets the turret exceed its traverse, even behind the unit", () => {
    for (const kind of kinds) {
      let hull = 0;
      let turret = 0;
      for (let n = 0; n < 400; n++) {
        const s = aimStep(kind, hull, turret, Math.PI, 1 / 60);
        hull = s.hull;
        turret = s.turret;
        expect(Math.abs(turret)).toBeLessThanOrEqual(TURRET_LIMIT[kind]! + 1e-9);
        if (s.aimed) break;
      }
      // A target dead astern is acquired by turning the hull around.
      expect(canFire(Math.PI, hull, turret)).toBe(true);
    }
  });

  it("converges to aimed for every kind and every octant", () => {
    for (const kind of kinds) {
      for (let o = 0; o < 8; o++) {
        const target = (o / 8) * Math.PI * 2 - Math.PI;
        let hull = 0.7;
        let turret = -0.2;
        let aimed = false;
        for (let n = 0; n < 600; n++) {
          const s = aimStep(kind, hull, turret, target, 1 / 60);
          hull = s.hull;
          turret = s.turret;
          if (s.aimed) {
            aimed = true;
            break;
          }
        }
        expect(aimed, `${kind} octant ${o}`).toBe(true);
      }
    }
  });

  it("is non-negative-dt safe", () => {
    const s = aimStep("flash", 0, 0, 1, -1);
    expect(s.hull).toBe(0);
    expect(s.turret).toBe(0);
    expect(s.aimed).toBe(false);
  });

  it("threads turret overshoot: far turret swings latch, then settle aimed", () => {
    // Turret parked far off while the hull already faces the target: the
    // first step latches the overcorrect, and threading the latch converges.
    let hull = 0;
    let turret = -1.2;
    let hold = 0;
    const first = aimStep("stump", hull, turret, 0.9, 1 / 60, hold);
    expect(first.overshoot).toBeCloseTo(TURRET_OVERSHOOT);
    let aimed = false;
    for (let n = 0; n < 600; n++) {
      const s = aimStep("stump", hull, turret, 0.9, 1 / 60, hold);
      hull = s.hull;
      turret = s.turret;
      hold = s.overshoot;
      // The muzzle crosses the aim in transit to the exaggerated goal, so
      // only a settled aim (latch released) ends the traverse.
      if (s.aimed && s.overshoot === 0) {
        aimed = true;
        break;
      }
    }
    expect(aimed).toBe(true);
    expect(hold).toBe(0);
  });

  it("publishes sane per-kind rates", () => {
    for (const kind of kinds) {
      expect(HULL_TURN_RATE[kind]).toBeGreaterThan(0);
      expect(TURRET_SLEW_RATE[kind]).toBeGreaterThan(0);
      // Turrets always slew faster than hulls turn (fine vs gross motion).
      expect(TURRET_SLEW_RATE[kind]).toBeGreaterThan(HULL_TURN_RATE[kind]!);
    }
    // Light tanks traverse hulls fastest, artillery slowest.
    expect(HULL_TURN_RATE.flash).toBeGreaterThan(HULL_TURN_RATE.hammer!);
  });

  it("keeps turret traverse weighty: slower than the original tune", () => {
    // Pinned so traverses stay heavy-feeling: turrets visibly wind up
    // before the first aimed shot, while the pending-pair scheduler's fast
    // retry (~0.15s) still fires engagements as soon as they aim.
    expect(TURRET_SLEW_RATE.flash).toBeCloseTo(2.4);
    expect(TURRET_SLEW_RATE.stump).toBeCloseTo(1.9);
    expect(TURRET_SLEW_RATE.hammer).toBeCloseTo(1.4);
    expect(TURRET_SLEW_RATE.commander).toBeCloseTo(1.9);
    // A 90° turret correction takes a beat even on the fastest mount.
    const dt = 1 / 60;
    let turret = 0;
    let steps = 0;
    for (let n = 0; n < 600; n++) {
      turret = stepAngle(turret, Math.PI / 2, TURRET_SLEW_RATE.flash! * dt);
      steps++;
      if (Math.abs(turret - Math.PI / 2) < 1e-9) break;
    }
    expect(steps).toBeGreaterThan(Math.PI / 2 / (3.0 * dt));
  });
});
