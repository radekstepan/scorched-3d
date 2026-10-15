import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The View panel hosts Pan/Zoom speed sliders (0.2x–3x; pan defaults 3x,
// zoom defaults 2x) that scale keyboard + right-drag panning and
// scroll-wheel zoom. These tests pin the App ↔ TerrainCanvas wiring at the
// source level (the canvas needs WebGL, so live-control assertions live in
// cameraPan.test.ts instead).

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");
const canvasSource = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");

describe("camera speed sliders in the View menu", () => {
  it("defaults pan to 3x and zoom to 2x in the View options state", () => {
    expect(appSource).toMatch(/panSpeed:\s*3/);
    expect(appSource).toMatch(/zoomSpeed:\s*2/);
  });

  it("renders Pan and Zoom speed sliders wired to the view options", () => {
    expect(appSource).toContain('label="Pan speed"');
    expect(appSource).toContain('label="Zoom speed"');
    expect(appSource).toContain("options.panSpeed");
    expect(appSource).toContain("options.zoomSpeed");
    expect(appSource).toContain("patch({ panSpeed:");
    expect(appSource).toContain("patch({ zoomSpeed:");
  });

  it("feeds the speeds into OrbitControls and the keyboard pan step", () => {
    expect(canvasSource).toContain("controls.panSpeed");
    expect(canvasSource).toContain("controls.zoomSpeed");
    expect(canvasSource).toContain("clampPanSpeed");
    expect(canvasSource).toContain("clampZoomSpeed");
    expect(canvasSource).toContain("panStepDistance");
  });
});
