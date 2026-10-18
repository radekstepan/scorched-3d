import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Veterancy wiring at the source level (the canvas needs WebGL; rank math
// is covered in core veterancy.test.ts, kill credit in combatFx.test.ts,
// and badges + flourish in veterancyFx.test.ts).

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");
const canvasSource = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");

describe("veterancy canvas wiring", () => {
  it("builds, ticks, and disposes the chevron layer with the roster", () => {
    expect(canvasSource).toContain("new VeterancyFx(scene, units.children.length)");
    expect(canvasSource).toContain("veterans.setVisible(opt.showHealth)");
    expect(canvasSource).toContain("veterans.update(combat, units.children, camera, dt, unitVisible)");
    expect(canvasSource).toContain("veterans.setCount(units.children.length)");
    expect(canvasSource).toContain("veterans.clearTransients()");
    expect(canvasSource).toContain("veterans.dispose()");
  });

  it("plays the promotion flourish from the combat hook", () => {
    expect(canvasSource).toContain("combat.onUnitPromoted = (index, rank) => {");
    expect(canvasSource).toContain("veterans.promote(index, rank, units.children[index])");
  });

  it("broadcasts ranks with the live positions", () => {
    expect(canvasSource).toContain("rank: combat.rankAt(i)");
  });
});

describe("veterancy selection tray", () => {
  it("carries ranks in the live-units state", () => {
    expect(appSource).toContain("alive: boolean; rank: number");
  });

  it("shows gold chevrons + the rank name for ranked selections", () => {
    expect(appSource).toContain("VETERAN_RANK_NAMES");
    expect(appSource).toContain("liveUnits[i]?.rank ?? 0");
    expect(appSource).toContain('"▲".repeat(maxRank)');
    expect(appSource).toContain("· ${rankName}");
  });
});
