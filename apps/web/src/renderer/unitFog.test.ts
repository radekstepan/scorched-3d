import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { TNTMap, UnitKind } from "@scorched-3d/core";
import { UNIT_KINDS } from "@scorched-3d/core";
import { applyValleyFog, VALLEY_FOG_SPAN, valleyFogFactor } from "./shaders";
import {
  applyUnitFog,
  spliceUnitFogFragment,
  spliceUnitFogVertex,
  UNIT_FOG_CACHE_KEY,
  unitFogFactor,
  unitFogUniforms,
  unitHullMaterial,
  unitValleyWhitening,
} from "./unitFog";
import { applyUnitDamageTint, applyWreckChar } from "./unitDamageFx";
import { buildSpawnedUnit, buildTeamRing, buildUnitIconBody, buildUnits } from "./units";
import { DAY_LIGHTING } from "./night";

const here = dirname(fileURLToPath(import.meta.url));

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
    ],
  } as unknown as TNTMap;
}

/** Every hull Lambert material under a body (icon bodies carry no markers). */
function hullMaterials(body: THREE.Group): THREE.MeshLambertMaterial[] {
  const out: THREE.MeshLambertMaterial[] = [];
  body.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
    if (mesh.isMesh && mat && mat.isMeshLambertMaterial) out.push(mat);
  });
  return out;
}

describe("unit fog splices", () => {
  it("writes a world-Y varying after the project_vertex anchor", () => {
    const out = spliceUnitFogVertex("prefix\n#include <project_vertex>\nsuffix");
    expect(out).toContain("prefix\n#include <project_vertex>\nsuffix".slice(0, 6));
    expect(out).toContain("varying float vUnitFogY;");
    expect(out).toContain("#include <project_vertex>");
    expect(out).toContain("vUnitFogY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;");
    // Anchor preserved ahead of the write (world pos derives from it).
    expect(out.indexOf("#include <project_vertex>")).toBeLessThan(out.indexOf("vUnitFogY ="));
  });

  it("layers a valley term after the fog anchor, gated on scene fog", () => {
    const out = spliceUnitFogFragment("prefix\n#include <fog_fragment>\nsuffix");
    expect(out).toContain("uniform vec3 unitFogColor;");
    expect(out).toContain("uniform float unitValleyFog;");
    expect(out).toContain("uniform float unitWaterY;");
    expect(out).toContain("uniform float unitExaggeration;");
    expect(out).toContain("varying float vUnitFogY;");
    expect(out).toContain("#include <fog_fragment>");
    // Same smoothstep band shape as the terrain shader (span from the shared
    // constant, so the GLSL cannot drift from the JS mirror).
    expect(out).toContain(`smoothstep( unitWaterY, unitWaterY + ${VALLEY_FOG_SPAN}.0 * unitExaggeration, vUnitFogY )`);
    // Layers onto the remaining clarity like the terrain combine, reusing
    // three.js's own distance factor — no second distance computation.
    expect(out).toContain("( 1.0 - fogFactor )");
    expect(out).toContain("gl_FragColor.rgb = mix( gl_FragColor.rgb, unitFogColor,");
    // Icon/thumbnail scenes carry no scene.fog: without the gate the valley
    // term would whiten tray thumbnails toward sky blue.
    const gated = out.slice(out.indexOf("#ifdef USE_FOG"), out.indexOf("#endif"));
    expect(gated).toContain("unitFogColor");
    expect(out.indexOf("#include <fog_fragment>")).toBeLessThan(out.indexOf("#ifdef USE_FOG"));
  });

  it("anchors exist in the installed Lambert shaders", () => {
    const lambert = THREE.ShaderLib.lambert;
    expect(lambert.vertexShader).toContain("#include <project_vertex>");
    expect(lambert.fragmentShader).toContain("#include <fog_fragment>");
    // The splices apply cleanly to the real shaders (not just fixtures).
    expect(spliceUnitFogVertex(lambert.vertexShader)).toContain("vUnitFogY =");
    expect(spliceUnitFogFragment(lambert.fragmentShader)).toContain("unitFogColor");
  });
});

