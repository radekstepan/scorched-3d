import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Overhead health bars read through smoke at glancing angles, so they are
// on by default — the Health toggle in the View panel only opts out. These
// tests pin the App ↔ TerrainCanvas wiring at the source level (the canvas
// needs WebGL; bar rendering itself is covered in healthBars.test.ts).

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");
const canvasSource = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");

describe("health bars on by default", () => {
  it("defaults showHealth to true in the View options state", () => {
    expect(appSource).toMatch(/showHealth:\s*true/);
  });

  it("keeps a working Health toggle wired to the view options", () => {
    expect(appSource).toContain('label="Health"');
    expect(appSource).toContain("options.showHealth");
    expect(appSource).toContain("patch({ showHealth:");
  });

  it("feeds the flag into the HealthBars visibility tick", () => {
    expect(canvasSource).toContain("health.setVisible(");
    expect(canvasSource).toContain("showHealth");
  });
});

describe("hq health shares the toggle", () => {
  it("sizes the HQ bar roster next to the unit roster", () => {
    expect(canvasSource).toContain("health.setHqCount(");
  });

  it("ticks live HQ damage into bars behind the same flag", () => {
    expect(canvasSource).toContain("health.updateHq(");
    expect(canvasSource).toContain("groupAt(");
  });
});
