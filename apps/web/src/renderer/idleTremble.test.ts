import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  IMPACT_DURATION,
  IMPACT_MAX_SHOVE,
  IMPACT_MAX_TILT,
  mulberry32,
  type UnitKind,
} from "@scorched-3d/core";
import { CombatFx } from "./combatFx";
import { UnitMovement } from "./movement";
import {
  applyIdleTremble,
  clearIdleTremble,
  IDLE_POS,
  IDLE_TILT,
  idleTremble,
} from "./units";

/** Solo stump held on its spawn: the mover never travels. */
function makeHeld(): { group: THREE.Group; movement: UnitMovement; body: THREE.Group } {
  const group = new THREE.Group();
  group.userData.units = [{ kind: "stump", cellX: 10, cellZ: 10, rotation: 0 }];
  const body = new THREE.Group();
  body.rotation.order = "YXZ";
  body.position.set(0, 100, 0);
  const turret = new THREE.Group();
  turret.name = "turret";
  body.add(turret);
  body.userData.turret = turret;
  group.add(body);
  const movement = new UnitMovement(group, [[{ x: 0, z: 0 }]], { groundY: () => 100 });
  const m = movement.moverState(0)!;
  movement.orderUnit(0, { x: m.x, z: m.z });
  return { group, movement, body };
}

/** Backdoor into the private splash (same white-box precedent as combatImpact). */
function splash(fx: CombatFx, x: number, y: number, z: number, kind: UnitKind = "hammer"): void {
  (fx as unknown as { damageUnits(at: THREE.Vector3, kind: UnitKind): void }).damageUnits(
    new THREE.Vector3(x, y, z),
    kind,
  );
}

