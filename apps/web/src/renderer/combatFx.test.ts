import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  HUSK_DECAY_DURATION,
  HUSK_SMOKE_END,
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

/** Eight hulls on a wide grid for barrage-cap tests (far outside any blast). */
function makeBarrageUnits(): THREE.Group {
  const kinds = ["stump", "hammer", "flash", "commander", "stump", "hammer", "flash", "commander"];
  const group = new THREE.Group();
  group.userData.units = kinds.map((kind, i) => ({
    kind,
    cellX: 10 + i,
    cellZ: 10 + i,
    rotation: (i * Math.PI) / 4,
  }));
  kinds.forEach((_, i) => {
    const body = new THREE.Group();
    body.rotation.y = (i * Math.PI) / 4;
    body.position.set((i % 4) * 700 - 1050, 100, Math.floor(i / 4) * 700 - 350);
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
    // Shots are capped; explosions decay after 1.0s, so the scene only ever
    // holds a handful of transients besides the 2 pooled lights + scorch.
    expect(fx.shotCount).toBeLessThanOrEqual(6);
    expect(fx.explosionCount).toBeLessThanOrEqual(8);
    expect(fx.flashCount).toBeLessThanOrEqual(24);
    expect(fx.totalFired).toBeGreaterThan(0);
    expect(scene.children.length).toBeLessThan(2 + 1 + 6 + 24 + 8 + 1);
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

describe("CombatFx AAA muzzle/explosion layering", () => {
  /** Explosion groups hold a THREE.Points spark field; the units group never does. */
  function explosionGroups(scene: THREE.Scene): THREE.Group[] {
    return scene.children.filter(
      (c) => c instanceof THREE.Group && c.children.some((k) => (k as THREE.Points).isPoints),
    ) as THREE.Group[];
  }

  function stepToExplosion(
    fx: CombatFx,
    scene: THREE.Scene,
    units: THREE.Group,
    maxSteps = 4000,
  ): void {
    void units;
    void scene;
    for (let n = 0; n < maxSteps && fx.explosionCount === 0; n++) fx.update(1 / 60);
    expect(fx.explosionCount).toBeGreaterThan(0);
  }

  it("spawns a layered muzzle flash (hot core + faint halo) and kicks light", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    let fired = false;
    for (let n = 0; n < 2000 && !fired; n++) {
      const before = fx.totalFired;
      fx.update(1 / 60);
      fired = fx.totalFired > before;
    }
    expect(fired).toBe(true);
    // One shot leaves two flashes: the white-hot core plus the halo shell.
    expect(fx.flashCount).toBeGreaterThanOrEqual(2);
    // The pooled light carries the pop to whatever is nearby — hulls or
    // trees/rocks/dirt — with no per-shot light objects.
    const lit = scene.children.some(
      (c) => (c as THREE.PointLight).isPointLight && (c as THREE.PointLight).intensity > 0,
    );
    expect(lit).toBe(true);
    expect(scene.children.filter((c) => (c as THREE.PointLight).isPointLight).length).toBe(2);
    fx.dispose();
  });

  it("builds layered explosions: flash + fireball + smoke + ring + glow + sparks", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    stepToExplosion(fx, scene, units);
    const groups = explosionGroups(scene);
    expect(groups.length).toBe(fx.explosionCount);
    const ex = groups[0]!;
    // 1 flash shell + 1 fireball + 3 smoke puffs + 1 ring + 1 glow + sparks.
    expect(ex.children.length).toBe(8);
    expect(ex.children.filter((k) => (k as THREE.Points).isPoints).length).toBe(1);
    const mats = new Map<string, number>();
    ex.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
      if (mat && "color" in mat) {
        const geo = (mesh as THREE.Mesh).geometry;
        const tag =
          geo?.type === "RingGeometry"
            ? "ring"
            : geo?.type === "CircleGeometry"
              ? "glow"
              : (mat.blending === THREE.NormalBlending ? "smoke" : "hot");
        mats.set(`${tag}:${(mat.color as THREE.Color).getHex().toString(16)}`, 1);
      }
    });
    // Fireball burns orange, the ring glows pale, smoke is one shared grey.
    const hexes = [...mats.keys()].join(",");
    expect(hexes).toContain("ffa03c");
    expect(hexes).toContain("ffe2b8");
    expect(hexes).toContain("ff9a3c");
    expect(hexes).toContain("8f959e");
    // Impact also leaves its weapon-tinted flash pop beside the explosion.
    expect(fx.flashCount).toBeGreaterThan(0);
    fx.dispose();
  });

  it("caps flashes and explosions under a long barrage", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    for (let n = 0; n < 4000; n++) {
      fx.update(0.05);
      expect(fx.explosionCount).toBeLessThanOrEqual(8);
      expect(fx.flashCount).toBeLessThanOrEqual(24);
      expect(fx.shotCount).toBeLessThanOrEqual(6);
    }
    expect(fx.totalFired).toBeGreaterThan(0);
    // Impacts happened along the way (persistent scars outlive the 1.0s
    // explosion layers, so none need be alive on the final tick).
    expect(fx.scorchCount).toBeGreaterThan(0);
    fx.dispose();
  });

  it("seats the ring and glow on the terrain with cool-grey smoke", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const ground = 100;
    const fx = new CombatFx(scene, units, mulberry32(21), {
      groundY: () => ground,
      blastFeatures: () => {},
    });
    stepToExplosion(fx, scene, units);
    const ex = explosionGroups(scene)[0]!;
    const world = new THREE.Vector3();
    let ringY = -1;
    let glowY = -1;
    let smokeHex = -1;
    ex.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
      if (!mat || !("color" in mat)) return;
      if (mesh.geometry?.type === "RingGeometry") {
        mesh.getWorldPosition(world);
        ringY = world.y;
      } else if (mesh.geometry?.type === "CircleGeometry") {
        mesh.getWorldPosition(world);
        glowY = world.y;
      } else if (mat.blending === THREE.NormalBlending) {
        smokeHex = (mat.color as THREE.Color).getHex();
      }
    });
    // Ground footprint reads on dirt/undergrowth, not up on the hull.
    expect(ringY).toBeCloseTo(ground + 1.6, 5);
    expect(glowY).toBeCloseTo(ground + 1.4, 5);
    // Cool grey per the gentler-scorch palette — never brown, never mud.
    expect(smokeHex).toBe(0x8f959e);
    fx.dispose();
  });

  it("clears and disposes every layer without leaking scene objects", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const before = scene.children.length;
    const fx = new CombatFx(scene, units, mulberry32(21));
    for (let n = 0; n < 300; n++) fx.update(0.05);
    expect(fx.activeCount).toBeGreaterThan(0);
    fx.clearTransients();
    expect(fx.shotCount).toBe(0);
    expect(fx.flashCount).toBe(0);
    expect(fx.explosionCount).toBe(0);
    // Only the pooled lights + the persistent scorch layer + the two
    // damage-view instanced draws (smoke/embers, owned by UnitDamageFx)
    // survive a clear.
    expect(scene.children.length).toBe(before + 5);
    fx.dispose();
    expect(scene.children.length).toBe(before);
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

describe("CombatFx unit death", () => {
  /**
   * White-box prime: the fx owns per-unit damage with no public setter
   * (it only grows through live splashes), so tests park one hull near
   * exhaustion and let aimed fire finish it.
   */
  function primeDamage(fx: CombatFx, index: number, value: number): void {
    (fx as unknown as { damage: number[] }).damage[index] = value;
  }

  function sparkGroups(scene: THREE.Scene): THREE.Group[] {
    return scene.children.filter(
      (c) => c instanceof THREE.Group && c.children.some((k) => (k as THREE.Points).isPoints),
    ) as THREE.Group[];
  }

  function sparkCountOf(group: THREE.Group): number {
    const points = group.children.find((k) => (k as THREE.Points).isPoints) as THREE.Points;
    return (points.geometry.getAttribute("position") as THREE.BufferAttribute).count;
  }

  function stepUntilKill(fx: CombatFx, maxSteps = 4000): void {
    for (let n = 0; n < maxSteps && fx.killCount === 0; n++) fx.update(1 / 60);
    expect(fx.killCount).toBeGreaterThan(0);
  }

  it("ages husks from the kill: fresh wreck, sinking husk, hidden gone", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    primeDamage(fx, 0, 0.99);
    stepUntilKill(fx);
    expect(fx.isDestroyedAt(0)).toBe(true);
    const body = units.children[0] as THREE.Group;
    // Fresh wreck: no decay, fully seated, still rendered.
    expect(fx.huskAgeAt(0)).toBeCloseTo(0, 9);
    expect(fx.huskDecayAt(0)).toBe(0);
    expect(fx.isHuskGoneAt(0)).toBe(false);
    expect(body.visible).toBe(true);
    const seatY = body.position.y;
    // Live hulls read zero age/decay and never count as gone.
    expect(fx.huskAgeAt(1)).toBe(0);
    expect(fx.huskDecayAt(1)).toBe(0);
    expect(fx.isHuskGoneAt(1)).toBe(false);
    // Mid decay: the husk sinks below its death seat but still renders.
    for (let n = 0; n < 30 * 60; n++) fx.update(1 / 60);
    expect(fx.huskAgeAt(0)).toBeCloseTo(30, 6);
    expect(fx.huskDecayAt(0)).toBeCloseTo(0.5, 6);
    expect(fx.huskDecayAt(0)).toBeCloseTo(
      fx.huskAgeAt(0) / HUSK_DECAY_DURATION,
      9,
    );
    expect(fx.isHuskGoneAt(0)).toBe(false);
    expect(body.position.y).toBeLessThan(seatY);
    expect(body.visible).toBe(true);
    // Fully decayed: the body hides but the roster slot (and scar) remain.
    for (let n = 0; n < 35 * 60; n++) fx.update(1 / 60);
    expect(fx.huskAgeAt(0)).toBeGreaterThanOrEqual(HUSK_DECAY_DURATION);
    expect(fx.huskDecayAt(0)).toBe(1);
    expect(fx.isHuskGoneAt(0)).toBe(true);
    expect(body.visible).toBe(false);
    expect(fx.goneCount).toBeGreaterThanOrEqual(1);
    // Decay never resurrects: still dead, still out of the fight.
    expect(fx.isDestroyedAt(0)).toBe(true);
    expect(fx.unitDamageAt(0)).toBe(1);
    expect(fx.aliveCount).toBeLessThanOrEqual(2);
    expect(units.children.length).toBe(3);
    expect(fx.scorchCount).toBeGreaterThan(0);
    fx.dispose();
  });

  it("keeps the kill clock through clearTransients (decay never rewinds)", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    primeDamage(fx, 0, 0.99);
    stepUntilKill(fx);
    for (let n = 0; n < 300; n++) fx.update(1 / 60); // 5 s of decay
    const age = fx.huskAgeAt(0);
    expect(age).toBeCloseTo(5, 6);
    const y = (units.children[0] as THREE.Group).position.y;
    fx.clearTransients();
    // The clock persists: age and decay read the same after the clear.
    expect(fx.huskAgeAt(0)).toBeCloseTo(age, 9);
    expect(fx.huskDecayAt(0)).toBeCloseTo(age / HUSK_DECAY_DURATION, 9);
    expect(fx.isDestroyedAt(0)).toBe(true);
    // (The rest of the roster keeps fighting through the window — a second
    // kill here is fine; only unit 0's clock is under test.)
    expect(fx.killCount).toBeGreaterThanOrEqual(1);
    // And decay resumes on the next tick — no snap back to the death seat.
    fx.update(1 / 60);
    expect((units.children[0] as THREE.Group).position.y).toBeLessThan(y);
    fx.dispose();
  });

  it("gutters wreck smoke once every husk has aged out", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    // White-box extinction: ambient fire goes quiet with one hull left, so
    // a full roster can never die organically (the organic kill path is
    // covered above — here only the decay-driven FX gating is under test).
    const internals = fx as unknown as {
      damage: number[];
      destroyed: boolean[];
      killedAt: (number | null)[];
      deathCount: number;
      elapsed: number;
    };
    for (let i = 0; i < 3; i++) {
      internals.damage[i] = 1;
      internals.destroyed[i] = true;
      internals.killedAt[i] = internals.elapsed;
      internals.deathCount += 1;
    }
    // Fresh husks still smoulder: scan past the intermittent emission gaps.
    let smouldered = false;
    for (let n = 0; n < 600 && !smouldered; n++) {
      fx.update(1 / 60);
      smouldered = fx.unitSmokeCount > 0;
    }
    expect(smouldered).toBe(true);
    // Age every husk past the smoke end: silence — embers too. Rewind the
    // kill timestamps (the test backdoor above owns them) instead of
    // stepping thousands of ticks.
    const youngest = Math.min(fx.huskAgeAt(0), fx.huskAgeAt(1), fx.huskAgeAt(2));
    const wait = HUSK_SMOKE_END * HUSK_DECAY_DURATION - youngest + 2;
    for (let i = 0; i < 3; i++) internals.killedAt[i]! -= wait;
    fx.update(1 / 60);
    expect(fx.unitSmokeCount).toBe(0);
    expect(fx.unitEmberCount).toBe(0);
    // The roster slots (and dim minimap dots) remain.
    expect(units.children.length).toBe(3);
    expect(fx.aliveCount).toBe(0);
    fx.dispose();
  });

  it("kills once at exhaustion: hook fires once, wreck persists, epic burst spawns", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    const killed: number[] = [];
    fx.onUnitKilled = (i) => killed.push(i);
    expect(fx.aliveCount).toBe(3);
    primeDamage(fx, 0, 0.95);
    stepUntilKill(fx);
    // The primed hull dies on its first splash; the transition fires once.
    expect(killed).toEqual([0]);
    expect(fx.killCount).toBe(1);
    expect(fx.isDestroyedAt(0)).toBe(true);
    expect(fx.unitDamageAt(0)).toBe(1);
    expect(fx.aliveCount).toBe(2);
    // Fell, don't remove: the instance stays in the roster buffers.
    expect(units.children.length).toBe(3);
    expect(units.children[0]).toBeDefined();
    // The death burst is the epic layering: 6 smoke puffs (flash + fire +
    // 6 smoke + ring + glow + sparks = 11 children) with 80 sparks, versus
    // the regular 3-puff / 36-spark impact stack.
    const epic = sparkGroups(scene).filter((g) => sparkCountOf(g) === 80);
    expect(epic.length).toBeGreaterThanOrEqual(1);
    expect(epic[0]!.children.length).toBe(11);
    // The kill survives more barrages without ever re-firing the hook.
    for (let n = 0; n < 2000; n++) fx.update(1 / 60);
    expect(killed.filter((i) => i === 0).length).toBe(1);
    expect(fx.isDestroyedAt(0)).toBe(true);
    expect(fx.unitDamageAt(0)).toBe(1);
    fx.dispose();
  });

  it("dead hulls stop firing and stop drawing fire", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(7));
    primeDamage(fx, 0, 0.99);
    primeDamage(fx, 1, 0.99);
    for (let n = 0; n < 4000 && fx.killCount < 2; n++) fx.update(1 / 60);
    expect(fx.killCount).toBe(2);
    expect(fx.aliveCount).toBe(1);
    // One live hull left: the skirmish goes quiet — no shots, no new fire.
    const fired = fx.totalFired;
    for (let n = 0; n < 600; n++) {
      fx.update(1 / 60);
      expect(fx.shotCount).toBe(0);
    }
    expect(fx.totalFired).toBe(fired);
    fx.dispose();
  });

  it("keeps kill flags and damage through clearTransients", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    primeDamage(fx, 2, 0.99);
    stepUntilKill(fx);
    expect(fx.killCount).toBe(1);
    fx.clearTransients();
    expect(fx.killCount).toBe(1);
    expect(fx.isDestroyedAt(2)).toBe(true);
    expect(fx.unitDamageAt(2)).toBe(1);
    expect(fx.aliveCount).toBe(2);
    fx.dispose();
  });
});

