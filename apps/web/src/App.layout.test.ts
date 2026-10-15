import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The header diagnostics panel (TNT / tileset / grid) sits top-right at
// p-4/md:p-6 with six text rows, so its bottom edge lands around ~150px.
// The right rail (View / Probe / Units) is absolutely positioned in the
// same corner and must start below that edge, otherwise it covers the
// diagnostics up. These tests pin the rail's top offset against the
// header's footprint (Tailwind spacing: top-N = N * 0.25rem).

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "App.tsx"), "utf8");

// Right rail = the aside that hosts the View / Probe / Units panels.
function rightRailClass(): string {
  const asides = [...source.matchAll(/<aside className="([^"]*)">/g)].map((m) => m[1]!);
  const rail = asides.find((c) => c.includes("right-4"));
  expect(rail, "right-rail aside (right-4) must exist in App.tsx").toBeDefined();
  return rail!;
}

function topOffsetPx(cls: string, prefix: string): number {
  const m = cls.match(new RegExp(`${prefix}:top-(\\d+)`)) ?? cls.match(/top-(\d+)/);
  expect(m, `right rail must declare a ${prefix}:top-* offset`).not.toBeNull();
  return Number(m![1]) * 4;
}

describe("right-rail clearance over header diagnostics", () => {
  it("starts below the header diagnostics panel on mobile and desktop", () => {
    const cls = rightRailClass();
    // Header diagnostics bottom edge ≈ 150px; require ≥176px (top-44)
    // mobile and ≥192px (md:top-48) desktop.
    expect(topOffsetPx(cls, "")).toBeGreaterThanOrEqual(176);
    expect(topOffsetPx(cls, "md")).toBeGreaterThanOrEqual(192);
  });

  it("scrolls instead of overflowing short viewports", () => {
    const cls = rightRailClass();
    expect(cls).toMatch(/max-h-\[/);
    expect(cls).toMatch(/overflow-y-auto/);
  });

  it("still hosts the View, Probe and Units panels", () => {
    for (const label of ["<Label>View</Label>", "<Label>Probe</Label>", "<Label>Units</Label>"]) {
      expect(source).toContain(label);
    }
  });

  it("keeps the TNT / tileset / grid diagnostics in the header", () => {
    for (const key of [`k="TNT"`, `k="tileset"`, `k="grid"`]) {
      expect(source).toContain(key);
    }
  });
});

describe("Units panel roster without patrol status text", () => {
  it("drops the Patrolling TA status line", () => {
    expect(source).not.toContain("Patrolling");
    expect(source).not.toContain("re-routed on every regen");
  });

  it("still lists per-kind unit entries with selection + minimap dots", () => {
    expect(source).toContain("<Label>Units</Label>");
    expect(source).toContain("UNIT_KINDS.map");
    expect(source).toContain("def.unitName");
    expect(source).toContain("liveUnits.map");
    expect(source).toContain("selected.includes");
    expect(source).toContain("MINIMAP_SELECTED_OUTLINE");
  });

  it("shows both team sides with colors in the Units box and minimap", () => {
    expect(source).toContain("TEAM_IDS.map");
    expect(source).toContain("Team {def.name}");
    expect(source).toContain("alive");
    expect(source).toContain("TEAM_DEFS[team].color");
  });

  it("shows a bottom selection tray with pre-rendered icons, counts, and team top borders", () => {
    expect(source).toContain("selectedGroups");
    expect(source).toContain("groupSelection(map.units, selected)");
    expect(source).toContain("getUnitIconDataUrl(g.kind)");
    expect(source).toContain("selectionGroupColor(g.team)");
    expect(source).toContain("borderTop");
    expect(source).toContain("×{g.count}");
    expect(source).toContain("bottom-12");
  });

  it("keeps selection markers static (no pulse/spin/bob in the canvas tick)", () => {
    const canvas = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");
    expect(canvas).not.toContain("selTime");
    expect(canvas).toContain("static");
    const fx = readFileSync(join(here, "renderer", "selectionFx.ts"), "utf8");
    expect(fx).toContain("SELECTION_CHEVRON_YAW");
  });
});
