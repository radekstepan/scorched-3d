import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { mulberry32 } from "@scorched-3d/core";
import { CombatFx } from "./combatFx";

/** Three unteamed hulls (legacy free-for-all), mirroring combatFx.test.ts. */
function makeUnits(): THREE.Group {
  const group = new THREE.Group();
  group.userData.units = [
    { kind: "stump", cellX: 10, cellZ: 10, rotation: 0 },
    { kind: "hammer", cellX: 40, cellZ: 40, rotation: Math.PI / 2 },
    { kind: "flash", cellX: 20, cellZ: 60, rotation: Math.PI },
  ];
  const positions = [
    new THREE.Vector3(0, 100, 0),
    new THREE.Vector3(500, 120, 300),
    new THREE.Vector3(-400, 90, 200),
  ];
  group.userData.units.forEach((u: { rotation: number }, i: number) => {
    const body = new THREE.Group();
    body.rotation.y = u.rotation;
    body.position.copy(positions[i]!);
    const turret = new THREE.Group();
    turret.name = "turret";
    body.add(turret);
    body.userData.turret = turret;
    group.add(body);
  });
  return group;
}

describe("combat sound hooks", () => {
  it("reports every fired round through onShotFired (muzzle position + kind)", () => {
    const scene = new THREE.Scene();
    const fx = new CombatFx(scene, makeUnits(), mulberry32(21));
    const shots: { x: number; y: number; z: number; kind: string; attack: string }[] = [];
    fx.onShotFired = (x, y, z, kind, attack) => {
      shots.push({ x, y, z, kind, attack });
    };
    for (let n = 0; n < 200; n++) fx.update(0.05);
    expect(fx.totalFired).toBeGreaterThan(0);
    // One report per round — the synth voices exactly the volley it sees.
    expect(shots).toHaveLength(fx.totalFired);
    for (const s of shots) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
      expect(Number.isFinite(s.z)).toBe(true);
      expect(["stump", "hammer", "flash"]).toContain(s.kind);
      expect(s.attack).toBe("round");
    }
    fx.dispose();
  });

  it("reports impacts through onExplosion alongside the visual stack", () => {
    const scene = new THREE.Scene();
    const fx = new CombatFx(scene, makeUnits(), mulberry32(21));
    const blasts: { kind: string; epic: boolean }[] = [];
    fx.onExplosion = (_x, _y, _z, kind, epic) => {
      blasts.push({ kind, epic });
    };
    for (let n = 0; n < 200; n++) fx.update(0.05);
    // Flights take seconds to land, but ~10 simulated seconds land several.
    expect(blasts.length).toBeGreaterThan(0);
    expect(blasts.every((b) => b.epic === false)).toBe(true);
    fx.dispose();
  });

  it("structure detonations report as epic blasts", () => {
    const scene = new THREE.Scene();
    const fx = new CombatFx(scene, makeUnits(), mulberry32(7));
    const blasts: { x: number; epic: boolean }[] = [];
    fx.onExplosion = (x, _y, _z, _kind, epic) => {
      blasts.push({ x, epic });
    };
    fx.detonateStructure(new THREE.Vector3(10, 100, 20), "hammer");
    expect(blasts).toHaveLength(1);
    expect(blasts[0]).toMatchObject({ x: 10, epic: true });
    fx.dispose();
  });

  it("null hooks (headless default) never break firing or blasts", () => {
    const scene = new THREE.Scene();
    const fx = new CombatFx(scene, makeUnits(), mulberry32(21));
    expect(fx.onShotFired).toBeNull();
    expect(fx.onExplosion).toBeNull();
    for (let n = 0; n < 200; n++) fx.update(0.05);
    fx.detonateStructure(new THREE.Vector3(0, 100, 0), "hammer");
    expect(fx.totalFired).toBeGreaterThan(0);
    fx.dispose();
  });
});
