import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Double-click same-type selection wiring at the source level (the canvas
// needs WebGL; the match math is covered headless in selection.test.ts and
// the on-screen predicate in viewCull.test.ts).

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");
const canvasSource = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");

describe("double-click selection wiring", () => {
  it("hooks and unhooks a dblclick listener on the canvas", () => {
    expect(canvasSource).toContain('addEventListener("dblclick", onDoubleClick);');
    expect(canvasSource).toContain('removeEventListener("dblclick", onDoubleClick);');
  });

  it("expands the anchor through the shared hit resolver, not a new pick path", () => {
    // The double-clicked unit resolves exactly like a single click
    // (raycast first, else nearest projection, wrecks unpickable), so the
    // anchor can never disagree with what the two preceding clicks saw.
    expect(canvasSource).toContain("const onDoubleClick = (ev: MouseEvent) => {");
    expect(canvasSource).toContain("const anchor = resolveClickHit(ev.clientX, ev.clientY);");
  });

  it("groups by kind + team over the strict on-screen set, wrecks excluded", () => {
    // Always replaces (no Shift branch — matches retail); the NDC
    // on-screen test keeps hulls just past the viewport edge out, where
    // the generous view-sphere gate would have pulled them in.
    expect(canvasSource).toContain("doubleClickSelect(anchor, placed, computeOnScreen(");
    expect(canvasSource).toContain("combat.isDestroyedAt(i)");
    const handler = canvasSource.match(/const onDoubleClick = \(ev: MouseEvent\) => \{[\s\S]*?\n    \};/);
    expect(handler?.[0]).toBeDefined();
    expect(handler?.[0]).not.toContain("shiftKey");
  });

  it("ignores non-left buttons and the suspended folio view", () => {
    expect(canvasSource).toMatch(
      /const onDoubleClick = \(ev: MouseEvent\) => \{\s+if \(suspendedRef\.current\) return;\s+if \(ev\.button !== 0\) return;/,
    );
  });

  it("documents the gesture in the HUD footer", () => {
    expect(appSource).toContain("DOUBLE-CLICK same type");
  });
});
