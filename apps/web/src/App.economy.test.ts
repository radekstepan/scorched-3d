import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Economy-lite wiring at the source level (the canvas needs WebGL; share
// math is covered in core influence.test.ts, the spawn scale in core
// hq.test.ts, and the clock + status in hqFx.test.ts).

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");
const canvasSource = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");

describe("economy-lite spawn clock", () => {
  it("feeds the live territory share into the HQ clock every tick", () => {
    expect(canvasSource).toContain("territoryShare(territory.field, t)");
    expect(canvasSource).toContain("hq?.update(dt, territoryShare(territory.field, t))");
  });
});

describe("factories panel", () => {
  it("is not rendered (removed per user request)", () => {
    expect(appSource).not.toContain("<Label>Factories</Label>");
    expect(appSource).not.toContain("% ground");
    expect(appSource).not.toContain("builds");
  });

  it("keeps HQ fort markers on the minimap", () => {
    expect(appSource).toContain("minimapHq");
    expect(appSource).toContain("hq-");
  });
});
