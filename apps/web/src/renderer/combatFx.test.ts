import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  HUSK_DECAY_DURATION,
  HUSK_SMOKE_END,
  MAX_SCORCH_MARKS,
  ballisticPosition,
  ballisticVelocity,
  canFire,
  ELEVATION_AIM_TOLERANCE,
  ELEVATION_MAX,
  ELEVATION_SLEW_RATE,
  FOREST_STICK_REPOSITION_HITS,
  GRAVITY,
  mulberry32,
  muzzleYaw,
  solveBallistic,
  solveDirect,
  TURRET_LIMIT,
  wrapAngle,
  yawToTarget,
  type TNTMap,
  type UnitKind,
} from "@scorched-3d/core";
import {
  CombatFx,
  impactPoint,
  muzzlePoint,
  PEEWEE_BLAST_SCALE,
  PEEWEE_BULLET_SCALE,
  PEEWEE_EXPLOSION_MAX_AGE,
  projectileGlowFalloff,
  projectileGlowRadius,
  projectileTailLength,
  projectileTailOpacity,
  PROJECTILE_TAIL_MAX,
  PROJECTILE_TAIL_MIN,
  PROJECTILE_TAIL_OPACITY_MAX,
  PROJECTILE_TAIL_OPACITY_MIN,
  SHOT_GLOW_LIGHTS,
  SHOT_GLOW_OPACITY,
  SHOT_GLOW_PEAK,
  SHOT_GLOW_RANGE,
  SHOT_GLOW_RADIUS,
  TURRET_RECOIL_DURATION,
  TURRET_RECOIL_KICK,
  wreckPopVelocity,
} from "./combatFx";
import { barrelElevation, buildTeamRing, buildUnits, getBarrel, getTurret, restBarrelElevation } from "./units";
import { wreckCharredColor } from "./unitDamageFx";
import { NIGHT_LIGHT_BOOST } from "./night";

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

