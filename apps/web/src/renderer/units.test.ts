import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { TNTMap } from "@scorched-3d/core";
import {
  barrelElevation,
  buildSpawnedUnit,
  buildTeamRing,
  buildUnits,
  getBarrel,
  getLegs,
  getMuzzleTip,
  getTeamRing,
  getTurret,
  getWheels,
  advanceLocomotion,
  muzzleWorld,
  placeUnitsGroup,
  restBarrelElevation,
  setBarrelElevation,
  setUnitAim,
  TEAM_RING_INNER,
  TEAM_RING_OUTER,
  teamRingColor,
} from "./units";
import { TEAM_DEFS } from "@scorched-3d/core";

function fakeMap(): TNTMap {
  const width = 32;
  const height = 32;
  return {
    width,
    height,
    heights: new Uint8Array(width * height).fill(100),
    units: [
      { kind: "commander", cellX: 8, cellZ: 8, rotation: 0 },
      { kind: "stump", cellX: 12, cellZ: 12, rotation: 1 },
      { kind: "flash", cellX: 16, cellZ: 16, rotation: 2 },
      { kind: "hammer", cellX: 20, cellZ: 20, rotation: 3 },
    ],
  } as unknown as TNTMap;
}

describe("buildUnits turrets", () => {
  it("gives every unit a named turret subgroup", () => {
    const group = buildUnits(fakeMap(), 1);
    expect(group.children.length).toBe(4);
    for (const child of group.children) {
      const turret = getTurret(child as THREE.Group);
      expect(turret).not.toBeNull();
      expect(turret!.name).toBe("turret");
      // Turret carries visible geometry (turret box + barrel at minimum).
      expect(turret!.children.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps tank hulls and commander legs on the body, turret parts above", () => {
    const group = buildUnits(fakeMap(), 1);
    const byKind = (group.children as THREE.Group[]).map((c, i) => ({
      body: c,
      kind: (fakeMap().units[i] as { kind: string }).kind,
    }));
    for (const { body, kind } of byKind) {
      // Team ground rings are markers, not hull geometry.
      const hullMeshes = body.children.filter((c) => c.type === "Mesh" && c.name !== "team-ring").length;
      if (kind === "commander") {
        // Two legs stay on the hull; chest/head/antenna yaw with the torso.
        expect(hullMeshes).toBe(2);
      } else {
        // Hull box(es) stay; turret box + barrel moved into the subgroup.
        expect(hullMeshes).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("aims hull and turret separately via setUnitAim", () => {
    const group = buildUnits(fakeMap(), 1);
    const body = group.children[1] as THREE.Group;
    setUnitAim(body, 1.2, 0.3);
    expect(body.rotation.y).toBeCloseTo(1.2);
    expect(getTurret(body)!.rotation.y).toBeCloseTo(0.3);
  });

  it("returns null turret for plain groups and survives re-snaps", () => {
    expect(getTurret(new THREE.Group())).toBeNull();
    const map = fakeMap();
    const group = buildUnits(map, 1);
    const body = group.children[0] as THREE.Group;
    setUnitAim(body, 2.1, -0.4);
    placeUnitsGroup(group, map, 2);
    // Re-snapping moves origins only; aim pose is preserved.
    expect(body.rotation.y).toBeCloseTo(2.1);
    expect(getTurret(body)!.rotation.y).toBeCloseTo(-0.4);
  });
});

describe("barrel elevation", () => {
  it("gives tanks an elevating pivot with a muzzle tip, commander a tip only", () => {
    const group = buildUnits(fakeMap(), 1);
    const kinds = ["commander", "stump", "flash", "hammer"] as const;
    group.children.forEach((child, i) => {
      const body = child as THREE.Group;
      // Every kind exposes a muzzle tip for the live muzzle solution.
      expect(getMuzzleTip(body)).not.toBeNull();
      if (kinds[i] === "commander") {
        expect(getBarrel(body)).toBeNull();
      } else {
        expect(getBarrel(body)).not.toBeNull();
        // Rest pose matches the per-kind mesh elevation.
        expect(barrelElevation(body)).toBeCloseTo(restBarrelElevation(kinds[i]!), 12);
      }
    });
  });

  it("pitches the barrel and moves the tip, surviving hull aim", () => {
    const group = buildUnits(fakeMap(), 1);
    const body = group.children[3] as THREE.Group; // hammer
    const before = muzzleWorld(body)!;
    // Rest 40°: the tip sits well above the trunnion and ahead of the hull.
    expect(before.position.y).toBeGreaterThan(body.position.y + 20);
    setUnitAim(body, 0.8, 0.2);
    setBarrelElevation(body, 0.1);
    expect(barrelElevation(body)).toBeCloseTo(0.1);
    const after = muzzleWorld(body)!;
    // Depressing the barrel drops the tip and throws it further forward.
    expect(after.position.y).toBeLessThan(before.position.y);
    const flat = (p: { x: number; z: number }) => Math.hypot(p.x - body.position.x, p.z - body.position.z);
    expect(flat(after.position)).toBeGreaterThan(flat(before.position));
    // Direction follows yaw + elevation: mostly forward, slightly up.
    expect(after.direction.y).toBeCloseTo(Math.sin(0.1), 2);
    expect(Math.hypot(after.direction.x, after.direction.z)).toBeCloseTo(Math.cos(0.1), 2);
  });

  it("returns null muzzle state for plain groups (math fallback applies)", () => {
    expect(muzzleWorld(new THREE.Group())).toBeNull();
    expect(getMuzzleTip(new THREE.Group())).toBeNull();
    expect(getBarrel(new THREE.Group())).toBeNull();
    // No-ops, never throws — headless combat tests use bare groups.
    setBarrelElevation(new THREE.Group(), 0.5);
    expect(barrelElevation(new THREE.Group())).toBe(0);
  });
});

describe("hull orientation", () => {
  /** Bounding box of the hull-level meshes (turret subgroup excluded). */
  function hullBox(body: THREE.Group): THREE.Box3 {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const child of body.children) {
      if (child.type !== "Mesh") continue;
      // Team ground rings are markers, not hull: skip them like the hull
      // box skips turret geometry (measured separately below).
      if (child.name === "team-ring") continue;
      tmp.setFromObject(child);
      box.union(tmp);
    }
    return box;
  }

  it("builds tank hulls longer than wide along the +Z travel axis", () => {
    const group = buildUnits(fakeMap(), 1);
    // Measure in the model frame (yaw 0): world depth then reads along the
    // hull's own +Z travel axis instead of the rotated placement yaw.
    for (const child of group.children) (child as THREE.Group).rotation.set(0, 0, 0);
    group.updateMatrixWorld(true);
    const kinds = ["commander", "stump", "flash", "hammer"] as const;
    group.children.forEach((child, i) => {
      const kind = kinds[i]!;
      const size = hullBox(child as THREE.Group).getSize(new THREE.Vector3());
      if (kind === "commander") {
        // Biped: shoulder-wide torso across X reads correctly facing +Z.
        expect(size.x).toBeGreaterThan(size.z);
      } else {
        // Tanks drive nose-first: depth (+Z) must exceed width, or the hull
        // reads as driving sideways even with the yaw facing travel.
        expect(size.z).toBeGreaterThan(size.x);
      }
    });
  });

  it("throws muzzles ahead of the lengthened hull nose", () => {
    const group = buildUnits(fakeMap(), 1);
    group.children.forEach((child) => {
      const body = child as THREE.Group;
      // Measure in the model frame (yaw 0, forward +Z) so the world-axis
      // comparison reads along the hull's own travel axis.
      body.rotation.set(0, 0, 0);
    });
    group.updateMatrixWorld(true);
    group.children.forEach((child) => {
      const body = child as THREE.Group;
      const live = muzzleWorld(body);
      expect(live).not.toBeNull();
      // Tip ahead of the hull nose: the barrel overhangs the lengthened
      // (+Z) hull instead of poking out of its flank.
      expect(live!.position.z).toBeGreaterThan(hullBox(body).max.z);
    });
  });
});

describe("grade seating", () => {
  function rampMap(): TNTMap {
    // Eastward ramp: 4 raw units per cell toward +x (gentle, walkable).
    const width = 32;
    const height = 32;
    const heights = new Uint8Array(width * height);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) heights[z * width + x] = 100 + x * 4;
    }
    return {
      width,
      height,
      heights,
      units: [
        { kind: "stump", cellX: 8, cellZ: 8, rotation: Math.PI / 2 },
        { kind: "flash", cellX: 16, cellZ: 16, rotation: 0 },
      ],
    } as unknown as TNTMap;
  }

  it("tilts hulls to the grade on build and re-snap, preserving aim yaw", () => {
    const map = rampMap();
    const group = buildUnits(map, 1);
    expect(group.children.length).toBe(2);
    for (const child of group.children) {
      expect((child as THREE.Group).rotation.order).toBe("YXZ");
    }
    // Hull 0 faces +x (uphill): nose up = negative X rotation.
    const uphill = group.children[0] as THREE.Group;
    expect(uphill.rotation.x).toBeLessThan(-0.01);
    // Hull 1 faces +z (across the fall line): rolls, barely pitches.
    const across = group.children[1] as THREE.Group;
    expect(Math.abs(across.rotation.z)).toBeGreaterThan(0.01);
    // Re-snapping at a higher exaggeration steepens the tilt, keeps yaws.
    placeUnitsGroup(group, map, 3);
    expect(uphill.rotation.y).toBeCloseTo(Math.PI / 2, 10);
    expect(across.rotation.y).toBeCloseTo(0, 10);
    const rebuilt = buildUnits(map, 1);
    expect(Math.abs(uphill.rotation.x)).toBeGreaterThan(
      Math.abs((rebuilt.children[0] as THREE.Group).rotation.x),
    );
  });

  it("seats flat-map units level, as before", () => {
    const map = fakeMap();
    const group = buildUnits(map, 2);
    for (const child of group.children) {
      const body = child as THREE.Group;
      expect(body.rotation.x).toBeCloseTo(0, 12);
      expect(body.rotation.z).toBeCloseTo(0, 12);
    }
  });
});

describe("drive locomotion", () => {
  it("fits road wheels to tracked hulls and legs to the walker", () => {
    const group = buildUnits(fakeMap(), 1);
    const kinds = ["commander", "stump", "flash", "hammer"] as const;
    group.children.forEach((child, i) => {
      const body = child as THREE.Group;
      if (kinds[i] === "commander") {
        expect(getWheels(body).length).toBe(0);
        expect(getLegs(body).length).toBe(2);
      } else {
        // 3 axle stations × 2 sides, no legs.
        expect(getWheels(body).length).toBe(6);
        expect(getLegs(body).length).toBe(0);
      }
    });
  });

  it("keeps tank hulls longer than wide with wheels fitted", () => {
    const group = buildUnits(fakeMap(), 1);
    // Wheels widen the bbox slightly; depth must still win for tanks.
    for (const child of group.children) (child as THREE.Group).rotation.set(0, 0, 0);
    group.updateMatrixWorld(true);
    const kinds = ["commander", "stump", "flash", "hammer"] as const;
    group.children.forEach((child, i) => {
      const body = child as THREE.Group;
      const box3 = new THREE.Box3();
      const tmp = new THREE.Box3();
      for (const part of body.children) {
        if (part.type !== "Mesh") continue;
        if (part.name === "team-ring") continue;
        tmp.setFromObject(part);
        box3.union(tmp);
      }
      const size = box3.getSize(new THREE.Vector3());
      if (kinds[i] === "commander") {
        expect(size.x).toBeGreaterThan(size.z);
      } else {
        expect(size.z).toBeGreaterThan(size.x);
      }
    });
  });

  it("spins wheels with travelled distance and holds at rest", () => {
    const group = buildUnits(fakeMap(), 1);
    const body = group.children[1] as THREE.Group; // stump, radius 4
    advanceLocomotion(body, "stump", 8, 1 / 60);
    for (const wheel of getWheels(body)) expect(wheel.rotation.x).toBeCloseTo(2);
    // Double the road, double the spin.
    advanceLocomotion(body, "stump", 8, 1 / 60);
    for (const wheel of getWheels(body)) expect(wheel.rotation.x).toBeCloseTo(4);
    // A pinned hull never spins its wheels: no travel, no spin.
    advanceLocomotion(body, "stump", 0, 1 / 60);
    for (const wheel of getWheels(body)) expect(wheel.rotation.x).toBeCloseTo(4);
  });

  it("strides the walker antiphase and settles to neutral at rest", () => {
    const group = buildUnits(fakeMap(), 1);
    const body = group.children[0] as THREE.Group; // commander
    const legs = getLegs(body);
    expect(legs.length).toBe(2);
    // Drive two full strides: amplitude ramps to 1, phase lands back at 0.
    for (let n = 0; n < 60; n++) advanceLocomotion(body, "commander", 32 / 60, 1 / 60);
    expect((body.userData as { amp?: number }).amp).toBe(1);
    const [left, right] = [legs[0]!, legs[1]!];
    expect(left.rotation.x).toBeCloseTo(-right.rotation.x, 10);
    // One leg lifts while the other plants (a full stride apart in phase).
    const lifts = [left.position.y - 14, right.position.y - 14];
    expect(Math.abs(lifts[0]! - lifts[1]!)).toBeGreaterThan(1);
    expect(Math.max(...lifts)).toBeLessThanOrEqual(2 + 1e-9);
    expect(Math.min(...lifts)).toBeGreaterThanOrEqual(-1e-9);
    // At rest the stride collapses back to neutral, never frozen mid-step.
    for (let n = 0; n < 60; n++) advanceLocomotion(body, "commander", 0, 1 / 60);
    expect(left.rotation.x).toBeCloseTo(0, 10);
    expect(right.rotation.x).toBeCloseTo(0, 10);
    expect(left.position.y).toBeCloseTo(14, 10);
    expect(right.position.y).toBeCloseTo(14, 10);
  });

  it("keeps spin and gait through exaggeration re-snaps", () => {
    const map = fakeMap();
    const group = buildUnits(map, 1);
    const tank = group.children[1] as THREE.Group;
    advanceLocomotion(tank, "stump", 8, 1 / 60);
    const walker = group.children[0] as THREE.Group;
    advanceLocomotion(walker, "commander", 4, 1 / 60);
    const legY = getLegs(walker)[0]!.position.y;
    placeUnitsGroup(group, map, 2);
    // Re-snapping moves origins/tilt only; locomotion pose survives.
    for (const wheel of getWheels(tank)) expect(wheel.rotation.x).toBeCloseTo(2);
    expect(getLegs(walker)[0]!.position.y).toBeCloseTo(legY);
  });

  it("no-ops on plain groups without wheels or legs", () => {
    const bare = new THREE.Group();
    expect(() => advanceLocomotion(bare, "stump", 10, 1 / 60)).not.toThrow();
    expect(() => advanceLocomotion(bare, "commander", 10, 1 / 60)).not.toThrow();
    expect(getWheels(bare).length).toBe(0);
    expect(getLegs(bare).length).toBe(0);
  });
});

describe("team ground rings", () => {
  function teamMap(): TNTMap {
    const width = 32;
    const height = 32;
    return {
      width,
      height,
      heights: new Uint8Array(width * height).fill(100),
      units: [
        { kind: "stump", cellX: 8, cellZ: 8, rotation: 0, team: 0 },
        { kind: "flash", cellX: 20, cellZ: 20, rotation: 0, team: 1 },
      ],
    } as unknown as TNTMap;
  }

  it("rings every hull in its side color without touching hull paint", () => {
    const group = buildUnits(teamMap(), 1);
    expect(group.children.length).toBe(2);
    group.children.forEach((child, i) => {
      const body = child as THREE.Group;
      const ring = getTeamRing(body);
      expect(ring).not.toBeNull();
      expect(ring!.name).toBe("team-ring");
      expect((ring!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
        teamRingColor(i as 0 | 1),
      );
      // Marker, not hull: damage charring skips it, the occlusion ghost
      // skips it, and it lifts just above the dirt under the scorch layer.
      expect(ring!.userData.noHighlight).toBe(true);
      expect(ring!.position.y).toBeGreaterThan(0);
      expect(ring!.position.y).toBeLessThan(2);
    });
    // Blue west, Orange east — the color-blind-safe opposition.
    expect(teamRingColor(0)).toBe(TEAM_DEFS[0].color);
    expect(teamRingColor(1)).toBe(TEAM_DEFS[1].color);
    expect(TEAM_RING_OUTER).toBeGreaterThan(TEAM_RING_INNER);
  });

  it("builds standalone rings per side and answers null on plain groups", () => {
    expect(getTeamRing(new THREE.Group())).toBeNull();
    for (const team of [0, 1] as const) {
      const ring = buildTeamRing(team);
      expect(ring.name).toBe("team-ring");
      expect((ring.material as THREE.MeshBasicMaterial).color.getHex()).toBe(teamRingColor(team));
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
  });

  it("survives exaggeration re-snaps with the body", () => {
    const map = teamMap();
    const group = buildUnits(map, 1);
    const body = group.children[0] as THREE.Group;
    placeUnitsGroup(group, map, 2);
    // Re-snapping moves origins/tilt only; the ring rides along.
    expect(getTeamRing(body)).not.toBeNull();
    expect(getTeamRing(body)!.position.y).toBeGreaterThan(0);
  });

  it("builds reinforcement bodies seated flat with team rings", () => {
    const body = buildSpawnedUnit("hammer", 1, 500, -300, -Math.PI / 2, () => 100);
    expect(body.rotation.order).toBe("YXZ");
    expect(body.rotation.y).toBe(-Math.PI / 2);
    expect(body.position.x).toBe(500);
    expect(body.position.z).toBe(-300);
    expect(body.position.y).toBe(100.5);
    // Full hull: turret subgroup + wheels + team ring, no selection marker
    // (the canvas adds that, like the mustered roster).
    expect(getTurret(body)).not.toBeNull();
    expect(getWheels(body).length).toBeGreaterThan(0);
    expect(getTeamRing(body)).not.toBeNull();
    expect(body.getObjectByName("select-marker")).toBeFalsy();
  });
});

describe("unit icon bodies (thumbnail source)", () => {
  it("reuses the real hull construction without markers", async () => {
    const { buildUnitIconBody } = await import("./units");
    const { UNIT_KINDS } = await import("@scorched-3d/core");
    for (const kind of UNIT_KINDS) {
      const body = buildUnitIconBody(kind);
      // Same turret subgroup + drive gear the field renders …
      expect(getTurret(body)).not.toBeNull();
      expect(getMuzzleTip(body)).not.toBeNull();
      if (kind === "commander") expect(getLegs(body).length).toBe(2);
      else expect(getWheels(body).length).toBe(6);
      // … but no team ring or selection marker (tray chrome owns those).
      expect(getTeamRing(body)).toBeNull();
      expect(body.getObjectByName("select-marker")).toBeFalsy();
    }
  });
});