describe("CombatFx destruction", () => {
  function makeEnv() {
    const calls: { x: number; z: number; radius: number }[] = [];
    const dents: { x: number; z: number; radius: number; depth: number }[] = [];
    let height = 100;
    return {
      calls,
      dents,
      setHeight(h: number) {
        height = h;
      },
      env: {
        groundY: () => height,
        blastFeatures: (x: number, z: number, radius: number) => {
          calls.push({ x, z, radius });
        },
        dentTerrain: (x: number, z: number, radius: number, depth: number) => {
          dents.push({ x, z, radius, depth });
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
    // Eight hulls on a wide grid (pairwise ≥700 apart, far outside any
    // 64-unit blast): the barrage reaches the 48-mark cap long before the
    // roster can annihilate itself into silence. Three hulls would die out
    // first and stall impacts at ~33 marks.
    const units = makeBarrageUnits();
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

  it("seeds scorch marks, tints over the char texture, and dents shallow bowls", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const ctl = makeEnv();
    const fx = new CombatFx(scene, units, mulberry32(21), ctl.env);
    for (let n = 0; n < 200; n++) fx.update(0.05);
    expect(fx.scorchCount).toBeGreaterThan(0);
    // One shallow dimple per scar, capped well under a height unit (visual
    // only — pathing and unit seating never see it).
    expect(ctl.dents.length).toBe(fx.scorchCount);
    for (const d of ctl.dents) {
      expect(d.radius).toBeGreaterThan(0);
      expect(d.radius).toBeLessThanOrEqual(34);
      expect(d.depth).toBeGreaterThan(0);
      expect(d.depth).toBeLessThanOrEqual(0.6);
    }
    // The shared scorch layer stays translucent so blotches never read as
    // opaque mud: material opacity well under full.
    const mesh = scene.children.find(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.InstancedMesh;
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.7);
    const color = new THREE.Color();
    for (let i = 0; i < fx.scorchCount; i++) {
      mesh.getColorAt(i, color);
      expect(color.r).toBeGreaterThan(0.7);
      expect(color.r).toBeLessThanOrEqual(1);
      // Warm-neutral multiplier: channels track each other closely.
      expect(Math.abs(color.r - color.g)).toBeLessThan(0.05);
      expect(Math.abs(color.r - color.b)).toBeLessThan(0.08);
    }
    // Decals are elliptical, never perfect circles sharing one silhouette.
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let varied = false;
    for (let i = 0; i < fx.scorchCount; i++) {
      mesh.getMatrixAt(i, m);
      m.decompose(pos, quat, scale);
      if (Math.abs(scale.x - scale.z) > 1e-6) varied = true;
    }
    expect(varied).toBe(true);
    fx.dispose();
  });
});