/** Two peewees facing each other `distance` apart (attacker at the origin). */
function makePeeweeDuel(distance: number): THREE.Group {
  const group = new THREE.Group();
  group.userData.units = [
    { kind: "peewee", cellX: 1, cellZ: 1, rotation: 0 },
    { kind: "peewee", cellX: 2, cellZ: 2, rotation: Math.PI },
  ];
  const bodies = [
    { pos: new THREE.Vector3(0, 100, 0), rot: 0 },
    { pos: new THREE.Vector3(0, 100, distance), rot: Math.PI },
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
  it("lands dead-on at close range, slightly above the hull", () => {
    const rng = mulberry32(11);
    for (let n = 0; n < 50; n++) {
      const p = impactPoint({ x: 500, y: 120, z: 300 }, rng, "hammer", 50);
      expect(p.x).toBe(500);
      expect(p.z).toBe(300);
      expect(p.y).toBeGreaterThan(120);
    }
  });

  it("scatters around the mark at range, bounded and worse for artillery", () => {
    const mark = { x: 500, y: 120, z: 300 };
    const shell = mulberry32(11);
    let shellMax = 0;
    for (let n = 0; n < 200; n++) {
      const p = impactPoint(mark, shell, "hammer", 900);
      shellMax = Math.max(shellMax, Math.hypot(p.x - mark.x, p.z - mark.z));
      expect(p.y).toBeGreaterThan(120);
    }
    // Long-range artillery visibly strays yet stays bounded.
    expect(shellMax).toBeGreaterThan(10);
    expect(shellMax).toBeLessThanOrEqual(60);
    const bolt = mulberry32(11);
    let boltMax = 0;
    for (let n = 0; n < 200; n++) {
      const p = impactPoint(mark, bolt, "flash", 900);
      boltMax = Math.max(boltMax, Math.hypot(p.x - mark.x, p.z - mark.z));
    }
    expect(boltMax).toBeLessThanOrEqual(24);
    expect(boltMax).toBeLessThan(shellMax);
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

  it("lobs grenades at close range, bolts past it", () => {
    // Knife-fight duel at 150 (inside the 220 grenade range): every volley
    // leaves as a high-arc lob, never a flat bolt.
    const scene = new THREE.Scene();
    const duel = makePeeweeDuel(150);
    const fx = new CombatFx(scene, duel, mulberry32(21));
    let fired = false;
    for (let n = 0; n < 600 && !fired; n++) {
      const before = fx.totalFired;
      fx.update(1 / 60);
      fired = fx.totalFired > before;
    }
    expect(fired).toBe(true);
    expect(fx.grenadeCount).toBeGreaterThan(0);
    expect(fx.grenadeCount).toBe(fx.totalFired);
    fx.dispose();
  });

  it("keeps the peashooter past grenade range", () => {
    // Brawling range at 400 (inside the 550 bolt reach, past the 220 lob):
    // volleys leave as flat bolts, never grenades.
    const scene = new THREE.Scene();
    const duel = makePeeweeDuel(400);
    const fx = new CombatFx(scene, duel, mulberry32(21));
    let fired = false;
    for (let n = 0; n < 600 && !fired; n++) {
      const before = fx.totalFired;
      fx.update(1 / 60);
      fired = fx.totalFired > before;
    }
    expect(fired).toBe(true);
    expect(fx.grenadeCount).toBe(0);
    fx.dispose();
  });

  it("fires small rifle bullets that crack instead of booming", () => {
    // Brawling duel at 400: peewee bolts leave shrunken and their impacts
    // stage a scaled-down, shorter blast stack.
    const scene = new THREE.Scene();
    const duel = makePeeweeDuel(400);
    const fx = new CombatFx(scene, duel, mulberry32(21));
    let fired = false;
    for (let n = 0; n < 600 && !fired; n++) {
      const before = fx.totalFired;
      fx.update(1 / 60);
      fired = fx.totalFired > before;
    }
    expect(fired).toBe(true);
    expect(fx.shotCount).toBeGreaterThan(0);
    expect(fx.shotScaleAt(0)).toBe(PEEWEE_BULLET_SCALE);
    expect(fx.shotScaleAt(99)).toBeNull();
    // Fly the bolt home: the impact cracks small and stages short.
    let burst = false;
    for (let n = 0; n < 600 && !burst; n++) {
      fx.update(1 / 60);
      burst = fx.explosionCount > 0;
    }
    expect(burst).toBe(true);
    expect(fx.explosionScaleAt(0)).toBe(PEEWEE_BLAST_SCALE);
    expect(fx.explosionMaxAgeAt(0)).toBe(PEEWEE_EXPLOSION_MAX_AGE);
    expect(fx.explosionScaleAt(99)).toBeNull();
    expect(fx.explosionMaxAgeAt(99)).toBeNull();
    fx.dispose();
  });

  it("stages full-size bullets and blasts for tank guns", () => {
    // Tank duel: no shrink anywhere — heads fly at scale 1 and blasts stage
    // the full stack, longer than the peewee crack.
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    let fired = false;
    for (let n = 0; n < 1200 && !fired; n++) {
      const before = fx.totalFired;
      fx.update(1 / 60);
      fired = fx.totalFired > before;
    }
    expect(fired).toBe(true);
    for (let i = 0; i < fx.shotCount; i++) expect(fx.shotScaleAt(i)).toBe(1);
    let burst = false;
    for (let n = 0; n < 1200 && !burst; n++) {
      fx.update(1 / 60);
      burst = fx.explosionCount > 0;
    }
    expect(burst).toBe(true);
    for (let i = 0; i < fx.explosionCount; i++) {
      expect(fx.explosionScaleAt(i)).toBe(1);
      expect(fx.explosionMaxAgeAt(i)).toBeGreaterThan(PEEWEE_EXPLOSION_MAX_AGE);
    }
    fx.dispose();
  });

  it("splashes landed grenades onto hulls", () => {
    // Close duel runs long enough for ~4 s lob flights to land: the hulls
    // must carry damage from the grenade splashes.
    const scene = new THREE.Scene();
    const duel = makePeeweeDuel(150);
    const fx = new CombatFx(scene, duel, mulberry32(21));
    for (let n = 0; n < 3600; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBeGreaterThan(0);
    expect(fx.grenadeCount).toBeGreaterThan(0);
    expect(fx.unitDamageAt(0) + fx.unitDamageAt(1)).toBeGreaterThan(0);
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

describe("CombatFx turret recoil", () => {
  /** Solo hull that never fires organically (single units hold fire). */
  function makeSolo(): THREE.Group {
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
    return group;
  }

  /** Backdoor into the private fire kick (same white-box precedent as primeDamage). */
  function recoil(
    fx: CombatFx,
    index: number,
    body: THREE.Group,
    dir: THREE.Vector3 = new THREE.Vector3(0, 0, 1),
  ): void {
    (fx as unknown as { kickRecoil(index: number, body: THREE.Group, dir: THREE.Vector3): void }).kickRecoil(
      index,
      body,
      dir,
    );
  }

  function splash(fx: CombatFx, x: number, y: number, z: number, kind: UnitKind = "hammer"): void {
    (fx as unknown as { damageUnits(at: THREE.Vector3, kind: UnitKind): void }).damageUnits(
      new THREE.Vector3(x, y, z),
      kind,
    );
  }

  function turretOf(units: THREE.Group, index: number): THREE.Group {
    return getTurret(units.children[index] as THREE.Group)!;
  }

  it("kicks the firing turret rearward along the live barrel line", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    // Step to the first aimed shot (a single attacker kicks).
    let fired = false;
    for (let n = 0; n < 2000 && !fired; n++) {
      const before = fx.totalFired;
      fx.update(1 / 60);
      fired = fx.totalFired > before;
    }
    expect(fired).toBe(true);
    // Exactly the firing hull slides its turret: full strength on the firing
    // tick, already decaying by one frame.
    const kicked = [0, 1, 2].filter((i) => {
      const t = turretOf(units, i);
      return Math.hypot(t.position.x, t.position.z) > 1e-9;
    });
    expect(kicked.length).toBe(1);
    const i = kicked[0]!;
    const turret = turretOf(units, i);
    const offset = Math.hypot(turret.position.x, turret.position.z);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThanOrEqual(TURRET_RECOIL_KICK + 1e-9);
    expect(offset).toBeCloseTo(TURRET_RECOIL_KICK * (1 - 1 / 60 / TURRET_RECOIL_DURATION), 9);
    // Rearward along the live barrel in the hull frame: anti-parallel to the
    // turret-relative yaw (the slide lives on turret.position, a body child),
    // never sideways.
    const pose = fx.aimState(i)!;
    const bx = Math.sin(pose.turret);
    const bz = Math.cos(pose.turret);
    const dot = turret.position.x * bx + turret.position.z * bz;
    expect(dot).toBeLessThan(0);
    expect(Math.abs(turret.position.x * bz - turret.position.z * bx)).toBeLessThan(1e-9);
    // Aiming is untouched: the slide lives on position, yaw on rotation.
    expect(turret.rotation.y).toBeCloseTo(pose.turret, 12);
    fx.dispose();
  });

  it("returns the turret to exact zero on its own shorter clock", () => {
    const scene = new THREE.Scene();
    const units = makeSolo();
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.update(1 / 60);
    const body = units.children[0] as THREE.Group;
    const turret = turretOf(units, 0);
    recoil(fx, 0, body);
    fx.update(1 / 60);
    expect(Math.hypot(turret.position.x, turret.position.z)).toBeGreaterThan(0);
    // A second shot mid-envelope refreshes the slide back to full (re-hits
    // re-kick instead of stacking past the cap).
    recoil(fx, 0, body);
    fx.update(1 / 60);
    expect(Math.hypot(turret.position.x, turret.position.z)).toBeCloseTo(
      TURRET_RECOIL_KICK * (1 - 1 / 60 / TURRET_RECOIL_DURATION),
      9,
    );
    // Past the envelope the turret sits bit-exact at rest with no entry left.
    for (let n = 0; n < 120; n++) fx.update(1 / 60);
    expect(turret.position.x).toBe(0);
    expect(turret.position.z).toBe(0);
    expect(fx.impactAt(0)).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
    fx.dispose();
  });

  it("stacks with the hull impact rock without fighting it", () => {
    const scene = new THREE.Scene();
    const units = makeSolo();
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.update(1 / 60);
    const body = units.children[0] as THREE.Group;
    const basePos = body.position.clone();
    const turret = turretOf(units, 0);
    // Rock the hull from the flank, then fire through the rock: the hull
    // keeps its rock, the turret still kicks.
    splash(fx, 30, 100, 0, "hammer");
    recoil(fx, 0, body);
    fx.update(1 / 60);
    expect(body.position.equals(basePos)).toBe(false);
    expect(fx.impactAt(0).shoveX).toBeLessThan(0);
    expect(Math.hypot(turret.position.x, turret.position.z)).toBeGreaterThan(0);
    // The turret yaw never moves under either system (rock tilts the hull,
    // recoil slides the turret).
    expect(turret.rotation.y).toBe(0);
    // Long after both envelopes (0.45 s rock, 0.25 s turret) everything is
    // bit-exact: hull on its seat, turret at rest.
    for (let n = 0; n < 120; n++) fx.update(1 / 60);
    expect(body.position.equals(basePos)).toBe(true);
    expect(turret.position.x).toBe(0);
    expect(turret.position.z).toBe(0);
    expect(fx.impactAt(0)).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
    fx.dispose();
  });

  it("settles a mid-recoil turret on the kill and never kicks wrecks", () => {
    // Commander solo: the walker keeps its torso aboard (tanks pop the
    // turret into debris, which would move the reference), so the slide
    // restore reads directly on the live subgroup.
    const group = new THREE.Group();
    group.userData.units = [{ kind: "commander", cellX: 10, cellZ: 10, rotation: 0 }];
    const commander = new THREE.Group();
    commander.rotation.order = "YXZ";
    commander.position.set(0, 100, 0);
    const torso = new THREE.Group();
    torso.name = "turret";
    commander.add(torso);
    commander.userData.turret = torso;
    group.add(commander);
    const scene = new THREE.Scene();
    const fx = new CombatFx(scene, group, mulberry32(21));
    fx.update(1 / 60);
    const body = group.children[0] as THREE.Group;
    const turret = turretOf(group, 0);
    recoil(fx, 0, body);
    fx.update(1 / 60);
    expect(Math.hypot(turret.position.x, turret.position.z)).toBeGreaterThan(0);
    // The finishing blow settles the slide with the rock: the wreck holds.
    (fx as unknown as { damage: number[] }).damage[0] = 0.99;
    splash(fx, 5, 100, 0, "hammer");
    expect(fx.isDestroyedAt(0)).toBe(true);
    expect(turret.position.x).toBe(0);
    expect(turret.position.z).toBe(0);
    expect(fx.impactAt(0)).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
    // A wreck never gains a slide, even when kicked directly.
    recoil(fx, 0, body);
    fx.update(1 / 60);
    expect(turret.position.x).toBe(0);
    expect(turret.position.z).toBe(0);
    expect(body.position.x).toBeCloseTo(0, 9);
    expect(body.position.z).toBeCloseTo(0, 9);
    fx.dispose();
  });

  it("restores the turret slide exactly on clearTransients", () => {
    const scene = new THREE.Scene();
    const units = makeSolo();
    const fx = new CombatFx(scene, units, mulberry32(21));
    fx.update(1 / 60);
    const body = units.children[0] as THREE.Group;
    const turret = turretOf(units, 0);
    recoil(fx, 0, body);
    fx.update(1 / 60);
    expect(Math.hypot(turret.position.x, turret.position.z)).toBeGreaterThan(0);
    fx.clearTransients();
    expect(turret.position.x).toBe(0);
    expect(turret.position.z).toBe(0);
    expect(fx.impactAt(0)).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
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
    // The pooled kick lights carry the pop to whatever is nearby — hulls or
    // trees/rocks/dirt — with no per-shot light objects. The fx also owns
    // the in-flight projectile-glow pool beside them (bounded, dark at rest).
    expect(scene.children.filter((c) => (c as THREE.PointLight).isPointLight).length).toBe(
      2 + SHOT_GLOW_LIGHTS,
    );
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
    // Only the pooled kick + projectile-glow lights, the pooled ground
    // blobs, the persistent scorch layer, and the two damage-view instanced
    // draws (smoke/embers, owned by UnitDamageFx) survive a clear.
    expect(scene.children.length).toBe(before + 2 + SHOT_GLOW_LIGHTS * 2 + 1 + 2);
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
    // The roster slots remain (the minimap drops their dots).
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

  it("death drops the team ring + selection beacon at once (husk keeps rendering)", async () => {
    const { buildSelectionMarker, disposeSelectionAssets, updateSelectionMarker } =
      await import("./selectionFx");
    const scene = new THREE.Scene();
    const units = makeUnits();
    const body = units.children[0] as THREE.Group;
    body.add(buildTeamRing(0));
    const marker = buildSelectionMarker();
    updateSelectionMarker(marker, 0, true);
    body.add(marker);
    const fx = new CombatFx(scene, units, mulberry32(21));
    try {
      expect(body.getObjectByName("team-ring")!.visible).toBe(true);
      expect(marker.visible).toBe(true);
      primeDamage(fx, 0, 0.99);
      stepUntilKill(fx);
      expect(fx.isDestroyedAt(0)).toBe(true);
      // Circles gone immediately — the fresh husk itself still renders
      // until full decay (see the husk-age test above).
      expect(body.getObjectByName("team-ring")!.visible).toBe(false);
      expect(marker.visible).toBe(false);
      expect(body.visible).toBe(true);
    } finally {
      disposeSelectionAssets();
      fx.dispose();
    }
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
    // A lethal volley's sibling round can still be airborne when the second
    // kill lands (task 114's barrel-lay gating shifted volley timing, so
    // this seed now kills with a round in flight): let in-flight rounds
    // land first — with one hull alive none may be *fired* past this point.
    for (let n = 0; n < 600 && fx.shotCount > 0; n++) fx.update(1 / 60);
    expect(fx.shotCount).toBe(0);
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
    // Blasts never move movers — hulls only rock with a decaying
    // renderer-side nudge (recoil + hit reaction), and clearTransients
    // settles that.
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

describe("CombatFx tree interception (canopy sticks + lobbed aiming)", () => {
  /** Two hulls 400 apart along +X on flat ground, facing each other. */
  function makeWoodlandPair(attackerKind: UnitKind, targetKind: UnitKind): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: attackerKind, cellX: 1, cellZ: 1, rotation: Math.PI / 2 },
      { kind: targetKind, cellX: 2, cellZ: 2, rotation: -Math.PI / 2 },
    ];
    for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(400, 100, 0)]) {
      const body = new THREE.Group();
      body.position.copy(pos);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    // Pre-aimed down the line so the first scheduler tick can fire.
    (group.children[0] as THREE.Group).rotation.y = Math.PI / 2;
    (group.children[1] as THREE.Group).rotation.y = -Math.PI / 2;
    return group;
  }

  /** One live crown centered on the flat line of fire (muzzle ~110). */
  function woodlandEnv() {
    const struck: number[] = [];
    return {
      struck,
      env: {
        groundY: () => 100,
        blastFeatures: () => {},
        treeStands: () => [{ x: 200, z: 0, groundY: 86, standing: true }],
        strikeTree: (fid: number) => {
          struck.push(fid);
        },
      },
    };
  }

  it("sticks flat bolts in live crowns (ember, no blast) and reports the tree", () => {
    const scene = new THREE.Scene();
    const units = makeWoodlandPair("flash", "flash");
    const ctl = woodlandEnv();
    const fx = new CombatFx(scene, units, mulberry32(21), ctl.env);
    for (let n = 0; n < 1200; n++) fx.update(1 / 60);
    // Every flat round crosses the crown (scatter stays inside r=16), so
    // ~25 shots at 0.55 stick chance must strand several embers.
    expect(fx.totalFired).toBeGreaterThan(0);
    expect(fx.stuckCount).toBeGreaterThan(0);
    expect(ctl.struck.length).toBe(fx.stuckCount);
    for (const fid of ctl.struck) expect(fid).toBe(0);
    fx.dispose();
  });

  it("never sticks in open ground (no stands, no entropy spent)", () => {
    const scene = new THREE.Scene();
    const units = makeWoodlandPair("flash", "flash");
    const fx = new CombatFx(scene, units, mulberry32(21), {
      groundY: () => 100,
      blastFeatures: () => {},
    });
    for (let n = 0; n < 1200; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBeGreaterThan(0);
    expect(fx.stuckCount).toBe(0);
    fx.dispose();
  });

  it("reports an obstructed shot when rounds keep sticking in wood (leave the forest)", () => {
    const scene = new THREE.Scene();
    const units = makeWoodlandPair("flash", "flash");
    const ctl = woodlandEnv();
    // Zero rng: every crossing sticks (0 < stick chance), every volley is
    // 0→1 (legacy pair pick draws attacker 0, slot 0), and aim never
    // scatters — the lane reads as blocked on attacker 0's third ember,
    // deterministically.
    const fx = new CombatFx(scene, units, () => 0, ctl.env);
    const obstructed: { attacker: number; target: number; x: number; z: number }[] = [];
    fx.onObstructedShot = (attacker, target, x, z) => obstructed.push({ attacker, target, x, z });
    for (let n = 0; n < 3000 && obstructed.length === 0; n++) fx.update(1 / 60);
    // The third consecutive ember names the pair plus the target position
    // to close on (unscattered aim: exactly the far hull), and re-arms.
    expect(fx.totalFired).toBeGreaterThanOrEqual(FOREST_STICK_REPOSITION_HITS);
    expect(obstructed).toEqual([{ attacker: 0, target: 1, x: 400, z: 0 }]);
    expect(fx.forestStickCount(0)).toBe(0);
    // Persistent futility re-reports without spamming: exactly one more
    // hook per further threshold of consecutive sticks.
    const stuckAtFirst = fx.stuckCount;
    for (let n = 0; n < 3000 && obstructed.length < 2; n++) fx.update(1 / 60);
    expect(obstructed).toHaveLength(2);
    expect(obstructed[1]).toEqual({ attacker: 0, target: 1, x: 400, z: 0 });
    expect(fx.stuckCount - stuckAtFirst).toBe(FOREST_STICK_REPOSITION_HITS);
    fx.dispose();
  });

  it("resets the forest-futility count when a round reaches its impact", () => {
    const scene = new THREE.Scene();
    const units = makeWoodlandPair("flash", "flash");
    let woodsOn = true;
    const fx = new CombatFx(scene, units, () => 0, {
      groundY: () => 100,
      blastFeatures: () => {},
      treeStands: () => (woodsOn ? [{ x: 200, z: 0, groundY: 86, standing: true }] : []),
      strikeTree: () => {},
    });
    const obstructed: unknown[] = [];
    fx.onObstructedShot = (...args: unknown[]) => obstructed.push(args);
    // Two embers strand a streak of 2 — one short of the reposition.
    for (let n = 0; n < 3000 && fx.forestStickCount(0) < 2; n++) fx.update(1 / 60);
    expect(fx.forestStickCount(0)).toBe(2);
    expect(obstructed).toHaveLength(0);
    // The wood falls (a blast/crush lane opens): the next volley lands and
    // clears the streak instead of reporting — only consecutive sticks move
    // the hull.
    woodsOn = false;
    for (let n = 0; n < 3000 && fx.forestStickCount(0) > 0; n++) fx.update(1 / 60);
    expect(fx.forestStickCount(0)).toBe(0);
    expect(obstructed).toHaveLength(0);
    fx.dispose();
  });

  /** Hammer + stump 400 apart via buildUnits (real elevating barrels). */
  function makeArtilleryDuel(): THREE.Group {
    const width = 64;
    const height = 64;
    const map = {
      width,
      height,
      heights: new Uint8Array(width * height).fill(100),
      units: [
        { kind: "hammer", cellX: 20, cellZ: 32, rotation: Math.PI / 2 },
        { kind: "stump", cellX: 45, cellZ: 32, rotation: -Math.PI / 2 },
      ],
    } as unknown as TNTMap;
    return buildUnits(map, 1);
  }

  function hammerBarrels(units: THREE.Group): number[] {
    const kinds = (units.userData.units as { kind: UnitKind }[]).map((u) => u.kind);
    return (units.children as THREE.Group[]).map((body, i) =>
      kinds[i] === "hammer" && getBarrel(body) ? barrelElevation(body) : NaN,
    );
  }

  it("fires flat into blocked canopy (mount refuses the near-vertical lob)", () => {
    const scene = new THREE.Scene();
    const units = makeArtilleryDuel();
    const fx = new CombatFx(scene, units, mulberry32(21), {
      groundY: () => 100,
      blastFeatures: () => {},
      // Crown centered on the flat arc between the hulls: the seated hulls
      // ride at y≈200, so the crown center sits at y≈226 (x≈16 world).
      treeStands: () => [{ x: 16, z: 8, groundY: 202, standing: true }],
      strikeTree: () => {},
    });
    let flat = false;
    let peak = 0;
    for (let n = 0; n < 6000; n++) {
      fx.update(1 / 60);
      for (const e of hammerBarrels(units)) {
        if (Number.isNaN(e)) continue;
        if (e < 0.5) flat = true;
        peak = Math.max(peak, e);
      }
    }
    expect(fx.totalFired).toBeGreaterThan(0);
    // The tube lays flat onto the low root instead of mortar-lobbing — and
    // never climbs past the artillery mount, not even toward the old lob.
    expect(flat).toBe(true);
    expect(peak).toBeLessThanOrEqual(ELEVATION_MAX.hammer + 1e-9);
    expect(peak).toBeLessThan(1.0);
    fx.dispose();
  });

  it("lays the barrel at the limited elevation rate instead of snapping", () => {
    // Flat open hammer-vs-hammer duel, both tubes pre-aimed in yaw: the only
    // wind-up is the barrel crank from rest (0.7) down to the flat solution
    // (~0.1), so any first round must wait out the full crank.
    const scene = new THREE.Scene();
    const width = 64;
    const height = 64;
    const map = {
      width,
      height,
      heights: new Uint8Array(width * height).fill(100),
      units: [
        { kind: "hammer", cellX: 20, cellZ: 32, rotation: Math.PI / 2 },
        { kind: "hammer", cellX: 45, cellZ: 32, rotation: -Math.PI / 2 },
      ],
    } as unknown as TNTMap;
    const units = buildUnits(map, 1);
    const fx = new CombatFx(scene, units, mulberry32(21), {
      groundY: () => 100,
      blastFeatures: () => {},
    });
    const tubes = () => hammerBarrels(units).filter((e) => !Number.isNaN(e));
    let prev = tubes();
    let maxStep = 0;
    let firedTick = -1;
    for (let n = 0; n < 3000 && firedTick < 0; n++) {
      fx.update(1 / 60);
      const now = tubes();
      for (let i = 0; i < now.length; i++) {
        maxStep = Math.max(maxStep, Math.abs(now[i]! - prev[i]!));
      }
      prev = now;
      if (fx.totalFired > 0) firedTick = n;
    }
    expect(firedTick).toBeGreaterThan(0);
    // No frame ever snaps the tube: per-tick motion stays within one slew
    // step plus the final invisible seat (≤ aim tolerance), far below the
    // ~0.6 rad rest-to-solution lay a snap would cover in one tick.
    expect(maxStep).toBeLessThanOrEqual(
      Math.max(ELEVATION_SLEW_RATE.hammer / 60, ELEVATION_AIM_TOLERANCE) + 1e-9,
    );
    // And the lay is a visible wind-up, not an instant pose: the crank alone
    // needs dozens of ticks before the first round leaves.
    expect(firedTick).toBeGreaterThan(30);
    fx.dispose();
  });

  it("fires the flat low root over the same ground with no wood (legacy)", () => {
    const scene = new THREE.Scene();
    const units = makeArtilleryDuel();
    const fx = new CombatFx(scene, units, mulberry32(21), {
      groundY: () => 100,
      blastFeatures: () => {},
    });
    // Full budget, no early exit: the barrel now poses flat while cranking
    // toward the lay, so a flat barrel no longer implies a round has left.
    let flat = false;
    for (let n = 0; n < 6000; n++) {
      fx.update(1 / 60);
      // Low root for ~400 units sits near 0.1 rad — far below the rest
      // pose (0.7).
      flat = flat || hammerBarrels(units).some((e) => e < 0.5);
    }
    expect(fx.totalFired).toBeGreaterThan(0);
    expect(flat).toBe(true);
    fx.dispose();
  });
});

describe("CombatFx terrain collision (no shooting through hills)", () => {
  /** Two flash hulls 400 apart along +X on flat ground, facing each other. */
  function makeRidgePair(): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "flash", cellX: 1, cellZ: 1, rotation: Math.PI / 2 },
      { kind: "flash", cellX: 2, cellZ: 2, rotation: -Math.PI / 2 },
    ];
    for (const pos of [new THREE.Vector3(0, 100, 0), new THREE.Vector3(400, 100, 0)]) {
      const body = new THREE.Group();
      body.position.copy(pos);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    (group.children[0] as THREE.Group).rotation.y = Math.PI / 2;
    (group.children[1] as THREE.Group).rotation.y = -Math.PI / 2;
    return group;
  }

  /** 70-tall ridge astride the line of fire (muzzles ride ~110). */
  const ridgeY = (x: number, _z: number) => (x > 150 && x < 250 ? 170 : 100);

  it("holds flat fire into a hillside and reports the obstruction", () => {
    const scene = new THREE.Scene();
    const units = makeRidgePair();
    const obstructed: { attacker: number; target: number; x: number; z: number }[] = [];
    const fx = new CombatFx(scene, units, mulberry32(21), {
      groundY: ridgeY,
      blastFeatures: () => {},
    });
    fx.onObstructedShot = (attacker, target, x, z) => obstructed.push({ attacker, target, x, z });
    for (let n = 0; n < 1200; n++) fx.update(1 / 60);
    // No round ever leaves into the hill — and every hold names a
    // cross-team pair plus the target position to close on.
    expect(fx.totalFired).toBe(0);
    expect(obstructed.length).toBeGreaterThan(0);
    for (const o of obstructed) {
      expect(o.attacker).not.toBe(o.target);
      expect(new Set([o.attacker, o.target])).toEqual(new Set([0, 1]));
      const t = units.children[o.target] as THREE.Group;
      // The hook carries the target position to close on (aim scatter
      // keeps the impact within a bound of the hull).
      expect(Math.abs(o.x - t.position.x)).toBeLessThan(100);
      expect(Math.abs(o.z - t.position.z)).toBeLessThan(100);
    }
    fx.dispose();
  });

  it("detonates a round mid-flight when terrain rises under it (no pass-through)", () => {
    const scene = new THREE.Scene();
    const units = makeRidgePair();
    const blasts: number[] = [];
    let ridgeOn = false;
    const fx = new CombatFx(scene, units, mulberry32(21), {
      groundY: (x, z) => (ridgeOn ? ridgeY(x, z) : 100),
      blastFeatures: (x) => {
        blasts.push(x);
      },
    });
    // Let one round leave on flat ground, then raise the ridge under it.
    let n = 0;
    for (; n < 600 && fx.shotCount === 0; n++) fx.update(1 / 60);
    expect(fx.shotCount).toBeGreaterThan(0);
    ridgeOn = true;
    for (let k = 0; k < 240; k++) fx.update(1 / 60);
    // The in-flight round died on the ridge face — nothing reached the
    // far hull at x=400, and later volleys held fire at the gate.
    expect(blasts.length).toBeGreaterThan(0);
    for (const x of blasts) expect(x).toBeLessThan(300);
    expect(fx.shotCount).toBe(0);
    fx.dispose();
  });

  it("holds fire when only a beyond-mount lob clears the ridge", () => {
    const scene = new THREE.Scene();
    const width = 64;
    const height = 64;
    const map = {
      width,
      height,
      heights: new Uint8Array(width * height).fill(100),
      units: [
        { kind: "hammer", cellX: 20, cellZ: 32, rotation: Math.PI / 2 },
        { kind: "hammer", cellX: 45, cellZ: 32, rotation: -Math.PI / 2 },
      ],
    } as unknown as TNTMap;
    const units = buildUnits(map, 1);
    const blasts: number[] = [];
    const obstructed: unknown[] = [];
    const fx = new CombatFx(scene, units, mulberry32(21), {
      // Ridge between the hulls (world x≈16): the seated hulls ride at
      // y≈200 with the flat arc peaking ~227, so a 260 crest genuinely digs
      // the flat root in while the high root that would sail over is past
      // the artillery mount.
      groundY: (x) => (Math.abs(x - 16) < 60 ? 260 : 200),
      blastFeatures: (x) => {
        blasts.push(x);
      },
    });
    fx.onObstructedShot = (...args: unknown[]) => obstructed.push(args);
    const kinds = (units.userData.units as { kind: UnitKind }[]).map((u) => u.kind);
    let peak = 0;
    for (let k = 0; k < 3000; k++) {
      fx.update(1 / 60);
      for (let i = 0; i < units.children.length; i++) {
        const body = units.children[i] as THREE.Group;
        if (kinds[i] === "hammer" && getBarrel(body)) {
          peak = Math.max(peak, barrelElevation(body));
        }
      }
    }
    // No round ever leaves into (or over) the hill — the guns hold fire and
    // ask for a reposition, and the tubes never crank past the mount.
    expect(fx.totalFired).toBe(0);
    expect(blasts).toHaveLength(0);
    expect(obstructed.length).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(ELEVATION_MAX.hammer + 1e-9);
    fx.dispose();
  });
});

describe("CombatFx barrel crush (tubes knock down what they touch)", () => {
  /** One stump at the origin facing +Z (tube z 4..26 at y ~112.5). */
  function makeParkedStump(): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = [{ kind: "stump", cellX: 1, cellZ: 1, rotation: 0 }];
    const body = new THREE.Group();
    body.position.set(0, 100, 0);
    body.rotation.y = 0;
    const turret = new THREE.Group();
    turret.name = "turret";
    body.add(turret);
    body.userData.turret = turret;
    group.add(body);
    return group;
  }

  it("fells a standing trunk the tube rests in (no clip left behind)", () => {
    const scene = new THREE.Scene();
    const units = makeParkedStump();
    const felled: number[] = [];
    const fx = new CombatFx(scene, units, mulberry32(21), {
      groundY: () => 100,
      blastFeatures: () => {},
      treeStands: () => [{ x: 0, z: 15, groundY: 100, standing: true }],
      fellTree: (fid: number) => {
        felled.push(fid);
      },
    });
    for (let n = 0; n < 3; n++) fx.update(1 / 60);
    // The parked tube overlaps the bole from the first tick — every report
    // names that tree (the canvas-side crush is idempotent past the fell).
    expect(felled.length).toBeGreaterThan(0);
    for (const fid of felled) expect(fid).toBe(0);
    fx.dispose();
  });

  it("leaves open ground, felled wood, and crowns alone", () => {
    const scene = new THREE.Scene();
    const units = makeParkedStump();
    const felled: number[] = [];
    const fx = new CombatFx(scene, units, mulberry32(21), {
      groundY: () => 100,
      blastFeatures: () => {},
      treeStands: () => [
        // Far from the tube.
        { x: 60, z: 60, groundY: 100, standing: true },
        // On the tube line but already flat (no bole left to hit).
        { x: 0, z: 15, groundY: 100, standing: false },
        // 6.5 aside: outside the bole + tube radius, under the canopy only.
        { x: 6.5, z: 15, groundY: 100, standing: true },
      ],
      fellTree: (fid: number) => {
        felled.push(fid);
      },
    });
    for (let n = 0; n < 60; n++) fx.update(1 / 60);
    expect(felled).toEqual([]);
    fx.dispose();
  });

  it("never fells for tube-less kinds (commander torso turns in place)", () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData.units = [{ kind: "commander", cellX: 1, cellZ: 1, rotation: 0 }];
    const body = new THREE.Group();
    body.position.set(0, 100, 0);
    const turret = new THREE.Group();
    turret.name = "turret";
    body.add(turret);
    body.userData.turret = turret;
    group.add(body);
    const felled: number[] = [];
    const fx = new CombatFx(scene, group, mulberry32(21), {
      groundY: () => 100,
      blastFeatures: () => {},
      treeStands: () => [{ x: 0, z: 8, groundY: 100, standing: true }],
      fellTree: (fid: number) => {
        felled.push(fid);
      },
    });
    for (let n = 0; n < 60; n++) fx.update(1 / 60);
    expect(felled).toEqual([]);
    fx.dispose();
  });
});

describe("CombatFx exploded husks", () => {
  function primeDamage(fx: CombatFx, index: number, value: number): void {
    (fx as unknown as { damage: number[] }).damage[index] = value;
  }

  function stepUntilKill(fx: CombatFx, maxSteps = 4000): void {
    for (let n = 0; n < maxSteps && fx.killCount === 0; n++) fx.update(1 / 60);
    expect(fx.killCount).toBeGreaterThan(0);
  }

  /** Commander (walker, with legs) plus a flash target so the pair can fight. */
  function makeWalkerPair(): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = [
      { kind: "commander", cellX: 1, cellZ: 1, rotation: 0 },
      { kind: "flash", cellX: 2, cellZ: 2, rotation: Math.PI },
    ];
    const walker = new THREE.Group();
    walker.position.set(0, 100, 0);
    const torso = new THREE.Group();
    torso.name = "turret";
    walker.add(torso);
    walker.userData.turret = torso;
    for (const x of [-4, 4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(5, 14, 6), new THREE.MeshLambertMaterial({ color: 0x2f6db3 }));
      leg.name = "leg";
      leg.position.set(x, 14, 0);
      walker.add(leg);
    }
    const flash = new THREE.Group();
    flash.position.set(500, 100, 300);
    flash.rotation.y = Math.PI;
    const turret = new THREE.Group();
    turret.name = "turret";
    flash.add(turret);
    flash.userData.turret = turret;
    group.add(walker, flash);
    return group;
  }

  function wreckMeshColors(body: THREE.Group): { base: number; hex: number }[] {
    const out: { base: number; hex: number }[] = [];
    body.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
      if (mat && "emissive" in mat && typeof mesh.userData.baseColor === "number") {
        out.push({
          base: mesh.userData.baseColor as number,
          hex: (mat.color as THREE.Color).getHex(),
        });
      }
    });
    return out;
  }

  it("pops a tank turret into ballistic debris and breaches the hull", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    expect(fx.isWreckPosedAt(0)).toBe(false);
    primeDamage(fx, 0, 0.99);
    stepUntilKill(fx);
    expect(fx.isDestroyedAt(0)).toBe(true);
    expect(fx.isWreckPosedAt(0)).toBe(true);
    const body = units.children[0] as THREE.Group;
    // The turret left the hull: no turret aboard, breach collar in its ring.
    expect(getTurret(body)).toBeNull();
    const collar = body.getObjectByName("wreck-collar");
    expect(collar).toBeDefined();
    // The popped turret flies as scene-level debris (never a picking target:
    // the canvas raycasts units.children only).
    expect(fx.debrisCount).toBe(1);
    const at = fx.debrisAt(0)!;
    expect(at).toBeDefined();
    const internals = fx as unknown as { debris: ({ group: THREE.Group } | null)[] };
    expect(scene.children).toContain(internals.debris[0]!.group);
    fx.dispose();
  });

  it("flies the popped turret on the analytic arc, then lands and rests", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    primeDamage(fx, 0, 0.99);
    stepUntilKill(fx);
    // Turret world position at the kill == the seated body origin here
    // (turret local origin), so the whole flight is pinned analytically.
    const start = { x: 0, y: 100, z: 0 };
    const vel = wreckPopVelocity(0);
    expect(vel.y).toBeGreaterThan(0);
    // Mid-flight (0.5 s of debris age): still airborne, on the arc exactly.
    // The kill lands mid-tick, so age the debris off its live clock instead
    // of counting ticks: advance to ~0.5 s and compare against the same age.
    for (let n = 0; n < 30; n++) fx.update(1 / 60);
    const mid = fx.debrisAt(0)!;
    const internals = fx as unknown as { debris: { age: number }[] };
    const age = internals.debris[0]!.age;
    expect(age).toBeCloseTo(0.5, 1);
    const expected = ballisticPosition(start, vel, age, GRAVITY);
    expect(mid.x).toBeCloseTo(expected.x, 6);
    expect(mid.y).toBeCloseTo(expected.y, 6);
    expect(mid.z).toBeCloseTo(expected.z, 6);
    expect(mid.y).toBeGreaterThan(start.y);
    // After the fall it rests on the ground and never moves again.
    for (let n = 0; n < 360; n++) fx.update(1 / 60);
    const landed = fx.debrisAt(0)!;
    expect(landed.y).toBeCloseTo(start.y - 12 + 2, 6);
    fx.update(1 / 60);
    expect(fx.debrisAt(0)).toEqual(landed);
    fx.dispose();
  });

  it("throws neighbouring kills on different bearings, deterministically", () => {
    const first = wreckPopVelocity(0);
    const second = wreckPopVelocity(1);
    expect([first, second].map((v) => Math.atan2(v.x, v.z))).not.toEqual([
      Math.atan2(first.x, first.z),
      Math.atan2(first.x, first.z),
    ]);
    // Same index, same throw — every run.
    expect(wreckPopVelocity(3)).toEqual(wreckPopVelocity(3));
    // End to end: two identical runs land the turret on the same spot.
    const run = (): { x: number; y: number; z: number } => {
      const scene = new THREE.Scene();
      const units = makeUnits();
      const fx = new CombatFx(scene, units, mulberry32(21));
      (fx as unknown as { damage: number[] }).damage[0] = 0.99;
      for (let n = 0; n < 4000 && fx.killCount === 0; n++) fx.update(1 / 60);
      for (let n = 0; n < 240; n++) fx.update(1 / 60);
      const at = fx.debrisAt(0)!;
      fx.dispose();
      return at;
    };
    expect(run()).toEqual(run());
  });

  it("slumps a commander in place: torso stays aboard, legs splay, no debris", () => {
    const scene = new THREE.Scene();
    const units = makeWalkerPair();
    const fx = new CombatFx(scene, units, mulberry32(21));
    primeDamage(fx, 0, 0.99);
    stepUntilKill(fx);
    expect(fx.isDestroyedAt(0)).toBe(true);
    expect(fx.isWreckPosedAt(0)).toBe(true);
    const body = units.children[0] as THREE.Group;
    // Torso stays aboard but slumped: pitched, dropped, yawed askew.
    const torso = getTurret(body);
    expect(torso).not.toBeNull();
    expect(torso!.rotation.x).toBeCloseTo(0.5, 9);
    expect(torso!.position.y).toBeCloseTo(-4, 9);
    const legs = body.children.filter((c) => c.name === "leg");
    expect(legs.length).toBe(2);
    expect((legs[0] as THREE.Group).rotation.z).toBeGreaterThan(0.15);
    expect((legs[1] as THREE.Group).rotation.z).toBeLessThan(-0.15);
    // Walkers never pop: no debris, no breach collar.
    expect(fx.debrisCount).toBe(0);
    expect(fx.debrisAt(0)).toBeNull();
    expect(body.getObjectByName("wreck-collar")).toBeUndefined();
    fx.dispose();
  });

  it("chars built wrecks past the live cap and keeps it through later barrages", () => {
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
    primeDamage(fx, 0, 0.99);
    stepUntilKill(fx);
    const body = units.children[0] as THREE.Group;
    const colors = wreckMeshColors(body);
    expect(colors.length).toBeGreaterThan(0);
    // Every hull mesh (including the popped turret's, charred pre-detach)
    // reads exactly its base-derived wreck color.
    for (const { base, hex } of colors) {
      expect(hex).toBe(wreckCharredColor(base));
    }
    // Hull boxes settled with a slump; the turret left with its barrel.
    expect(getTurret(body)).toBeNull();
    // Post-death barrages re-tint through the capped live char — the deep
    // husk char stays on top, and the dressing never re-applies.
    const collars = body.children.filter((c) => c.name === "wreck-collar").length;
    for (let n = 0; n < 2000; n++) fx.update(1 / 60);
    expect(fx.isWreckPosedAt(0)).toBe(true);
    expect(body.children.filter((c) => c.name === "wreck-collar").length).toBe(collars);
    for (const { base, hex } of wreckMeshColors(body)) {
      expect(hex).toBe(wreckCharredColor(base));
    }
    fx.dispose();
  });

  it("holds the wreck body still while debris flies, then hides both when gone", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    primeDamage(fx, 0, 0.99);
    stepUntilKill(fx);
    const body = units.children[0] as THREE.Group;
    const x = body.position.x;
    const z = body.position.z;
    // Debris flight + decay never rock the husk: no nudge, X/Z pinned.
    // (The skirmish keeps running — other hulls may die in the window, so
    // all debris assertions below are index-scoped to this wreck.)
    for (let n = 0; n < 180; n++) {
      fx.update(1 / 60);
      expect(body.position.x).toBeCloseTo(x, 9);
      expect(body.position.z).toBeCloseTo(z, 9);
      const kick = fx.impactAt(0);
      expect(kick).toEqual({ shoveX: 0, shoveZ: 0, pitch: 0, roll: 0 });
    }
    expect(fx.debrisAt(0)).not.toBeNull();
    // Fully decayed: the body and its litter hide together, slot retained.
    const internals = fx as unknown as { killedAt: (number | null)[]; elapsed: number };
    internals.killedAt[0] = internals.elapsed - HUSK_DECAY_DURATION - 1;
    fx.update(1 / 60);
    expect(fx.isHuskGoneAt(0)).toBe(true);
    expect(body.visible).toBe(false);
    expect(fx.debrisAt(0)).toBeNull();
    expect(units.children.length).toBe(3);
    fx.dispose();
  });

  it("keeps wreck dressing and debris through clearTransients", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21));
    primeDamage(fx, 0, 0.99);
    stepUntilKill(fx);
    expect(fx.isWreckPosedAt(0)).toBe(true);
    const at = fx.debrisAt(0);
    expect(at).not.toBeNull();
    fx.clearTransients();
    // Dressing persists like scorch: still posed, debris still flying.
    expect(fx.isDestroyedAt(0)).toBe(true);
    expect(fx.isWreckPosedAt(0)).toBe(true);
    expect(fx.debrisAt(0)).toEqual(at);
    expect((units.children[0] as THREE.Group).getObjectByName("wreck-collar")).toBeDefined();
    fx.update(1 / 60);
    expect(fx.debrisAt(0)).not.toEqual(at);
    fx.dispose();
  });
});