describe("idle engine tremble", () => {
  it("shapes tiny deterministic trembles, phased per unit", () => {
    // Tiny by construction: orders below a world cell and a third of a
    // degree, far under the recoil kick and the hit-reaction clamps.
    expect(IDLE_POS).toBeLessThanOrEqual(1);
    expect(IDLE_TILT).toBeLessThanOrEqual(0.01);
    expect(IDLE_POS).toBeLessThan(IMPACT_MAX_SHOVE);
    expect(IDLE_TILT).toBeLessThan(IMPACT_MAX_TILT);
    let trembled = false;
    let phased = false;
    for (let t = 0; t <= 10; t += 0.25) {
      for (let i = 0; i < 4; i++) {
        const j = { ...idleTremble(t, i) };
        expect(Math.abs(j.x)).toBeLessThanOrEqual(IDLE_POS + 1e-9);
        expect(Math.abs(j.z)).toBeLessThanOrEqual(IDLE_POS + 1e-9);
        expect(Math.abs(j.pitch)).toBeLessThanOrEqual(IDLE_TILT + 1e-9);
        expect(Math.abs(j.roll)).toBeLessThanOrEqual(IDLE_TILT + 1e-9);
        if (j.x !== 0 || j.z !== 0 || j.pitch !== 0 || j.roll !== 0) trembled = true;
      }
      // Same clock, neighbouring hulls shiver out of phase.
      if (idleTremble(t, 0).x !== idleTremble(t, 1).x) phased = true;
    }
    expect(trembled).toBe(true);
    expect(phased).toBe(true);
    // Deterministic: the same tick sequence replays the same shiver.
    expect({ ...idleTremble(1.23, 2) }).toEqual({ ...idleTremble(1.23, 2) });
  });

  it("applies and clears exactly on a bare group", () => {
    const body = new THREE.Group();
    body.rotation.order = "YXZ";
    body.position.set(10, 100, 20);
    applyIdleTremble(body, 3, 1.5);
    const j = { ...idleTremble(1.5, 3) };
    expect(body.position.x).toBeCloseTo(10 + j.x, 12);
    expect(body.position.z).toBeCloseTo(20 + j.z, 12);
    expect(body.rotation.x).toBeCloseTo(j.pitch, 12);
    expect(body.rotation.z).toBeCloseTo(j.roll, 12);
    // Clearing sheds the judder exactly; position is the seat's business.
    clearIdleTremble(body);
    expect(body.rotation.x).toBe(0);
    expect(body.rotation.z).toBe(0);
    expect(body.position.x).toBeCloseTo(10 + j.x, 12);
    // A second clear is a no-op (no drift), as is clearing a fresh body.
    clearIdleTremble(body);
    expect(body.rotation.x).toBe(0);
    expect(body.rotation.z).toBe(0);
    expect(() => clearIdleTremble(new THREE.Group())).not.toThrow();
  });

  it("trembles held hulls around their frozen mover, never moving it", () => {
    const { movement, body } = makeHeld();
    const seat = movement.moverState(0)!;
    let trembled = false;
    for (let n = 0; n < 120; n++) {
      movement.update(1 / 60);
      // Simulation exact: the mover never travels (visual only).
      const mover = movement.moverState(0)!;
      expect(mover.x).toBe(seat.x);
      expect(mover.z).toBe(seat.z);
      // The body shivers around it within the idle bounds; height is
      // untouched (flat `groundY + 0.5` seat, zero grade tilt).
      expect(Math.abs(body.position.x - mover.x)).toBeLessThanOrEqual(IDLE_POS + 1e-9);
      expect(Math.abs(body.position.z - mover.z)).toBeLessThanOrEqual(IDLE_POS + 1e-9);
      expect(body.position.y).toBe(100.5);
      expect(Math.abs(body.rotation.x)).toBeLessThanOrEqual(IDLE_TILT + 1e-9);
      expect(Math.abs(body.rotation.z)).toBeLessThanOrEqual(IDLE_TILT + 1e-9);
      if (body.position.x !== mover.x || body.rotation.x !== 0) trembled = true;
    }
    expect(trembled).toBe(true);
    movement.dispose();
  });

  it("holds driving hulls exactly on their movers", () => {
    const group = new THREE.Group();
    group.userData.units = [{ kind: "stump", cellX: 10, cellZ: 10, rotation: 0 }];
    const body = new THREE.Group();
    body.rotation.order = "YXZ";
    body.position.set(0, 100, 0);
    group.add(body);
    const movement = new UnitMovement(group, [[{ x: 0, z: 0 }, { x: 0, z: 400 }]], {
      groundY: () => 100,
    });
    movement.update(1 / 60);
    const mover = movement.moverState(0)!;
    // Off the start line: travelled, so no tremble — the body is the seat.
    expect(Math.hypot(mover.x, mover.z)).toBeGreaterThan(0);
    expect(body.position.x).toBe(mover.x);
    expect(body.position.z).toBe(mover.z);
    expect((body.userData as { idlePitch?: number }).idlePitch ?? 0).toBe(0);
    expect((body.userData as { idleRoll?: number }).idleRoll ?? 0).toBe(0);
    movement.dispose();
  });

  it("wrecks hold still and shed the shiver", () => {
    const { movement, body } = makeHeld();
    for (let n = 0; n < 10; n++) movement.update(1 / 60);
    // Trembling right up to the kill…
    expect(
      (body.userData as { idlePitch?: number }).idlePitch !== 0 ||
        (body.userData as { idleRoll?: number }).idleRoll !== 0 ||
        body.position.x !== movement.moverState(0)!.x,
    ).toBe(true);
    movement.markDestroyed(0);
    for (let n = 0; n < 60; n++) movement.update(1 / 60);
    // …then exact stillness: the mover frozen, the judder shed, no resume.
    const mover = movement.moverState(0)!;
    expect(body.position.x).toBe(mover.x);
    expect(body.position.z).toBe(mover.z);
    expect(body.rotation.x).toBe(0);
    expect(body.rotation.z).toBe(0);
    expect((body.userData as { idlePitch?: number }).idlePitch ?? 0).toBe(0);
    expect((body.userData as { idleRoll?: number }).idleRoll ?? 0).toBe(0);
    movement.dispose();
  });

  it("stacks additively with a hit-reaction rock and heals after it", () => {
    const { group, movement, body } = makeHeld();
    const scene = new THREE.Scene();
    const fx = new CombatFx(scene, group, mulberry32(7));
    fx.update(1 / 60); // size the damage roster (a solo hull never fires)
    for (let n = 0; n < 3; n++) movement.update(1 / 60);
    const mover = movement.moverState(0)!;
    // The splash shapes its kick from the trembling body; the stored kick is
    // pure rock (combat never sees the tremble as shaping input it keeps).
    splash(fx, 30, 100, 0, "hammer"); // right-flank blast: shoveX < 0
    const kick = fx.impactAt(0);
    expect(kick.shoveX).toBeLessThan(0);
    // Fresh tremble at the splash clock, copied off the shared scratch.
    const shaped = { ...idleTremble(3 / 60, 0) };
    fx.update(1 / 60);
    // Tilt stacks exactly: the rock rides on top of the live tremble judder
    // (combat only ever un-applies its own tilt).
    const k = 1 - 1 / 60 / IMPACT_DURATION;
    expect(body.rotation.x).toBeCloseTo(kick.pitch * k + shaped.pitch, 12);
    expect(body.rotation.z).toBeCloseTo(kick.roll * k + shaped.roll, 12);
    // Position rides the nudge base (seat + splash-clock jitter, healed
    // below): the rock displaces, the tremble never accumulates on top.
    expect(body.position.x).toBeCloseTo(mover.x + shaped.x + kick.shoveX * k, 12);
    // The envelope runs out under continued patrol posing: the mover never
    // moved, the rock restores, and only the fresh tremble remains.
    for (let n = 0; n < 120; n++) {
      movement.update(1 / 60);
      fx.update(1 / 60);
    }
    expect(fx.impactAt(0)).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
    const held = movement.moverState(0)!;
    expect(held.x).toBe(mover.x);
    expect(held.z).toBe(mover.z);
    expect(Math.abs(body.position.x - held.x)).toBeLessThanOrEqual(IDLE_POS + 1e-9);
    expect(Math.abs(body.position.z - held.z)).toBeLessThanOrEqual(IDLE_POS + 1e-9);
    fx.dispose();
    movement.dispose();
  });

  it("re-seats exactly, shedding the shiver", () => {
    const { movement, body } = makeHeld();
    for (let n = 0; n < 10; n++) movement.update(1 / 60);
    const mover = movement.moverState(0)!;
    movement.resnap();
    expect(body.position.x).toBe(mover.x);
    expect(body.position.z).toBe(mover.z);
    expect(body.rotation.x).toBe(0);
    expect(body.rotation.z).toBe(0);
    movement.dispose();
  });
});
