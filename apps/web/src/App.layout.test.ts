import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// WebGL stays outside the DOM test harness. These source-level contracts
// guard structural layout and control wiring, as in the other App tests.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "App.tsx"), "utf8");
const css = readFileSync(join(here, "index.css"), "utf8");

describe("RTS command shell", () => {
  it("reserves independent grid tracks for rails and battlefield", () => {
    expect(css).toContain("grid-template: 68px minmax(0, 1fr) 30px / 244px minmax(0, 1fr) 244px");
    expect(css).toMatch(/\.battlefield\s*\{[^}]*grid-column: 2;[^}]*grid-row: 2/);
    expect(css).toMatch(/\.worlds-rail\s*\{[^}]*grid-column: 1;[^}]*grid-row: 2/);
    expect(css).toMatch(/\.inspector-rail\s*\{[^}]*grid-column: 3;[^}]*grid-row: 2/);
    expect(source.indexOf("<TerrainCanvas")).toBeGreaterThan(source.indexOf('<main className="battlefield"'));
    expect(source.indexOf("<TerrainCanvas")).toBeLessThan(source.indexOf("</main>"));
  });

  it("aligns desktop navigation with viewport content using the shell's own tracks", () => {
    const desktop = css.split("@media (max-width: 1000px)")[0] ?? "";
    const rule = (selector: string) => desktop.slice(desktop.indexOf(`${selector} {`)).split("}")[0] ?? "";
    expect(rule(".command-header")).toContain("display: grid;");
    expect(rule(".command-header")).toContain("grid-template-columns: subgrid;");
    expect(rule(".command-nav")).toContain("grid-column: 2;");
    expect(rule(".battlefield")).toContain("grid-column: 2;");
    // The button's padding completes the viewport heading's 18px inset.
    const navInset = Number(rule(".command-nav").match(/padding-left: (\d+)px/)?.[1]);
    const buttonInset = Number(rule(".command-nav > *").match(/padding: 0 (\d+)px/)?.[1]);
    const headingInset = Number(rule(".viewport-heading").match(/left: (\d+)px/)?.[1]);
    expect(navInset + buttonInset).toBe(headingInset);
  });

  it("restores compact navigation after the desktop tracks collapse on mobile", () => {
    const mobile = css.split("@media (max-width: 1000px)")[1];
    expect(mobile).toMatch(/\.command-header\s*\{[^}]*display: flex;/);
    expect(mobile).toMatch(/\.command-brand\s*\{[^}]*margin-left: 0;/);
    expect(mobile).toMatch(/\.command-nav\s*\{[^}]*margin-left: auto;[^}]*padding-left: 0;/);
  });

  it("scrolls both rails and selection cards inside their available space", () => {
    expect(css).toMatch(/\.command-rail\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.selection-tray\s*\{[^}]*left: 12px;[^}]*right: 12px;[^}]*overflow-x: auto/);
    expect(source.indexOf('aria-label="Selected units"')).toBeLessThan(source.indexOf("</main>"));
  });

  it("replaces narrow-screen rails with mutually exclusive accessible drawers", () => {
    expect(source).toContain('useState<"worlds" | "inspector" | null>(null)');
    for (const panel of ["worlds", "inspector"]) {
      expect(source).toContain(`aria-controls="${panel}-panel"`);
      expect(source).toContain(`id="${panel}-panel"`);
      expect(source).toContain(`aria-expanded={mobilePanel === "${panel}"}`);
      expect(source).toContain(`setMobilePanel(mobilePanel === "${panel}" ? null : "${panel}")`);
    }
    expect(css).toContain("@media (max-width: 1000px)");
    expect(css).toMatch(/\.command-rail\s*\{ display: none; position: absolute; grid-area: auto; top: 96px; bottom: 28px/);
    expect(css).toContain('.command-shell[data-mobile-panel="worlds"] .worlds-rail { display: flex; }');
    expect(css).toContain('.command-shell[data-mobile-panel="inspector"] .inspector-rail { display: block; }');
  });

  it("keeps view controls, diagnostics and readable keyboard focus", () => {
    for (const label of ["View", "Probe", "Units"]) expect(source).toContain(`<Label>${label}</Label>`);
    for (const key of ["TNT", "tileset", "grid"]) expect(source).toContain(`k="${key}"`);
    expect(source).toContain("<summary>Terrain diagnostics</summary>");
    expect(source).toContain("aria-pressed={on}");
    expect(source).toContain("aria-pressed={preset === p}");
    expect(css).toContain("button:focus-visible, input:focus-visible, summary:focus-visible");
  });
});