describe("CombatFx slope-aware blasts (gradient wash)", () => {
  /** Explosion groups hold a THREE.Points spark field; the units group never does. */
  function blastGroups(scene: THREE.Scene): THREE.Group[] {
    return scene.children.filter(
      (c) => c instanceof THREE.Group && c.children.some((k) => (k as THREE.Points).isPoints),
    ) as THREE.Group[];
  }

  function makeSlopeEnv() {
    const featureSkew: number[] = [];
    const dentSkew: number[] = [];
    return {
      featureSkew,
      dentSkew,
      env: {
        // Eastward grade: ground rises toward +x at 0.5 world units per unit.
        groundY: (x: number) => 100 + x * 0.5,
        // Steep fall line toward −x (downhill): maximum wash.
        slopeAt: () => ({ sx: -1, sz: 0, skew: 0.45 }),
        blastFeatures: (x: number, z: number, radius: number, slope?: { skew?: number }) => {
          void x;
          void z;
          void radius;
          featureSkew.push(slope?.skew ?? 0);
        },
        dentTerrain: (
          x: number,
          z: number,
          radius: number,
          depth: number,
          slope?: { skew?: number },
        ) => {
          void x;
          void z;
          void radius;
          void depth;
          dentSkew.push(slope?.skew ?? 0);
        },
      },
    };
  }

  function scorchMeshOf(scene: THREE.Scene): THREE.InstancedMesh {
    return scene.children.find(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.InstancedMesh;
  }

  it("reports the wash to blast/crater hooks and stretches scorch downhill", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const ctl = makeSlopeEnv();
    const fx = new CombatFx(scene, units, mulberry32(21), ctl.env);
    for (let n = 0; n < 200; n++) fx.update(0.05);
    expect(fx.scorchCount).toBeGreaterThan(0);
    // Every scar carried its wash to features and the crater dent.
    expect(ctl.featureSkew).toHaveLength(fx.scorchCount);
    expect(ctl.dentSkew).toHaveLength(fx.scorchCount);
    for (const s of [...ctl.featureSkew, ...ctl.dentSkew]) expect(s).toBeCloseTo(0.45, 9);
    // Scorch decals stretch down the fall line: the major axis clearly
    // exceeds the minor one (flat stamps stay near-circular).
    const mesh = scorchMeshOf(scene);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < fx.scorchCount; i++) {
      mesh.getMatrixAt(i, m);
      m.decompose(pos, quat, scale);
      expect(scale.x / scale.z).toBeGreaterThan(1.2);
      // Draped to the grade, never a flat horizontal stamp: the instance
      // carries real X/Z tilt (26° grade here ≫ any float noise).
      expect(Math.hypot(quat.x, quat.z)).toBeGreaterThan(0.1);
    }
    fx.dispose();
  });

  it("tilts the shockwave ring and glow to the terrain normal", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const ctl = makeSlopeEnv();
    const fx = new CombatFx(scene, units, mulberry32(21), ctl.env);
    for (let n = 0; n < 4000 && fx.explosionCount === 0; n++) fx.update(1 / 60);
    expect(fx.explosionCount).toBeGreaterThan(0);
    const groups = blastGroups(scene);
    expect(groups.length).toBe(fx.explosionCount);
    // Ring + glow ride the slope: tilted quaternions, not identity.
    let tilted = 0;
    let checked = 0;
    for (const group of groups) {
      for (const child of group.children) {
        const geo = (child as THREE.Mesh).geometry;
        if (geo?.type !== "RingGeometry" && geo?.type !== "CircleGeometry") continue;
        checked++;
        const q = (child as THREE.Mesh).quaternion;
        if (Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) + Math.abs(q.w - 1) > 1e-3) tilted++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(tilted).toBe(checked);
    fx.dispose();
  });

  it("keeps flat-ground blasts circular with untilted rings (legacy)", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    // No slopeAt: perfectly flat wash, flat seating.
    const fx = new CombatFx(scene, units, mulberry32(21), {
      groundY: () => 100,
      blastFeatures: () => {},
      dentTerrain: () => {},
    });
    for (let n = 0; n < 4000 && fx.explosionCount === 0; n++) fx.update(1 / 60);
    expect(fx.explosionCount).toBeGreaterThan(0);
    for (const group of blastGroups(scene)) {
      for (const child of group.children) {
        const geo = (child as THREE.Mesh).geometry;
        if (geo?.type !== "RingGeometry" && geo?.type !== "CircleGeometry") continue;
        const q = (child as THREE.Mesh).quaternion;
        expect(Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) + Math.abs(q.w - 1)).toBeLessThan(1e-9);
      }
    }
    fx.dispose();
  });
});

