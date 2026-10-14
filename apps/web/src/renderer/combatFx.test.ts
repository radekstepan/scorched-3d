import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MAX_SCORCH_MARKS, mulberry32, TURRET_LIMIT, type UnitKind } from "@scorched-3d/core";
import { CombatFx, impactPoint, muzzlePoint } from "./combatFx";
import { getTurret } from "./units";

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
    // Mirror buildUnits: every body carries a traverse-limited turret group.
    const turret = new THREE.Group();
    turret.name = "turret";
    body.add(turret);
    body.userData.turret = turret;
    group.add(body);
  });
  return group;
}

/** Two units: attacker at the origin facing -Z, target at +Z (dead astern). */
function makeAsternPair(): THREE.Group {
  const group = new THREE.Group();
  group.userData.units = [
    { kind: "hammer", cellX: 1, cellZ: 1, rotation: Math.PI },
    { kind: "stump", cellX: 2, cellZ: 2, rotation: 0 },
  ];
  const bodies = [
    { pos: new THREE.Vector3(0, 100, 0), rot: Math.PI },
    { pos: new THREE.Vector3(0, 100, 500), rot: 0 },
  ];
  bodies.forEach((b) => {
    const body = new THREE.Group();
    body.rotation.y = b.rot;
    body.position.copy(b.pos);
    const turret = new THREE.Group();
    turret.name = "turret";
    body.add(turret);
    body.userData.turret = turret;
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

  it("follows the turret line (hull + turret-relative yaw)", () => {
    // Hull facing +Z with the turret traversed +90°: muzzle must leave
    // sideways down the turret line, not down the hull line.
    const m = muzzlePoint({ x: 0, y: 100, z: 0 }, 0 + Math.PI / 2, "stump");
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
    expect(fx.totalFired).toBeGreaterThan(0);
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

  it("withholds fire until the attacker traverses onto the target", () => {
    const scene = new THREE.Scene();
    const units = makeAsternPair();
    const fx = new CombatFx(scene, units, mulberry32(21));
    // The hammer starts facing dead away (PI off boresight at 1.1 rad/s
    // needs ~2.9s to turn around): nothing may fire in the first second.
    for (let n = 0; n < 60; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBe(0);
    // After traverse + scheduler retries, aimed shots leave down the muzzle.
    for (let n = 0; n < 60 * 12; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBeGreaterThan(0);
    fx.dispose();
  });

  it("keeps turrets inside their traverse and turns hulls to face targets", () => {    const scene = new THREE.Scene();
    const units = makeUnits();
    const kinds = (units.userData.units as { kind: UnitKind }[]).map((u) => u.kind);
    const fx = new CombatFx(scene, units, mulberry32(7));
    for (let n = 0; n < 600; n++) {
      fx.update(1 / 60);
      units.children.forEach((child, i) => {
        const body = child as THREE.Group;
        const turret = getTurret(body);
        const limit = TURRET_LIMIT[kinds[i]!]!;
        // Turret-relative yaw never exceeds the clamp, on the mesh or state.
        if (turret) expect(Math.abs(turret.rotation.y)).toBeLessThanOrEqual(limit + 1e-9);
        const pose = fx.aimState(i)!;
        expect(Math.abs(pose.turret)).toBeLessThanOrEqual(limit + 1e-9);
        expect(body.rotation.y).toBeCloseTo(pose.hull, 10);
      });
    }
    // Hulls visibly turned away from their seeded placements to track targets.
    const initial = [0, Math.PI / 2, Math.PI];
    const moved = [0, 1, 2].some(
      (i) => Math.abs(fx.aimState(i)!.hull - initial[i]!) > 1e-6,
    );
    expect(moved).toBe(true);
    fx.dispose();
  });
});

describe("CombatFx destruction", () => {
  function makeEnv() {
    const calls: { x: number; z: number; radius: number }[] = [];
    let height = 100;
    return {
      calls,
      setHeight(h: number) {
        height = h;
      },
      env: {
        groundY: () => height,
        fellFeatures: (x: number, z: number, radius: number) => {
          calls.push({ x, z, radius });
        },
      },
    };
  }

  function scorchY(scene: THREE.Scene, index: number): number {
    const mesh = scene.children.find(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(index, m);
    return m.elements[13]!;
  }

  function hasScorchMesh(scene: THREE.Scene): boolean {
    return scene.children.some((c) => (c as THREE.InstancedMesh).isInstancedMesh);
  }

  it("scars the ground and fells features on impact", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const { calls, env } = makeEnv();
    const fx = new CombatFx(scene, units, mulberry32(21), env);
    for (let n = 0; n < 200; n++) fx.update(0.05);
    expect(fx.scorchCount).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.radius).toBeGreaterThan(0);
    // Units themselves are never moved by blasts (only recoil touches them,
    // and clearTransients restores that).
    expect(units.children.length).toBe(3);
    fx.dispose();
  });

  it("caps scorch decals and keeps them through clearTransients", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const { env } = makeEnv();
    const fx = new CombatFx(scene, units, mulberry32(21), env);
    for (let n = 0; n < 4000; n++) fx.update(0.05);
    expect(fx.scorchCount).toBe(MAX_SCORCH_MARKS);
    const kept = fx.scorchCount;
    fx.clearTransients();
    expect(fx.scorchCount).toBe(kept);
    expect(fx.activeCount).toBe(0);
    fx.dispose();
  });

  it("re-seats scorch on exaggeration change and drops it on dispose", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const ctl = makeEnv();
    const fx = new CombatFx(scene, units, mulberry32(21), ctl.env);
    for (let n = 0; n < 200; n++) fx.update(0.05);
    expect(fx.scorchCount).toBeGreaterThan(0);
    expect(scorchY(scene, 0)).toBeCloseTo(101.2, 5);
    ctl.setHeight(200);
    fx.reseatScorch();
    expect(scorchY(scene, 0)).toBeCloseTo(201.2, 5);
    fx.dispose();
    expect(fx.scorchCount).toBe(0);
    expect(hasScorchMesh(scene)).toBe(false);
  });
});
