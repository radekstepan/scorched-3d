import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Territory overlay wiring at the source level (the canvas needs WebGL;
// field math is covered in core influence.test.ts, texture/cadence in
// territory.test.ts, and the shader mix in shaders.test.ts).

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");
const canvasSource = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");
const territorySource = readFileSync(join(here, "renderer", "territory.ts"), "utf8");

describe("territory toggle", () => {
  it("defaults showTerritory to false in the View options state", () => {
    expect(appSource).toMatch(/showTerritory:\s*false/);
  });

  it("keeps a working Territory toggle wired to the view options", () => {
    expect(appSource).toContain('label="Territory"');
    expect(appSource).toContain("options.showTerritory");
    expect(appSource).toContain("patch({ showTerritory:");
  });

  it("drives the overlay visibility from the flag every tick", () => {
    expect(canvasSource).toContain("territory.setVisible(opt.showTerritory, t)");
    expect(canvasSource).toContain("territory.update(roster, t, opt.showTerritory)");
  });

  it("stamps live hulls and live forts, never wrecks-as-live", () => {
    // Wrecks keep fading history by simply not stamping (alive:false skips).
    expect(canvasSource).toContain("alive: !combat.isDestroyedAt(i)");
    expect(canvasSource).toContain("alive: s.alive");
  });

  it("disposes the overlay texture on unmount/regen", () => {
    expect(canvasSource).toContain("territory.dispose()");
  });
});

describe("territory minimap overlay", () => {
  it("broadcasts the paint at the 4 Hz cadence, cleared while hidden", () => {
    expect(appSource).toContain("onTerritory={setTerritory}");
    expect(canvasSource).toContain("territoryRef.current?.(opt.showTerritory ? territory.minimap() : null)");
    expect(canvasSource).toContain("territoryRef.current?.(null);");
  });

  it("paints broadcasts into an overlay canvas under the dots", () => {
    expect(appSource).toContain("territoryCanvasRef");
    expect(appSource).toContain("putImageData(new ImageData(territory.data, territory.cols, territory.rows), 0, 0)");
    // Canvas sits between the terrain image and the live dots (dots above).
    const imgAt = appSource.indexOf('alt="Minimap"');
    const canvasAt = appSource.indexOf("territoryCanvasRef}");
    const dotsAt = appSource.indexOf("{minimapDots}");
    expect(imgAt).toBeGreaterThanOrEqual(0);
    expect(canvasAt).toBeGreaterThan(imgAt);
    expect(dotsAt).toBeGreaterThan(canvasAt);
  });

  it("keeps the overlay canvas out of the click/dot layout box", () => {
    // Same rule as the minimap frame: absolutely positioned, so clicks and
    // dots keep measuring against the image content box.
    const canvasTag = appSource.match(/<canvas[\s\S]*?territoryCanvasRef[\s\S]*?\/>/)?.[0] ?? "";
    expect(canvasTag).toContain("absolute inset-0");
    expect(canvasTag).toContain("hidden={!options.showTerritory}");
  });
});

describe("territory perf budget", () => {
  it("repaints at 4 Hz, not per frame", () => {
    expect(territorySource).toContain("TERRITORY_PAINT_INTERVAL = 0.25");
  });

  it("shares one buffer between the 3D texture and the minimap copy", () => {
    // One paint feeds both surfaces: the texture reads the live buffer, the
    // minimap gets a copy (React state must never alias the live buffer).
    expect(territorySource).toContain("new THREE.DataTexture(this.buffer,");
    expect(territorySource).toContain("data: this.buffer.slice()");
  });
});