describe("CombatFx projectile glow", () => {
  /** Scene-level ground-blob discs (scorch is instanced; blast glows live in groups). */
  function glowBlobs(scene: THREE.Scene): THREE.Mesh[] {
    return scene.children.filter(
      (c) =>
        c instanceof THREE.Mesh &&
        !(c as THREE.InstancedMesh).isInstancedMesh &&
        (c as THREE.Mesh).geometry?.type === "CircleGeometry",
    ) as THREE.Mesh[];
  }

  function flatEnv(ground: number) {
    return { groundY: () => ground, blastFeatures: () => {} };
  }

  /** Step until at least one round is in flight (shots live many ticks). */
  function stepToShot(fx: CombatFx, maxSteps = 4000): void {
    for (let n = 0; n < maxSteps && fx.shotCount === 0; n++) fx.update(1 / 60);
    expect(fx.shotCount).toBeGreaterThan(0);
  }

  it("fades linearly with height above the dirt (pure falloff)", () => {
    expect(projectileGlowFalloff(-10)).toBe(1);
    expect(projectileGlowFalloff(0)).toBe(1);
    expect(projectileGlowFalloff(SHOT_GLOW_RANGE / 2)).toBeCloseTo(0.5, 5);
    expect(projectileGlowFalloff(SHOT_GLOW_RANGE)).toBe(0);
    expect(projectileGlowFalloff(SHOT_GLOW_RANGE + 500)).toBe(0);
    // Monotonic: nearer dirt never glows dimmer.
    let prev = 2;
    for (let h = 0; h <= SHOT_GLOW_RANGE + 50; h += 10) {
      const f = projectileGlowFalloff(h);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it("rides live rounds with a bounded light + ground-blob pool", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21), flatEnv(100));
    stepToShot(fx);
    // Pool bounds: never more glow slots than lights, no per-shot objects.
    expect(fx.shotGlowCount).toBe(Math.min(fx.shotCount, SHOT_GLOW_LIGHTS));
    expect(fx.shotGlowCount).toBeLessThanOrEqual(SHOT_GLOW_LIGHTS);
    expect(scene.children.filter((c) => (c as THREE.PointLight).isPointLight).length).toBe(
      2 + SHOT_GLOW_LIGHTS,
    );
    expect(glowBlobs(scene).length).toBe(SHOT_GLOW_LIGHTS);
    // Live slots ride near-surface rounds: light up, blob seated + faint.
    for (let i = 0; i < fx.shotGlowCount; i++) {
      expect(fx.shotGlowIntensityAt(i)).toBeGreaterThan(0);
      expect(fx.shotGlowIntensityAt(i)).toBeLessThanOrEqual(SHOT_GLOW_PEAK);
      expect(fx.shotGlowOpacityAt(i)).toBeGreaterThan(0);
      expect(fx.shotGlowOpacityAt(i)).toBeLessThanOrEqual(SHOT_GLOW_OPACITY);
    }
    // Idle slots stay dark/hidden — no light leak past the live rounds.
    for (let i = fx.shotGlowCount; i < SHOT_GLOW_LIGHTS; i++) {
      expect(fx.shotGlowIntensityAt(i)).toBe(0);
      expect(fx.shotGlowOpacityAt(i)).toBe(0);
    }
    fx.dispose();
  });

  it("keeps the ground highlight small and subtle (radius + opacity caps)", () => {
    // Regression: the in-flight ground blob used to stamp a radius-70 disc
    // at 0.4 opacity — far wider than any scorch mark. It now stays under
    // the smallest scorch radius and peaks faint.
    expect(SHOT_GLOW_RADIUS).toBeLessThanOrEqual(34);
    expect(SHOT_GLOW_OPACITY).toBeLessThanOrEqual(0.25);
    // Pure radius math: full strength hits the cap, climbs shrink it, and
    // out-of-range falloff clamps instead of collapsing the disc.
    expect(projectileGlowRadius(1)).toBeCloseTo(SHOT_GLOW_RADIUS, 5);
    expect(projectileGlowRadius(0)).toBeCloseTo(SHOT_GLOW_RADIUS * 0.6, 5);
    expect(projectileGlowRadius(0.5)).toBeCloseTo(SHOT_GLOW_RADIUS * 0.8, 5);
    expect(projectileGlowRadius(-2)).toBeCloseTo(projectileGlowRadius(0), 5);
    expect(projectileGlowRadius(9)).toBeCloseTo(projectileGlowRadius(1), 5);
    let prev = -Infinity;
    for (let f = 0; f <= 1.001; f += 0.1) {
      const r = projectileGlowRadius(f);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("seats small faint ground blobs under live rounds", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21), flatEnv(100));
    stepToShot(fx);
    expect(fx.shotGlowCount).toBeGreaterThan(0);
    const blobs = glowBlobs(scene);
    const live = blobs.filter((b) => b.visible);
    expect(live.length).toBe(fx.shotGlowCount);
    for (const blob of live) {
      // Seated on the dirt, scaled to the subtle highlight — never the old
      // oversized stamp.
      expect(blob.position.y).toBeCloseTo(100 + 1.4, 5);
      expect(blob.scale.x).toBeGreaterThan(0);
      expect(blob.scale.x).toBeLessThanOrEqual(SHOT_GLOW_RADIUS + 1e-6);
    }
    fx.dispose();
  });

  it("goes quiet far above the dirt (high lobbed arcs light nothing)", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    // Dirt far below every flight path: every height exceeds the range.
    const fx = new CombatFx(scene, units, mulberry32(21), flatEnv(-10000));
    stepToShot(fx);
    // Rounds still fly (sim untouched) but no slot glows.
    expect(fx.shotGlowCount).toBeGreaterThan(0);
    for (let i = 0; i < SHOT_GLOW_LIGHTS; i++) {
      expect(fx.shotGlowIntensityAt(i)).toBe(0);
      expect(fx.shotGlowOpacityAt(i)).toBe(0);
    }
    expect(glowBlobs(scene).every((b) => !b.visible)).toBe(true);
    fx.dispose();
  });

  it("hides the glow with no shots and drops it on clear/dispose (no sim impact)", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21), flatEnv(100));
    stepToShot(fx);
    const fired = fx.totalFired;
    expect(fired).toBeGreaterThan(0);
    fx.clearTransients();
    // Transient glow clears; persistent + sim counters survive the clear.
    expect(fx.shotCount).toBe(0);
    expect(fx.shotGlowCount).toBe(0);
    for (let i = 0; i < SHOT_GLOW_LIGHTS; i++) {
      expect(fx.shotGlowIntensityAt(i)).toBe(0);
      expect(fx.shotGlowOpacityAt(i)).toBe(0);
    }
    expect(fx.totalFired).toBe(fired);
    // Skirmish resumes after the clear — glow never gates firing.
    for (let n = 0; n < 4000 && fx.shotCount === 0; n++) fx.update(1 / 60);
    expect(fx.shotCount).toBeGreaterThan(0);
    fx.dispose();
    // Dispose removes every pooled light and blob (no per-frame leak).
    expect(scene.children.filter((c) => (c as THREE.PointLight).isPointLight).length).toBe(0);
    expect(glowBlobs(scene).length).toBe(0);
  });
});

