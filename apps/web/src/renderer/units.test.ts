import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { TNTMap } from "@scorched-3d/core";
import {
  barrelElevation,
  buildUnits,
  getBarrel,
  getMuzzleTip,
  getTurret,
  muzzleWorld,
  placeUnitsGroup,
  restBarrelElevation,
  setBarrelElevation,
  setUnitAim,
} from "./units";

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
      const hullMeshes = body.children.filter((c) => c.type === "Mesh").length;
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
