import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { UNIT_DEFS, UNIT_KINDS, type TeamId, type UnitKind } from "@scorched-3d/core";
import { buildSpawnedUnit, buildUnitIconBody } from "./units";
import {
  applyUnitDamageTint,
  applyWreckChar,
  charredColor,
  wreckCharredColor,
} from "./unitDamageFx";
import { TEAM_HULL_PAINT, TEAM_HULL_PANEL, teamLivery } from "./teamPaint";

/** Every hull Lambert material hex under a body (rings are Basic: excluded). */
function hullHexes(body: THREE.Group): number[] {
  const out: number[] = [];
  body.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
    if (mesh.isMesh && mat && mat.isMeshLambertMaterial) out.push(mat.color.getHex());
  });
  return out;
}

/** Hull Lambert meshes with their stashed damage-char base colors. */
function basedMeshes(body: THREE.Group): { mat: THREE.MeshLambertMaterial; base: number }[] {
  const out: { mat: THREE.MeshLambertMaterial; base: number }[] = [];
  body.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
    const base = mesh.userData.baseColor as number | undefined;
    if (mesh.isMesh && mat && mat.isMeshLambertMaterial && typeof base === "number") {
      out.push({ mat, base });
    }
  });
  return out;
}

/** Relative luminance of a hex (rec. 709 weights on sRGB channels). */
function luminance(hex: number): number {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("team livery", () => {
  it("pins the exact team paint hexes", () => {
    // Blue reuses the commander hull blue exactly; orange is that blue
    // hue-rotated into the team's established orange family at the same
    // saturation/lightness, so both sides pop equally.
    expect(teamLivery(0)).toEqual({ paint: 0x3d719b, panel: 0x81a3be });
    expect(teamLivery(1)).toEqual({ paint: 0x9b673d, panel: 0xbe9c81 });
    expect(TEAM_HULL_PAINT[0]).toBe(0x3d719b);
    expect(TEAM_HULL_PAINT[1]).toBe(0x9b673d);
    expect(TEAM_HULL_PANEL[0]).toBe(0x81a3be);
    expect(TEAM_HULL_PANEL[1]).toBe(0xbe9c81);
  });

  it("keeps panels lighter than paint on both sides", () => {
    for (const team of [0, 1] as const) {
      expect(luminance(TEAM_HULL_PANEL[team]!)).toBeGreaterThan(
        luminance(TEAM_HULL_PAINT[team]!),
      );
    }
  });

  it("paints every kind in its side's livery, with no cross-team paint", () => {
    for (const kind of UNIT_KINDS as readonly UnitKind[]) {
      for (const team of [0, 1] as const) {
        const other = (1 - team) as TeamId;
        const hexes = hullHexes(buildSpawnedUnit(kind, team, 0, 0, 0, () => 0));
        expect(hexes).toContain(TEAM_HULL_PAINT[team]);
        expect(hexes).toContain(TEAM_HULL_PANEL[team]);
        expect(hexes).not.toContain(TEAM_HULL_PAINT[other]);
        expect(hexes).not.toContain(TEAM_HULL_PANEL[other]);
      }
    }
  });

  it("keeps tray icon bodies team-neutral", () => {
    for (const kind of UNIT_KINDS as readonly UnitKind[]) {
      const hexes = hullHexes(buildUnitIconBody(kind));
      expect(hexes).not.toContain(TEAM_HULL_PAINT[1]);
      expect(hexes).not.toContain(TEAM_HULL_PANEL[1]);
      expect(hexes).not.toContain(TEAM_HULL_PANEL[0]);
      // Commander kind paint IS the blue livery, so only its panel
      // distinguishes the neutral thumbnail from a blue-side hull.
      if (kind !== "commander") expect(hexes).not.toContain(TEAM_HULL_PAINT[0]);
    }
    // Tank lower strakes keep their own kind colors in neutral builds
    // (they only join the main paint under a team livery).
    for (const kind of ["stump", "flash", "hammer"] as const) {
      expect(hullHexes(buildUnitIconBody(kind))).toContain(UNIT_DEFS[kind].color);
    }
  });

  it("chars team paint readably while live, then kills it on wrecks", () => {
    for (const kind of UNIT_KINDS as readonly UnitKind[]) {
      for (const team of [0, 1] as const) {
        const paint = TEAM_HULL_PAINT[team]!;
        const panel = TEAM_HULL_PANEL[team]!;
        const body = buildSpawnedUnit(kind, team, 0, 0, 0, () => 0);
        applyUnitDamageTint(body, 1);
        // Fully battered hulls keep a readable brown derived from the
        // team base — the livery survives damage, muted, never neon.
        const battered = basedMeshes(body).filter((m) => m.base === paint);
        expect(battered.length).toBeGreaterThan(0);
        for (const m of battered) {
          expect(m.mat.color.getHex()).toBe(charredColor(paint, 1));
        }
        applyWreckChar(body);
        // Wrecks read as dead: no team paint survives, every hull mesh
        // sits at the near-black wreck char of its stashed base.
        expect(hullHexes(body)).not.toContain(paint);
        expect(hullHexes(body)).not.toContain(panel);
        const husks = basedMeshes(body);
        expect(husks.length).toBeGreaterThan(0);
        for (const m of husks) {
          expect(m.mat.color.getHex()).toBe(wreckCharredColor(m.base));
        }
      }
    }
  });
});