describe("CombatFx structure fire (HQ forts)", () => {
  function hqDuel(hqX: number, isEngaged?: (index: number) => boolean) {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    // Attacker (team 0 hammer) vs a far teammate-less enemy: the hull duel
    // holds fire at 2500 units, so any volley must answer the HQ.
    group.userData.units = [
      { kind: "hammer", team: 0, cellX: 1, cellZ: 1, rotation: 0 },
      { kind: "flash", team: 1, cellX: 2, cellZ: 2, rotation: Math.PI },
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
    const splashes: { x: number; z: number; shooter: number | null }[] = [];
    const fx = new CombatFx(scene, group, mulberry32(99), {
      groundY: () => 100,
      blastFeatures: () => {},
      hqTargets: () => [{ x: hqX, y: 110, z: 0, team: 1 }],
      damageStructures: (at, _kind, shooter) => {
        splashes.push({ x: at.x, z: at.z, shooter });
      },
      ...(isEngaged ? { isEngaged } : {}),
    });
    return { fx, splashes };
  }

  it("shells a live enemy HQ inside admitted range", () => {
    const { fx, splashes } = hqDuel(600);
    for (let n = 0; n < 60 * 40 && splashes.length === 0; n++) fx.update(1 / 60);
    // Aimed structure volleys left the barrel and splashed the fort.
    expect(fx.totalFired).toBeGreaterThan(0);
    expect(splashes.length).toBeGreaterThan(0);
    for (const s of splashes) {
      expect(Math.hypot(s.x - 600, s.z)).toBeLessThan(120);
      expect(s.shooter).toBe(0);
    }
    fx.dispose();
  });

  it("holds structure fire across the map (range caps lob-proof the HQ)", () => {
    const { fx, splashes } = hqDuel(2000);
    for (let n = 0; n < 1200; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBe(0);
    expect(splashes).toHaveLength(0);
    fx.dispose();
  });

  it("holds structure fire while the gun answers a live enemy (self-defense first)", () => {
    // The only admitted gun is engaged from the first tick: no fort volley
    // ever leaves, and no fort aim is ever recorded.
    const { fx, splashes } = hqDuel(600, (i) => i === 0);
    for (let n = 0; n < 60 * 40; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBe(0);
    expect(splashes).toHaveLength(0);
    expect((fx as unknown as { pendingHq: Map<number, number> }).pendingHq.size).toBe(0);
    fx.dispose();
  });

  it("drops a stale fort aim once its gun answers a live enemy", () => {
    let engaged = false;
    const { fx, splashes } = hqDuel(600, () => engaged);
    const pendingHq = (fx as unknown as { pendingHq: Map<number, number> }).pendingHq;
    // A traverse goal left over from shelling the fort…
    pendingHq.set(0, 1);
    expect(splashes).toHaveLength(0);
    // …is dropped once the gun gets engaged, so the turret rejoins the
    // hull duel instead of lingering on the HQ (the ambient scheduler only
    // reaches the fire gate every few ticks, so sweep a short window).
    engaged = true;
    for (let n = 0; n < 600 && pendingHq.size > 0; n++) fx.update(1 / 60);
    expect(pendingHq.size).toBe(0);
    fx.dispose();
  });

  it("detonates structure-class bursts through the shared epic stack", () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData.units = [{ kind: "flash", team: 0, cellX: 1, cellZ: 1, rotation: 0 }];
    const body = new THREE.Group();
    body.position.set(0, 100, 0);
    group.add(body);
    const splashes: number[] = [];
    const fx = new CombatFx(scene, group, mulberry32(5), {
      groundY: () => 100,
      blastFeatures: () => {},
      damageStructures: () => {
        splashes.push(1);
      },
    });
    const before = fx.scorchCount;
    fx.detonateStructure(new THREE.Vector3(600, 110, 0), "hammer");
    expect(fx.explosionCount).toBe(1);
    expect(fx.scorchCount).toBe(before + 1);
    // The burst routes into the structures hook (the canvas wrecks the HQ).
    expect(splashes).toHaveLength(1);
    fx.dispose();
  });
});

describe("CombatFx projectile warp tail", () => {
  function flatEnv(ground: number) {
    return { groundY: () => ground, blastFeatures: () => {} };
  }

  /** Step until at least one round is in flight (shots live many ticks). */
  function stepToShot(fx: CombatFx, maxSteps = 4000): void {
    for (let n = 0; n < maxSteps && fx.shotCount === 0; n++) fx.update(1 / 60);
    expect(fx.shotCount).toBeGreaterThan(0);
  }

  /** Every warp-tail cone in the scene graph (tails ride heads as children). */
  function tailCones(scene: THREE.Scene): THREE.Mesh[] {
    const cones: THREE.Mesh[] = [];
    scene.traverse((c) => {
      if (c instanceof THREE.Mesh && c.geometry?.type === "ConeGeometry") cones.push(c);
    });
    return cones;
  }

  it("stretches linearly with speed between the clamps (pure length)", () => {
    expect(projectileTailLength(0)).toBe(PROJECTILE_TAIL_MIN);
    expect(projectileTailLength(-50)).toBe(PROJECTILE_TAIL_MIN);
    expect(projectileTailLength(Number.NaN)).toBe(PROJECTILE_TAIL_MIN);
    expect(projectileTailLength(1e6)).toBe(PROJECTILE_TAIL_MAX);
    // Mid-band: 0.06 s of flight — a flash bolt streaks 78, a hunkered
    // shell only 31.2, so fast rounds visibly out-streak slow ones.
    expect(projectileTailLength(1300)).toBeCloseTo(78, 5);
    expect(projectileTailLength(520)).toBeCloseTo(31.2, 5);
    expect(projectileTailLength(1300)).toBeGreaterThan(projectileTailLength(520));
    // Monotonic: faster never trails shorter.
    let prev = -Infinity;
    for (let s = 0; s <= 2000; s += 25) {
      const len = projectileTailLength(s);
      expect(len).toBeGreaterThanOrEqual(prev);
      expect(len).toBeGreaterThanOrEqual(PROJECTILE_TAIL_MIN);
      expect(len).toBeLessThanOrEqual(PROJECTILE_TAIL_MAX);
      prev = len;
    }
  });

  it("stays more transparent than the head across the opacity band (pure opacity)", () => {
    expect(projectileTailOpacity(0)).toBe(PROJECTILE_TAIL_OPACITY_MIN);
    expect(projectileTailOpacity(-50)).toBe(PROJECTILE_TAIL_OPACITY_MIN);
    expect(projectileTailOpacity(Number.NaN)).toBe(PROJECTILE_TAIL_OPACITY_MIN);
    expect(projectileTailOpacity(1e6)).toBe(PROJECTILE_TAIL_OPACITY_MAX);
    // The whole band sits well under the opaque head (opacity 1).
    expect(PROJECTILE_TAIL_OPACITY_MAX).toBeLessThan(0.5);
    // Monotonic: faster never trails fainter.
    let prev = -Infinity;
    for (let s = 0; s <= 2000; s += 25) {
      const o = projectileTailOpacity(s);
      expect(o).toBeGreaterThanOrEqual(prev);
      expect(o).toBeGreaterThanOrEqual(PROJECTILE_TAIL_OPACITY_MIN);
      expect(o).toBeLessThanOrEqual(PROJECTILE_TAIL_OPACITY_MAX);
      expect(o).toBeLessThan(1);
      prev = o;
    }
  });

  it("breathes along a shell arc as gravity works, holds steady for bolts", () => {
    const speedAt = (v: { x: number; y: number; z: number }, t: number, g: number): number => {
      const u = ballisticVelocity(v, t, g);
      return Math.hypot(u.x, u.y, u.z);
    };
    // Flat hammer shell: symmetric arc, apex mid-flight where gravity has
    // bled the vertical speed.
    const shell = solveBallistic({ x: 0, y: 100, z: 0 }, { x: 800, y: 100, z: 0 }, 520, GRAVITY);
    expect(shell).not.toBeNull();
    const apexT = shell!.velocity.y / GRAVITY;
    const muzzle = speedAt(shell!.velocity, 0, GRAVITY);
    const apex = speedAt(shell!.velocity, apexT, GRAVITY);
    const impact = speedAt(shell!.velocity, shell!.duration, GRAVITY);
    expect(apex).toBeLessThan(muzzle);
    expect(impact).toBeCloseTo(muzzle, 5);
    expect(projectileTailLength(apex)).toBeLessThan(projectileTailLength(muzzle));
    expect(projectileTailLength(impact)).toBeCloseTo(projectileTailLength(muzzle), 5);
    expect(projectileTailOpacity(apex)).toBeLessThan(projectileTailOpacity(muzzle));
    expect(projectileTailOpacity(impact)).toBeCloseTo(projectileTailOpacity(muzzle), 5);
    // Flat bolt (no gravity): constant speed, constant tail end to end.
    const bolt = solveDirect({ x: 0, y: 100, z: 0 }, { x: 800, y: 100, z: 0 }, 1300);
    expect(bolt).not.toBeNull();
    for (const t of [0, bolt!.duration / 2, bolt!.duration]) {
      expect(speedAt(bolt!.velocity, t, 0)).toBeCloseTo(1300, 5);
      expect(projectileTailLength(speedAt(bolt!.velocity, t, 0))).toBeCloseTo(78, 5);
    }
  });

  it("trails one tinted cone per live round, posed from its speed", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21), flatEnv(100));
    stepToShot(fx);
    // Exactly one tail per live round, parented to its head (never pooled,
    // never scene-level): heads carry the cones as children.
    const cones = tailCones(scene);
    expect(cones).toHaveLength(fx.shotCount);
    for (const cone of cones) {
      expect(cone.parent).not.toBe(scene);
      // Child at the head origin with no local rotation: it inherits the
      // head's velocity orientation and trails down local -Z by geometry.
      expect(cone.position.length()).toBeCloseTo(0, 5);
      expect(cone.quaternion.length()).toBeCloseTo(1, 5);
      expect(cone.quaternion.x).toBeCloseTo(0, 5);
      expect(cone.quaternion.y).toBeCloseTo(0, 5);
      expect(cone.quaternion.z).toBeCloseTo(0, 5);
      // Tapered cone stretched behind the head, additive and faint.
      expect(cone.scale.x).toBeCloseTo(1, 5);
      expect(cone.scale.y).toBeCloseTo(1, 5);
      expect(cone.scale.z).toBeGreaterThanOrEqual(PROJECTILE_TAIL_MIN);
      expect(cone.scale.z).toBeLessThanOrEqual(PROJECTILE_TAIL_MAX);
      const mat = cone.material as THREE.MeshBasicMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.blending).toBe(THREE.AdditiveBlending);
      expect(mat.opacity).toBeGreaterThanOrEqual(PROJECTILE_TAIL_OPACITY_MIN);
      expect(mat.opacity).toBeLessThanOrEqual(PROJECTILE_TAIL_OPACITY_MAX);
      // Tail wears its head's weapon tint.
      const head = cone.parent as THREE.Mesh;
      expect(mat.color.getHex()).toBe((head.material as THREE.MeshBasicMaterial).color.getHex());
    }
    // The test accessor tracks the same pose per live shot.
    for (let i = 0; i < fx.shotCount; i++) {
      const tail = fx.shotTailAt(i);
      expect(tail).not.toBeNull();
      expect(tail!.length).toBeGreaterThanOrEqual(PROJECTILE_TAIL_MIN);
      expect(tail!.length).toBeLessThanOrEqual(PROJECTILE_TAIL_MAX);
      expect(tail!.opacity).toBeGreaterThanOrEqual(PROJECTILE_TAIL_OPACITY_MIN);
      expect(tail!.opacity).toBeLessThanOrEqual(PROJECTILE_TAIL_OPACITY_MAX);
    }
    expect(fx.shotTailAt(fx.shotCount)).toBeNull();
    fx.dispose();
  });

  it("drops tails with their rounds on arrival and on clear (no sim impact)", () => {
    const scene = new THREE.Scene();
    const units = makeUnits();
    const fx = new CombatFx(scene, units, mulberry32(21), flatEnv(100));
    stepToShot(fx);
    // Tails track live rounds 1:1 every tick — landing volleys take their
    // cones with them (explosions bloom, no cone lingers) and fresh
    // volleys bring new ones.
    for (let n = 0; n < 600; n++) {
      fx.update(1 / 60);
      expect(tailCones(scene).length).toBe(fx.shotCount);
    }
    const fired = fx.totalFired;
    expect(fired).toBeGreaterThan(0);
    fx.clearTransients();
    expect(fx.shotCount).toBe(0);
    expect(tailCones(scene)).toHaveLength(0);
    expect(fx.shotTailAt(0)).toBeNull();
    expect(fx.totalFired).toBe(fired);
    // Skirmish resumes with fresh tails — tails never gate firing.
    stepToShot(fx);
    expect(tailCones(scene)).toHaveLength(fx.shotCount);
    fx.dispose();
    expect(tailCones(scene)).toHaveLength(0);
  });
});

