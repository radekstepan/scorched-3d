import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { mulberry32 } from "@scorched-3d/core";
import { CombatFx, impactPoint, muzzlePoint } from "./combatFx";

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
    group.add(body);
  });
  return group;
}

describe("muzzlePoint", () => {
  it("throws the muzzle forward along the unit facing", () => {
    // Facing +Z (rotation 0): muzzle sits ahead in +Z, above the anchor.
    const m = muzzlePoint({ x: 0, y: 100, z: 0 }, 0, "stump");
    expect(m.z).toBeGreaterThan(0);
    expect(m.x).toBeCloseTo(0);
    expect(m.y).toBeGreaterThan(100);
  });

  it("rotates with the hull (facing +X at PI/2)", () => {
    const m = muzzlePoint({ x: 0, y: 100, z: 0 }, Math.PI / 2, "stump");
    expect(m.x).toBeGreaterThan(0);
    expect(m.z).toBeCloseTo(0, 5);
  });
});

describe("impactPoint", () => {
  it("lands near the target hull, slightly above it", () => {
    const rng = mulberry32(11);
    for (let n = 0; n < 50; n++) {
      const p = impactPoint({ x: 500, y: 120, z: 300 }, rng);
      expect(Math.abs(p.x - 500)).toBeLessThanOrEqual(11);
      expect(Math.abs(p.z - 300)).toBeLessThanOrEqual(11);
      expect(p.y).toBeGreaterThan(120);
    }
  });
});

describe("CombatFx", () => {
  it("fires shots on a schedule and resolves them into explosions", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    // Step ~10 simulated seconds: several scheduler firings must occur and
    // the first flights (<=3s) must complete into explosions/cleanup.
    for (let n = 0; n < 200; n++) fx.update(0.05);
    // Shots are capped; explosions decay after 0.8s, so the scene only ever
    // holds a handful of transients besides the 2 pooled lights.
    expect(fx.shotCount).toBeLessThanOrEqual(6);
    expect(scene.children.length).toBeLessThan(2 + 6 + 8 * 2 + 6);
    fx.dispose();
  });

  it("clears transients and restores recoiled bodies", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const base = units.children.map((c) => c.position.clone());
    const fx = new CombatFx(scene, units, mulberry32(33));
    for (let n = 0; n < 60; n++) fx.update(0.05);
    expect(fx.activeCount).toBeGreaterThan(0);
    fx.clearTransients();
    expect(fx.activeCount).toBe(0);
    expect(fx.shotCount).toBe(0);
    units.children.forEach((c, i) => {
      expect(c.position.equals(base[i]!)).toBe(true);
    });
    fx.dispose();
  });

  it("does nothing with fewer than two units and disposes cleanly", () => {
    const scene = new THREE.Scene();
    const units = new THREE.Group();
    units.userData.units = [{ kind: "flash", cellX: 1, cellZ: 1, rotation: 0 }];
    const before = scene.children.length;
    const fx = new CombatFx(scene, units, mulberry32(1));
    for (let n = 0; n < 40; n++) fx.update(0.05);
    expect(fx.shotCount).toBe(0);
    fx.dispose();
    // Only the pooled lights were added, and dispose removes them.
    expect(scene.children.length).toBe(before);
  });
});
