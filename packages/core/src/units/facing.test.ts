import { describe, expect, it } from "vitest";
import {
  aimError,
  aimStep,
  canFire,
  clampTurret,
  FIRE_TOLERANCE,
  HULL_TURN_RATE,
  muzzleYaw,
  stepAngle,
  TURRET_LIMIT,
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
