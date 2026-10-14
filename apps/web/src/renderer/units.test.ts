import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { TNTMap } from "@scorched-3d/core";
import { buildUnits, getTurret, placeUnitsGroup, setUnitAim } from "./units";

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
