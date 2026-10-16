import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  IMPACT_MAX_SHOVE,
  IMPACT_MAX_TILT,
  IMPACT_SIDE_BIAS,
  mulberry32,
  type UnitKind,
} from "@scorched-3d/core";
import { CombatFx } from "./combatFx";

function makeSolo(pos = new THREE.Vector3(0, 100, 0), yaw = 0): THREE.Group {
  const group = new THREE.Group();
  group.userData.units = [{ kind: "stump", cellX: 10, cellZ: 10, rotation: yaw }];
  const body = new THREE.Group();
  body.rotation.order = "YXZ";
  body.rotation.y = yaw;
  body.position.copy(pos);
  const turret = new THREE.Group();
  turret.name = "turret";
  body.add(turret);
  body.userData.turret = turret;
  group.add(body);
  return group;
}

function makePair(): THREE.Group {
  const group = new THREE.Group();
  group.userData.units = [
    { kind: "stump", cellX: 10, cellZ: 10, rotation: 0 },
    { kind: "hammer", cellX: 40, cellZ: 40, rotation: Math.PI },
  ];
  for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(500, 120, 300)]) {
    const body = new THREE.Group();
    body.rotation.order = "YXZ";
    body.position.copy(pos);
    const turret = new THREE.Group();
    turret.name = "turret";
    body.add(turret);
    body.userData.turret = turret;
    group.add(body);
  }
  return group;
}

/** Backdoor into the private splash (same white-box precedent as primeDamage). */
function splash(fx: CombatFx, x: number, y: number, z: number, kind: UnitKind = "hammer"): void {
  (fx as unknown as { damageUnits(at: THREE.Vector3, kind: UnitKind): void }).damageUnits(
    new THREE.Vector3(x, y, z),
    kind,
  );
}

function primeDamage(fx: CombatFx, index: number, value: number): void {
  (fx as unknown as { damage: number[] }).damage[index] = value;
}

