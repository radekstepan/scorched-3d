import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  MAX_SCORCH_MARKS,
  mulberry32,
  TURRET_LIMIT,
  type TNTMap,
  type UnitKind,
} from "@scorched-3d/core";
import { CombatFx, impactPoint, muzzlePoint } from "./combatFx";
import { barrelElevation, buildUnits, getBarrel, getTurret, restBarrelElevation } from "./units";

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

  it("keeps turrets inside their traverse and turns hulls to face targets", () => {
    const scene = new THREE.Scene();
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

  it("leaves hulls to patrol movement in external-hull mode while turrets fire", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const kinds = (units.userData.units as { kind: UnitKind }[]).map((u) => u.kind);
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.setExternalHull(true);
    const hulls = units.children.map((c) => (c as THREE.Group).rotation.y);
    for (let n = 0; n < 600; n++) {
      fx.update(1 / 60);
      units.children.forEach((child, i) => {
        const body = child as THREE.Group;
        // Patrol owns the hull: combat must never yaw it.
        expect(body.rotation.y).toBeCloseTo(hulls[i]!, 10);
        const turret = getTurret(body);
        const limit = TURRET_LIMIT[kinds[i]!]!;
        if (turret) expect(Math.abs(turret.rotation.y)).toBeLessThanOrEqual(limit + 1e-9);
      });
    }
    // Turrets still slewed onto targets independently and fired on the move.
    expect(fx.totalFired).toBeGreaterThan(0);
    fx.dispose();
  });

  it("holds fire when the pair is ballistically out of range", () => {
    // Two hammers ~2500 units apart: past the V²/g ≈ 1931 max range, so the
    // solver returns no solution (retail's admission sentinel) and the guns
    // stay silent no matter how long they traverse.
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "hammer", cellX: 1, cellZ: 1, rotation: 0 },
      { kind: "hammer", cellX: 2, cellZ: 2, rotation: Math.PI },
    ];
    for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(2500, 100, 0)]) {
      const body = new THREE.Group();
      body.position.copy(pos);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    const fx = new CombatFx(scene, group, mulberry32(21));
    for (let n = 0; n < 1200; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBe(0);
    expect(fx.activeCount).toBe(0);
    fx.dispose();
  });

  it("aims the barrel at the firing solution on built units", () => {
    // Real buildUnits bodies (barrel pivots + muzzle tips): the first shot
    // must leave a tank barrel posed away from its rest elevation.
    const width = 32;
    const height = 32;
    const map = {
      width,
      height,
      heights: new Uint8Array(width * height).fill(100),
      units: [
        { kind: "stump", cellX: 8, cellZ: 8, rotation: 0 },
        { kind: "hammer", cellX: 20, cellZ: 20, rotation: 0 },
        { kind: "flash", cellX: 12, cellZ: 20, rotation: 0 },
      ],
    } as unknown as TNTMap;
    const scene = new THREE.Scene();
    const units = buildUnits(map, 1);
    const kinds = (units.userData.units as { kind: UnitKind }[]).map((u) => u.kind);
    const fx = new CombatFx(scene, units, mulberry32(21));
    let fired = false;
    for (let n = 0; n < 3000 && !fired; n++) {
      const before = fx.totalFired;
      fx.update(1 / 60);
      fired = fx.totalFired > before;
    }
    expect(fired).toBe(true);
    // At least one tank barrel was pitched to its solution (commanders and
    // unfired units keep their rest pose).
    const posed = (units.children as THREE.Group[]).some((body, i) => {
      if (!getBarrel(body)) return false;
      return Math.abs(barrelElevation(body) - restBarrelElevation(kinds[i]!)) > 1e-6;
    });
    expect(posed).toBe(true);
    fx.dispose();
  });

  it("shifts recoil anchors so movement never fights the kick", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const anchors = units.children.map((c) => (c as THREE.Group).position.clone());
    const fx = new CombatFx(scene, units, mulberry32(21));
    // Step to the first aimed shot (a single active recoil kick).
    let fired = false;
    for (let n = 0; n < 2000 && !fired; n++) {
      const before = fx.totalFired;
      fx.update(1 / 60);
      fired = fx.totalFired > before;
    }
    expect(fired).toBe(true);
    // Patrol drives every hull 10 units east; anchors follow.
    for (let i = 0; i < units.children.length; i++) fx.shiftRecoilBase(i, 10, 0);
    fx.clearTransients();
    let shifted = 0;
    units.children.forEach((child, i) => {
      const body = child as THREE.Group;
      const dx = body.position.x - anchors[i]!.x;
      expect(dx === 0 || Math.abs(dx - 10) < 1e-9).toBe(true);
      expect(body.position.y).toBeCloseTo(anchors[i]!.y, 9);
      expect(body.position.z).toBeCloseTo(anchors[i]!.z, 9);
      if (Math.abs(dx - 10) < 1e-9) shifted += 1;
    });
    // Exactly the firing hull rode the shifted anchor home.
    expect(shifted).toBe(1);
    fx.dispose();
  });
});

