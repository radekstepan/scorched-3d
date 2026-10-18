import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Indexed-filter toggle removal at the source level (the canvas needs
// WebGL): the View panel offers no texture-filter choice and the terrain
// albedo stays nearest-filtered — the old toggle-on default — so the
// indexed TNT pixels render crisp at every zoom.

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");
const canvasSource = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");
const coreTypes = readFileSync(
  join(here, "..", "..", "..", "packages", "core", "src", "terrain", "types.ts"),
  "utf8",
);

describe("indexed filter toggle removal", () => {
  it("drops pixelFilter from the core view options", () => {
    expect(coreTypes).not.toContain("pixelFilter");
  });

  it("offers no Indexed filter toggle in the View panel", () => {
    expect(appSource).not.toContain("Indexed filter");
    expect(appSource).not.toContain("pixelFilter");
  });

  it("pins the terrain albedo to nearest sampling at creation", () => {
    expect(canvasSource).not.toContain("pixelFilter");
    expect(canvasSource).toContain("const albedoTex = imageDataTexture(albedoData, false);");
    expect(canvasSource).toContain("albedoTex.minFilter = THREE.NearestFilter;");
    expect(canvasSource).toContain("albedoTex.magFilter = THREE.NearestFilter;");
  });

  it("never re-switches the albedo filters per tick", () => {
    // The old per-frame mag/min branch is gone; the only albedo filter
    // writes are the creation-time pins above (height/territory textures
    // keep their own linear sampling).
    const writes = canvasSource.match(/albedoTex\.(magFilter|minFilter)\s*=/g) ?? [];
    expect(writes).toHaveLength(2);
  });
});