describe("unit fog material wiring", () => {
  it("uses a distinct program-cache key", () => {
    const mat = unitHullMaterial(0xff0000);
    expect(mat.isMeshLambertMaterial).toBe(true);
    expect(mat.color.getHex()).toBe(0xff0000);
    expect(mat.customProgramCacheKey()).toBe(UNIT_FOG_CACHE_KEY);
    expect(new THREE.MeshLambertMaterial({ color: 0xff0000 }).customProgramCacheKey()).not.toBe(
      UNIT_FOG_CACHE_KEY,
    );
  });

  it("aliases the shared uniforms and splices on compile", () => {
    const mat = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
    applyUnitFog(mat);
    const shader = {
      uniforms: {},
      vertexShader: "#include <project_vertex>",
      fragmentShader: "#include <fog_fragment>",
    };
    mat.onBeforeCompile(shader as never, {} as never);
    const uniforms = shader.uniforms as Record<string, unknown>;
    expect(uniforms.unitFogColor).toBe(unitFogUniforms.color);
    expect(uniforms.unitValleyFog).toBe(unitFogUniforms.valley);
    expect(uniforms.unitWaterY).toBe(unitFogUniforms.waterY);
    expect(uniforms.unitExaggeration).toBe(unitFogUniforms.exaggeration);
    expect(shader.vertexShader).toContain("vUnitFogY =");
    expect(shader.fragmentShader).toContain("unitFogColor");
  });

  it("fogs every hull mesh of every unit kind", () => {
    for (const kind of UNIT_KINDS as readonly UnitKind[]) {
      const mats = hullMaterials(buildUnitIconBody(kind));
      expect(mats.length).toBeGreaterThan(0);
      for (const mat of mats) {
        expect(mat.customProgramCacheKey()).toBe(UNIT_FOG_CACHE_KEY);
      }
    }
  });

  it("fogs spawned reinforcements but never the team ring", () => {
    const body = buildSpawnedUnit("hammer", 0, 10, 20, 0, () => 100);
    const mats = hullMaterials(body);
    expect(mats.length).toBeGreaterThan(0);
    for (const mat of mats) {
      expect(mat.customProgramCacheKey()).toBe(UNIT_FOG_CACHE_KEY);
    }
    // Markers are UI layers: they keep their existing distance response and
    // never take the valley term, so units stay findable in the haze.
    const ring = buildTeamRing(0);
    const ringMat = ring.material as THREE.MeshBasicMaterial;
    expect(ringMat.customProgramCacheKey()).toBe(
      new THREE.MeshBasicMaterial({ color: 0xffffff }).customProgramCacheKey(),
    );
    const group = buildUnits(fakeMap(), 1);
    const fieldRing = group.children[0]!.getObjectByName("team-ring") as THREE.Mesh;
    expect((fieldRing.material as THREE.Material).customProgramCacheKey()).toBe(
      ringMat.customProgramCacheKey(),
    );
  });

  it("survives damage tinting and the wreck char (live hulls and wrecks match)", () => {
    const body = buildUnitIconBody("stump");
    const before = hullMaterials(body);
    applyUnitDamageTint(body, 0.8);
    applyWreckChar(body);
    const after = hullMaterials(body);
    // Same material instances (charring recolors in place), keys intact.
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < after.length; i++) {
      expect(after[i]).toBe(before[i]);
      expect(after[i]!.customProgramCacheKey()).toBe(UNIT_FOG_CACHE_KEY);
    }
  });
});

describe("unit fog factor mirror", () => {
  it("matches the terrain combine at sample points (shared math)", () => {
    const dists = [0, 0.2, 0.55, 1];
    const grounds = [80, 100, 120, 200];
    for (const fogDist of dists) {
      for (const groundY of grounds) {
        expect(unitFogFactor(fogDist, groundY, 100, 1, 0.35)).toBe(
          applyValleyFog(fogDist, groundY, 100, 1, 0.35),
        );
      }
    }
  });

  it("leaves clear-ground units unchanged", () => {
    // Far above the band on open ground: no distance fog, no valley term.
    expect(unitFogFactor(0, 500, 100, 1, DAY_LIGHTING.valleyFog)).toBe(0);
    expect(unitValleyWhitening(0, 500, 100, 1, DAY_LIGHTING.valleyFog)).toBe(0);
  });

  it("is the identity at night (strength 0)", () => {
    expect(unitFogFactor(0.4, 90, 100, 1, 0)).toBe(0.4);
    expect(unitValleyWhitening(0.4, 90, 100, 1, 0)).toBe(0);
  });

  it("hazes pooled units subtly, never past the strength (readability floor)", () => {
    // Full valley at the waterline, near camera: exactly the day strength.
    expect(unitValleyWhitening(0, 100, 100, 1, DAY_LIGHTING.valleyFog)).toBe(
      DAY_LIGHTING.valleyFog,
    );
    // The valley layer can whiten at most `strength` of the shaded hull —
    // day hulls always keep >= 65% of their paint from this term alone.
    for (let d = 0; d <= 10; d++) {
      for (let g = 60; g <= 220; g += 8) {
        const w = unitValleyWhitening(d / 10, g, 100, 1, DAY_LIGHTING.valleyFog);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(DAY_LIGHTING.valleyFog);
      }
    }
    expect(valleyFogFactor(100, 100, 1)).toBe(1);
  });
});

describe("unit fog canvas wiring", () => {
  it("binds the shared field at init and tracks waterline/exaggeration per tick", () => {
    const src = readFileSync(join(here, "TerrainCanvas.tsx"), "utf8");
    expect(src).toContain('from "./unitFog"');
    expect(src).toContain("setUnitFog(");
    // Waterline + exaggeration ride the same per-tick uniform block as the
    // terrain/water exaggeration writes, so valley bands track the slider.
    expect(src).toContain("unitFogUniforms.waterY.value");
    expect(src).toContain("unitFogUniforms.exaggeration.value");
  });
});