describe("CombatFx unit damage", () => {
  function lambertHexes(body: THREE.Object3D): number[] {
    const out: number[] = [];
    body.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
      if (mat && "emissive" in mat) out.push((mat.color as THREE.Color).getHex());
    });
    return out;
  }

  it("splashes hulls near impacts and smokes the battered ones", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    expect(fx.unitDamageAt(0)).toBe(0);
    // ~30 simulated seconds: dozens of aimed shots land beside hulls.
    for (let n = 0; n < 600; n++) fx.update(0.05);
    expect(fx.totalFired).toBeGreaterThan(0);
    const worst = Math.max(fx.unitDamageAt(0), fx.unitDamageAt(1), fx.unitDamageAt(2));
    expect(worst).toBeGreaterThan(0);
    // Repeated hits push past the smoke threshold: battered hulls puff.
    expect(worst).toBeGreaterThanOrEqual(0.2);
    expect(fx.unitSmokeCount).toBeGreaterThan(0);
    fx.dispose();
  });

  it("chars built hull meshes and keeps damage through clearTransients", () => {
    const width = 32;
    const height = 32;
    const map = {
      width,
      height,
      heights: new Uint8Array(width * height).fill(100),
      units: [
        { kind: "stump", cellX: 8, cellZ: 8, rotation: 0 },
        { kind: "hammer", cellX: 20, cellZ: 20, rotation: 0 },
        { kind: "flash", cellX: 12, cellZ: 20, rotation: 0 },
      ],
    } as unknown as TNTMap;
    const scene = new THREE.Scene();
    const units = buildUnits(map, 1);
    const fx = new CombatFx(scene, units, mulberry32(21));
    const before = (units.children as THREE.Group[]).map(lambertHexes);
    for (let n = 0; n < 600; n++) fx.update(0.05);
    const damaged = [0, 1, 2].filter((i) => fx.unitDamageAt(i) > 0);
    expect(damaged.length).toBeGreaterThan(0);
    // Charring rewrote at least one battered hull's palette in place.
    const charred = damaged.some(
      (i) => JSON.stringify(lambertHexes(units.children[i] as THREE.Group)) !== JSON.stringify(before[i]),
    );
    expect(charred).toBe(true);
    // Damage is persistent session state like scorch: transients drop, hulls
    // stay battered (and still smoke) after the clear.
    const kept = damaged.map((i) => fx.unitDamageAt(i));
    fx.clearTransients();
    expect(damaged.map((i) => fx.unitDamageAt(i))).toEqual(kept);
    fx.update(0.05);
    expect(fx.unitSmokeCount).toBeGreaterThan(0);
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
        blastFeatures: (x: number, z: number, radius: number) => {
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

  it("scars the ground and damages features on impact", () => {
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

  it("kicks the shared light pool for fire glow without adding lights", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const { env } = makeEnv();
    const fx = new CombatFx(scene, units, mulberry32(21), env);
    const before = scene.children.length;
    fx.glowAt({ x: 10, y: 120, z: 30 }, 0xff7a22);
    // Same 2 pooled lights, one now lit; no new objects for fire glow.
    expect(scene.children.length).toBe(before);
    fx.update(0.05);
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