describe("CombatFx proactive engagement", () => {
  /** Teamed bodies with turrets (mirrors buildUnits traverse groups). */
  function makeTeamed(
    specs: { kind: UnitKind; team: number; x: number; z: number; rot: number }[],
  ): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = specs.map((s, n) => ({
      kind: s.kind,
      cellX: n + 1,
      cellZ: n + 1,
      rotation: s.rot,
      team: s.team,
    }));
    for (const s of specs) {
      const body = new THREE.Group();
      body.rotation.y = s.rot;
      body.position.set(s.x, 100, s.z);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    return group;
  }

  /** Unteamed bodies (legacy headless groups: every hull is a valid target). */
  function makeUnteamed(specs: { kind: UnitKind; x: number; z: number; rot: number }[]): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = specs.map((s, n) => ({
      kind: s.kind,
      cellX: n + 1,
      cellZ: n + 1,
      rotation: s.rot,
    }));
    for (const s of specs) {
      const body = new THREE.Group();
      body.rotation.y = s.rot;
      body.position.set(s.x, 100, s.z);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    return group;
  }

  function pendingOf(fx: CombatFx): Map<number, number> {
    return (fx as unknown as { pending: Map<number, number> }).pending;
  }

  function gunError(fx: CombatFx, from: number, to: number, units: THREE.Group): number {
    const a = units.children[from] as THREE.Group;
    const b = units.children[to] as THREE.Group;
    const want = yawToTarget({ x: a.position.x, z: a.position.z }, { x: b.position.x, z: b.position.z });
    const pose = fx.aimState(from)!;
    return Math.abs(wrapAngle(muzzleYaw(pose.hull, pose.turret) - want));
  }

  it("aims in-range enemies before any shot is fired", () => {
    const scene = new THREE.Scene();
    // Two flashes 500 apart (admission 950), facing away from each other.
    const units = makeTeamed([
      { kind: "flash", team: 0, x: 0, z: 0, rot: Math.PI },
      { kind: "flash", team: 1, x: 0, z: 500, rot: 0 },
    ]);
    const fx = new CombatFx(scene, units, mulberry32(11));
    // One tick: the ambient timer (≥0.35s) cannot have fired yet.
    fx.update(1 / 60);
    expect(fx.totalFired).toBe(0);
    // Both guns already acquired across team lines — reaction without fire.
    expect(pendingOf(fx).get(0)).toBe(1);
    expect(pendingOf(fx).get(1)).toBe(0);
    fx.dispose();
  });

  it("traverses turrets onto in-range enemies without being fired upon", () => {
    const scene = new THREE.Scene();
    // Two hammers 500 apart (admission 1050), dead off boresight both ways.
    const units = makeTeamed([
      { kind: "hammer", team: 0, x: 0, z: 0, rot: Math.PI },
      { kind: "hammer", team: 1, x: 0, z: 500, rot: 0 },
    ]);
    const fx = new CombatFx(scene, units, mulberry32(11));
    fx.update(1 / 60); // size the aim roster; one tick barely traverses
    const before0 = gunError(fx, 0, 1, units);
    const before1 = gunError(fx, 1, 0, units);
    expect(before0).toBeGreaterThan(2);
    expect(before1).toBeGreaterThan(2);
    // Half a second of traverse: both guns visibly turn, neither has fired
    // (a PI turn at 1.1 rad/s needs ~2.9s — silence is the aim gate working).
    for (let n = 0; n < 30; n++) fx.update(1 / 60);
    expect(gunError(fx, 0, 1, units)).toBeLessThan(before0);
    expect(gunError(fx, 1, 0, units)).toBeLessThan(before1);
    expect(fx.totalFired).toBe(0);
    fx.dispose();
  });

  it("ignores enemies past admitted range", () => {
    const scene = new THREE.Scene();
    // Two hammers 2500 apart: past the 1050 admission, so no reaction.
    const units = makeTeamed([
      { kind: "hammer", team: 0, x: 0, z: 0, rot: Math.PI },
      { kind: "hammer", team: 1, x: 2500, z: 0, rot: 0 },
    ]);
    const fx = new CombatFx(scene, units, mulberry32(11));
    fx.update(1 / 60);
    expect(pendingOf(fx).size).toBe(0);
    const hasAdmittedFoe = (
      fx as unknown as {
        hasAdmittedFoe: (
          i: number,
          positions: readonly { x: number; z: number }[],
          teams: readonly (number | undefined)[],
          live: readonly boolean[],
        ) => boolean;
      }
    ).hasAdmittedFoe.bind(fx);
    const snap = (
      fx as unknown as {
        rosterSnapshot: () => {
          positions: { x: number; z: number }[];
          teams: (number | undefined)[];
          liveFlags: boolean[];
        };
      }
    ).rosterSnapshot.call(fx);
    expect(hasAdmittedFoe(0, snap.positions, snap.teams, snap.liveFlags)).toBe(false);
    expect(hasAdmittedFoe(1, snap.positions, snap.teams, snap.liveFlags)).toBe(false);
    fx.dispose();
  });

  it("tracks the nearest hull in range for legacy unteamed groups", () => {
    const scene = new THREE.Scene();
    // Three flashes at 0/400/900 (admission 950): no ties, nearest wins.
    const units = makeUnteamed([
      { kind: "flash", x: 0, z: 0, rot: 0 },
      { kind: "flash", x: 400, z: 0, rot: 0 },
      { kind: "flash", x: 900, z: 0, rot: 0 },
    ]);
    const fx = new CombatFx(scene, units, mulberry32(11));
    fx.update(1 / 60);
    expect(fx.totalFired).toBe(0);
    expect(pendingOf(fx).get(0)).toBe(1);
    expect(pendingOf(fx).get(1)).toBe(0);
    expect(pendingOf(fx).get(2)).toBe(1);
    fx.dispose();
  });

  it("leaves existing aims alone (never fights the scheduler)", () => {
    const scene = new THREE.Scene();
    const units = makeUnteamed([
      { kind: "flash", x: 0, z: 0, rot: 0 },
      { kind: "flash", x: 400, z: 0, rot: 0 },
      { kind: "flash", x: 900, z: 0, rot: 0 },
    ]);
    const fx = new CombatFx(scene, units, mulberry32(11));
    // Hull 0 already tracks the farther hull 2 (a scheduler-drawn aim): the
    // proactive pass must not steal it back to the nearer hull 1.
    fx.trackThreat(0, 2);
    fx.update(1 / 60);
    expect(pendingOf(fx).get(0)).toBe(2);
    expect(pendingOf(fx).get(1)).toBe(0);
    expect(pendingOf(fx).get(2)).toBe(1);
    fx.dispose();
  });

  it("draws scheduler volleys from engaged guns first", () => {
    const scene = new THREE.Scene();
    // Far hammer (0) out of range of everything; near flash (1) duels the
    // enemy flash (2) at 400. The ambient volley must never come from 0.
    const units = makeTeamed([
      { kind: "hammer", team: 0, x: 0, z: 0, rot: 0 },
      { kind: "flash", team: 0, x: 2000, z: 0, rot: 0 },
      { kind: "flash", team: 1, x: 2400, z: 0, rot: 0 },
    ]);
    const fx = new CombatFx(scene, units, mulberry32(11));
    const priv = fx as unknown as {
      hasAdmittedFoe: (
        i: number,
        positions: readonly { x: number; z: number }[],
        teams: readonly (number | undefined)[],
        live: readonly boolean[],
      ) => boolean;
      rosterSnapshot: () => {
        positions: { x: number; z: number }[];
        teams: (number | undefined)[];
        liveFlags: boolean[];
      };
    };
    const snap = priv.rosterSnapshot.call(fx);
    expect(priv.hasAdmittedFoe.bind(fx)(0, snap.positions, snap.teams, snap.liveFlags)).toBe(false);
    expect(priv.hasAdmittedFoe.bind(fx)(1, snap.positions, snap.teams, snap.liveFlags)).toBe(true);
    expect(priv.hasAdmittedFoe.bind(fx)(2, snap.positions, snap.teams, snap.liveFlags)).toBe(true);
    // Ten seconds of duelling: volleys leave, nobody dies (flash chips at
    // 0.06/hit), and the far gun never draws a volley — no aim, no fire.
    for (let n = 0; n < 600; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBeGreaterThan(0);
    expect(fx.isDestroyedAt(0)).toBe(false);
    expect(fx.isDestroyedAt(1)).toBe(false);
    expect(fx.isDestroyedAt(2)).toBe(false);
    expect(pendingOf(fx).has(0)).toBe(false);
    fx.dispose();
  });
});

describe("CombatFx turret traverse overshoot", () => {
  /** Teamed bodies with turrets (mirrors buildUnits traverse groups). */
  function makeDuel(
    specs: { kind: UnitKind; team: number; x: number; z: number; rot: number }[],
  ): THREE.Group {
    const group = new THREE.Group();
    group.userData.units = specs.map((s, n) => ({
      kind: s.kind,
      cellX: n + 1,
      cellZ: n + 1,
      rotation: s.rot,
      team: s.team,
    }));
    for (const s of specs) {
      const body = new THREE.Group();
      body.rotation.y = s.rot;
      body.position.set(s.x, 100, s.z);
      const turret = new THREE.Group();
      turret.name = "turret";
      body.add(turret);
      body.userData.turret = turret;
      group.add(body);
    }
    return group;
  }

  /** White-box prime: park a turret far off its aim (the fx owns no setter). */
  function primeTurret(fx: CombatFx, index: number, turret: number): void {
    (fx as unknown as { aim: { hull: number; turret: number; overshoot: number }[] }).aim[
      index
    ]!.turret = turret;
  }

  /** White-box read of a traverse's overshoot latch (0 once settled). */
  function overshootOf(fx: CombatFx, index: number): number {
    return (fx as unknown as { aim: { overshoot: number }[] }).aim[index]!.overshoot;
  }

  function liveBearing(units: THREE.Group, from: number, to: number): number {
    const a = units.children[from] as THREE.Group;
    const b = units.children[to] as THREE.Group;
    return yawToTarget({ x: a.position.x, z: a.position.z }, { x: b.position.x, z: b.position.z });
  }

  it("overshoots far turret swings past the aim, then corrects back", () => {
    const scene = new THREE.Scene();
    // Attacker already faces its foe (hull on the bearing); only the turret
    // is parked far off — a pure turret swing with no hull gross motion.
    const units = makeDuel([
      { kind: "stump", team: 0, x: 0, z: 0, rot: 0 },
      { kind: "stump", team: 1, x: 0, z: 500, rot: Math.PI },
    ]);
    const fx = new CombatFx(scene, units, mulberry32(11));
    fx.update(1 / 60); // size the aim roster
    primeTurret(fx, 0, -1.2);
    // Step through the settle: the traverse ends only once the latch has
    // released onto the aim (the muzzle crosses it in transit, still held).
    let peak = -Infinity;
    let settled = false;
    for (let n = 0; n < 240 && !settled; n++) {
      fx.update(1 / 60);
      const pose = fx.aimState(0)!;
      peak = Math.max(peak, pose.turret);
      settled = overshootOf(fx, 0) === 0 && canFire(liveBearing(units, 0, 1), pose.hull, pose.turret);
    }
    expect(settled).toBe(true);
    // The turret ran past the aim (~0.1 over) before correcting back.
    expect(peak).toBeGreaterThan(0.05);
    // The visible meshes sit exactly on the settled firing line (hull + turret).
    const body = units.children[0] as THREE.Group;
    const pose = fx.aimState(0)!;
    expect(body.rotation.y).toBeCloseTo(pose.hull, 10);
    expect(getTurret(body)!.rotation.y).toBeCloseTo(pose.turret, 10);
    fx.dispose();
  });

  it("fires down the turret line: the firing gun is aimed at its target", () => {
    const scene = new THREE.Scene();
    const units = makeDuel([
      { kind: "flash", team: 0, x: 0, z: 0, rot: Math.PI / 2 },
      { kind: "flash", team: 1, x: 400, z: 0, rot: -Math.PI / 2 },
    ]);
    const fx = new CombatFx(scene, units, mulberry32(7));
    // Step to the first volley; both guns face each other, so it leaves fast.
    for (let n = 0; n < 4000 && fx.totalFired === 0; n++) fx.update(1 / 60);
    expect(fx.totalFired).toBeGreaterThan(0);
    const shots = (fx as unknown as { shots: { attacker: number; target: number }[] }).shots;
    const last = shots[shots.length - 1]!;
    // The gun that fired is aimed at its mark — turret on the firing line.
    const pose = fx.aimState(last.attacker)!;
    expect(canFire(liveBearing(units, last.attacker, last.target), pose.hull, pose.turret)).toBe(true);
    // And the visible meshes sit exactly on that pose (hull + turret).
    const body = units.children[last.attacker] as THREE.Group;
    expect(body.rotation.y).toBeCloseTo(pose.hull, 10);
    expect(getTurret(body)!.rotation.y).toBeCloseTo(pose.turret, 10);
    fx.dispose();
  });

  it("overshoots far turret-only swings while hulls are externally driven", () => {
    const scene = new THREE.Scene();
    // Hull parked off the duel (travel heading); the turret alone traverses
    // the clamped remainder onto the foe.
    const units = makeDuel([
      { kind: "stump", team: 0, x: 0, z: 0, rot: 0 },
      { kind: "stump", team: 1, x: 500, z: 300, rot: Math.PI },
    ]);
    const fx = new CombatFx(scene, units, mulberry32(11));
    fx.setExternalHull(true);
    fx.update(1 / 60);
    primeTurret(fx, 0, -0.5);
    const want = liveBearing(units, 0, 1); // ≈ 1.03, inside the traverse
    let peak = -Infinity;
    let settled = false;
    for (let n = 0; n < 240 && !settled; n++) {
      fx.update(1 / 60);
      const pose = fx.aimState(0)!;
      peak = Math.max(peak, pose.turret);
      settled = overshootOf(fx, 0) === 0 && canFire(liveBearing(units, 0, 1), pose.hull, pose.turret);
    }
    expect(settled).toBe(true);
    // Ran ~0.1 past the clamped goal before correcting back...
    expect(peak).toBeGreaterThan(want + 0.04);
    // ...the hull never turned (the external drive owns it)...
    expect((units.children[0] as THREE.Group).rotation.y).toBeCloseTo(0);
    // ...and the visible turret sits on the settled firing line.
    const pose = fx.aimState(0)!;
    expect(getTurret(units.children[0] as THREE.Group)!.rotation.y).toBeCloseTo(pose.turret, 10);
    fx.dispose();
  });
});

describe("CombatFx night light boost", () => {
  function flatEnv(ground: number) {
    return { groundY: () => ground, blastFeatures: () => {} };
  }

  function kickPeak(fx: CombatFx): number {
    const lights = fx["lights" as never] as THREE.PointLight[];
    return Math.max(...lights.map((l) => l.intensity));
  }

  it("strikes muzzle/explosion kicks hotter by night, day peaks by day", () => {
    const scene = new THREE.Scene();
    const fx = new CombatFx(scene, makeUnits(), mulberry32(21), flatEnv(100));
    fx.glowAt({ x: 10, y: 120, z: 30 }, 0xff7a22, 1400);
    expect(kickPeak(fx)).toBeCloseTo(1400, 6);
    fx.clearTransients();
    expect(kickPeak(fx)).toBe(0);
    fx.setNight(true);
    fx.glowAt({ x: 10, y: 120, z: 30 }, 0xff7a22, 1400);
    expect(kickPeak(fx)).toBeCloseTo(1400 * NIGHT_LIGHT_BOOST, 6);
    fx.clearTransients();
    fx.setNight(false);
    fx.glowAt({ x: 10, y: 120, z: 30 }, 0xff7a22, 1400);
    expect(kickPeak(fx)).toBeCloseTo(1400, 6);
    fx.dispose();
  });

  it("rides shot glow hotter by night (locked-step seeds, same round)", () => {
    // Twin skirmishes on the same seed step in lockstep, so both carry the
    // same round at the same height — the only difference is the toggle.
    const day = new CombatFx(new THREE.Scene(), makeUnits(), mulberry32(21), flatEnv(100));
    const night = new CombatFx(new THREE.Scene(), makeUnits(), mulberry32(21), flatEnv(100));
    night.setNight(true);
    let compared = 0;
    for (let n = 0; n < 4000 && compared < 4; n++) {
      day.update(1 / 60);
      night.update(1 / 60);
      expect(night.shotCount).toBe(day.shotCount);
      for (let i = 0; i < SHOT_GLOW_LIGHTS; i++) {
        const d = day.shotGlowIntensityAt(i);
        if (d > 0) {
          expect(night.shotGlowIntensityAt(i)).toBeCloseTo(d * NIGHT_LIGHT_BOOST, 6);
          expect(night.shotGlowOpacityAt(i)).toBeCloseTo(day.shotGlowOpacityAt(i) * NIGHT_LIGHT_BOOST, 6);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
    day.dispose();
    night.dispose();
  });
});
