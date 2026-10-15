import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Dead units must vanish from the minimap immediately on death (both
// teams): no dimmed grey wreck dots. The canvas needs WebGL, so this pins
// the overlay wiring at source level — the live-unit dot block returns null
// for dead slots and carries no wreck-grey styling (HQ fort squares keep
// their own grey-when-destroyed marker further below).

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");

// The live-unit dot block: from the liveUnits overlay map up to (but not
// including) the HQ fort markers.
function unitDotBlock(): string {
  const start = appSource.indexOf("liveUnits.map");
  const end = appSource.indexOf("hqs.map");
  expect(start, "liveUnits.map overlay must exist in App.tsx").toBeGreaterThanOrEqual(0);
  expect(end, "hqs.map overlay must exist in App.tsx").toBeGreaterThan(start);
  return appSource.slice(start, end);
}

describe("dead units stay off the minimap", () => {
  it("returns null for dead slots before rendering any dot", () => {
    const block = unitDotBlock();
    expect(block).toContain("p.alive === false");
    expect(block).toContain("return null");
  });

  it("carries no wreck-grey styling on unit dots", () => {
    const block = unitDotBlock();
    expect(block, "unit dots must not render wreck grey").not.toContain("#57534e");
    expect(block, "unit dots must not dim wrecks").not.toContain("0.55");
    expect(block, "unit dots must not branch on a wrecked flag").not.toContain("wrecked");
  });

  it("keeps live-dot identity: kind color, team outline, selection glow", () => {
    const block = unitDotBlock();
    expect(block).toContain("UNIT_DEFS[kind].color");
    expect(block).toContain("TEAM_DEFS[team]");
    expect(block).toContain("MINIMAP_SELECTED_OUTLINE");
    expect(block).toContain("MINIMAP_SELECTED_GLOW");
  });
});
