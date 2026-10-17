import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { TNTMap } from "@scorched-3d/core";
import {
  applyCamo,
  bakeCamoBytes,
  CAMO_TEXTURE_SIZE,
  disposeCamoTextures,
  getCamoTexture,
} from "./camo";
import { buildUnits } from "./units";
import {
  applyUnitDamageTint,
  applyWreckChar,
  charredColor,
  wreckCharredColor,
} from "./unitDamageFx";

const KINDS = ["flash", "stump", "hammer", "commander"] as const;

function stats(bytes: Uint8Array): { min: number; max: number; mean: number } {
  let min = 255;
  let max = 0;
  let sum = 0;
  const n = bytes.length / 4;
  for (let i = 0; i < bytes.length; i += 4) {
    const v = bytes[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / n };
}

function hullPaintMeshes(body: THREE.Group): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  body.traverse((child) => {
    if (child.userData.noHighlight) return;
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || child.name === "wheel" || child.userData.noCamo) return;
    const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
    if (mat && "emissive" in mat && "color" in mat) out.push(mesh);
  });
  return out;
}

describe("bakeCamoBytes", () => {
  it("is deterministic per kind and varies per kind", () => {
    for (const kind of KINDS) {
      expect(bakeCamoBytes(kind, 32)).toEqual(bakeCamoBytes(kind, 32));
    }
    // Per-kind pattern variation: every pair of kinds bakes different bytes.
    for (let a = 0; a < KINDS.length; a++) {
      for (let b = a + 1; b < KINDS.length; b++) {
        expect(bakeCamoBytes(KINDS[a]!, 32)).not.toEqual(
          bakeCamoBytes(KINDS[b]!, 32),
        );
      }
    }
  });

  it("stays subtle: near-white opaque grayscale with real pattern", () => {
    for (const kind of KINDS) {
      const bytes = bakeCamoBytes(kind, CAMO_TEXTURE_SIZE);
      expect(bytes.length).toBe(CAMO_TEXTURE_SIZE * CAMO_TEXTURE_SIZE * 4);
      const { min, max, mean } = stats(bytes);
      // Subtle: nothing darker than ~20% off the field, field near-white.
      expect(min).toBeGreaterThanOrEqual(200);
      expect(mean).toBeGreaterThanOrEqual(238);
      expect(max).toBeLessThanOrEqual(255);
      // But a real pattern: blotches dip below the field, grain spreads it.
      expect(min).toBeLessThan(245);
      expect(max - min).toBeGreaterThan(4);
      for (let i = 0; i < bytes.length; i += 4) {
        // Grayscale (hue-preserving multiply) and fully opaque.
        expect(bytes[i]).toBe(bytes[i + 1]);
        expect(bytes[i]).toBe(bytes[i + 2]);
        expect(bytes[i + 3]).toBe(255);
      }
    }
  });
});

describe("getCamoTexture", () => {
  it("shares one texture per kind across calls and bodies", () => {
    for (const kind of KINDS) {
      const a = getCamoTexture(kind);
      expect(getCamoTexture(kind)).toBe(a);
      expect(a.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(a.image.width).toBe(CAMO_TEXTURE_SIZE);
    }
    expect(getCamoTexture("flash")).not.toBe(getCamoTexture("stump"));
    disposeCamoTextures();
    // Disposal drops the cache: the next call bakes fresh.
    const before = getCamoTexture("flash");
    disposeCamoTextures();
    expect(getCamoTexture("flash")).not.toBe(before);
    disposeCamoTextures();
  });
});

describe("applyCamo", () => {
  function camoMap(): TNTMap {
    const width = 32;
    const height = 32;
    return {
      width,
      height,
      heights: new Uint8Array(width * height).fill(100),
      units: [
        { kind: "stump", cellX: 8, cellZ: 8, rotation: 0, team: 0 },
        { kind: "flash", cellX: 20, cellZ: 20, rotation: 0, team: 1 },
        { kind: "commander", cellX: 12, cellZ: 20, rotation: 0, team: 0 },
      ],
    } as unknown as TNTMap;
  }

  it("dresses hull paint in the kind texture, skipping wheels and markers", () => {
    const group = buildUnits(camoMap(), 1);
    expect(group.children.length).toBe(3);
    group.children.forEach((child, i) => {
      const body = child as THREE.Group;
      const kind = (camoMap().units[i] as { kind: (typeof KINDS)[number] }).kind;
      const painted = hullPaintMeshes(body);
      expect(painted.length).toBeGreaterThan(0);
      for (const mesh of painted) {
        expect((mesh.material as THREE.MeshLambertMaterial).map).toBe(
          getCamoTexture(kind),
        );
      }
      // Road wheels stay flat rubber: no camo map.
      for (const wheel of body.children.filter((c) => c.name === "wheel")) {
        expect(
          (wheel as THREE.Mesh & { material: THREE.MeshLambertMaterial }).material
            .map,
        ).toBeNull();
      }
      // Team ring marker untouched (still unmapped, still no-highlight).
      const ring = body.getObjectByName("team-ring")!;
      expect(ring.userData.noHighlight).toBe(true);
      expect(
        (ring as THREE.Mesh & { material: THREE.MeshBasicMaterial }).material.map,
      ).toBeNull();
    });
    // Per-kind sharing on built bodies: same kind shares, kinds differ.
    disposeCamoTextures();
  });

  it("never tints hull paint and preserves damage/wreck char math", () => {
    const group = buildUnits(camoMap(), 1);
    const body = group.children[0] as THREE.Group; // stump
    const painted = hullPaintMeshes(body);
    const before = painted.map((m) => ({
      mesh: m,
      hex: (m.material as THREE.MeshLambertMaterial).color.getHex(),
    }));
    // Re-application is idempotent: same shared map, colors untouched.
    applyCamo(body, "stump");
    for (const { mesh, hex } of before) {
      expect((mesh.material as THREE.MeshLambertMaterial).map).toBe(
        getCamoTexture("stump"),
      );
      expect((mesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(hex);
    }
    // Damage charring still lerps from the stashed base with the map aboard.
    const target = before[0]!;
    applyUnitDamageTint(body, 1);
    expect((target.mesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(
      charredColor(target.hex, 1),
    );
    expect((target.mesh.material as THREE.MeshLambertMaterial).map).toBe(
      getCamoTexture("stump"),
    );
    // Exploded-husk char still lands past the readable cap with camo aboard.
    applyWreckChar(body);
    expect((target.mesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(
      wreckCharredColor(target.hex),
    );
    expect((target.mesh.material as THREE.MeshLambertMaterial).map).toBe(
      getCamoTexture("stump"),
    );
    disposeCamoTextures();
  });

  it("no-ops on plain groups without meshes", () => {
    expect(() => applyCamo(new THREE.Group(), "flash")).not.toThrow();
    disposeCamoTextures();
  });
});