describe("Units panel live per-kind counts", () => {
  it("lists only live per-kind counts in commander … hammer order", () => {
    expect(source).toContain("<Label>Units</Label>");
    expect(source).toContain("UNIT_KINDS.map");
    expect(source).toContain("countLiveUnitsByKind(map.units, liveUnits)");
    expect(source).toContain("liveCounts[k]");
    expect(source).toContain("def.name");
    expect(source).toContain("×{liveCounts[k]}");
  });

  it("drops the long explainer, team rows, HQ rows, and catalog columns", () => {
    for (const snippet of [
      "Blue holds the west",
      "blast scorch",
      "Waypoints overlay",
      "right-click the terrain",
      "shift-click to extend",
      "TEAM_IDS.map",
      "Team {def.name}",
      "HQ {def.name}",
      "def.unitName",
      "alive}/{roster}",
      "+{h.spawned} sent",
    ]) {
      expect(source, `Units panel must not contain ${JSON.stringify(snippet)}`).not.toContain(snippet);
    }
  });

  it("keeps live minimap dots and HQ fort markers", () => {
    expect(source).toContain("liveUnits.map");
    expect(source).toContain("selected.includes");
    expect(source).toContain("MINIMAP_SELECTED_OUTLINE");
    expect(source).toContain("onHq={setHqs}");
    expect(source).toContain("hqs.map");
    expect(source).toContain("hq-${h.team}");
    expect(source).toContain("TEAM_DEFS[h.team]");
  });

  it("shows a bottom selection tray with pre-rendered icons, counts, and team top borders", () => {
    expect(source).toContain("selectedGroups");
    expect(source).toContain("groupSelection(map.units, selected)");
    expect(source).toContain("getUnitIconDataUrl(g.kind)");
    expect(source).toContain("selectionGroupColor(g.team)");
    expect(source).toContain("borderTop");
    expect(source).toContain("×{g.count}");
    expect(source).toContain('className="selection-tray"');
  });

  it("keeps selection markers static (no pulse/spin/bob in the canvas tick)", () => {
    const canvas = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");
    expect(canvas).not.toContain("selTime");
    expect(canvas).toContain("static");
    const fx = readFileSync(join(here, "renderer", "selectionFx.ts"), "utf8");
    expect(fx).toContain("SELECTION_CHEVRON_YAW");
  });

  it("fields map-end HQ forts with spawn, damage, and broadcast wiring", () => {
    const canvas = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");
    // The canvas builds forts on the map's own sited cells (whose pads were
    // leveled and whose exit roads were painted for exactly those cells),
    // keeping a fresh siting only as a synthetic-map fallback.
    expect(canvas).toContain("map.hqs ?? placeHqs(map, map.seed)");
    expect(canvas).toContain("new HqFx");
    expect(canvas).toContain("onSpawn");
    expect(canvas).toContain("buildSpawnedUnit");
    expect(canvas).toContain("movement.addUnit");
    expect(canvas).toContain("damageStructures");
    expect(canvas).toContain("detonateStructure");
    expect(canvas).toContain("hq?.update(dt)");
    expect(canvas).toContain("hq?.resnap()");
    expect(canvas).toContain("hqRef.current?.(hq?.status()");
  });
});