describe("CombatFx hit reaction", () => {
  it("shoves away and tips the nose up for a frontal blast", () => {
    const scene = new THREE.Scene();
    const units = makeSolo();
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.update(1 / 60); // size the damage roster (a solo hull never fires)
    const body = units.children[0] as THREE.Group;
    splash(fx, 0, 100, 30, "hammer"); // blast 30 ahead (+Z) of a yaw-0 hull
    const kick = fx.impactAt(0);
    expect(kick.shoveZ).toBeLessThan(0);
    expect(kick.shoveX).toBeCloseTo(0, 12);
    expect(kick.pitch).toBeLessThan(0);
    expect(kick.roll).toBeCloseTo(0, 12);
    // The pose follows on the next tick: shoved back, nose up.
    fx.update(1 / 60);
    expect(body.position.z).toBeLessThan(0);
    expect(body.rotation.x).toBeLessThan(0);
    fx.dispose();
  });

  it("rocks the flank harder than the face at equal damage (side bias)", () => {
    const setup = (): { fx: CombatFx; units: THREE.Group } => {
      const scene = new THREE.Scene();
      const units = makeSolo();
      const fx = new CombatFx(scene, units, mulberry32(21));
      fx.update(1 / 60);
      return { fx, units };
    };
    const front = setup();
    splash(front.fx, 0, 100, 30, "hammer");
    const frontKick = front.fx.impactAt(0);
    const side = setup();
    splash(side.fx, 30, 100, 0, "hammer"); // same distance, right flank
    const sideKick = side.fx.impactAt(0);
    // Same range → same dealt damage → the flank kick lands the side bias.
    expect(sideKick.shoveX).toBeLessThan(0);
    expect(sideKick.roll).toBeGreaterThan(0);
    const frontShove = Math.hypot(frontKick.shoveX, frontKick.shoveZ);
    const sideShove = Math.hypot(sideKick.shoveX, sideKick.shoveZ);
    expect(sideShove).toBeCloseTo(frontShove * (1 + IMPACT_SIDE_BIAS), 9);
    expect(Math.abs(sideKick.roll)).toBeCloseTo(Math.abs(frontKick.pitch) * (1 + IMPACT_SIDE_BIAS), 9);
    front.fx.dispose();
    side.fx.dispose();
  });

  it("decays back to the seated pose and restores exactly", () => {
    const scene = new THREE.Scene();
    const units = makeSolo();
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.update(1 / 60);
    const body = units.children[0] as THREE.Group;
    const basePos = body.position.clone();
    const baseRX = body.rotation.x;
    const baseRZ = body.rotation.z;
    splash(fx, 30, 100, 0, "hammer");
    // Mid-rock the hull is visibly displaced...
    fx.update(1 / 60);
    expect(body.position.x).toBeLessThan(basePos.x);
    expect(body.rotation.z).toBeGreaterThan(0);
    // ...then the envelope runs out and the seat restores bit-exactly.
    for (let n = 0; n < 120; n++) fx.update(1 / 60);
    expect(fx.impactAt(0)).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
    expect(body.position.equals(basePos)).toBe(true);
    expect(body.rotation.x).toBeCloseTo(baseRX, 12);
    expect(body.rotation.z).toBeCloseTo(baseRZ, 12);
    fx.dispose();
  });

  it("rocks the tilt back then forward while the shove only returns", () => {
    const scene = new THREE.Scene();
    const units = makeSolo();
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.update(1 / 60);
    const body = units.children[0] as THREE.Group;
    const baseX = body.position.x;
    splash(fx, 30, 100, 0, "hammer"); // right-flank blast: shoveX < 0, roll > 0
    const kick = fx.impactAt(0);
    expect(kick.shoveX).toBeLessThan(0);
    expect(kick.roll).toBeGreaterThan(0);
    // Step through the beat: the roll must swing back *and* forward (sign
    // reversal past the seat) while X never crosses the seat — the hull is
    // pushed back and returns, it never overshoots forward.
    let maxRoll = 0;
    let minRoll = 0;
    for (let n = 0; n < 60; n++) {
      fx.update(1 / 60);
      expect(body.position.x).toBeLessThanOrEqual(baseX + 1e-9);
      maxRoll = Math.max(maxRoll, body.rotation.z);
      minRoll = Math.min(minRoll, body.rotation.z);
    }
    expect(maxRoll).toBeGreaterThan(kick.roll * 0.5);
    expect(minRoll).toBeLessThan(-kick.roll * 0.1);
    // The short beat ends settled: no standing kick, seat restored exactly.
    expect(fx.impactAt(0)).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
    expect(body.position.x).toBe(baseX);
    expect(body.rotation.z).toBeCloseTo(0, 12);
    fx.dispose();
  });

  it("settles rocked hulls exactly on clearTransients", () => {
    const scene = new THREE.Scene();
    const units = makeSolo();
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.update(1 / 60);
    const body = units.children[0] as THREE.Group;
    const basePos = body.position.clone();
    splash(fx, 30, 100, 0, "hammer");
    fx.update(1 / 60);
    expect(body.position.equals(basePos)).toBe(false);
    fx.clearTransients();
    expect(fx.impactAt(0)).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
    expect(body.position.equals(basePos)).toBe(true);
    expect(body.rotation.x).toBeCloseTo(0, 12);
    expect(body.rotation.z).toBeCloseTo(0, 12);
    fx.dispose();
  });

  it("stacks re-hits under the caps instead of launching the hull", () => {
    const scene = new THREE.Scene();
    const units = makeSolo();
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.update(1 / 60);
    for (let n = 0; n < 10; n++) splash(fx, 30, 100, 0, "hammer");
    const kick = fx.impactAt(0);
    expect(Math.hypot(kick.shoveX, kick.shoveZ)).toBeLessThanOrEqual(IMPACT_MAX_SHOVE + 1e-9);
    expect(Math.abs(kick.pitch)).toBeLessThanOrEqual(IMPACT_MAX_TILT + 1e-9);
    expect(Math.abs(kick.roll)).toBeLessThanOrEqual(IMPACT_MAX_TILT + 1e-9);
    // The rendered offset never exceeds the stacked kick either.
    for (let n = 0; n < 120; n++) {
      fx.update(1 / 60);
      const body = units.children[0] as THREE.Group;
      expect(Math.abs(body.position.x)).toBeLessThanOrEqual(IMPACT_MAX_SHOVE + 1e-9);
      expect(Math.abs(body.rotation.x)).toBeLessThanOrEqual(IMPACT_MAX_TILT + 0.04);
      expect(Math.abs(body.rotation.z)).toBeLessThanOrEqual(IMPACT_MAX_TILT + 0.04);
    }
    fx.dispose();
  });

  it("recoils survivors (stun hook with dealt damage + blast pos) but never the kill", () => {
    const scene = new THREE.Scene();
    const units = makePair();
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.update(1 / 60);
    const stunned: { index: number; damageAdd: number; blastX: number; blastZ: number }[] = [];
    fx.onUnitStunned = (index, damageAdd, blastX, blastZ) =>
      stunned.push({ index, damageAdd, blastX, blastZ });
    // A fringe splash on hull 0 recoils it with its dealt damage + blast pin...
    splash(fx, 5, 100, 0, "flash");
    expect(stunned.length).toBeGreaterThan(0);
    expect(stunned[0]!.index).toBe(0);
    expect(stunned[0]!.damageAdd).toBeGreaterThan(0);
    expect(stunned[0]!.blastX).toBe(5);
    expect(stunned[0]!.blastZ).toBe(0);
    expect(fx.isDestroyedAt(0)).toBe(false);
    // ...but the finishing blow stuns nothing: the wreck holds instead.
    stunned.length = 0;
    primeDamage(fx, 0, 0.99);
    splash(fx, 5, 100, 0, "hammer");
    expect(fx.isDestroyedAt(0)).toBe(true);
    expect(stunned.filter((s) => s.index === 0)).toEqual([]);
    // And later barrages wash over the wreck without stunning it either.
    splash(fx, 10, 100, 0, "hammer");
    expect(stunned.filter((s) => s.index === 0)).toEqual([]);
    fx.dispose();
  });

  it("wrecks never rock: the kill settles the nudge and later blasts add none", () => {
    const scene = new THREE.Scene();
    const units = makePair();
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.update(1 / 60);
    const body = units.children[0] as THREE.Group;
    const seat = body.position.clone();
    primeDamage(fx, 0, 0.99);
    splash(fx, 5, 100, 0, "hammer"); // near-direct hit finishes the hull
    expect(fx.isDestroyedAt(0)).toBe(true);
    // The death rock settles: no standing kick, body back on its seat (the
    // epic burst centers on the seated hull, the husk sinks from there).
    expect(fx.impactAt(0)).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
    expect(body.position.equals(seat)).toBe(true);
    // Later barrages wash over the wreck without rocking it: X/Z hold the
    // death seat (Y sinks through normal husk decay, which is expected).
    splash(fx, 10, 100, 0, "hammer");
    fx.update(1 / 60);
    expect(fx.impactAt(0)).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
    expect(body.position.x).toBe(seat.x);
    expect(body.position.z).toBe(seat.z);
    expect(body.position.y).toBeLessThanOrEqual(seat.y);
    fx.dispose();
  });
});
